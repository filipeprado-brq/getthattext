import { describe, expect, it } from "vitest";
import { buildWhisperArgs, cleanTranscript } from "./transcript";

describe("buildWhisperArgs", () => {
  const args = buildWhisperArgs("/modelos/turbo.bin");

  it("lê o áudio do stdin", () => {
    // A spec descarta arquivo temporário: sem disco, sem limpeza a errar.
    expect(args).toContain("-f");
    expect(args[args.indexOf("-f") + 1]).toBe("-");
  });

  it("aponta para o modelo recebido", () => {
    expect(args[args.indexOf("-m") + 1]).toBe("/modelos/turbo.bin");
  });

  it("força português em vez de deixar o auto-detect decidir", () => {
    expect(args[args.indexOf("-l") + 1]).toBe("pt");
  });

  it("usa o modo de menor latência decidido na spec", () => {
    expect(args).toContain("-bs"); // beam size
    expect(args[args.indexOf("-bs") + 1]).toBe("1"); // greedy
    expect(args).toContain("-nf"); // sem temperature fallback
  });

  it("pede saída limpa: sem timestamps, sem prints, sem tokens de não-fala", () => {
    expect(args).toContain("-nt");
    expect(args).toContain("-np");
    expect(args).toContain("-sns");
  });

  it("não passa --prompt", () => {
    // Descartado: é apagado após a primeira janela de 30 s e some de vez
    // quando o fallback de temperatura sobe.
    expect(args).not.toContain("--prompt");
    expect(args).not.toContain("-p");
  });

  it("não liga o VAD dentro da transcrição", () => {
    // O VAD é portão, nunca filtro — ligá-lo aqui engole conteúdo real.
    expect(args).not.toContain("--vad");
  });
});

describe("cleanTranscript", () => {
  it("remove o recuo que o whisper coloca em cada linha", () => {
    expect(cleanTranscript("   Olá, tudo bem?")).toBe("Olá, tudo bem?");
  });

  it("descarta linhas em branco no começo e no fim", () => {
    expect(cleanTranscript("\n\n  Bom dia.  \n\n")).toBe("Bom dia.");
  });

  it("junta várias linhas num parágrafo só", () => {
    // O whisper quebra por segmento; para o clipboard isso é uma frase só.
    expect(cleanTranscript("  Primeira parte\n  segunda parte")).toBe(
      "Primeira parte segunda parte",
    );
  });

  it("não colapsa espaço dentro da frase", () => {
    expect(cleanTranscript("um, dois, três")).toBe("um, dois, três");
  });

  it("devolve string vazia quando não houve fala", () => {
    // Sem portão VAD ainda, mas o vazio precisa ser representável.
    expect(cleanTranscript("")).toBe("");
    expect(cleanTranscript("   \n  \n")).toBe("");
  });

  it("preserva acentuação e pontuação", () => {
    expect(cleanTranscript("  É só isso, né? Não tem problema.")).toBe(
      "É só isso, né? Não tem problema.",
    );
  });
});

describe("buildWhisperArgs — a armadilha do stdin", () => {
  const args = buildWhisperArgs("/modelos/turbo.bin");

  it("pede saída de texto para stdout, sem o que a transcrição se perde", () => {
    // Com entrada "-", o whisper-cli deriva o nome do arquivo de saída da
    // entrada e passa a valer "--output-file -". Sem um formato --output-*
    // pedido, ele lê o áudio, transcreve e não imprime nada: stdout vazio
    // com exit code 0. Medido contra o binário real.
    expect(args).toContain("-otxt");
    expect(args[args.indexOf("-of") + 1]).toBe("-");
  });
});
