import type { ModelProgress } from "../shared/bridge.js";
import { reason } from "../shared/errors.js";
import { el } from "./dom.js";
import { formatBytes, progressPercent } from "../shared/models.js";
import type { OnboardingState } from "../shared/onboarding.js";
import { acceleratorToSymbols } from "../shared/shortcut.js";

const micStep = el("step-mic");
const micExplanation = el("mic-what");
const micPath = el("mic-path");
const micAsk = el<HTMLButtonElement>("mic-ask");
const micSettings = el<HTMLButtonElement>("mic-settings");
const modelsStep = el("step-models");
const modelsExplanation = el("models-what");
const modelsGet = el<HTMLButtonElement>("models-get");
const bars = el("bars");
const keyStep = el("step-key");
const keyInput = el<HTMLInputElement>("key");
const shortcutStep = el("step-shortcut");
const shortcutExplanation = el("shortcut-what");
const shortcutTest = el<HTMLButtonElement>("shortcut-test");
const status = el("status");
const finish = el<HTMLButtonElement>("finish");

/** O andamento de cada arquivo, para a barra não zerar entre redesenhos. */
const progress = new Map<string, ModelProgress>();

/** O atalho em vigor, para os recados não dependerem do último redesenho. */
let chosenShortcut = "";

/**
 * A tecla já chegou nesta sessão?
 *
 * O passo NÃO é marcado por existir um atalho configurado — é marcado quando
 * a combinação de fato chega. O #5 mediu que `globalShortcut.register`
 * devolve `true` para tudo, então "está configurado" não prova nada; só
 * apertar prova.
 */
let shortcutConfirmed = false;

/** O recado do atalho, com a combinação em destaque no meio. */
function describeShortcut(before: string, after: string): void {
  shortcutExplanation.replaceChildren(
    document.createTextNode(before),
    Object.assign(document.createElement("span"), {
      className: "chord",
      textContent: acceleratorToSymbols(chosenShortcut),
    }),
    document.createTextNode(after),
  );
}

function say(message: string): void {
  status.textContent = message;
}

const MIC_TEXT: Readonly<Record<OnboardingState["microphone"], string>> = {
  granted: "Permissão concedida.",
  "not-determined": "O app precisa da sua permissão para ouvir.",
  denied:
    "Permissão negada. Ela só pode ser devolvida pelos Ajustes do Sistema, e a " +
    "mudança vale depois de reabrir o app.",
  restricted: "O sistema restringe o acesso ao microfone nesta máquina.",
  unknown: "Não foi possível saber o estado da permissão.",
};

function renderMicrophone(state: OnboardingState): void {
  const granted = state.microphone === "granted";
  const blocked = state.microphone === "denied" || state.microphone === "restricted";

  micStep.classList.toggle("done", granted);
  micStep.classList.toggle("blocked", blocked);
  micExplanation.textContent = MIC_TEXT[state.microphone];

  micAsk.hidden = granted || blocked;
  micSettings.hidden = !blocked;
  // O caminho por escrito ao lado do botão: o scheme `x-apple.
  // systempreferences:` não é suportado pela Apple e pode parar de abrir.
  micPath.textContent = blocked
    ? "Ajustes do Sistema › Privacidade e Segurança › Microfone › getthattext"
    : "";
}

/** O último estado desenhado, para o progresso não precisar pedi-lo de novo. */
let lastState: OnboardingState | undefined;

function paintBars(state: OnboardingState | undefined): void {
  if (!state) return;

  bars.replaceChildren(
    ...state.models.map((model) => {
      const done = progress.get(model.file);
      const percent = model.present
        ? 100
        : progressPercent(done?.received ?? 0, done?.total ?? model.bytes);

      const bar = document.createElement("div");
      bar.className = model.present ? "bar done" : "bar";

      const head = document.createElement("div");
      head.className = "bar-head";
      const name = document.createElement("span");
      name.textContent = model.label;
      const amount = document.createElement("span");
      amount.textContent = model.present
        ? formatBytes(model.bytes)
        : `${percent}% de ${formatBytes(model.bytes)}`;
      head.append(name, amount);

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = `${percent}%`;
      track.append(fill);

      bar.append(head, track);

      return bar;
    }),
  );
}

