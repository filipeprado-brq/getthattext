import type { PreferencesSnapshot } from "../shared/bridge.js";
import { reason } from "../shared/errors.js";
import { el } from "./dom.js";
import { LANGUAGES } from "../shared/preferences.js";
import { acceleratorFromChord, acceleratorToSymbols } from "../shared/shortcut.js";

const shortcutOutput = el("shortcut");
const recordButton = el<HTMLButtonElement>("record");
const shortcutNote = el("shortcut-note");
const testButton = el<HTMLButtonElement>("test");
const languageSelect = el<HTMLSelectElement>("language");
const modelSelect = el<HTMLSelectElement>("model");
const modelNote = el("model-note");
const rewriteBox = el<HTMLInputElement>("rewrite");
const soundBox = el<HTMLInputElement>("sound");
const apiKeyInput = el<HTMLInputElement>("api-key");
const keyNote = el("key-note");
const loginBox = el<HTMLInputElement>("login");
const loginNote = el("login-note");
const status = el("status");

/** O atalho em vigor, para os recados não dependerem do DOM. */
let chosen = "";

function say(message: string): void {
  status.textContent = message;
}

function note(target: HTMLElement, text: string, kind: "warn" | "good" | "" = ""): void {
  target.textContent = text;
  target.className = `note${kind ? ` ${kind}` : ""}`;
}

/** Grava e redesenha. Falha de gravação é dita, nunca engolida. */
async function save(patch: Parameters<typeof window.preferencesBridge.save>[0]) {
  try {
    render(await window.preferencesBridge.save(patch));
    say("");
  } catch (error) {
    say(`Não foi possível gravar: ${reason(error)}`);
  }
}

function render(snapshot: PreferencesSnapshot): void {
  const { preferences, models, loginItem, hasApiKey } = snapshot;

  chosen = preferences.shortcut;
  shortcutOutput.textContent = acceleratorToSymbols(chosen);
  showShortcutNote(chosen);

  languageSelect.replaceChildren(
    ...LANGUAGES.map(({ code, label }) => new Option(label, code, false, code === preferences.language)),
  );

  modelSelect.replaceChildren(
    ...(models.length > 0 ? models : [preferences.model]).map((name) =>
      new Option(name, name, false, name === preferences.model),
    ),
  );
  note(
    modelNote,
    models.includes(preferences.model)
      ? ""
      : `O modelo "${preferences.model}" não está na pasta de modelos — a transcrição vai falhar.`,
    models.includes(preferences.model) ? "" : "warn",
  );

  rewriteBox.checked = preferences.rewrite;
  soundBox.checked = preferences.sound;

  apiKeyInput.value = "";
  apiKeyInput.placeholder = hasApiKey ? "•••••••• (guardada)" : "gsk_…";
  note(
    keyNote,
    hasApiKey
      ? "Guardada no Keychain. Deixe em branco e clique em Guardar para apagar."
      : "Sem chave, o texto vai cru para a área de transferência — o app não bloqueia.",
  );

  showLoginState(loginItem);
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

/**
 * Os quatro estados do login item, cada um com o seu recado.
 *
 * `not-found` é o caso comum em desenvolvimento — app não empacotado — e
 * cair calado ali seria falhar em silêncio no mesmo controle que existe
 * para não mentir.
 */
function showLoginState(state: PreferencesSnapshot["loginItem"]): void {
  loginBox.checked = state.status === "enabled" || state.status === "requires-approval";

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

/* ---------- os controles ---------- */

/**
 * Grava o atalho apertando as teclas.
 *
 * Um campo de texto exigiria saber escrever `Alt+Command+G`, que é sintaxe
 * do Electron — nem todo mundo sabe, e ninguém deveria precisar. Enquanto
 * grava, `preventDefault` impede que a combinação faça o que faria: você
 * está escolhendo o atalho, não usando o computador.
 */
function startRecording(): void {
  recordButton.disabled = true;
  testButton.disabled = true;
  shortcutOutput.classList.add("recording");
  shortcutOutput.textContent = "Aperte a combinação…";
  note(shortcutNote, "Esc cancela.");

  const onKey = (event: KeyboardEvent): void => {
    event.preventDefault();

    if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      stopRecording();

      return;
    }

    const accelerator = acceleratorFromChord(event);
    if (accelerator === undefined) {
      // Ainda incompleto — modificador sozinho, ou tecla intraduzível.
      shortcutOutput.textContent = acceleratorToSymbols(
        [
          event.ctrlKey ? "Control" : "",
          event.altKey ? "Alt" : "",
          event.shiftKey ? "Shift" : "",
          event.metaKey ? "Command" : "",
        ]
          .filter((name) => name.length > 0)
          .join("+"),
      ) || "Aperte a combinação…";

      return;
    }

    stopRecording();
    void save({ shortcut: accelerator });
  };

  const stopRecording = (): void => {
    window.removeEventListener("keydown", onKey, true);
    recordButton.disabled = false;
    testButton.disabled = false;
    shortcutOutput.classList.remove("recording");
    shortcutOutput.textContent = acceleratorToSymbols(chosen);
    showShortcutNote(chosen);
  };

  window.addEventListener("keydown", onKey, true);
}

recordButton.addEventListener("click", startRecording);

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
  note(shortcutNote, `Aperte ${acceleratorToSymbols(chosen)}.`);

  void window.preferencesBridge
    .testShortcut()
    .then((result) => {
      if (result === "cancelled") {
        showShortcutNote(chosen);

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
modelSelect.addEventListener("change", () => void save({ model: modelSelect.value }));
rewriteBox.addEventListener("change", () => void save({ rewrite: rewriteBox.checked }));
soundBox.addEventListener("change", () => void save({ sound: soundBox.checked }));

el<HTMLButtonElement>("save-key").addEventListener("click", () => {
  void window.preferencesBridge
    .setApiKey(apiKeyInput.value)
    .then((stored) => {
      apiKeyInput.value = "";
      apiKeyInput.placeholder = stored ? "•••••••• (guardada)" : "gsk_…";
      note(
        keyNote,
        stored ? "Chave guardada no Keychain." : "Chave apagada.",
        "good",
      );
    })
    .catch((error: unknown) => note(keyNote, `Não foi possível guardar: ${reason(error)}`, "warn"));
});

loginBox.addEventListener("change", () => {
  void window.preferencesBridge
    .setLoginItem(loginBox.checked)
    // Redesenha com o que o SISTEMA ficou, não com o que o clique pediu:
    // `register()` pode ter sucesso e ainda exigir aprovação, e um checkbox
    // ligado só ao pedido mentiria.
    .then(showLoginState)
    .catch((error: unknown) => note(loginNote, `Não foi possível mudar: ${reason(error)}`, "warn"));
});

void window.preferencesBridge
  .load()
  .then(render)
  .catch((error: unknown) => say(`Não foi possível abrir as preferências: ${reason(error)}`));
