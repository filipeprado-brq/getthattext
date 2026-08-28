import { describe, expect, it } from "vitest";
import { reason } from "./errors";

describe("reason", () => {
  it("tira a mensagem do erro, sem o prefixo", () => {
    expect(reason(new Error("disco cheio"))).toBe("disco cheio");
  });

  it("tira o embrulho do IPC, que fala do canal e não do problema", () => {
    // O que chegava à tela era o nome do canal na frente do recado, e o
    // recado era o que a pessoa precisava ler.
    expect(
      reason(
        new Error(
          "Error invoking remote method 'onboarding-download': Error: Não foi possível falar com huggingface.co.",
        ),
      ),
    ).toBe("Não foi possível falar com huggingface.co.");

    expect(
      reason(new Error("Error invoking remote method 'preferences-save': disco cheio")),
    ).toBe("disco cheio");
  });

  it("não mexe em mensagem que só PARECE do IPC", () => {
    expect(reason(new Error("Error invoking remote method sem aspas: nada"))).toBe(
      "Error invoking remote method sem aspas: nada",
    );
  });

  it("aceita o que não é erro", () => {
    expect(reason("texto solto")).toBe("texto solto");
    expect(reason(undefined)).toBe("undefined");
  });
});
