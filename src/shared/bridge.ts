import type { Entry } from "./dictionary.js";

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
  /** Entrega o WAV capturado; o main transcreve e devolve o texto. */
  deliverAudio(bytes: ArrayBuffer): Promise<void>;
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
