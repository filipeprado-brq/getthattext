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
import { applyDictionary, type Entry } from "../shared/dictionary";
import type { PreferencesSnapshot } from "../shared/bridge";
import type { Preferences } from "../shared/preferences";
import { formatElapsed } from "../shared/elapsed";
import { PRESENTATION, type State } from "../shared/states";
import { acceleratorToSymbols } from "../shared/shortcut";
import { prepareIcons, showIcon, stopIconAnimation } from "./trayIcon";
import {
  armShortcutTest,
  cancelShortcutTest,
  currentShortcut,
  isShortcutRegistered,
  keepShortcutRegistered,
  reapplyShortcut,
  releaseShortcut,
  warnIfShortcutMissing,
} from "./shortcut";
import { dictionary, saveDictionary } from "./dictionary";
import { loginItem, setLoginItem } from "./loginItem";
import { clearApiKey, hasApiKey, saveApiKey } from "./apiKey";
import { rewriteOrRaw } from "./groq";
import { preferences, updatePreferences } from "./preferences";
import { availableModels, hasSpeech, transcribe } from "./whisper";

/**
 * O nome do app, fixado ANTES de qualquer coisa tocar o `userData`.
 *
 * `productName` no `package.json` não basta: o Electron lê o package.json do
 * diretório do app, e rodando `electron dist/main/main.js` esse diretório é
 * `dist/main/`, que não tem um. Sem isto o `userData` fica em
 * "Application Support/Electron" em desenvolvimento e no nome de verdade
 * quando empacotado — dois lugares diferentes para os mesmos dados.
 *
 * A spec (seção 11) é dura sobre isto: o nome batiza o `userData` E o item
 * do Keychain ("<appName> Safe Storage"). Mudá-lo órfã todos os segredos, o
 * dicionário, as preferências e os 547 MB de modelo. Por isso fica aqui, no
 * topo, e não muda mais.
 */
app.setName("getthattext");

/**
 * As janelas do app, agrupadas porque só fazem sentido juntas.
 *
 * `hidden` existe só porque `getUserMedia` é API web e não há equivalente no
 * processo main — ela fica oculta, fazendo captura e mais nada. `editor` é a
 * única janela que você vê, e só quando pede.
 */
const windows: {
  hidden?: BrowserWindow;
  editor?: BrowserWindow;
  preferences?: BrowserWindow;
} = {};

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
  windows.hidden?.webContents.send("command", command);
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
  windows.hidden = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void windows.hidden.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * Abre uma janela utilitária, ou traz para frente a que já está aberta.
 *
 * Uma instância por janela: duas editando o mesmo arquivo se sobrescreveriam
 * sem que nenhuma soubesse.
 *
 * `app.focus({ steal: true })` é necessário porque o app não tem ícone no
 * Dock — sem isso a janela abre atrás do que você estava usando, o que para
 * quem acabou de escolher um item de menu parece que nada aconteceu.
 */
