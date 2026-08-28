import type { KeyCheck, ModelProgress, PreferencesSnapshot } from "../shared/bridge.js";
import { reason } from "../shared/errors.js";
import { activeModel, formatBytes, TRANSCRIPTION_MODELS, VAD_MODEL } from "../shared/models.js";
import { LANGUAGES } from "../shared/preferences.js";
import { PROVIDERS, providerFor } from "../shared/providers.js";
import { acceleratorToSymbols } from "../shared/shortcut.js";
import { el, paintChoices, paintDownloads as paintList, sayInto } from "./dom.js";
import { recordShortcut } from "./shortcutField.js";

/**
 * As preferências, em quatro abas.
 *
 * Eram três seções numa rolagem só, com os rótulos alinhados à direita numa
 * coluna de 150 px — o olho voltava a cada linha, e o que estava embaixo
 * dependia de rolar. Cada aba agora cabe inteira na janela.
 *
 * A aba Modelo usa o MESMO card do onboarding, mais o que só ela precisa
 * dizer: quem está no disco, e um download que pode esperar.
 */
type TabId = "dictation" | "model" | "rewrite" | "system";

type Tab = { id: TabId; label: string; icon: string };

const TABS: readonly Tab[] = [
  {
    id: "dictation",
    label: "Ditado",
    icon:
      '<rect x="6" y="2" width="4" height="7.2" rx="2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0M8 11.4V14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
  {
    id: "model",
    label: "Modelo",
    icon:
      '<path d="M8 1.8 14.2 5 8 8.2 1.8 5 8 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M1.8 8.6 8 11.8l6.2-3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: "rewrite",
    label: "Reescrita",
    icon:
      '<path d="M4.2 2.4 5 4.6l2.2.8L5 6.2l-.8 2.2-.8-2.2L1.2 5.4 3.4 4.6l.8-2.2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M10.6 6.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  {
    id: "system",
    label: "Sistema",
    icon:
      '<circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  },
];

type Screen = {
  tab: TabId;
  /** Download em curso na aba Modelo: trava a escolha até terminar. */
  downloading: boolean;
  /** Por que o último download parou. Some quando outro começa. */
  downloadFailure?: string;
};

const screen: Screen = { tab: "dictation", downloading: false };
let snapshot: PreferencesSnapshot | undefined;

/** O andamento de cada arquivo, para a barra não zerar entre redesenhos. */
const progress = new Map<string, ModelProgress>();

const tabs = el("tabs");
const shortcutOutput = el("shortcut");
const recordButton = el<HTMLButtonElement>("record");
const shortcutNote = el("shortcut-note");
const testButton = el<HTMLButtonElement>("test");
const languageSelect = el<HTMLSelectElement>("language");
const soundSwitch = el<HTMLButtonElement>("sound");
const choices = el("choices");
const downloads = el("downloads");
const modelNote = el("model-note");
const modelGet = el<HTMLButtonElement>("model-get");
const rewriteSwitch = el<HTMLButtonElement>("rewrite");
const providerSelect = el<HTMLSelectElement>("provider");
const apiKeyInput = el<HTMLInputElement>("api-key");
const keyCheckButton = el<HTMLButtonElement>("key-check");
const keySaveButton = el<HTMLButtonElement>("key-save");
const keyNote = el("key-note");
const loginSwitch = el<HTMLButtonElement>("login");
const loginNote = el("login-note");
const status = el("status");
const disk = el("disk");
const say = sayInto(status);

/** O atalho EM VIGOR, para os recados não dependerem do DOM. */
let activeShortcut = "";

function note(target: HTMLElement, text: string, kind: "warn" | "bad" | "good" | "" = ""): void {
  target.textContent = text;
  target.className = kind.length > 0 ? `note ${kind}` : "note";
}

function toggle(control: HTMLButtonElement, on: boolean): void {
  control.setAttribute("aria-checked", String(on));
}

/** Grava e redesenha. Falha de gravação é dita, nunca engolida. */
async function save(patch: Parameters<typeof window.preferencesBridge.save>[0]): Promise<void> {
  try {
    render(await window.preferencesBridge.save(patch));
    status.className = "";
    say("Gravado.");
  } catch (error) {
    status.className = "bad";
    say(`Não foi possível gravar: ${reason(error)}`);
  }
}

/* ---------- desenho ---------- */

function paintTabs(): void {
  tabs.replaceChildren(
    ...TABS.map((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(tab.id === screen.tab));
      button.innerHTML =
        `<svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">${tab.icon}</svg>` +
        `<span>${tab.label}</span>`;
      button.addEventListener("click", () => {
        screen.tab = tab.id;
        if (snapshot) render(snapshot);
      });

      return button;
    }),
  );

  for (const tab of TABS) {
    el(`panel-${tab.id}`).classList.toggle("active", tab.id === screen.tab);
  }
}

/** A lista do download, a MESMA do wizard: um arquivo por linha. */
function paintDownloads(): void {
  if (!snapshot) return;

  const chosen = TRANSCRIPTION_MODELS.find(({ file }) => file === snapshot?.preferences.model);
  const files = chosen ? [chosen, VAD_MODEL] : [VAD_MODEL];

  paintList(
    downloads,
    files.map((model) => ({
      title: "name" in model ? `Modelo ${model.name}` : model.label,
      file: model.file,
      bytes: model.bytes,
      received: progress.get(model.file)?.received ?? 0,
    })),
    formatBytes,
  );
}

/**
 * A aba do modelo: os cards, o que falta e quanto ocupa.
 *
 * Escolher um ausente NÃO sequestra a janela — antes isso reabria o
 * onboarding na hora. O card fica marcado, o rodapé diz o que falta, e o
 * download espera o botão. Até lá `activeModel` mantém a ditação rodando
 * com o que está no disco, e o rodapé diz qual é.
 */
function paintModels(): void {
  if (!snapshot) return;

  const { preferences, models } = snapshot;
  const chosen = preferences.model;
  const running = activeModel(chosen, models);
  const missing = TRANSCRIPTION_MODELS.find(({ file }) => file === chosen && !models.includes(file));

  paintChoices(choices, {
    models: TRANSCRIPTION_MODELS,
    chosen,
    present: models,
    format: formatBytes,
    onPick: (file) => {
      if (screen.downloading) return;
      void save({ model: file });
    },
  });

  // Enquanto baixa, a lista de arquivos ocupa o lugar dos cards: a escolha
  // está congelada até terminar, e três cards clicáveis ali seriam mentira
  // — além de não caberem junto com as barras.
  downloads.hidden = !screen.downloading;
  choices.hidden = screen.downloading;
  modelGet.hidden = missing === undefined || screen.downloading;
  modelGet.disabled = screen.downloading;

  if (screen.downloading) {
    note(modelNote, "Baixando. Dá para fechar a janela: retoma de onde parou.");
  } else if (screen.downloadFailure) {
    // A falha ocupa o rodapé do grupo, que quebra linha; o rodapé da janela
    // tem uma linha só, ao lado do espaço em disco.
    modelGet.textContent = "Tentar de novo";
    note(modelNote, screen.downloadFailure, "bad");
  } else if (missing) {
    modelGet.textContent = `Baixar ${formatBytes(missing.bytes)}`;
    const inUse = TRANSCRIPTION_MODELS.find(({ file }) => file === running);
    note(
      modelNote,
      inUse
        ? `Falta baixar ${formatBytes(missing.bytes)}. Até lá, o ${inUse.name} continua transcrevendo.`
        : `Falta baixar ${formatBytes(missing.bytes)}.`,
      "warn",
    );
  } else {
    note(
      modelNote,
      "Ao trocar, o modelo que sai de uso é apagado assim que o novo estiver íntegro no disco.",
    );
  }

  const onDisk = TRANSCRIPTION_MODELS.filter(({ file }) => models.includes(file)).reduce(
    (total, model) => total + model.bytes,
    0,
  );
  disk.textContent = `${formatBytes(onDisk)} em disco`;
}

function paintRewrite(): void {
  if (!snapshot) return;

  const { preferences, hasApiKey } = snapshot;
  const chosen = providerFor(preferences.provider);

  toggle(rewriteSwitch, preferences.rewrite);

  providerSelect.replaceChildren(
    ...PROVIDERS.map((provider) => {
      const option = new Option(
        provider.available ? `${provider.name} · ${provider.model}` : `${provider.name} — em breve`,
        provider.id,
        false,
        provider.id === chosen.id,
      );
      option.disabled = !provider.available;

      return option;
    }),
  );

  apiKeyInput.placeholder = hasApiKey ? "•••••••• (guardada)" : `${chosen.keyPrefix}…`;
  note(
    keyNote,
    hasApiKey
      ? "Guardada no Keychain. Deixe em branco e clique em Ativar para apagar."
      : `Sem chave o texto vai cru para a área de transferência. A do ${chosen.name} sai em ${chosen.keyUrl}.`,
  );
}

/**
 * Os quatro estados do login item, cada um com o seu recado.
 *
 * `not-found` é o caso comum em desenvolvimento — app não empacotado — e
 * cair calado ali seria falhar em silêncio no mesmo controle que existe
 * para não mentir.
 */
function paintLogin(state: PreferencesSnapshot["loginItem"]): void {
  toggle(loginSwitch, state.status === "enabled" || state.status === "requires-approval");

  if (state.status === "requires-approval") {
    note(
      loginNote,
      "Registrado, mas parado: aprove getthattext em Ajustes do Sistema › Geral › " +
        "Itens de Início. Até lá ele NÃO abre no login.",
      "warn",
    );

    return;
  }

  if (state.status === "not-found") {
    note(
      loginNote,
      "O sistema não encontrou o item de início. Isso é esperado enquanto o app " +
        "roda sem estar empacotado.",
      "warn",
    );

    return;
  }

  note(loginNote, "");
}

function render(loaded: PreferencesSnapshot): void {
  snapshot = loaded;
  const { preferences, loginItem } = loaded;

  paintTabs();

  activeShortcut = preferences.shortcut;
  shortcutOutput.textContent = acceleratorToSymbols(activeShortcut);
  showShortcutNote(activeShortcut);

  languageSelect.replaceChildren(
    ...LANGUAGES.map(({ code, label }) => new Option(label, code, false, code === preferences.language)),
  );
  toggle(soundSwitch, preferences.sound);

  paintModels();
  paintDownloads();
  paintRewrite();
  paintLogin(loginItem);
}

/**
 * O recado padrão do atalho: PERMANENTE e preventivo.
 *
 * Um atalho global do macOS tem precedência sobre atalho de menu de
 * aplicativo, então a combinação escolhida deixa de funcionar nos outros
 * programas enquanto o app estiver aberto. O sistema não avisa disso, e o
 * `register` aceita qualquer coisa — medido. Dizer só depois de um teste que
 * falhou seria tarde e fala da direção oposta.
 */
function showShortcutNote(accelerator: string): void {
  note(
    shortcutNote,
    `Aparece como ${acceleratorToSymbols(accelerator)}. Um atalho global tem ` +
      "precedência sobre os atalhos dos aplicativos: esta combinação deixa de " +
      "funcionar nos outros programas enquanto o getthattext estiver aberto.",
  );
}

/* ---------- os controles ---------- */

/**
 * Grava o atalho apertando as teclas.
 *
 * Um campo de texto exigiria saber escrever `Alt+Command+G`, que é sintaxe
 * do Electron — nem todo mundo sabe, e ninguém deveria precisar.
 */
recordButton.addEventListener("click", () => {
  recordButton.disabled = true;
  testButton.disabled = true;
  shortcutOutput.classList.add("recording");
  note(shortcutNote, "Esc cancela.");

  recordShortcut({
    output: shortcutOutput,
    onDone: (accelerator) => {
      recordButton.disabled = false;
      testButton.disabled = false;
      shortcutOutput.classList.remove("recording");

      if (accelerator === undefined) {
        shortcutOutput.textContent = acceleratorToSymbols(activeShortcut);
        showShortcutNote(activeShortcut);

        return;
      }

      void save({ shortcut: accelerator });
    },
  });
});

/**
 * O teste de atalho.
 *
 * Existe porque `globalShortcut.register` devolve `true` para tudo neste
 * sistema — medido, inclusive com outro processo segurando a combinação e
 * com hotkeys do próprio macOS. Não há detecção de conflito pela API, e a
 * única verificação honesta é você apertar a tecla.
 */
testButton.addEventListener("click", () => {
  // Desabilitar não é cosmético: um segundo clique cancelaria o teste em
  // curso, e o recado do primeiro chegaria depois do segundo.
  testButton.disabled = true;
  testButton.dataset["listening"] = "true";
  testButton.textContent = "Aperte agora…";
  note(shortcutNote, `Aperte ${acceleratorToSymbols(activeShortcut)}.`);

  void window.preferencesBridge
    .testShortcut()
    .then((result) => {
      if (result === "cancelled") {
        showShortcutNote(activeShortcut);

        return;
      }
      note(
        shortcutNote,
        result === "arrived"
          ? "Chegou. O atalho está funcionando."
          : "Não chegou. Outro aplicativo pode estar usando essa combinação — " +
              "o sistema não avisa, então escolha outra e teste de novo.",
        result === "arrived" ? "good" : "warn",
      );
    })
    .catch((error: unknown) => say(`O teste falhou: ${reason(error)}`))
    .finally(() => {
      testButton.disabled = false;
      delete testButton.dataset["listening"];
      testButton.textContent = "Testar";
    });
});

languageSelect.addEventListener("change", () => void save({ language: languageSelect.value }));
providerSelect.addEventListener("change", () => void save({ provider: providerSelect.value }));

soundSwitch.addEventListener("click", () => {
  void save({ sound: soundSwitch.getAttribute("aria-checked") !== "true" });
});

rewriteSwitch.addEventListener("click", () => {
  void save({ rewrite: rewriteSwitch.getAttribute("aria-checked") !== "true" });
});

modelGet.addEventListener("click", () => {
  screen.downloading = true;
  screen.downloadFailure = undefined;
  progress.clear();
  if (snapshot) render(snapshot);
  say("");

  void window.preferencesBridge
    .downloadModels()
    .then((updated) => {
      screen.downloading = false;
      render(updated);
      say("Gravado. O modelo anterior foi apagado.");
    })
    .catch((error: unknown) => {
      screen.downloading = false;
      screen.downloadFailure = reason(error);
      if (snapshot) render(snapshot);
    });
});

window.preferencesBridge.onProgress((update) => {
  progress.set(update.file, update);
  paintDownloads();
});

keySaveButton.addEventListener("click", () => {
  void window.preferencesBridge
    .setApiKey(apiKeyInput.value)
    .then(() => window.preferencesBridge.load())
    .then((updated) => {
      apiKeyInput.value = "";
      render(updated);
      note(keyNote, updated.hasApiKey ? "Chave guardada no Keychain." : "Chave apagada.", "good");
    })
    .catch((error: unknown) => note(keyNote, `Não foi possível guardar: ${reason(error)}`, "bad"));
});

/** Recusa e rede fora pedem coisas diferentes, e por isso são dois recados. */
const KEY_CHECK: Readonly<Record<KeyCheck["kind"], { text: string; tone: "good" | "bad" }>> = {
  ok: { text: "O provedor respondeu. A chave é válida.", tone: "good" },
  rejected: { text: "O provedor recusou essa chave. Confira se copiou inteira.", tone: "bad" },
  unreachable: { text: "Não foi possível falar com o provedor. Tente de novo.", tone: "bad" },
};

keyCheckButton.addEventListener("click", () => {
  keyCheckButton.disabled = true;
  keyCheckButton.textContent = "Testando…";
  note(keyNote, "Perguntando ao provedor…");

  void window.preferencesBridge
    .testApiKey(apiKeyInput.value.trim())
    .then((result) => {
      const shown = KEY_CHECK[result.kind];
      if (result.kind === "unreachable") console.error("teste da chave:", result.why);
      note(keyNote, shown.text, shown.tone);
    })
    .catch((error: unknown) => note(keyNote, `O teste falhou: ${reason(error)}`, "bad"))
    .finally(() => {
      keyCheckButton.disabled = false;
      keyCheckButton.textContent = "Testar";
    });
});

loginSwitch.addEventListener("click", () => {
  void window.preferencesBridge
    .setLoginItem(loginSwitch.getAttribute("aria-checked") !== "true")
    // Redesenha com o que o SISTEMA ficou, não com o que o clique pediu:
    // `register()` pode ter sucesso e ainda exigir aprovação, e um controle
    // ligado só ao pedido mentiria.
    .then(paintLogin)
    .catch((error: unknown) => note(loginNote, `Não foi possível mudar: ${reason(error)}`, "bad"));
});

el<HTMLButtonElement>("open-dictionary").addEventListener("click", () =>
  window.preferencesBridge.openDictionary(),
);

el<HTMLButtonElement>("open-onboarding").addEventListener("click", () =>
  window.preferencesBridge.openOnboarding(),
);

void window.preferencesBridge
  .load()
  .then(render)
  .catch((error: unknown) => say(`Não foi possível abrir as preferências: ${reason(error)}`));
