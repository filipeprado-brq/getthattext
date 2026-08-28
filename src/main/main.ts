import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  Tray,
} from "electron";
import { join } from "node:path";
import type { Command } from "../shared/bridge";
import { applyDictionary, type Entry } from "../shared/dictionary";
import type { KeyCheck, PreferencesSnapshot } from "../shared/bridge";
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
import {
  discardModel,
  discardUnchosenModels,
  downloadModel,
  hasRoomForAll,
  isModelIntact,
  isModelPresent,
  presentModels,
} from "./models";
import {
  isReady,
  onboardingState,
  openMicrophoneSettings,
  requestMicrophone,
} from "./onboarding";
import { MISSING_BINARY_MESSAGE, recoveryFor } from "../shared/failures";
import {
  bytesNeeded,
  formatBytes,
  MODELS,
  requiredModels,
} from "../shared/models";
import { clearApiKey, hasApiKey, loadApiKey, saveApiKey } from "./apiKey";
import { checkApiKey, rewriteOrRaw } from "./groq";
import { preferences, updatePreferences } from "./preferences";
import {
  availableModels,
  hasSpeech,
  isWhisperInstalled,
  transcribe,
  WhisperFailure,
} from "./whisper";

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
  onboarding?: BrowserWindow;
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


/**
 * Aplica um estado, com um detalhe opcional no tooltip.
 *
 * O detalhe existe para as falhas: `failed` persiste até o clique, e sem ele
 * a razão morreria no console. Passar o texto pelo tooltip a deixa
 * alcançável sem um modal a cada erro.
 */
function setState(next: State, detail?: string): void {
  const { icon, tooltip, chime, fades } = PRESENTATION[next];

  state = next;
  clearTimeout(terminalTimer);
  clearInterval(elapsedTimer);
  elapsedTimer = undefined;

  if (tray) {
    tray.setTitle("");
    tray.setToolTip(`getthattext — ${detail ?? tooltip}`);
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

  // Barra só o INÍCIO. Barrar o "parar" deixaria o microfone aberto e o
  // ponto laranja aceso se um modelo sumisse no meio da gravação — o
  // oposto do que o portão existe para fazer.
  if (click === "start" && !isReady()) {
    openOnboarding();

    return;
  }

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
  // Os DOIS handlers, como a spec (seção 8) exige. Sem o de checagem, o
  // Chromium recusa `getUserMedia` sem nunca chegar ao prompt do sistema.
  const { session } = windows.hidden.webContents;
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "media");
  });
  session.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return permission === "media" && details.mediaType === "audio";
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
  key: "editor" | "preferences" | "onboarding",
  title: string,
  // `fixed` é para as janelas cujo conteúdo tem altura definida: o wizard e
  // as preferências foram desenhados para caber exatamente, e deixar
  // encolher só produziria três cards espremidos e texto cortado.
  size: { width: number; height: number; fixed?: boolean },
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
    width: size.width,
    height: size.height,
    resizable: size.fixed !== true,
    minWidth: size.fixed === true ? size.width : 520,
    minHeight: size.fixed === true ? size.height : 380,
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

const openOnboarding = (): void =>
  openWindow("onboarding", "Bem-vindo", { width: 680, height: 412, fixed: true });

const openPreferences = (): void =>
  // Um teste de atalho armado não pode sobreviver à janela que o pediu: ele
  // engoliria a próxima ditação.
  openWindow("preferences", "Preferências", { width: 640, height: 412, fixed: true }, cancelShortcutTest);

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

ipcMain.handle("onboarding-load", () => onboardingState());

ipcMain.handle("onboarding-microphone", () => requestMicrophone());

ipcMain.handle("onboarding-microphone-settings", () => openMicrophoneSettings());

ipcMain.handle("onboarding-choose-model", (_event, file: unknown) => {
  if (typeof file === "string") updatePreferences({ model: file });

  return onboardingState();
});

ipcMain.handle("onboarding-choose-provider", (_event, id: unknown) => {
  if (typeof id === "string") updatePreferences({ provider: id });

  return onboardingState();
});

/**
 * Troca o atalho durante a primeira abertura.
 *
 * Re-registra na hora, como o `preferences-save` faz: sem isso a tela
 * mostraria a combinação nova e o teste do passo seguinte esperaria a
 * antiga — e o passo existe justamente para provar que a tecla chega.
 */
