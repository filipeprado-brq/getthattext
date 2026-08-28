import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  Tray,
} from "electron";
import { join } from "node:path";
import type { Command } from "../shared/bridge";
import { applyDictionary } from "../shared/dictionary";
import { formatElapsed } from "../shared/elapsed";
import { PRESENTATION, type State } from "../shared/states";
import { SHORTCUT_ACCELERATOR, SHORTCUT_LABEL } from "../shared/shortcut";
import { prepareIcons, showIcon, stopIconAnimation } from "./trayIcon";
import {
  isShortcutRegistered,
  keepShortcutRegistered,
  releaseShortcut,
  warnIfShortcutMissing,
} from "./shortcut";
import { dictionary } from "./dictionary";
import { rewriteOrRaw } from "./groq";
import { preferences, setPreference } from "./preferences";
import { hasSpeech, transcribe } from "./whisper";

/**
 * O app vive na barra de menu e não tem janela visível.
 *
 * O renderer existe só porque `getUserMedia` é API web e não há equivalente
 * no processo main — ele fica oculto, fazendo captura e mais nada.
 */
let hidden: BrowserWindow | undefined;
let tray: Tray | undefined;

let state: State = "idle";

/**
 * A última ditação, nas duas formas anteriores à reescrita.
 *
 * SÓ MEMÓRIA, de propósito: isto não é histórico e nada disso vai para o
 * disco. Existe porque a reescrita pode distorcer, e o texto longo é
 * justamente onde você menos pega o erro — o cru recuperável é o seguro
 * barato que dispensa uma janela de revisão a cada ditação.
 *
 * São DUAS de propósito. `heard` é o que o Whisper literalmente entregou, e
 * é o que o #8 precisa para você apontar a palavra que saiu errada.
 * `corrected` já passou pelo dicionário, e é o que vai para o clipboard —
 * o menu nunca pode PIORAR o que você tem, e entregar o literal depois de
 * uma ditação degradada faria exatamente isso.
 *
 * Uma gravação sem fala não apaga a anterior: ela não produziu nada, então
 * não tem o que substituir.
 */
type Dictation = { heard: string; corrected: string };

let lastDictation: Dictation | undefined;

/** Quanto tempo um estado terminal fica visível antes de voltar a ocioso. */
const TERMINAL_MS = 2000;

let terminalTimer: ReturnType<typeof setTimeout> | undefined;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

function setState(next: State): void {
  const { icon, tooltip, chime, fades } = PRESENTATION[next];

  state = next;
  clearTimeout(terminalTimer);
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;

  if (tray) {
    tray.setTitle("");
    tray.setToolTip(`getthattext — ${tooltip}`);
    showIcon(tray, icon);
  }

  if (chime && preferences().sound) send("blip");
  if (fades) terminalTimer = setTimeout(() => setState("idle"), TERMINAL_MS);
}

/**
 * Mostra o tempo de gravação ao lado do ícone, enquanto grava.
 *
 * O vermelho respirando pode passar despercebido numa barra cheia, e uma
 * pulsação lenta se confunde com artefato de renderização; um número que
 * muda a cada segundo não se confunde com nada. Também mostra a distância
 * do teto de 2 minutos, que hoje só se descobre batendo nele.
 *
 * Começa quando o ÁUDIO começa, não no clique: o tempo de abertura do
 * microfone não está no WAV, e contá-lo faria o número mentir sobre quanto
 * foi gravado.
 */
function startElapsedCounter(): void {
  clearInterval(elapsedTimer);
  const startedAt = Date.now();

  const tick = (): void => tray?.setTitle(` ${formatElapsed(Date.now() - startedAt)}`);
  tick();
  elapsedTimer = setInterval(tick, 500);
}

function send(command: Command): void {
  hidden?.webContents.send("command", command);
}

/**
 * O clique no ícone e o atalho, que fazem a mesma coisa.
 *
 * Um estado terminal ainda visível já aceita uma ditação nova: engolir o
 * clique nesse intervalo faria você achar que o app travou justamente
 * quando ele acabou de dar certo. Em "processando" o clique é ignorado —
 * uma segunda ditação enquanto a primeira transcreve exigiria fila.
 */
function toggle(): void {
  const { click } = PRESENTATION[state];

  if (click === "start") {
    setState("opening");
    send("start");
  } else if (click === "stop") {
    setState("processing");
    send("stop");
  }
}


function createHiddenWindow(): void {
  hidden = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void hidden.loadFile(join(__dirname, "../renderer/index.html"));
}

