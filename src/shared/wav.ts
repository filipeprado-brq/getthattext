/**
 * Codificação WAV PCM 16 bits, escrita à mão.
 *
 * A spec (seção 2) descarta o `MediaRecorder` de propósito: ele produz
 * contêiner WebM/Opus, e o `whisper-cli` quer PCM cru. O caminho é o
 * AudioWorklet entregar Float32 e este módulo montar o arquivo.
 *
 * Puro e sem dependências: roda no renderer e nos testes sem adaptação.
 */

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1; // mono — o grafo de áudio já entrega um canal só
const PCM_UNCOMPRESSED = 1;

/** Maior magnitude negativa do Int16. */
const INT16_MIN_MAGNITUDE = 0x8000;
/** Maior magnitude positiva do Int16. */
const INT16_MAX_MAGNITUDE = 0x7fff;

/**
 * Converte uma amostra Float32 (-1..1) para Int16.
 *
 * As duas escalas são diferentes de propósito: o Int16 é assimétrico
 * (-32768..32767), então usar 0x8000 no lado positivo estouraria a faixa.
 */
export function floatToInt16(sample: number): number {
  // NaN vira silêncio em vez de contaminar o arquivo — um único NaN
  // propagado produz um WAV que players e o whisper leem como ruído.
  if (Number.isNaN(sample)) return 0;

  const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;

  return Math.round(
    clamped < 0
      ? clamped * INT16_MIN_MAGNITUDE
      : clamped * INT16_MAX_MAGNITUDE,
  );
}

/** Escreve uma tag ASCII de 4 bytes (RIFF, WAVE, fmt, data). */
function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < tag.length; i++) {
    view.setUint8(offset + i, tag.charCodeAt(i));
  }
}

/**
 * Monta um WAV mono de 16 bits a partir dos blocos entregues pelo worklet.
 *
 * Os blocos são concatenados na ordem recebida — essa ordem é o áudio.
 * Uma lista vazia produz um arquivo válido só com header, porque gravação
 * sem conteúdo não pode virar arquivo malformado.
 */
export function encodeWav(
  chunks: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  let frames = 0;
  for (const chunk of chunks) frames += chunk.length;

  const dataSize = frames * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataSize);
  const view = new DataView(bytes.buffer);

  writeTag(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataSize, true);
  writeTag(view, 8, "WAVE");

  writeTag(view, 12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do subchunk fmt, sempre 16 em PCM
  view.setUint16(20, PCM_UNCOMPRESSED, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * BYTES_PER_SAMPLE, true); // byteRate
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true); // blockAlign
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeTag(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = HEADER_BYTES;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(offset, floatToInt16(chunk[i]!), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return bytes;
}