ipcMain.handle("onboarding-choose-shortcut", (_event, accelerator: unknown) => {
  if (typeof accelerator === "string") {
    const before = preferences().shortcut;
    const saved = updatePreferences({ shortcut: accelerator });

    if (saved.shortcut !== before) reapplyShortcut();
  }

  return onboardingState();
});

/**
 * Baixa o que falta, um de cada vez.
 *
 * Em série e não em paralelo: são 574 MB e 885 KB pela mesma conexão, e
 * dividir a banda faria a barra grande arrastar sem ninguém ganhar nada.
 */
/**
 * Baixa o que falta, um de cada vez.
 *
 * Em série e não em paralelo: são 574 MB e 885 KB pela mesma conexão, e
 * dividir a banda faria a barra grande arrastar sem ninguém ganhar nada.
 *
 * Serve as DUAS janelas — a primeira abertura e a aba Modelo das
 * preferências — porque baixar é a mesma coisa nos dois lugares. O que
 * muda é só o retrato devolvido no fim.
 */
async function downloadMissingModels(event: IpcMainInvokeEvent): Promise<void> {
  const chosen = preferences().model;
  const needed = requiredModels(chosen);
  const present = presentModels();

  if (!hasRoomForAll(chosen, present)) {
    throw new Error(
      `Não há espaço em disco para os modelos que faltam ` +
        `(${formatBytes(bytesNeeded(needed, present))}).`,
    );
  }

  // O download morre com a janela que o pediu. Sem isto ele continuaria
  // mandando progresso para um renderer destruído — e `send` num
  // `webContents` destruído LANÇA, dentro de um listener de stream que não
  // está na cadeia da pipeline: exceção não capturada no main. O `.part`
  // fica no disco, então reabrir retoma de onde parou.
  const cancel = new AbortController();
  const stop = (): void => cancel.abort();
  event.sender.once("destroyed", stop);

  try {
    // Só o escolhido e o portão. Baixar o catálogo inteiro custaria 824 MB.
    for (const model of needed) {
      if (isModelPresent(model)) continue;

      await downloadModel(
        model,
        ({ received, total }) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send("models-progress", { file: model.file, received, total });
        },
        cancel.signal,
      );
    }
  } finally {
    event.sender.off("destroyed", stop);
  }

  // Só agora: o escolhido está no disco e verificado, então guardar os
  // outros seria só ocupar espaço.
  const removed = await discardUnchosenModels(chosen);
  if (removed.length > 0) console.log(`modelos removidos: ${removed.join(", ")}`);
}

ipcMain.handle("onboarding-download", async (event) => {
  await downloadMissingModels(event);

  return onboardingState();
});

ipcMain.handle("preferences-download", async (event) => {
  await downloadMissingModels(event);

  return snapshot();
});

ipcMain.on("onboarding-finish", () => windows.onboarding?.close());

ipcMain.handle("preferences-load", () => snapshot());

