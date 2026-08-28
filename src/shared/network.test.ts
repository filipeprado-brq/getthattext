import { describe, expect, it } from "vitest";
import { isNetworkFailure, networkFailureMessage } from "./network.js";

/** O formato exato do que o `fetch` do Node entrega. */
const fetchFailure = (code: string): TypeError =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("Connect Timeout Error"), { code }),
  });

describe("isNetworkFailure", () => {
  it("reconhece o timeout de conexão que derrubou o download", () => {
    // Aconteceu: `UND_ERR_CONNECT_TIMEOUT` num endereço IPv6 do CloudFront,
    // com o mesmo host respondendo em 60 ms minutos depois.
    expect(isNetworkFailure(fetchFailure("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
  });

  it("reconhece os outros erros de transporte", () => {
    for (const code of ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ENETUNREACH"]) {
      expect(isNetworkFailure(fetchFailure(code))).toBe(true);
    }
  });

  it("aceita o TypeError do fetch mesmo sem cause legível", () => {
    expect(isNetworkFailure(new TypeError("fetch failed"))).toBe(true);
  });

  it("NÃO repete cancelamento", () => {
    // Fechar a janela aborta o download de propósito; repetir seria reabrir
    // sozinho o que você acabou de fechar.
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";

    expect(isNetworkFailure(aborted)).toBe(false);
  });

  it("NÃO repete o que a rede já respondeu", () => {
    // 404 e hash errado não melhoram tentando de novo.
    expect(isNetworkFailure(new Error("o arquivo não está mais lá (404)"))).toBe(false);
    expect(isNetworkFailure(new Error("veio com 10 bytes, esperava 574041195"))).toBe(false);
    expect(isNetworkFailure("qualquer coisa")).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });

  it("acha o código mesmo aninhado", () => {
    const wrapped = Object.assign(new Error("falhou"), {
      cause: Object.assign(new Error("meio"), {
        cause: Object.assign(new Error("fundo"), { code: "ECONNRESET" }),
      }),
    });

    expect(isNetworkFailure(wrapped)).toBe(true);
  });
});

describe("networkFailureMessage", () => {
  it("nomeia o host e promete o que o .part garante", () => {
    const message = networkFailureMessage("huggingface.co");

    expect(message).toContain("huggingface.co");
    expect(message).toContain("de onde parou");
  });
});
