import type { KeyCheck, ModelProgress } from "../shared/bridge.js";
import { reason } from "../shared/errors.js";
import { formatBytes, TRANSCRIPTION_MODELS } from "../shared/models.js";
import type { OnboardingState } from "../shared/onboarding.js";
import { firstPending, isStepDone, type StepId, STEPS } from "../shared/onboardingSteps.js";
import { PROVIDERS, providerFor } from "../shared/providers.js";
import { acceleratorToSymbols } from "../shared/shortcut.js";
import { el, paintChoices, paintDownloads as paintList, sayInto } from "./dom.js";
import { recordShortcut } from "./shortcutField.js";

/**
 * A primeira abertura, como wizard linear.
 *
 * Um passo por tela, na ordem da seção 9 da spec, com o download entre o
 * passo dos modelos e o da chave. A navegação mora no RODAPÉ e não dentro do
 * passo: o botão de avançar mudava de lugar a cada tela e, no passo dos
 * modelos, sumia quando não havia nada a baixar — deixando o passo sem saída.
 *
 * O estado dos passos é DERIVADO do sistema a cada leitura — permissão,
 * arquivos no disco, chave guardada — nunca um sinalizador de "já fiz".
 * Apagar um modelo ou revogar a permissão traz a tela de volta no passo
 * certo.
 */

/** O download é tela, não passo: a régua continua marcando "Modelos". */
type PaneId = StepId | "download";

type Wizard = {
  pane: PaneId;
  /**
   * A tecla já chegou nesta sessão?
   *
   * Não é estado do sistema: sempre existe um atalho configurado, e o #5
   * mediu que `register` aceita qualquer combinação. Só apertar prova.
   */
  shortcutConfirmed: boolean;
  /** Download em curso: trava a navegação nos dois sentidos. */
  downloading: boolean;
  /** O recado do passo da chave, quando ele não é o padrão. */
  keyNote?: { text: string; tone: "ok" | "bad" | "" };
  /** Por que o último download parou, para o passo dos modelos dizer. */
  downloadFailure?: string;
};

const wizard: Wizard = { pane: "microphone", shortcutConfirmed: false, downloading: false };
let state: OnboardingState | undefined;

/** O andamento de cada arquivo, para a barra não zerar entre redesenhos. */
const progress = new Map<string, ModelProgress>();

const progressRuler = el("progress");
const micBanner = el("mic-banner");
const micTitle = el("mic-title");
const micSub = el("mic-sub");
const micPath = el("mic-path");
const micAsk = el<HTMLButtonElement>("mic-ask");
const micSettings = el<HTMLButtonElement>("mic-settings");
const choices = el("choices");
const bars = el("bars");
const providerSelect = el<HTMLSelectElement>("provider");
const keyInput = el<HTMLInputElement>("key");
const keyCheck = el<HTMLButtonElement>("key-check");
const keySave = el<HTMLButtonElement>("key-save");
const keyState = el("key-state");
const keyAside = el("key-aside");
const chord = el("chord");
const shortcutChange = el<HTMLButtonElement>("shortcut-change");
const shortcutTest = el<HTMLButtonElement>("shortcut-test");
const back = el<HTMLButtonElement>("back");
const next = el<HTMLButtonElement>("next");
const say = sayInto(el("status"));

/** O que o banner do microfone diz, por estado da permissão. */
const MICROPHONE: Readonly<
  Record<OnboardingState["microphone"], { title: string; sub: string; tone: "" | "ok" | "blocked" }>
> = {
  "not-determined": {
    title: "O macOS precisa autorizar",
    sub: "Clique em Permitir e responda à caixa do sistema. Sem essa autorização o app não consegue gravar.",
    tone: "",
  },
  granted: {
    title: "Microfone liberado",
    sub: "O app já pode gravar. O ícone da barra de menu muda enquanto isso acontece.",
    tone: "ok",
  },
  denied: {
    title: "Permissão negada",
    sub: "O macOS não pergunta duas vezes: ela só volta pelos Ajustes do Sistema, e vale depois de reabrir o app.",
    tone: "blocked",
  },
  restricted: {
    title: "O sistema restringe o microfone",
    sub: "Esta máquina não permite liberar o microfone para este app.",
    tone: "blocked",
  },
  unknown: {
    title: "Estado desconhecido",
    sub: "Não foi possível saber o que o sistema respondeu sobre o microfone.",
    tone: "blocked",
  },
};

