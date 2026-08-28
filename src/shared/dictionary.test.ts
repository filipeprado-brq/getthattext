import { describe, expect, it } from "vitest";
import {
  applyDictionary,
  type Entry,
  parseDictionary,
  spokenForms,
  termsForPrompt,
} from "./dictionary";

describe("spokenForms", () => {
  it("desmonta camelCase, que o Whisper quebra 3 de 3", () => {
    // Medido no corpus: dateFormat → "date format", useMenu → "use menu".
    // É sistemático, e por isso vira regra em vez de entrada de lista.
    expect(spokenForms("dateFormat")).toContain("date format");
    expect(spokenForms("useMenu")).toContain("use menu");
  });

  it("separa a sigla do resto em PascalCase com acrônimo", () => {
    expect(spokenForms("getHTTPResponse")).toContain("get http response");
  });

  it("não inventa forma para termo que não é camelCase", () => {
    // "auth" e "Danger" erram por outro motivo — som, não composição. O
    // conserto deles é `heard`, não regra.
    expect(spokenForms("auth")).toEqual([]);
    expect(spokenForms("Danger")).toEqual([]);
    expect(spokenForms("Tier Magno")).toEqual([]);
  });
});

describe("applyDictionary", () => {
  const entries: Entry[] = [
    { term: "auth", heard: ["alf"] },
    { term: "Danger", heard: ["dungeon"] },
    { term: "useMenu" },
  ];

  it("troca o que foi ouvido errado pelo termo", () => {
    expect(applyDictionary("o serviço de alf caiu", entries)).toBe(
      "o serviço de auth caiu",
    );
  });

  it("aplica a regra de camelCase sem o usuário declarar nada", () => {
    expect(applyDictionary("o hook use menu quebrou", entries)).toBe(
      "o hook useMenu quebrou",
    );
  });

  it("corrige a capitalização do próprio termo", () => {
    // Do corpus: "Amplitude" saiu "amplitude".
    expect(applyDictionary("subiu o dungeon", entries)).toBe("subiu o Danger");
  });

  it("respeita fronteira de palavra", () => {
    // Sem isso, "auth" comeria o começo de "author" e de "alfabeto".
    expect(applyDictionary("o alfabeto grego", entries)).toBe("o alfabeto grego");
    expect(applyDictionary("alf", entries)).toBe("auth");
  });

  it("funciona com acento em volta, não só ASCII", () => {
    expect(applyDictionary("é alf, não?", entries)).toBe("é auth, não?");
  });

  it("prefere a correspondência mais longa", () => {
    // Sem isso, "auth" casaria dentro de "auth service" e deixaria o resto
    // pendurado.
    const longer: Entry[] = [
      { term: "auth", heard: ["alf"] },
      { term: "authService", heard: ["alf service"] },
    ];
    expect(applyDictionary("o alf service caiu", longer)).toBe(
      "o authService caiu",
    );
  });

  it("não reprocessa o que acabou de trocar", () => {
    const chain: Entry[] = [{ term: "b", heard: ["a"] }, { term: "c", heard: ["b"] }];
    expect(applyDictionary("a", chain)).toBe("b");
  });

  it("escapa metacaractere de regex no termo", () => {
    const files: Entry[] = [{ term: "import.spec.ts", heard: ["import spec ts"] }];
    expect(applyDictionary("o import spec ts falhou", files)).toBe(
      "o import.spec.ts falhou",
    );
    // O ponto não pode virar coringa: "importXspecYts" não é o arquivo.
    expect(applyDictionary("importXspecYts", files)).toBe("importXspecYts");
  });

  it("uma entrada não corrompe o termo de outra", () => {
    // Duas entradas podem produzir o MESMO padrão em minúsculas. Se a
    // segunda vencer, ela sequestra a correção da primeira — e nada avisa.
    expect(applyDictionary("usei o auth", [{ term: "auth" }, { term: "AUTH" }])).toBe(
      "usei o auth",
    );
    expect(
      applyDictionary("o date format", [{ term: "dateFormat" }, { term: "DateFormat" }]),
    ).toBe("o dateFormat");
  });

  it("casa termo que começa ou termina em pontuação", () => {
    // A fronteira de palavra só faz sentido onde a borda do padrão É letra.
    // Exigi-la sempre desligava "->" e "/me" — endpoints e operadores, que
    // são exatamente o que este app existe para preservar.
    expect(applyDictionary("a->b", [{ term: "→", heard: ["->"] }])).toBe("a→b");
    expect(applyDictionary("chama o barra MI", [{ term: "/me", heard: ["barra MI"] }])).toBe(
      "chama o /me",
    );
  });

  it("dicionário vazio devolve o texto intacto", () => {
    expect(applyDictionary("nada muda aqui", [])).toBe("nada muda aqui");
  });
});

describe("parseDictionary", () => {
  it("lê o arranjo gravado", () => {
    const parsed = parseDictionary('[{"term":"auth","heard":["alf"]}]');
    expect(parsed).toEqual([{ term: "auth", heard: ["alf"] }]);
  });

  it("arquivo ausente ou quebrado vira dicionário vazio", () => {
    // Nunca pode derrubar a ditação: sem dicionário o app funciona, só
    // erra os termos.
    expect(parseDictionary(undefined)).toEqual([]);
    expect(parseDictionary("{não é json")).toEqual([]);
    expect(parseDictionary('{"term":"auth"}')).toEqual([]);
    expect(parseDictionary("null")).toEqual([]);
  });

  it("descarta entrada inválida sem descartar o resto", () => {
    const parsed = parseDictionary(
      '[{"term":"auth"},{"nope":1},{"term":""},{"term":"Danger","heard":"dungeon"}]',
    );
    expect(parsed).toEqual([{ term: "auth" }, { term: "Danger" }]);
  });

  it("apara espaço, que senão desliga a entrada em silêncio", () => {
    // Erro clássico de arquivo editado à mão. Sem aparar, " alf " nunca
    // casa, porque a fronteira exige não-letra dos dois lados.
    const parsed = parseDictionary('[{"term":" auth ","heard":[" alf "]}]');
    expect(parsed).toEqual([{ term: "auth", heard: ["alf"] }]);
    expect(applyDictionary("o alf caiu", parsed)).toBe("o auth caiu");
  });

  it("guarda o contexto quando ele existe", () => {
    const parsed = parseDictionary('[{"term":"Danger","context":"ferramenta de CI"}]');
    expect(parsed[0]?.context).toBe("ferramenta de CI");
  });
});

describe("termsForPrompt", () => {
  const entries: Entry[] = [
    { term: "useMenu" },
    { term: "Danger", context: "ferramenta de CI" },
  ];

  it("lista os termos para o Groq não os 'corrigir'", () => {
    const list = termsForPrompt(entries, "o useMenu quebrou com o Danger");

    expect(list).toContain("useMenu");
    expect(list).toContain("Danger");
    expect(list).toContain("ferramenta de CI");
  });

  it("lista SÓ os termos que estão no texto", () => {
    // O bloco diz ao modelo "já corretos no texto". Listar termo ausente é
    // afirmar o que não é verdade, contra a própria trava NUNCA ACRESCENTE
    // do prompt — e ainda gasta tokens à toa.
    const list = termsForPrompt(entries, "o useMenu quebrou");

    expect(list).toContain("useMenu");
    expect(list).not.toContain("Danger");
  });

  it("não produz lista quando nada se aplica", () => {
    expect(termsForPrompt([], "qualquer texto")).toBe("");
    expect(termsForPrompt(entries, "nada aqui bate")).toBe("");
  });
});
