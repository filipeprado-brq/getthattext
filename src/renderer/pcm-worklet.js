/**
 * Captura os blocos de áudio que o Web Audio entrega e os manda para a
 * thread principal do renderer.
 *
 * Fica em JS puro de propósito: o AudioWorklet roda num escopo isolado,
 * carregado por URL, fora do grafo de módulos do renderer.
 *
 * O `process()` é chamado a cada render quantum — 128 frames, ~8 ms a
 * 16 kHz. O buffer que ele recebe é REUTILIZADO pelo motor, então cada
 * bloco precisa ser copiado antes de sair daqui.
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturando = false;
    this.port.onmessage = (evento) => {
      this.capturando = evento.data === "iniciar";
    };
  }

  process(inputs) {
    const canal = inputs[0]?.[0];

    // Sem entrada conectada ainda: seguir vivo, esperando.
    if (!canal) return true;

    if (this.capturando) {
      // Cópia obrigatória — o motor sobrescreve este buffer no próximo quantum.
      this.port.postMessage(new Float32Array(canal));
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
