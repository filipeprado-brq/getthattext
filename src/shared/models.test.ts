import { describe, expect, it } from "vitest";
import {
  bytesNeeded,
  formatBytes,
  MODELS,
  planDownload,
  progressPercent,
  RECOMMENDED_MODEL,
  requiredModels,
  TRANSCRIPTION_MODELS,
  VAD_MODEL,
} from "./models";

describe("o catálogo", () => {
  it("traz hash e tamanho publicados, não só a URL", () => {
    // O `download-ggml-model.sh` do whisper.cpp não verifica nada. Sem hash
    // no catálogo, um download truncado vira "modelo corrompido" só na
    // primeira ditação.
    for (const model of MODELS) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(0);
      expect(model.url.startsWith("https://")).toBe(true);
    }
  });

  it("separa a escolha do que é obrigatório", () => {
    // O portão de fala não é escolha: sem ele o app alucina em gravação sem
    // fala, medido em 8 de 8.
    expect(TRANSCRIPTION_MODELS.map((m) => m.file)).toEqual([
      "ggml-large-v3-turbo-q5_0.bin",
      "ggml-small-q5_1.bin",
      "ggml-base-q5_1.bin",
    ]);
    expect(VAD_MODEL.file).toBe("ggml-silero-v5.1.2.bin");
    expect(TRANSCRIPTION_MODELS).not.toContain(VAD_MODEL);
  });

  it("um só é recomendado, e é o que preserva termo técnico", () => {
    const recomendados = TRANSCRIPTION_MODELS.filter((m) => m.recommended);
    expect(recomendados).toHaveLength(1);
    expect(recomendados[0]?.file).toBe(RECOMMENDED_MODEL);
  });

  it("cada opção diz o que se perde, não só o tamanho", () => {
    // Oferecer "60 MB" sem dizer que ele repete trechos em loop seria
    // oferecer uma armadilha.
    for (const model of TRANSCRIPTION_MODELS) {
      expect(model.name.length).toBeGreaterThan(0);
      expect(model.tradeoff.length).toBeGreaterThan(20);
    }
  });

  it("está em ordem de qualidade, não de tamanho", () => {
    // A lista é lida de cima para baixo; o melhor primeiro é o que faz o
    // recomendado ser o padrão de quem não lê.
    const bytes = TRANSCRIPTION_MODELS.map((m) => m.bytes);
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
  });
});

describe("requiredModels", () => {
  it("é o escolhido mais o portão de fala", () => {
    const files = requiredModels("ggml-small-q5_1.bin").map((m) => m.file);
    expect(files).toEqual(["ggml-small-q5_1.bin", "ggml-silero-v5.1.2.bin"]);
  });

  it("NÃO inclui os modelos não escolhidos", () => {
    // Baixar os três custaria 824 MB — pior que o problema que a escolha
    // resolve.
    expect(requiredModels(RECOMMENDED_MODEL)).toHaveLength(2);
  });

  it("escolha desconhecida cai no recomendado", () => {
    // Preferência editada à mão, ou de uma versão que oferecia outro
    // modelo: baixar o recomendado é melhor que não baixar nada.
    const files = requiredModels("ggml-inexistente.bin").map((m) => m.file);
    expect(files).toEqual([RECOMMENDED_MODEL, VAD_MODEL.file]);
  });
});

describe("planDownload", () => {
  const model = TRANSCRIPTION_MODELS[0]!;

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
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(-1, 200)).toBe(0);
  });

  it("total desconhecido não vira divisão por zero", () => {
    expect(progressPercent(10, 0)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("usa unidade legível", () => {
    expect(formatBytes(885_098)).toMatch(/kB$/);
    expect(formatBytes(2_500_000_000)).toMatch(/GB$/);
  });

  it("usa unidade DECIMAL, como o Finder", () => {
    expect(formatBytes(574_041_195)).toBe("574 MB");
  });

  it("zero não quebra", () => {
    expect(formatBytes(0)).toMatch(/0/);
  });
});

describe("bytesNeeded", () => {
  it("soma só o que falta, entre os necessários", () => {
    const needed = requiredModels(RECOMMENDED_MODEL);
    const total = needed.reduce((sum, m) => sum + m.bytes, 0);

    expect(bytesNeeded(needed, [])).toBe(total);
    expect(bytesNeeded(needed, [VAD_MODEL.file])).toBe(total - VAD_MODEL.bytes);
    expect(bytesNeeded(needed, needed.map((m) => m.file))).toBe(0);
  });
});
