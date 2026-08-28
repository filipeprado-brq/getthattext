import { describe, expect, it } from "vitest";
import type { OnboardingState } from "./onboarding";
import { firstPending, isStepDone, STEPS } from "./onboardingSteps";

const state = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  microphone: "granted",
  models: [
    { file: "a.bin", label: "A", bytes: 10, present: true },
    { file: "b.bin", label: "B", bytes: 20, present: true },
  ],
  hasApiKey: true,
  shortcut: "Alt+Command+G",
  chosenModel: "ggml-large-v3-turbo-q5_0.bin",
  ...over,
});

describe("STEPS", () => {
  it("segue a ordem da spec: microfone, modelos, chave, atalho", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["microphone", "models", "key", "shortcut"]);
  });

  it("só a chave é pulável", () => {
    // A §9 marca a chave como opcional — sem ela o app funciona em modo cru.
    // Microfone e modelos não têm alternativa.
    expect(STEPS.filter((s) => s.skippable).map((s) => s.id)).toEqual(["key"]);
  });
});

describe("isStepDone", () => {
  it("microfone só com permissão concedida", () => {
    expect(isStepDone(state(), "microphone", false)).toBe(true);
    expect(isStepDone(state({ microphone: "denied" }), "microphone", false)).toBe(false);
    expect(isStepDone(state({ microphone: "not-determined" }), "microphone", false)).toBe(
      false,
    );
  });

  it("modelos só com TODOS presentes", () => {
    const half = state({
      models: [
        { file: "a.bin", label: "A", bytes: 10, present: true },
        { file: "b.bin", label: "B", bytes: 20, present: false },
      ],
    });
    expect(isStepDone(half, "models", false)).toBe(false);
  });

  it("o atalho depende de ter CHEGADO, não de estar configurado", () => {
    // Sempre há um atalho configurado. `register` aceita qualquer combinação,
    // então só apertar prova que ela chega.
    expect(isStepDone(state(), "shortcut", false)).toBe(false);
    expect(isStepDone(state(), "shortcut", true)).toBe(true);
  });
});

describe("firstPending", () => {
  it("leva ao primeiro passo que falta", () => {
    expect(firstPending(state({ microphone: "not-determined" }), false)).toBe("microphone");
    expect(
      firstPending(
        state({ models: [{ file: "a.bin", label: "A", bytes: 1, present: false }] }),
        false,
      ),
    ).toBe("models");
  });

  it("pula o que já está feito", () => {
    // Reabrir o onboarding não pode fazer você refazer o que já fez.
    expect(firstPending(state(), false)).toBe("shortcut");
  });

  it("a chave pendente não segura o wizard", () => {
    // É opcional: parar nela obrigaria a decidir sobre o Groq antes de
    // confirmar o atalho, que é o passo que fecha o onboarding.
    expect(firstPending(state({ hasApiKey: false }), true)).toBeUndefined();
  });

  it("tudo feito não tem pendência", () => {
    expect(firstPending(state(), true)).toBeUndefined();
  });
});
