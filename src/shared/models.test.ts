import { describe, expect, it } from "vitest";
import {
  bytesNeeded,
  formatBytes,
  MODELS,
  planDownload,
  progressPercent,
} from "./models";

describe("MODELS", () => {
  it("traz o hash e o tamanho publicados, não só a URL", () => {
    // O `download-ggml-model.sh` do whisper.cpp não verifica nada. Sem hash
    // no catálogo, um download truncado vira "modelo corrompido" só na
    // primeira ditação.
    for (const model of MODELS) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(0);
      expect(model.url.startsWith("https://")).toBe(true);
    }
  });

  it("tem o modelo de transcrição e o do portão de fala", () => {
    expect(MODELS.map((m) => m.file)).toEqual([
      "ggml-large-v3-turbo-q5_0.bin",
      "ggml-silero-v5.1.2.bin",
    ]);
  });
});

describe("planDownload", () => {
  const model = MODELS[0]!;

  it("sem arquivo parcial, começa do zero", () => {
    expect(planDownload(model, 0)).toEqual({ kind: "download", from: 0 });
  });

  it("com arquivo parcial, retoma de onde parou", () => {
    expect(planDownload(model, 1_000)).toEqual({ kind: "download", from: 1_000 });
  });

  it("com o tamanho exato, não baixa: manda verificar", () => {
    expect(planDownload(model, model.bytes)).toEqual({ kind: "verify" });
  });

  it("com MAIS bytes que o esperado, descarta e recomeça", () => {
    // Retomar a partir daí pediria um range além do fim e o servidor
    // responderia 416 — ou pior, o arquivo ficaria com lixo no meio.
    expect(planDownload(model, model.bytes + 1)).toEqual({ kind: "restart" });
  });

  it("tamanho negativo é tratado como nada baixado", () => {
    expect(planDownload(model, -5)).toEqual({ kind: "download", from: 0 });
  });
});

describe("progressPercent", () => {
  it("vai de 0 a 100", () => {
    expect(progressPercent(0, 200)).toBe(0);
    expect(progressPercent(100, 200)).toBe(50);
    expect(progressPercent(200, 200)).toBe(100);
  });

  it("não passa de 100 nem fica negativo", () => {
    // Um servidor que manda mais do que prometeu não pode virar uma barra
    // de 140%.
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(-1, 200)).toBe(0);
  });

  it("total desconhecido não vira divisão por zero", () => {
    expect(progressPercent(10, 0)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("usa unidade legível", () => {
    // A regra 3 proíbe formatar número à mão; quem arredonda e põe o
    // separador é o Intl.
    expect(formatBytes(885_098)).toMatch(/kB$/);
    expect(formatBytes(2_500_000_000)).toMatch(/GB$/);
  });

  it("usa unidade DECIMAL, como o Finder", () => {
    // A spec diz "547 MiB" (binário) e o Finder diz "574 MB" (decimal) para
    // o mesmo arquivo. A tela mostra o número que você vê no Finder, senão
    // parece que baixou o modelo errado.
    expect(formatBytes(574_041_195)).toBe("574 MB");
  });

  it("zero não quebra", () => {
    expect(formatBytes(0)).toMatch(/0/);
  });
});

describe("bytesNeeded", () => {
  it("soma só o que falta", () => {
    const [big, small] = [MODELS[0]!, MODELS[1]!];
    expect(bytesNeeded(MODELS, [])).toBe(big.bytes + small.bytes);
    expect(bytesNeeded(MODELS, [big.file])).toBe(small.bytes);
    expect(bytesNeeded(MODELS, [big.file, small.file])).toBe(0);
  });
});
