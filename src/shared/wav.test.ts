import { describe, expect, it } from "vitest";
import { encodeWav, floatToInt16 } from "./wav";

/** Lê um uint32 little-endian do header. */
const u32 = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset).getUint32(at, true);
/** Lê um uint16 little-endian do header. */
const u16 = (b: Uint8Array, at: number) =>
  new DataView(b.buffer, b.byteOffset).getUint16(at, true);
/** Lê uma tag ASCII de 4 bytes. */
const tag = (b: Uint8Array, at: number) =>
  String.fromCharCode(...b.subarray(at, at + 4));

describe("floatToInt16", () => {
  it("mapeia silêncio para zero", () => {
    expect(floatToInt16(0)).toBe(0);
  });

  it("usa escalas diferentes para positivo e negativo", () => {
    // Int16 é assimétrico: -32768..32767. Usar 0x8000 nos dois lados
    // estouraria no positivo.
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
  });

  it("faz clamp de valores fora de -1..1", () => {
    expect(floatToInt16(2.5)).toBe(32767);
    expect(floatToInt16(-2.5)).toBe(-32768);
  });

  it("nunca sai da faixa do Int16, mesmo com entrada absurda", () => {
    for (const v of [1e9, -1e9, Infinity, -Infinity]) {
      const out = floatToInt16(v);
      expect(out).toBeGreaterThanOrEqual(-32768);
      expect(out).toBeLessThanOrEqual(32767);
    }
  });

  it("trata NaN como silêncio em vez de propagar", () => {
    expect(floatToInt16(NaN)).toBe(0);
  });

  it("arredonda em vez de truncar", () => {
    // 0.5 * 32767 = 16383,5 — truncar daria 16383
    expect(floatToInt16(0.5)).toBe(16384);
  });
});

describe("encodeWav", () => {
  const chunk = (values: number[]) => Float32Array.from(values);

  it("escreve um header canônico de 44 bytes", () => {
    const wav = encodeWav([chunk([0, 0])], 16000);

    expect(tag(wav, 0)).toBe("RIFF");
    expect(tag(wav, 8)).toBe("WAVE");
    expect(tag(wav, 12)).toBe("fmt ");
    expect(u32(wav, 16)).toBe(16); // tamanho do subchunk fmt
    expect(u16(wav, 20)).toBe(1); // PCM sem compressão
    expect(u16(wav, 22)).toBe(1); // mono
    expect(u32(wav, 24)).toBe(16000); // taxa de amostragem
    expect(u16(wav, 34)).toBe(16); // bits por amostra
    expect(tag(wav, 36)).toBe("data");
  });

  it("calcula byteRate e blockAlign a partir da taxa", () => {
    const wav = encodeWav([chunk([0])], 16000);
    expect(u32(wav, 28)).toBe(16000 * 2); // byteRate = taxa * canais * bytes
    expect(u16(wav, 32)).toBe(2); // blockAlign = canais * bytes
  });

  it("declara tamanhos coerentes com o conteúdo real", () => {
    const wav = encodeWav([chunk([0, 0, 0])], 16000);
    const dataSize = 3 * 2;

    expect(u32(wav, 40)).toBe(dataSize);
    expect(u32(wav, 4)).toBe(36 + dataSize); // RIFF = 36 + dados
    expect(wav.byteLength).toBe(44 + dataSize); // e o arquivo bate
  });

  it("concatena vários chunks na ordem recebida", () => {
    // O worklet entrega blocos de 128 frames; a ordem é o áudio.
    const wav = encodeWav([chunk([1, 1]), chunk([-1]), chunk([0])], 16000);
    const view = new DataView(wav.buffer, wav.byteOffset);

    expect(u32(wav, 40)).toBe(4 * 2);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(0);
  });

  it("produz um arquivo válido, só com header, quando não há áudio", () => {
    // O portão VAD ainda não existe: gravação vazia não pode gerar lixo.
    const wav = encodeWav([], 16000);
    expect(wav.byteLength).toBe(44);
    expect(u32(wav, 40)).toBe(0);
    expect(tag(wav, 0)).toBe("RIFF");
  });

  it("ignora chunks vazios sem quebrar o alinhamento", () => {
    const wav = encodeWav([chunk([]), chunk([1]), chunk([])], 16000);
    expect(u32(wav, 40)).toBe(2);
    expect(wav.byteLength).toBe(46);
  });

  it("respeita outras taxas de amostragem", () => {
    const wav = encodeWav([chunk([0])], 48000);
    expect(u32(wav, 24)).toBe(48000);
    expect(u32(wav, 28)).toBe(48000 * 2);
  });
});
