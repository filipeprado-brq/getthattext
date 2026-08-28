import { describe, expect, it } from "vitest";
import {
  OPENING_BREATH,
  OPENING_PERIOD_MS,
  opacityAt,
  RECORDING_BREATH,
  RECORDING_PERIOD_MS,
  scaleAlpha,
} from "./trayIcon";

describe("RECORDING_BREATH", () => {
  it("respira no período de 1,7 s que a spec fixa", () => {
    expect(RECORDING_PERIOD_MS).toBe(1700);
  });

  it("passa a maior parte do ciclo aceso", () => {
    // A curva do protótipo é quase um piscar lento: fica aceso até 44%,
    // apaga rápido, e volta. Não é um seno — um seno pareceria pulsação
    // de respiração, e o que se quer é "isto está vivo e gravando".
    expect(opacityAt(RECORDING_BREATH, 0)).toBe(1);
    expect(opacityAt(RECORDING_BREATH, 0.44)).toBe(1);
    expect(opacityAt(RECORDING_BREATH, 0.55)).toBeCloseTo(0.18);
    expect(opacityAt(RECORDING_BREATH, 0.94)).toBeCloseTo(0.18);
  });
});

describe("OPENING_BREATH", () => {
  it("é mais rápido e nunca apaga tanto quanto o de gravando", () => {
    expect(OPENING_PERIOD_MS).toBe(1400);
    expect(opacityAt(OPENING_BREATH, 0)).toBeCloseTo(0.35);
  });

  it("nunca chega a opaco, nem no pico", () => {
    // A spec pede contorno esmaecido: em opacidade 1 o desenho fica
    // idêntico ao de ocioso, e o estado perde a razão de existir.
    for (const frame of OPENING_BREATH) expect(frame.opacity).toBeLessThan(1);
    for (let phase = 0; phase < 1; phase += 0.05) {
      expect(opacityAt(OPENING_BREATH, phase)).toBeLessThan(1);
    }
  });
});

describe("opacityAt", () => {
  it("interpola entre os quadros", () => {
    const half = opacityAt(RECORDING_BREATH, 0.495);
    expect(half).toBeGreaterThan(0.18);
    expect(half).toBeLessThan(1);
  });

  it("é contínua na virada do ciclo", () => {
    // Se 1 e 0 não coincidirem, cada volta dá um salto visível.
    expect(opacityAt(RECORDING_BREATH, 1)).toBeCloseTo(
      opacityAt(RECORDING_BREATH, 0),
    );
  });

  it("dá a volta em vez de estourar", () => {
    expect(opacityAt(RECORDING_BREATH, 1.44)).toBeCloseTo(
      opacityAt(RECORDING_BREATH, 0.44),
    );
    expect(opacityAt(RECORDING_BREATH, -0.56)).toBeCloseTo(
      opacityAt(RECORDING_BREATH, 0.44),
    );
  });
});

describe("scaleAlpha", () => {
  /** Dois pixels: um opaco, um já meio transparente. */
  const pixels = () => new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);

  it("não toca nos canais de cor", () => {
    const out = scaleAlpha(pixels(), 0.5);
    expect([...out.slice(0, 3)]).toEqual([10, 20, 30]);
    expect([...out.slice(4, 7)]).toEqual([40, 50, 60]);
  });

  it("escala só o alfa, que é sempre o quarto byte", () => {
    // Vale para RGBA e para BGRA: o que muda entre os dois é a ordem das
    // cores, e o alfa fica em último nos dois.
    const out = scaleAlpha(pixels(), 0.5);
    expect(out[3]).toBe(128);
    expect(out[7]).toBe(64);
  });

  it("devolve cópia, sem alterar a entrada", () => {
    const input = pixels();
    scaleAlpha(input, 0.5);
    expect(input[3]).toBe(255);
  });

  it("opacidade 1 não muda nada", () => {
    expect([...scaleAlpha(pixels(), 1)]).toEqual([...pixels()]);
  });

  it("faz clamp de opacidade fora de 0..1", () => {
    expect(scaleAlpha(pixels(), 2)[3]).toBe(255);
    expect(scaleAlpha(pixels(), -1)[3]).toBe(0);
  });
});