/* ---------- desenho ---------- */

/** A régua: o download não tem traço próprio, ele pertence a "Modelos". */
function paintRuler(): void {
  const at = wizard.pane === "download" ? "models" : wizard.pane;
  const current = STEPS.findIndex(({ id }) => id === at);

  progressRuler.replaceChildren(
    ...STEPS.map((step, index) => {
      const mark = document.createElement("i");
      if (index < current || (state && isStepDone(state, step.id, wizard.shortcutConfirmed) && index !== current)) {
        mark.className = "done";
      }
      if (index === current) mark.className = "current";

      return mark;
    }),
  );
  progressRuler.setAttribute("aria-label", `Passo ${current + 1} de ${STEPS.length}`);
}

/** O nome do arquivo na tela de download: o tipo do modelo, ou o rótulo. */
function nameOf(file: string, label: string): string {
  const model = TRANSCRIPTION_MODELS.find((entry) => entry.file === file);

  return model ? `Modelo ${model.name}` : label;
}

function paintDownloads(): void {
  if (!state) return;

  paintList(
    bars,
    state.models.map((model) => {
      const seen = progress.get(model.file);

      return {
        title: nameOf(model.file, model.label),
        file: model.file,
        bytes: model.bytes,
        received: model.present ? model.bytes : (seen?.received ?? 0),
      };
    }),
    formatBytes,
  );
}

function paintProviders(): void {
  if (!state) return;

  const chosen = providerFor(state.provider);

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

  keyInput.placeholder = state.hasApiKey ? "•••••••• (guardada)" : `${chosen.keyPrefix}…`;
  keyAside.textContent =
    `A chave é emitida em ${chosen.keyUrl} e fica cifrada no Keychain desta ` +
    "máquina. O campo, o teste e o Keychain são os mesmos para todos os provedores.";

  const note =
    wizard.keyNote ??
    (state.hasApiKey
      ? { text: "Chave ativa, guardada no Keychain desta máquina.", tone: "ok" as const }
      : { text: "Cole a chave e clique em Ativar para seguir.", tone: "" as const });

  keyState.textContent = note.text;
  keyState.className = note.tone.length > 0 ? `key-state ${note.tone}` : "key-state";
}

/** O rótulo e a disponibilidade do botão que avança, por tela. */
function paintFooter(): void {
  if (!state) return;

  const missing = state.models.filter((model) => !model.present);

  back.disabled = wizard.pane === STEPS[0]?.id || wizard.downloading;
  next.disabled = false;

  switch (wizard.pane) {
    case "microphone":
      next.textContent = "Continuar";
      next.disabled = state.microphone !== "granted";
      break;
    case "models":
      next.textContent =
        missing.length === 0
          ? "Continuar"
          : `Baixar ${formatBytes(missing.reduce((total, model) => total + model.bytes, 0))}`;
      break;
    case "download":
      next.textContent = "Baixando…";
      next.disabled = true;
      break;
    case "key":
      next.textContent = "Continuar";
      next.disabled = !state.hasApiKey;
      break;
    case "shortcut":
      next.textContent = "Começar a usar";
      break;
  }
}

