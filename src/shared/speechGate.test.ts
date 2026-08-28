import { describe, expect, it } from "vitest";
import { buildVadArgs, countSpeechSegments } from "./speechGate";

/** Saída real do binário para 2 s de silêncio digital. Medida. */
const NO_SPEECH = "\nDetected 0 speech segments:\n\n";

/** Saída real para a amostra 03 do corpus — a fala mais baixa (RMS 0,0351). */
const ONE_SEGMENT =
  "\nDetected 1 speech segments:\nSpeech segment 0: start = 103.00, end = 406.00\n";

describe("buildVadArgs", () => {
  const args = buildVadArgs("/modelos/silero.bin");

  it("lê o áudio do stdin", () => {
    // Mesmo caminho da transcrição: sem arquivo temporário, sem limpeza a errar.
    expect(args[args.indexOf("-f") + 1]).toBe("-");
  });

  it("aponta para o modelo de VAD recebido", () => {
    expect(args[args.indexOf("-vm") + 1]).toBe("/modelos/silero.bin");
  });

  it("silencia os prints do binário", () => {
    // Sem isso os logs de backend se misturam à contagem no stdout.
    expect(args).toContain("-np");
  });

  it("não fixa o limiar, deixando o default de 0,50", () => {
    // 0,50 acertou 6 de 6 no corpus, e repetir o número aqui só criaria
    // uma segunda fonte da verdade. O teste trava a AUSÊNCIA da flag, não
    // o valor — de propósito: o default é questão aberta (spec §13, e uma
    // medição posterior achou falso positivo no silêncio capturado pelo
    // próprio app). Quando o número for decidido, é aqui que ele entra.
    expect(args).not.toContain("-vt");
    expect(args).not.toContain("--vad-threshold");
  });
});

describe("countSpeechSegments", () => {
  it("devolve zero quando não houve fala", () => {
    expect(countSpeechSegments(NO_SPEECH)).toBe(0);
  });

  it("conta o único segmento da fala mais baixa do corpus", () => {
    expect(countSpeechSegments(ONE_SEGMENT)).toBe(1);
  });

  it("conta os segmentos de uma ditação longa", () => {
    const lines = Array.from(
      { length: 13 },
      (_, i) => `Speech segment ${i}: start = ${i * 100}.00, end = ${i * 100 + 50}.00`,
    ).join("\n");
    expect(countSpeechSegments(`\nDetected 13 speech segments:\n${lines}\n`)).toBe(13);
  });

  it("ignora o que o binário imprime antes da contagem", () => {
    expect(
      countSpeechSegments(`load_backend: loaded CPU backend\n${ONE_SEGMENT}`),
    ).toBe(1);
  });

  it("recusa saída que não dá para ler", () => {
    // Saída ilegível NÃO é ausência de fala. Confundir as duas descartaria
    // uma ditação de verdade em silêncio — o pior desfecho possível aqui.
    expect(() => countSpeechSegments("")).toThrow();
    expect(() => countSpeechSegments("error: failed to read audio data")).toThrow();
  });
});
