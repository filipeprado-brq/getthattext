import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("mostra minutos e segundos", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  it("tem largura estável dentro do limite de 2 minutos", () => {
    // O ícone não pode dançar na barra conforme o número muda.
    for (const ms of [0, 9_000, 59_000, 60_000, 119_000, 120_000]) {
      expect(formatElapsed(ms)).toHaveLength(4);
    }
  });

  it("trunca em vez de arredondar", () => {
    // 0:01 só aparece quando 1 s de fato passou. Arredondar mostraria 0:01
    // com 600 ms, e o número mentiria sobre o que está no WAV.
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(1_999)).toBe("0:01");
  });

  it("não quebra além do limite de gravação", () => {
    expect(formatElapsed(120_000)).toBe("2:00");
    expect(formatElapsed(605_000)).toBe("10:05");
  });

  it("trata tempo negativo como zero", () => {
    // Relógio andando para trás não pode virar "-1:-5" na barra.
    expect(formatElapsed(-500)).toBe("0:00");
  });
});