function paint(): void {
  paintRuler();
  if (!state) return;

  for (const { id } of STEPS) {
    el(`pane-${id}`).classList.toggle("active", id === wizard.pane);
  }
  el("pane-download").classList.toggle("active", wizard.pane === "download");

  const microphone = MICROPHONE[state.microphone];
  micBanner.className = microphone.tone.length > 0 ? `banner ${microphone.tone}` : "banner";
  micTitle.textContent = microphone.title;
  micSub.textContent = microphone.sub;
  micAsk.disabled = state.microphone !== "not-determined";
  // O caminho por escrito ao lado do ícone: o scheme
  // `x-apple.systempreferences:` não é suportado pela Apple e pode parar de
  // abrir, então ele é conveniência, não o único caminho.
  micPath.textContent =
    microphone.tone === "blocked"
      ? "Ajustes do Sistema › Privacidade e Segurança › Microfone › getthattext"
      : "";

  paintChoices(choices, {
    models: TRANSCRIPTION_MODELS,
    chosen: state.chosenModel,
    format: formatBytes,
    onPick: (file) => {
      void window.onboardingBridge
        .chooseModel(file)
        .then((updated) => {
          state = updated;
          paint();
        })
        .catch((error: unknown) => say(reason(error)));
    },
  });

  el("models-note").textContent = wizard.downloadFailure ?? "";
  paintDownloads();
  paintProviders();

  chord.textContent = acceleratorToSymbols(state.shortcut);
  paintFooter();
}

function go(pane: PaneId): void {
  wizard.pane = pane;
  say("");
  paint();
}

/* ---------- os passos ---------- */

micAsk.addEventListener("click", () => {
  micAsk.disabled = true;
  void window.onboardingBridge
    .requestMicrophone()
    .then((updated) => {
      state = updated;
      paint();
    })
    .catch((error: unknown) => say(reason(error)));
});

micSettings.addEventListener("click", () => {
  void window.onboardingBridge
    .openMicrophoneSettings()
    .catch((error: unknown) => say(`Não foi possível abrir os Ajustes: ${reason(error)}`));
});

providerSelect.addEventListener("change", () => {
  void window.onboardingBridge
    .chooseProvider(providerSelect.value)
    .then((updated) => {
      state = updated;
      wizard.keyNote = undefined;
      paint();
    })
    .catch((error: unknown) => say(reason(error)));
});

keySave.addEventListener("click", () => {
  const typed = keyInput.value.trim();

  if (typed.length === 0) {
    wizard.keyNote = { text: "Cole a chave do provedor para continuar.", tone: "bad" };
    paint();

    return;
  }

  keySave.disabled = true;
  void window.onboardingBridge
    .setApiKey(typed)
    .then(() => window.onboardingBridge.load())
    .then((updated) => {
      state = updated;
      keyInput.value = "";
      wizard.keyNote = { text: "Chave ativa, guardada no Keychain.", tone: "ok" };
      paint();
    })
    .catch((error: unknown) => say(`Não foi possível guardar a chave: ${reason(error)}`))
    .finally(() => {
      keySave.disabled = false;
    });
});

/**
 * O teste da chave (#19).
 *
 * Campo vazio testa a que já está guardada — é o caso de quem volta ao passo
 * depois de ativar. Recusa e rede fora têm recados diferentes de propósito:
 * uma pede outra chave, a outra pede tentar de novo.
 */
const KEY_CHECK: Readonly<Record<KeyCheck["kind"], { text: string; tone: "ok" | "bad" }>> = {
  ok: { text: "O provedor respondeu. A chave é válida.", tone: "ok" },
  rejected: { text: "O provedor recusou essa chave. Confira se copiou inteira.", tone: "bad" },
  unreachable: { text: "Não foi possível falar com o provedor. Tente de novo.", tone: "bad" },
};

keyCheck.addEventListener("click", () => {
  keyCheck.disabled = true;
  keyCheck.textContent = "Testando…";
  wizard.keyNote = { text: "Perguntando ao provedor…", tone: "" };
  paint();

  void window.onboardingBridge
    .testApiKey(keyInput.value.trim())
    .then((result) => {
      wizard.keyNote = KEY_CHECK[result.kind];
      if (result.kind === "unreachable") console.error("teste da chave:", result.why);
      paint();
    })
    .catch((error: unknown) => say(`O teste falhou: ${reason(error)}`))
    .finally(() => {
      keyCheck.disabled = false;
      keyCheck.textContent = "Testar conexão";
    });
});

