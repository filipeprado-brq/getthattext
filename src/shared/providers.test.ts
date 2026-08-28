import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  isUsableProvider,
  PROVIDERS,
  providerFor,
} from "./providers.js";

describe("o catálogo de provedores", () => {
  it("tem o padrão entre os disponíveis", () => {
    expect(isUsableProvider(DEFAULT_PROVIDER)).toBe(true);
  });

  it("não repete id", () => {
    const ids = PROVIDERS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada um diz o modelo que roda e onde pegar a chave", () => {
    for (const provider of PROVIDERS) {
      expect(provider.model.length).toBeGreaterThan(0);
      expect(provider.keyPrefix.length).toBeGreaterThan(0);
      expect(provider.keyUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("providerFor", () => {
  it("devolve o pedido quando ele está disponível", () => {
    expect(providerFor("groq").id).toBe("groq");
  });

  it("cai no padrão para id desconhecido", () => {
    // Preferência editada à mão não pode virar "sem provedor": a reescrita
    // ficaria desligada sem ninguém ter desligado.
    expect(providerFor("inexistente").id).toBe(DEFAULT_PROVIDER);
  });

  it("cai no padrão para provedor apenas anunciado", () => {
    expect(providerFor("openai").id).toBe(DEFAULT_PROVIDER);
  });
});

describe("isUsableProvider", () => {
  it("recusa o anunciado e o que não existe", () => {
    expect(isUsableProvider("openai")).toBe(false);
    expect(isUsableProvider("nada")).toBe(false);
    expect(isUsableProvider(42)).toBe(false);
  });
});
