import { describe, expect, it } from "vitest";
import { cleanRewrite, SYSTEM_PROMPT } from "./rewrite";

describe("SYSTEM_PROMPT", () => {
  it("fixa o limiar de 40 palavras", () => {
    // Medido, não estimado: pedindo brevidade explícita, a fala natural saiu
    // com 9, 14, 19, 27, 33, 35 e 37 palavras. O limiar anterior de 15 quase
    // nunca dispararia.
    expect(SYSTEM_PROMPT).toContain("Menos de 40 palavras");
    expect(SYSTEM_PROMPT).toContain("40 palavras ou mais");
  });

  it("trava o que nunca pode mudar", () => {
    // Sem essas travas, "ok pode subir" virou "Upload concluído com
    // sucesso!" — invenção total, num teste real.
    for (const lock of [
      "números, datas, valores",
      "nomes de arquivos, variáveis, funções, comandos, endpoints",
      "siglas",
      "o grau de certeza",
    ]) {
      expect(SYSTEM_PROMPT).toContain(lock);
    }
  });

  it("proíbe acrescentar o que não foi dito", () => {
    expect(SYSTEM_PROMPT).toContain("NUNCA ACRESCENTE");
    expect(SYSTEM_PROMPT).toContain("informação que não está no texto");
  });

  it("fixa português do Brasil nas duas pontas", () => {
    expect(SYSTEM_PROMPT).toContain("Nunca traduza");
  });

  it("pede texto puro, sem preâmbulo", () => {
    expect(SYSTEM_PROMPT).toContain("EXCLUSIVAMENTE o texto reescrito");
  });
});

describe("cleanRewrite", () => {
  it("devolve texto limpo intacto", () => {
    expect(cleanRewrite("Bom dia, tudo certo por aqui.")).toBe(
      "Bom dia, tudo certo por aqui.",
    );
  });

  it("remove os preâmbulos conhecidos", () => {
    expect(cleanRewrite("Aqui está o texto reescrito: Bom dia.")).toBe("Bom dia.");
    expect(cleanRewrite("Texto revisado: Bom dia.")).toBe("Bom dia.");
    expect(cleanRewrite("Segue a versão revisada:\n\nBom dia.")).toBe("Bom dia.");
  });

  it("NÃO remove uma fala que só começa parecido", () => {
    // O risco real da limpeza: "Aqui está o que eu preciso" é ditado
    // legítimo. Cortar isso destruiria conteúdo, que é pior que deixar
    // passar um preâmbulo.
    expect(cleanRewrite("Aqui está o que eu preciso: três coisas.")).toBe(
      "Aqui está o que eu preciso: três coisas.",
    );
    expect(cleanRewrite("Segue o link do board: exemplo.com")).toBe(
      "Segue o link do board: exemplo.com",
    );
  });

  it("remove aspas que envolvem o texto inteiro", () => {
    expect(cleanRewrite('"Bom dia."')).toBe("Bom dia.");
    expect(cleanRewrite("“Bom dia.”")).toBe("Bom dia.");
  });

  it("NÃO remove aspas que fazem parte do texto", () => {
    expect(cleanRewrite('Ele disse "oi" e saiu.')).toBe('Ele disse "oi" e saiu.');
    // Envolvido, mas com aspas por dentro: cortar as pontas quebraria o par
    // de dentro. Na dúvida, não mexe.
    expect(cleanRewrite('"Ele disse "oi" e saiu."')).toBe('"Ele disse "oi" e saiu."');
  });

  it("apara espaço em volta", () => {
    expect(cleanRewrite("\n  Bom dia.  \n")).toBe("Bom dia.");
  });

  it("devolve vazio quando não sobra nada", () => {
    expect(cleanRewrite("")).toBe("");
    expect(cleanRewrite("   \n ")).toBe("");
  });
});
