import { describe, expect, it } from "vitest";
import { reason } from "./errors";

describe("reason", () => {
  it("tira a mensagem do erro, sem o prefixo", () => {
    expect(reason(new Error("disco cheio"))).toBe("disco cheio");
  });

  it("aceita o que não é erro", () => {
    expect(reason("texto solto")).toBe("texto solto");
    expect(reason(undefined)).toBe("undefined");
  });
});
