import type { ModelProgress } from "../shared/bridge.js";
import { reason } from "../shared/errors.js";
import { formatBytes, progressPercent } from "../shared/models.js";
import type { OnboardingState } from "../shared/onboarding.js";
import {
  firstPending,
  isStepDone,
  type StepId,
  STEPS,
} from "../shared/onboardingSteps.js";
import { acceleratorToSymbols } from "../shared/shortcut.js";
import { el } from "./dom.js";

/**
 * A primeira abertura, como wizard.
 *
 * Um passo por vez, avançando sozinho quando o passo se completa. Quatro
 * passos simultâneos obrigam a decidir por onde começar antes de conseguir
 * começar, e a §9 diz "primeira abertura, EM ORDEM".
 *
 * O estado dos passos é DERIVADO do sistema a cada leitura — permissão e
 * arquivos no disco — nunca um sinalizador de "já fiz". Apagar um modelo ou
 * revogar a permissão traz a tela de volta no passo certo.
 */
const dots = el("dots");
const title = el("title");
const micLead = el("mic-lead");
const micPath = el("mic-path");
const micAsk = el<HTMLButtonElement>("mic-ask");
const micSettings = el<HTMLButtonElement>("mic-settings");
const modelsLead = el("models-lead");
const modelsGet = el<HTMLButtonElement>("models-get");
const bars = el("bars");
const keyInput = el<HTMLInputElement>("key");
const shortcutLead = el("shortcut-lead");
const shortcutTest = el<HTMLButtonElement>("shortcut-test");
const back = el<HTMLButtonElement>("back");
const status = el("status");

/** O passo na tela. `done` é o fim do wizard. */
let current: StepId | "done" = "microphone";
let state: OnboardingState | undefined;

/**
 * A tecla já chegou nesta sessão?
 *
 * Não é estado do sistema: sempre existe um atalho configurado, e o #5 mediu
 * que `register` aceita qualquer combinação. Só apertar prova.
 */
let shortcutConfirmed = false;

/** O andamento de cada arquivo, para a barra não zerar entre redesenhos. */
const progress = new Map<string, ModelProgress>();

function say(message: string): void {
  status.textContent = message;
}

const TITLES: Readonly<Record<StepId | "done", string>> = {
  microphone: "Primeiro, o microfone",
  models: "Agora, os modelos",
  key: "A chave do Groq",
  shortcut: "Confirme o atalho",
  done: "Pronto",
};

const MIC_LEAD: Readonly<Record<OnboardingState["microphone"], string>> = {
  granted: "Permissão concedida.",
  "not-determined":
    "O app precisa ouvir para transcrever. O áudio é processado nesta máquina " +
    "e não é enviado a lugar nenhum.",
  denied:
    "Permissão negada. Ela só pode ser devolvida pelos Ajustes do Sistema, e a " +
    "mudança vale depois de reabrir o app.",
  restricted: "O sistema restringe o acesso ao microfone nesta máquina.",
  unknown: "Não foi possível saber o estado da permissão.",
};

/* ---------- navegação ---------- */

function show(step: StepId | "done"): void {
  current = step;
  title.textContent = TITLES[step];

  for (const { id } of STEPS) {
    el(`panel-${id}`).classList.toggle("active", id === step);
  }
  el("panel-done").classList.toggle("active", step === "done");

  // Voltar existe para rever o que já passou, não para escapar do que falta.
  back.hidden = step === STEPS[0]?.id;
  paint();
}

/** Vai para o próximo passo que ainda faz sentido mostrar. */
function advance(): void {
  const index = STEPS.findIndex(({ id }) => id === current);
  const next = STEPS.slice(index + 1).find(
    ({ id }) => !state || !isStepDone(state, id, shortcutConfirmed),
  );

  show(next?.id ?? "done");
}

back.addEventListener("click", () => {
  const index = current === "done" ? STEPS.length : STEPS.findIndex(({ id }) => id === current);
  const previous = STEPS[Math.max(0, index - 1)];
  if (previous) show(previous.id);
});

/* ---------- desenho ---------- */

function paintDots(): void {
  dots.replaceChildren(
    ...STEPS.map(({ id }) => {
      const dot = document.createElement("div");
      dot.className = "dot";
      if (state && isStepDone(state, id, shortcutConfirmed)) dot.classList.add("done");
      if (id === current) dot.classList.add("current");

      return dot;
    }),
  );
}

