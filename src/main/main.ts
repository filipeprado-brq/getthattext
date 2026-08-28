import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import { join } from "node:path";
import type { Command } from "../shared/bridge";
import { hasSpeech, transcribe } from "./whisper";

/**
 * O app vive na barra de menu e não tem janela visível.
 *
 * O renderer existe só porque `getUserMedia` é API web e não há equivalente
 * no processo main — ele fica oculto, fazendo captura e mais nada.
 */
let hidden: BrowserWindow | undefined;
let tray: Tray | undefined;

/** Estados que o app assume durante uma ditação. */
type State =
  | "idle"
  | "opening"
  | "recording"
  | "processing"
  | "done"
  | "unguarded"
  | "empty"
  | "failed";

let state: State = "idle";

/** Quanto tempo um estado terminal fica visível antes de voltar a ocioso. */
const TERMINAL_MS = 2000;

let terminalTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * O ícone é placeholder. O ticket #6 é dono do visual — sete estados,
 * vermelho ao gravar, respiração de 1,7 s. Aqui só precisa existir e
 * dizer em que ponto o app está.
 */
const LABELS: Record<State, string> = {
  idle: "",
  opening: "abrindo…",
  recording: "gravando",
  processing: "transcrevendo…",
  done: "✓ copiado",
  unguarded: "✓ copiado, sem portão",
  empty: "nada ouvido",
  failed: "✕ falhou",
};

/**
 * Estados terminais voltam a ocioso sozinhos.
 *
 * Eles precisam ser DISTINGUÍVEIS: um texto copiado, um texto copiado sem o
 * portão ter rodado, uma gravação sem fala e uma falha real são resultados
 * diferentes. Se todos voltassem em silêncio ao mesmo ícone limpo, você
 * aprenderia a ignorar todos.
 */
const TERMINAL: ReadonlySet<State> = new Set<State>([
  "done",
  "unguarded",
  "empty",
  "failed",
]);

function setState(next: State): void {
  state = next;
  clearTimeout(terminalTimer);

  tray?.setTitle(LABELS[next] ? ` ${LABELS[next]}` : "");
  tray?.setToolTip(
    next === "idle" ? "getthattext — clique para ditar" : `getthattext — ${LABELS[next]}`,
  );

  if (TERMINAL.has(next)) {
    terminalTimer = setTimeout(() => setState("idle"), TERMINAL_MS);
  }
}

function send(command: Command): void {
  hidden?.webContents.send("command", command);
}

function toggle(): void {
  // Estados terminais ainda são visíveis por 2 s, mas já aceitam uma nova
  // ditação: engolir o clique nesse intervalo faria você achar que o app
  // travou justamente quando ele acabou de dar certo.
  if (state === "idle" || TERMINAL.has(state)) {
    setState("opening");
    send("start");
  } else if (state === "opening" || state === "recording") {
    setState("processing");
    send("stop");
  }
  // Em "processing" o clique é ignorado: uma segunda ditação enquanto a
  // primeira transcreve exigiria fila, e isso não é escopo deste ticket.
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
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../assets/trayTemplate.png"),
  );
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  setState("idle");

  // Clique esquerdo alterna; clique direito abre o menu. No macOS, definir
  // um menu de contexto faz o clique esquerdo abri-lo também, então o menu
  // é mostrado sob demanda em vez de fixado no tray.
  tray.on("click", toggle);
  tray.on("right-click", () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: "Ditar", click: toggle, enabled: state !== "processing" },
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
  if (state === "opening") setState("recording");
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

    const text = await transcribe(wav);
    // Vazio é resultado legítimo, não erro: o portão diz que houve fala, mas
    // o Whisper pode não achar palavra nenhuma nela. Não sobrescrever a área
    // de transferência com nada.
    if (text.length === 0) {
      setState("empty");
      return;
    }

    clipboard.writeText(text);
    setState(verdict === "unavailable" ? "unguarded" : "done");
  } catch (error) {
    console.error("transcrição falhou:", error);
    setState("failed");
  }
});

void app.whenReady().then(() => {
  // Sem ícone no Dock: é um app de barra de menu.
  app.dock?.hide();
  createHiddenWindow();
  createTray();
});

// A janela oculta nunca é fechada pelo usuário; sem este handler o Electron
// encerraria o app se ela sumisse por qualquer motivo.
app.on("window-all-closed", () => {
  // Intencionalmente vazio: o app vive no tray, não nas janelas.
});
