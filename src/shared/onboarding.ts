/**
 * O contrato da primeira abertura.
 *
 * Em `shared/` porque a janela de onboarding e o main precisam concordar
 * sobre o que "pronto" significa, e escrever isso duas vezes não teria nada
 * que os mantivesse em sincronia.
 */

/** O que o macOS diz sobre o microfone. */
export type MicrophoneAccess =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export type ModelStatus = {
  file: string;
  label: string;
  bytes: number;
  present: boolean;
};

export type OnboardingState = {
  microphone: MicrophoneAccess;
  models: readonly ModelStatus[];
  /** Opcional: sem chave o app funciona em modo cru. */
  hasApiKey: boolean;
  /**
   * O atalho EM VIGOR, não o padrão.
   *
   * A tela ensina qual tecla apertar. Mostrar a constante ensinaria a tecla
   * errada para quem já trocou nas preferências — e o onboarding volta
   * sempre que um modelo some, não só na primeira abertura.
   */
  shortcut: string;
};