function createTray(): void {
  // O Tray exige uma imagem no construtor; `setState` troca pela do estado
  // logo em seguida.
  tray = new Tray(prepareIcons());
  setState("idle");

  // Clique esquerdo alterna; clique direito abre o menu. No macOS, definir
  // um menu de contexto faz o clique esquerdo abri-lo também, então o menu
  // é mostrado sob demanda em vez de fixado no tray.
  tray.on("click", toggle);
  tray.on("right-click", () => {
    const shortcutRegistered = isShortcutRegistered();
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Ditar",
          click: toggle,
          enabled: PRESENTATION[state].click !== "ignore",
          // Só exibição: quem dispara é o globalShortcut, e um accelerator
          // ativo aqui abriria caminho para o atalho disparar duas vezes.
          ...(shortcutRegistered
            ? { accelerator: SHORTCUT_ACCELERATOR, registerAccelerator: false }
            : {}),
        },
        // O aviso permanente: o diálogo do boot você fecha e esquece, isto
        // fica enquanto o atalho não estiver valendo.
        ...(shortcutRegistered
          ? []
          : [{ label: `⚠ ${SHORTCUT_LABEL} não registrado`, enabled: false }]),
        { type: "separator" },
        {
          label: "Copiar transcrição crua",
          enabled: lastDictation !== undefined,
          click: () => {
            if (lastDictation) clipboard.writeText(lastDictation.corrected);
          },
        },
        { type: "separator" },
        {
          label: "Som ao terminar",
          type: "checkbox",
          checked: preferences().sound,
          click: (item) => setPreference("sound", item.checked),
        },
        { type: "separator" },
        { label: "Sair", role: "quit" },
      ]),
    );
  });
}

/** O que o portão de fala respondeu sobre uma gravação. */
type GateVerdict = "speech" | "silence" | "unavailable";

/**
 * Roda o portão de fala e classifica o desfecho, inclusive o dele próprio
 * falhar.
 *
 * "Indisponível" existe porque os dois princípios da spec (seção 10) valem
 * ao mesmo tempo e puxam para lados diferentes:
 *
 * 1. Nunca descartar uma transcrição — então um portão quebrado não pode
 *    virar "não houve fala": isso engoliria toda ditação em silêncio.
 * 2. Nunca falhar em silêncio — então um portão quebrado também não pode
 *    virar "tudo certo": sem VAD o Whisper volta a alucinar `Obrigado.` em
 *    gravação vazia, e o app sinalizaria êxito para lixo.
 *
 * O desenho é o mesmo que a spec já usa para o device de áudio trocando no
 * meio: transcreve assim mesmo, mas com variante de erro no ícone. Continuar
 * E sinalizar.
 */
async function runSpeechGate(wav: Buffer): Promise<GateVerdict> {
  try {
    return (await hasSpeech(wav)) ? "speech" : "silence";
  } catch (error) {
    console.error("portão de fala indisponível:", error);
    return "unavailable";
  }
}

ipcMain.on("audio-flowing", () => {
  if (state !== "opening") return;

  setState("recording");
  startElapsedCounter();
});

ipcMain.on("capture-empty", () => setState("empty"));

ipcMain.on("capture-failed", (_event, reason: string) => {
  console.error("captura falhou:", reason);
  setState("failed");
});

ipcMain.handle("deliver-audio", async (_event, bytes: ArrayBuffer) => {
  setState("processing");
  const wav = Buffer.from(bytes);

  try {
    const verdict = await runSpeechGate(wav);
    if (verdict === "silence") {
      setState("empty");
      return;
    }

    const transcript = await transcribe(wav);
    // Vazio é resultado legítimo, não erro: o portão diz que houve fala, mas
    // o Whisper pode não achar palavra nenhuma nela. Não sobrescrever a área
    // de transferência com nada.
    if (transcript.length === 0) {
      setState("empty");
      return;
    }

    // O dicionário vem ANTES do Groq. Na ordem contrária ele desfaria
    // escolhas boas do LLM: o modelo reescreve a frase inteira, e trocar
    // palavras depois quebraria a concordância que ele acabou de acertar.
    const entries = dictionary();
    const corrected = applyDictionary(transcript, entries);
    lastDictation = { heard: transcript, corrected };

    const rewritten = await rewriteOrRaw(corrected, entries);
    if (rewritten.kind === "raw") console.warn(`modo cru: ${rewritten.why}`);

    // "Cru" aqui significa "não passou pela IA". A substituição é
    // determinística e offline: não há razão para perdê-la porque o Groq
    // caiu.
    clipboard.writeText(
      rewritten.kind === "rewritten" ? rewritten.text : corrected,
    );

    // As duas degradações são independentes e podem acontecer juntas. O cru
    // vence porque descreve o que está no clipboard agora, que é a decisão
    // do próximo segundo — o ticket 12 promete que você sabe que recebeu o
    // cru PELO ÍCONE. "Sem portão" é instalação quebrada: condição
    // permanente, que se anuncia sozinha nas outras ditações.
    if (rewritten.kind === "raw") setState("raw");
    else setState(verdict === "unavailable" ? "unguarded" : "done");
  } catch (error) {
    console.error("transcrição falhou:", error);
    setState("failed");
  }
});

void app.whenReady().then(() => {
  // Sem ícone no Dock: é um app de barra de menu.
  app.dock?.hide();
  createHiddenWindow();
  keepShortcutRegistered(toggle);
  createTray();
  warnIfShortcutMissing();
});

app.on("will-quit", () => {
  releaseShortcut();
  stopIconAnimation();
  clearTimeout(terminalTimer);
  clearInterval(elapsedTimer);
});

// A janela oculta nunca é fechada pelo usuário; sem este handler o Electron
// encerraria o app se ela sumisse por qualquer motivo.
app.on("window-all-closed", () => {
  // Intencionalmente vazio: o app vive no tray, não nas janelas.
});
