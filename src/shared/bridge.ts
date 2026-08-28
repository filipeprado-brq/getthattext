import type { Entry } from "./dictionary.js";
import type { OnboardingState } from "./onboarding.js";
import type { Preferences } from "./preferences.js";

/**
 * Contrato entre o processo main e o renderer.
 *
 * Definido aqui e importado pelos dois lados: o `contextBridge` implementa,
 * o renderer consome. Escrever a assinatura duas vezes não teria nada que
 * as mantivesse em sincronia.
 *
 * O gatilho vive no main (ícone da barra), mas a captura só existe no
 * renderer — daí o tráfego nas duas direções.
 */

/**
 * Ordens que o main dá ao renderer.
 *
 * `blip` está aqui porque o processo main não toca áudio: quem tem Web
 * Audio é o renderer, que já mantém um `AudioContext` pré-aquecido.
 */
export type Command = "start" | "stop" | "blip";

export type Bridge = {
  /** Assina as ordens vindas do ícone da barra. */
  onCommand(handler: (command: Command) => void): void;
  /**
   * Entrega o WAV capturado; o main transcreve e devolve o texto.
   *
   * `interrupted` viaja JUNTO com o áudio de propósito. Como aviso separado,
   * ele virava um sinalizador no main que dependia da ordem entre dois IPCs
   * — e um sinalizador que ficasse quente contaminaria a ditação seguinte.
   */
  deliverAudio(bytes: ArrayBuffer, interrupted: boolean): Promise<void>;
  /** Avisa o main que a captura começou de fato — o primeiro frame chegou. */
  reportAudioFlowing(): void;
  /** Avisa o main que não havia nada para transcrever. */
  reportEmpty(): void;
  /** Avisa o main que a captura falhou, com um motivo legível. */
  reportFailure(reason: string): void;
};

declare global {
  interface Window {
    bridge: Bridge;
  }
}

/**
 * A ponte do editor de dicionário, que é outra janela e outro preload.
 *
 * Separada da `Bridge` de propósito: a janela oculta captura áudio e não
 * tem nada que fazer com o dicionário, e o editor não pode ligar o
 * microfone. Cada uma expõe só o que usa.
 */
export type DictionaryBridge = {
  /** As entradas e o cru da última ditação, se houver uma nesta sessão. */
  load(): Promise<{ entries: Entry[]; heard: string | undefined }>;
  /** Grava e devolve o que ficou no disco, já normalizado pelo parse. */
  save(entries: readonly Entry[]): Promise<Entry[]>;
};

declare global {
  interface Window {
    dictionaryBridge: DictionaryBridge;
  }
}

/**
 * O estado real de "abrir no login", que mora no sistema, não no arquivo.
 *
 * Os quatro valores do `SMAppService`, sem reduzir para booleano: é a
 * distinção entre `enabled` e `requires-approval` que impede o checkbox de
 * mentir, e `not-found` precisa de recado próprio.
 */
export type LoginItemState = {
  status: "not-registered" | "enabled" | "requires-approval" | "not-found";
};

/** Tudo que a tela de preferências precisa saber ao abrir. */
export type PreferencesSnapshot = {
  preferences: Preferences;
  /** Modelos encontrados na pasta, para a tela não oferecer o que não existe. */
  models: string[];
  loginItem: LoginItemState;
  /** Só se EXISTE. A chave nunca cruza o IPC. */
  hasApiKey: boolean;
};

/**
 * O resultado de esperar o atalho.
 *
 * `cancelled` existe para a promise nunca ficar pendurada: fechar a janela
 * ou pedir outro teste precisa RESOLVER o anterior, não abandoná-lo.
 */
export type ShortcutTest = "arrived" | "timeout" | "cancelled";

export type PreferencesBridge = {
  load(): Promise<PreferencesSnapshot>;
  /** Grava um pedaço e devolve tudo, já normalizado pelo parse. */
  save(patch: Partial<Preferences>): Promise<PreferencesSnapshot>;
  setLoginItem(enabled: boolean): Promise<LoginItemState>;
  /** Grava a chave, ou apaga se vier vazia. Devolve se passou a existir. */
  setApiKey(key: string): Promise<boolean>;
  /** Pergunta ao provedor se a chave responde. Vazia testa a guardada. */
  testApiKey(key: string): Promise<KeyCheck>;
  /**
   * Baixa o que falta para o modelo escolhido, aqui mesmo.
   *
   * A troca de modelo deixou de reabrir o onboarding: quem escolhe outro
   * decide QUANDO baixar, e a barra aparece dentro da aba.
   */
  downloadModels(): Promise<PreferencesSnapshot>;
  onProgress(handler: (progress: ModelProgress) => void): void;
  /** Abre o editor de dicionário — a aba Sistema é a porta visível dele. */
  openDictionary(): void;
  /** Reabre a primeira abertura, para refazer os passos. */
  openOnboarding(): void;
  /** Espera você apertar o atalho. É a única verificação honesta que existe. */
  testShortcut(): Promise<ShortcutTest>;
};

declare global {
  interface Window {
    preferencesBridge: PreferencesBridge;
  }
}

/**
 * O que o provedor respondeu ao teste da chave.
 *
 * Três respostas, não duas: recusa pede outra chave, e rede fora pede
 * tentar de novo. Reduzir a um booleano faria a tela mandar você trocar uma
 * chave boa porque o wi-fi caiu.
 */
export type KeyCheck =
  | { kind: "ok" }
  | { kind: "rejected" }
  | { kind: "unreachable"; why: string };

/** O andamento de um download, empurrado do main para a tela. */
export type ModelProgress = { file: string; received: number; total: number };

export type OnboardingBridge = {
  load(): Promise<OnboardingState>;
  /** Abre o prompt do sistema, se ele ainda não foi mostrado. */
  requestMicrophone(): Promise<OnboardingState>;
  /** Leva ao painel de privacidade — conveniência, não o único caminho. */
  openMicrophoneSettings(): Promise<void>;
  /** Guarda o modelo escolhido antes de baixar. */
  chooseModel(file: string): Promise<OnboardingState>;
  /** Guarda o provedor de reescrita escolhido. */
  chooseProvider(id: string): Promise<OnboardingState>;
  /** Troca o atalho e o re-registra, como fazem as preferências. */
  chooseShortcut(accelerator: string): Promise<OnboardingState>;
  /** Baixa o que falta. Rejeita com mensagem utilizável. */
  downloadModels(): Promise<OnboardingState>;
  onProgress(handler: (progress: ModelProgress) => void): void;
  /** Guarda a chave, ou apaga se vier vazia. */
  setApiKey(key: string): Promise<boolean>;
  /** Pergunta ao provedor se a chave responde. Vazia testa a guardada. */
  testApiKey(key: string): Promise<KeyCheck>;
  /**
   * Espera você apertar o atalho.
   *
   * É a mesma máquina das preferências, e existe pelo mesmo motivo: o #5
   * mediu que `globalShortcut.register` devolve `true` para tudo, então a
   * única prova de que a tecla chega é você apertá-la. O onboarding é o
   * único momento em que você está atento e com as mãos no teclado.
   */
  testShortcut(): Promise<ShortcutTest>;
  /** Fecha o onboarding e libera o uso. */
  finish(): void;
};

declare global {
  interface Window {
    onboardingBridge: OnboardingBridge;
  }
}