function renderModels(state: OnboardingState): void {
  const missing = state.models.filter((model) => !model.present);

  modelsStep.classList.toggle("done", missing.length === 0);
  modelsExplanation.textContent =
    missing.length === 0
      ? "Tudo no lugar."
      : `Faltam ${formatBytes(missing.reduce((total, m) => total + m.bytes, 0))}. ` +
        "A transcrição roda na sua máquina, então os modelos ficam aqui.";
  // "Primeira abertura, EM ORDEM" (§9): baixar antes de conceder a
  // permissão deixaria você esperando dez minutos para descobrir que o
  // passo anterior falhou.
  modelsGet.hidden = missing.length === 0;
  modelsGet.disabled = state.microphone !== "granted";

  paintBars(state);
}

function render(state: OnboardingState): void {
  lastState = state;
  renderMicrophone(state);
  renderModels(state);

  keyStep.classList.toggle("done", state.hasApiKey);
  keyInput.placeholder = state.hasApiKey ? "•••••••• (guardada)" : "gsk_…";

  chosenShortcut = state.shortcut;
  if (!shortcutConfirmed) describeShortcut("Aperte ", " para começar e parar de ditar.");

  const ready =
    state.microphone === "granted" && state.models.every((model) => model.present);
  finish.disabled = !ready;
}

async function refresh(): Promise<void> {
  try {
    render(await window.onboardingBridge.load());
  } catch (error) {
    say(`Não foi possível ler o estado: ${reason(error)}`);
  }
}

micAsk.addEventListener("click", () => {
  micAsk.disabled = true;
  void window.onboardingBridge
    .requestMicrophone()
    .then(render)
    .catch((error: unknown) => say(reason(error)))
    .finally(() => {
      micAsk.disabled = false;
    });
});

micSettings.addEventListener("click", () => {
  void window.onboardingBridge
    .openMicrophoneSettings()
    .catch((error: unknown) => say(`Não foi possível abrir os Ajustes: ${reason(error)}`));
});

modelsGet.addEventListener("click", () => {
  modelsGet.disabled = true;
  modelsGet.textContent = "Baixando…";
  say("");

  void window.onboardingBridge
    .downloadModels()
    .then(render)
    .catch((error: unknown) => say(reason(error)))
    .finally(() => {
      modelsGet.disabled = false;
      modelsGet.textContent = "Baixar";
      void refresh();
    });
});

el<HTMLButtonElement>("key-save").addEventListener("click", () => {
  void window.onboardingBridge
    .setApiKey(keyInput.value)
    .then(() => {
      keyInput.value = "";

      return refresh();
    })
    .catch((error: unknown) => say(`Não foi possível guardar a chave: ${reason(error)}`));
});

shortcutTest.addEventListener("click", () => {
  shortcutTest.disabled = true;
  shortcutTest.textContent = "Aguardando…";
  describeShortcut("Aperte ", " agora.");

  void window.onboardingBridge
    .testShortcut()
    .then((result) => {
      shortcutConfirmed = result === "arrived";
      shortcutStep.classList.toggle("done", shortcutConfirmed);
      shortcutStep.classList.toggle("blocked", result === "timeout");

      if (result === "arrived") {
        describeShortcut("", " chegou. O atalho está funcionando.");
      } else if (result === "timeout") {
        describeShortcut(
          "",
          " não chegou. Outro aplicativo pode estar usando essa combinação — o " +
            "sistema não avisa. Troque em Preferências e teste de novo.",
        );
      } else {
        describeShortcut("Aperte ", " para começar e parar de ditar.");
      }
    })
    .catch((error: unknown) => say(`O teste falhou: ${reason(error)}`))
    .finally(() => {
      shortcutTest.disabled = false;
      shortcutTest.textContent = shortcutConfirmed ? "Testar de novo" : "Testar agora";
    });
});

finish.addEventListener("click", () => window.onboardingBridge.finish());

/**
 * O progresso desenha DIRETO, sem reconsultar o estado.
 *
 * São ~9 mil chunks em 574 MB: pedir o estado de volta a cada um faria nove
 * mil idas e voltas por IPC e dezoito mil `stat` no disco, só para desenhar
 * uma barra. O estado completo é relido quando o download termina.
 */
window.onboardingBridge.onProgress((update) => {
  progress.set(update.file, update);
  paintBars(lastState);
});

void refresh();