shortcutChange.addEventListener("click", () => {
  shortcutChange.disabled = true;
  shortcutTest.disabled = true;
  chord.classList.add("recording");

  recordShortcut({
    output: chord,
    onDone: (accelerator) => {
      chord.classList.remove("recording");
      shortcutChange.disabled = false;
      shortcutTest.disabled = false;

      if (accelerator === undefined) {
        paint();

        return;
      }

      // Trocar invalida a confirmação: quem provou que chega foi a
      // combinação ANTIGA.
      wizard.shortcutConfirmed = false;
      void window.onboardingBridge
        .chooseShortcut(accelerator)
        .then((updated) => {
          state = updated;
          el("shortcut-note").textContent = "";
          paint();
        })
        .catch((error: unknown) => say(`Não foi possível trocar o atalho: ${reason(error)}`));
    },
  });
});

shortcutTest.addEventListener("click", () => {
  // Desabilitar não é cosmético: um segundo clique cancelaria o teste em
  // curso, e o recado do primeiro chegaria depois do segundo.
  shortcutTest.disabled = true;
  shortcutChange.disabled = true;
  shortcutTest.textContent = "Aperte agora…";
  el("shortcut-note").textContent = "";

  void window.onboardingBridge
    .testShortcut()
    .then((result) => {
      wizard.shortcutConfirmed = result === "arrived";
      el("shortcut-note").textContent =
        result === "arrived"
          ? "A combinação chegou ao app. Registrar não prova isso — por isso o teste."
          : result === "timeout"
            ? "A combinação não chegou. Outro aplicativo pode estar usando essa tecla — o sistema não avisa. Troque aqui mesmo."
            : "";
      paint();
    })
    .catch((error: unknown) => say(`O teste falhou: ${reason(error)}`))
    .finally(() => {
      shortcutTest.disabled = false;
      shortcutChange.disabled = false;
      shortcutTest.textContent = wizard.shortcutConfirmed ? "Testar de novo" : "Testar";
    });
});

/* ---------- navegação ---------- */

const ORDER: readonly PaneId[] = ["microphone", "models", "download", "key", "shortcut"];

back.addEventListener("click", () => {
  const index = ORDER.indexOf(wizard.pane);
  // O download não é destino de "Voltar": voltar dele é voltar à escolha.
  const target = ORDER[Math.max(0, index - 1)];

  go(target === "download" ? "models" : (target ?? "microphone"));
});

/**
 * Baixa o que falta, mostrando a tela própria.
 *
 * O progresso chega empurrado pelo main, arquivo por arquivo; a promessa só
 * resolve quando o último terminou e os não escolhidos foram apagados.
 */
function download(): void {
  wizard.downloading = true;
  wizard.downloadFailure = undefined;
  progress.clear();
  go("download");

  void window.onboardingBridge
    .downloadModels()
    .then((updated) => {
      state = updated;
      wizard.downloading = false;
      go("key");
    })
    .catch((error: unknown) => {
      wizard.downloading = false;
      // Volta para a escolha, que é de onde se tenta de novo: o botão já
      // volta a dizer "Baixar", e o `.part` no disco retoma de onde parou.
      wizard.downloadFailure = reason(error);
      go("models");
    });
}

next.addEventListener("click", () => {
  if (!state) return;

  if (wizard.pane === "models" && state.models.some((model) => !model.present)) {
    download();

    return;
  }

  if (wizard.pane === "shortcut") {
    window.onboardingBridge.finish();

    return;
  }

  const index = ORDER.indexOf(wizard.pane);
  const target = ORDER[index + 1];
  // Nada a baixar pula a tela de download: ela não é passo, é espera.
  go(target === "download" ? "key" : (target ?? "shortcut"));
});

/**
 * O progresso desenha DIRETO, sem reconsultar o estado.
 *
 * São ~9 mil chunks em 574 MB: pedir o estado de volta a cada um faria nove
 * mil idas e voltas por IPC só para mover uma barra.
 */
window.onboardingBridge.onProgress((update) => {
  progress.set(update.file, update);
  paintDownloads();
});

void window.onboardingBridge
  .load()
  .then((loaded) => {
    state = loaded;
    // Abre no primeiro passo que falta: reabrir não pode fazer você refazer
    // o que já fez.
    go(firstPending(loaded, wizard.shortcutConfirmed) ?? "shortcut");
  })
  .catch((error: unknown) => say(`Não foi possível abrir: ${reason(error)}`));
