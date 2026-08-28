import type { OnboardingState } from "./onboarding.js";

/**
 * Os passos da primeira abertura, na ordem da seção 9 da spec.
 *
 * Puro e em `shared/` porque decidir "qual passo falta" é a espinha do
 * wizard: errar isso faz você refazer o que já fez, ou pular o que não
 * pode ser pulado.
 */
export type StepId = "microphone" | "models" | "key" | "shortcut";

export type Step = {
  id: StepId;
  title: string;
  /**
   * Dá para seguir sem completar?
   *
   * Só a chave. A §9 a marca como opcional — sem ela o app funciona em modo
   * cru. Microfone e modelos não têm alternativa: sem eles não há ditação.
   */
  skippable?: true;
};

export const STEPS: readonly Step[] = [
  { id: "microphone", title: "Microfone" },
  { id: "models", title: "Modelos" },
  { id: "key", title: "Chave do Groq", skippable: true },
  { id: "shortcut", title: "O atalho" },
];

/**
 * O passo está concluído?
 *
 * `shortcutConfirmed` vem de fora porque não é estado do sistema: é o fato
 * de a tecla ter CHEGADO nesta sessão. Sempre existe um atalho configurado,
 * e `globalShortcut.register` aceita qualquer combinação — medido no #5 —
 * então "está configurado" não prova nada.
 */
export function isStepDone(
  state: OnboardingState,
  id: StepId,
  shortcutConfirmed: boolean,
): boolean {
  switch (id) {
    case "microphone":
      return state.microphone === "granted";
    case "models":
      return state.models.every((model) => model.present);
    case "key":
      return state.hasApiKey;
    case "shortcut":
      return shortcutConfirmed;
  }
}

/**
 * O primeiro passo que ainda falta, ignorando os puláveis.
 *
 * Reabrir o onboarding não pode fazer você refazer o que já fez — e parar
 * na chave obrigaria a decidir sobre o Groq antes de confirmar o atalho,
 * que é o passo que fecha o onboarding.
 */
export function firstPending(
  state: OnboardingState,
  shortcutConfirmed: boolean,
): StepId | undefined {
  return STEPS.find(
    (step) => !step.skippable && !isStepDone(state, step.id, shortcutConfirmed),
  )?.id;
}
