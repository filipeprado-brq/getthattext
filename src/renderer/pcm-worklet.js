/**
 * Captura os blocos de áudio que o Web Audio entrega e os manda para a
 * thread principal do renderer.
 *
 * Fica em JS puro de propósito: o AudioWorklet roda num escopo isolado,
 * carregado por URL, fora do grafo de módulos do renderer.
 *
 * O `process()` é chamado a cada render quantum — 128 frames, ~8 ms a
 * 16 kHz. O buffer recebido é REUTILIZADO pelo motor, então cada bloco
 * precisa ser copiado antes de sair daqui.
 *
 * O portão de captura é ligado ANTES de conectar o microfone e desligado
 * DEPOIS de desconectar: a flag atravessa a fronteira entre threads de
 * forma assíncrona, e ordenar ao contrário perdia o começo e o fim da fala.
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturing = false;
    this.port.onmessage = (event) => {
      this.capturing = event.data === "start";
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];

    // Sem entrada conectada ainda: seguir vivo, esperando.
    if (!channel) return true;

    if (this.capturing) {
      const copy = new Float32Array(channel);
      // Transferível: entrega a posse do buffer em vez de cloná-lo.
      this.port.postMessage(copy, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