function openWindow(
  key: "editor" | "preferences",
  title: string,
  size: { width: number; height: number },
  onClosed?: () => void,
): void {
  const existing = windows[key];
  if (existing) {
    existing.show();
    existing.focus();
    app.focus({ steal: true });

    return;
  }

  const created = new BrowserWindow({
    ...size,
    minWidth: 520,
    minHeight: 380,
    title,
    show: false,
    webPreferences: {
      preload: join(__dirname, `${key}Preload.js`),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  created.once("ready-to-show", () => {
    created.show();
    app.focus({ steal: true });
  });
  created.on("closed", () => {
    windows[key] = undefined;
    onClosed?.();
  });

  void created.loadFile(join(__dirname, `../renderer/${key}.html`));
  windows[key] = created;
}

const openDictionaryEditor = (): void =>
  openWindow("editor", "Dicionário", { width: 640, height: 620 });

const openPreferences = (): void =>
  // Um teste de atalho armado não pode sobreviver à janela que o pediu: ele
  // engoliria a próxima ditação.
  openWindow("preferences", "Preferências", { width: 560, height: 640 }, cancelShortcutTest);

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
            ? { accelerator: currentShortcut(), registerAccelerator: false }
            : {}),
        },
        // O aviso permanente: o diálogo do boot você fecha e esquece, isto
        // fica enquanto o atalho não estiver valendo.
        ...(shortcutRegistered
          ? []
          : [
              {
                label: `⚠ ${acceleratorToSymbols(currentShortcut())} não registrado`,
                enabled: false,
              },
            ]),
        { type: "separator" },
        {
          label: "Copiar transcrição crua",
          enabled: lastDictation !== undefined,
          click: () => {
            if (lastDictation) clipboard.writeText(lastDictation.corrected);
          },
        },
        { type: "separator" },
        { label: "Preferências…", click: openPreferences, accelerator: "Command+," },
        { label: "Dicionário…", click: openDictionaryEditor },
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

/**
 * O que a tela de preferências vê.
 *
 * Anotado com o tipo do contrato de propósito: sem isso o lado main poderia
 * divergir do renderer sem erro de compilação, que é o que a regra 6 existe
 * para impedir.
 *
 * `hasApiKey` olha a existência do arquivo em vez de descriptografar: a
 * chave em si nunca cruza o IPC, e um erro de Keychain viraria "não há
 * chave" — mentira que a tela repetiria dizendo que o app está em modo cru.
 */
function snapshot(): PreferencesSnapshot {
  return {
    preferences: preferences(),
    models: availableModels(),
    loginItem: loginItem(),
    hasApiKey: hasApiKey(),
  };
}

ipcMain.handle("preferences-load", () => snapshot());

ipcMain.handle("preferences-save", (_event, patch: Partial<Preferences>) => {
  const before = preferences().shortcut;
  const saved = updatePreferences(patch);
  // O atalho só passa a valer depois de re-registrar; sem isto a tela
  // mostraria o novo e o teclado continuaria no antigo.
  if (saved.shortcut !== before) reapplyShortcut();

  return snapshot();
});

ipcMain.handle("preferences-login-item", (_event, enabled: unknown) =>
  setLoginItem(enabled === true),
);

ipcMain.handle("preferences-api-key", async (_event, key: unknown) => {
  const value = typeof key === "string" ? key.trim() : "";
  if (value.length === 0) {
    await clearApiKey();

    return false;
  }

  await saveApiKey(value);

  return true;
});

ipcMain.handle("preferences-test-shortcut", () => armShortcutTest());

ipcMain.handle("dictionary-load", () => ({
  entries: dictionary(),
  // `undefined` quando não houve ditação nesta sessão: é o que desabilita
  // "adicionar do último ditado" na tela.
  heard: lastDictation?.heard,
}));

ipcMain.handle("dictionary-save", (_event, entries: readonly Entry[]) =>
  saveDictionary(entries),
);

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

    // `undefined` = a reescrita está DESLIGADA nas preferências. É diferente
    // de ter falhado: o cru é o resultado pedido, não uma degradação, e o
    // ícone não pode acusar problema onde não há.
    const rewritten = preferences().rewrite
      ? await rewriteOrRaw(corrected, entries)
      : undefined;
    if (rewritten?.kind === "raw") console.warn(`modo cru: ${rewritten.why}`);

    // "Cru" aqui significa "não passou pela IA". A substituição é
    // determinística e offline: não há razão para perdê-la porque o Groq
    // caiu.
    clipboard.writeText(
      rewritten?.kind === "rewritten" ? rewritten.text : corrected,
    );

    // As duas degradações são independentes e podem acontecer juntas. O cru
    // vence porque descreve o que está no clipboard agora, que é a decisão
    // do próximo segundo — o ticket 12 promete que você sabe que recebeu o
    // cru PELO ÍCONE. "Sem portão" é instalação quebrada: condição
    // permanente, que se anuncia sozinha nas outras ditações.
    if (rewritten?.kind === "raw") setState("raw");
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
