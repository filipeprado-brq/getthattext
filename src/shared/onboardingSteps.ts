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
};

/**
 * Os quatro, todos obrigatórios.
 *
 * A chave era pulável — a §9 a marcava como opcional, e o wizard oferecia
 * "Agora não". Deixou de ser: adiar a decisão empurrava a descoberta de que
 * a chave está errada para a primeira ditação, longe do campo onde ela foi
 * colada. Quem não quer reescrita desliga em Preferências, que é uma
 * escolha nomeada em vez de um adiamento.
 *
 * Isto vale para o WIZARD, não para o app: `isReady` continua sem exigir
 * chave, e ditar sem ela segue entregando o texto cru.
 */
export const STEPS: readonly Step[] = [
  { id: "microphone", title: "Microfone" },
  { id: "models", title: "Modelos" },
  { id: "key", title: "Reescrita" },
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
 * O primeiro passo que ainda falta.
 *
 * Reabrir o onboarding não pode fazer você refazer o que já fez: o wizard
 * abre onde parou, não no começo.
 */
export function firstPending(
  state: OnboardingState,
  shortcutConfirmed: boolean,
): StepId | undefined {
  return STEPS.find((step) => !isStepDone(state, step.id, shortcutConfirmed))?.id;
}