function paintBars(): void {
  if (!state) return;

  bars.replaceChildren(
    ...state.models.map((model) => {
      const seen = progress.get(model.file);
      const percent = model.present
        ? 100
        : progressPercent(seen?.received ?? 0, seen?.total ?? model.bytes);

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

/** O recado do atalho, com a combinação em destaque no meio. */
function describeShortcut(before: string, after: string): void {
  shortcutLead.replaceChildren(
    document.createTextNode(before),
    Object.assign(document.createElement("span"), {
      className: "chord",
      textContent: acceleratorToSymbols(state?.shortcut ?? ""),
    }),
    document.createTextNode(after),
  );
}

function paint(): void {
  paintDots();
  if (!state) return;

  const blocked = state.microphone === "denied" || state.microphone === "restricted";
  el("panel-microphone").classList.toggle("blocked", blocked);
  micLead.textContent = MIC_LEAD[state.microphone];
  micAsk.hidden = state.microphone !== "not-determined";
  micSettings.hidden = !blocked;
  // O caminho por escrito ao lado do botão: o scheme `x-apple.
  // systempreferences:` não é suportado pela Apple e pode parar de abrir.
  micPath.textContent = blocked
    ? "Ajustes do Sistema › Privacidade e Segurança › Microfone › getthattext"
    : "";

  const missing = state.models.filter((model) => !model.present);
  modelsLead.textContent =
    missing.length === 0
      ? "Os modelos estão no lugar."
      : `A transcrição roda nesta máquina, então os modelos ficam aqui. ` +
        `Faltam ${formatBytes(missing.reduce((total, m) => total + m.bytes, 0))}.`;
  modelsGet.hidden = missing.length === 0;
  paintBars();

  keyInput.placeholder = state.hasApiKey ? "•••••••• (guardada)" : "gsk_…";

  if (current === "shortcut" && !shortcutConfirmed && !shortcutTest.disabled) {
    describeShortcut("Aperte ", " para começar e parar de ditar. Teste agora.");
  }
}

/** Relê o estado e avança sozinho se o passo atual se completou. */
async function refresh(): Promise<void> {
  try {
    state = await window.onboardingBridge.load();
  } catch (error) {
    say(`Não foi possível ler o estado: ${reason(error)}`);

    return;
  }

  if (current !== "done" && isStepDone(state, current, shortcutConfirmed)) advance();
  else paint();
}

/* ---------- os passos ---------- */

micAsk.addEventListener("click", () => {
  micAsk.disabled = true;
  void window.onboardingBridge
    .requestMicrophone()
    .then((updated) => {
      state = updated;
      if (isStepDone(updated, "microphone", shortcutConfirmed)) advance();
      else paint();
    })
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
    .then(() => refresh())
    .catch((error: unknown) => say(reason(error)))
    .finally(() => {
      modelsGet.disabled = false;
      modelsGet.textContent = "Baixar";
    });
});

el<HTMLButtonElement>("key-save").addEventListener("click", () => {
  void window.onboardingBridge
    .setApiKey(keyInput.value)
    .then(() => {
      keyInput.value = "";

      return refresh();
    })
    .then(() => advance())
    .catch((error: unknown) => say(`Não foi possível guardar a chave: ${reason(error)}`));
});

el<HTMLButtonElement>("key-skip").addEventListener("click", advance);

shortcutTest.addEventListener("click", () => {
  shortcutTest.disabled = true;
  shortcutTest.textContent = "Aguardando…";
  el("panel-shortcut").classList.remove("blocked");
  describeShortcut("Aperte ", " agora.");

  void window.onboardingBridge
    .testShortcut()
    .then((result) => {
      shortcutConfirmed = result === "arrived";

      if (result === "arrived") {
        describeShortcut("", " chegou. O atalho está funcionando.");
        advance();

        return;
      }
      if (result === "timeout") {
        el("panel-shortcut").classList.add("blocked");
        describeShortcut(
          "",
          " não chegou. Outro aplicativo pode estar usando essa combinação — o " +
            "sistema não avisa. Dá para trocar em Preferências depois.",
        );
      }
      paint();
    })
    .catch((error: unknown) => say(`O teste falhou: ${reason(error)}`))
    .finally(() => {
      shortcutTest.disabled = false;
      shortcutTest.textContent = shortcutConfirmed ? "Testar de novo" : "Testar agora";
    });
});

el<HTMLButtonElement>("finish").addEventListener("click", () =>
  window.onboardingBridge.finish(),
);

/**
 * O progresso desenha DIRETO, sem reconsultar o estado.
 *
 * São ~9 mil chunks em 574 MB: pedir o estado de volta a cada um faria nove
 * mil idas e voltas por IPC só para mover uma barra.
 */
window.onboardingBridge.onProgress((update) => {
  progress.set(update.file, update);
  paintBars();
});

void window.onboardingBridge
  .load()
  .then((loaded) => {
    state = loaded;
    // Abre no primeiro passo que falta: reabrir não pode fazer você refazer
    // o que já fez.
    show(firstPending(loaded, shortcutConfirmed) ?? "shortcut");
  })
  .catch((error: unknown) => say(`Não foi possível abrir: ${reason(error)}`));