ipcMain.handle("preferences-save", (_event, patch: Partial<Preferences>) => {
  const before = preferences();
  const saved = updatePreferences(patch);

  // O atalho só passa a valer depois de re-registrar; sem isto a tela
  // mostraria o novo e o teclado continuaria no antigo.
  if (saved.shortcut !== before.shortcut) reapplyShortcut();

  // Escolher um modelo ausente NÃO abre mais o onboarding: a aba Modelo
  // mostra o que falta e baixa ali mesmo, quando você quiser. Até lá,
  // `activeModel` mantém a ditação rodando com o que está no disco.
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

/**
 * Testa a chave contra o provedor, sem gravá-la.
 *
 * Chave vazia testa a que já está guardada: nas preferências o campo fica em
 * branco por segurança — a chave nunca volta pelo IPC — e "Testar" ali
 * pergunta sobre a que está em uso.
 */
ipcMain.handle("preferences-test-api-key", async (_event, key: unknown): Promise<KeyCheck> => {
  const typed = typeof key === "string" ? key.trim() : "";
  const value = typed.length > 0 ? typed : await loadApiKey();

  if (value === undefined || value.length === 0) {
    return { kind: "rejected" };
  }

  return checkApiKey(value);
});

ipcMain.handle("preferences-test-shortcut", () => armShortcutTest());

// A aba Sistema é a única porta visível para as outras duas janelas: o
// dicionário e o onboarding só abriam pelo menu da bandeja.
ipcMain.on("preferences-open-dictionary", openDictionaryEditor);
ipcMain.on("preferences-open-onboarding", openOnboarding);

ipcMain.handle("dictionary-load", () => ({
  entries: dictionary(),
  // `undefined` quando não houve ditação nesta sessão: é o que desabilita
  // "adicionar do último ditado" na tela.
  heard: lastDictation?.heard,
}));

ipcMain.handle("dictionary-save", (_event, entries: readonly Entry[]) =>
  saveDictionary(entries),
);

/**
 * O que fazer quando a transcrição falha.
 *
 * A tabela da seção 10 da spec, executada. O diagnóstico vem de OLHAR o
 * modelo, não de ler o log: modelo ausente, corrompido e truncado produzem
 * a mesma mensagem no whisper — medido.
 *
 * Nenhum caminho aqui toca o clipboard. O que estava lá continua lá: uma
 * falha nunca pode deixar você em situação pior do que antes de ditar.
 */
async function recoverFrom(error: unknown): Promise<void> {
  const kind = error instanceof WhisperFailure ? error.kind : "other";

  // O modelo EM USO, não o primeiro do catálogo. As preferências deixam
  // escolher qualquer `.bin` da pasta, e diagnosticar o arquivo errado
  // levaria a apagar 574 MB de um modelo que nem participou da falha.
  const model = MODELS.find(({ file }) => file === preferences().model);

  // Só paga o SHA-256 de 574 MB quando a resposta pode mudar a ação: com o
  // binário ausente, o modelo é irrelevante.
  const health =
    kind === "model-load" && model
      ? {
          present: isModelPresent(model),
          intact: isModelPresent(model) ? await isModelIntact(model) : false,
        }
      : { present: false, intact: false };

  const recovery = recoveryFor(kind, health);
  console.error(`transcrição falhou (${kind}):`, error);
  console.error(`recuperação: ${recovery.action} — ${recovery.message}`);

  // A mensagem vai para o tooltip: `failed` persiste até o clique, então ela
  // fica alcançável em vez de morrer no console.
  setState("failed", recovery.message);

  if (recovery.action === "reinstall") {
    dialog.showErrorBox("getthattext não pode continuar", recovery.message);
    app.quit();

    return;
  }

  if (recovery.action === "discard-model" && model) {
    await discardModel(model).catch((failure) =>
      console.error("não foi possível apagar o modelo:", failure),
    );
  }

  if (recovery.action === "discard-model" || recovery.action === "onboard") {
    dialog.showErrorBox("Modelo de transcrição", recovery.message);
    openOnboarding();
  }
}

ipcMain.handle(
  "deliver-audio",
  async (_event, bytes: ArrayBuffer, interrupted: boolean) => {
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

      // Precedência entre ressalvas, da mais grave para a menos: falta
      // conteúdo (o microfone caiu), o texto não passou pela IA, o portão não
      // rodou. "Sem portão" fica por último porque é instalação quebrada —
      // condição permanente, que se anuncia sozinha nas outras ditações.
      if (interrupted) setState("interrupted");
      else if (rewritten?.kind === "raw") setState("raw");
      else setState(verdict === "unavailable" ? "unguarded" : "done");

      // A única falha da tabela que exige ação sua. Depois de o texto estar no
      // clipboard, de propósito: abrir uma janela antes arriscaria mandar a
      // ditação para o `catch` com o texto ainda fora do clipboard.
      if (rewritten?.kind === "raw" && rewritten.reason === "rejected-key") {
        openPreferences();
      }
    } catch (error) {
      await recoverFrom(error);
    }
  },
);

void app.whenReady().then(() => {
  // Sem ícone no Dock: é um app de barra de menu.
  app.dock?.hide();

  // "Sem whisper não há produto; degradar seria fingir." Abrir e falhar em
  // toda ditação seria pior que não abrir: você descobriria depois de falar.
  if (!isWhisperInstalled()) {
    dialog.showErrorBox("getthattext não pode abrir", MISSING_BINARY_MESSAGE);
    app.quit();

    return;
  }
  createHiddenWindow();
  keepShortcutRegistered(toggle);
  createTray();
  warnIfShortcutMissing();

  // A primeira abertura mostra o onboarding sozinha. Também volta se um
  // modelo for apagado ou a permissão revogada: o estado é derivado, não
  // um sinalizador de "já fiz isso".
  if (!isReady()) openOnboarding();
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
