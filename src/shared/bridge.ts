/**
 * Contrato entre o processo main e o renderer.
 *
 * Definido aqui e importado pelos dois lados: o `contextBridge` implementa,
 * o renderer consome. Escrever a assinatura duas vezes não teria nada que
 * as mantivesse em sincronia.
 */
export type Bridge = {
  /** Grava o WAV em disco e devolve o caminho absoluto. */
  saveWav(bytes: ArrayBuffer): Promise<string>;
  /** Revela o arquivo no Finder. */
  revealInFinder(path: string): Promise<void>;
};

declare global {
  interface Window {
    bridge: Bridge;
  }
}
