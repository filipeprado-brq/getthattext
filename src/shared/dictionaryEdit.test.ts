import { describe, expect, it } from "vitest";
import type { Entry } from "./dictionary";
import {
  heardRejection,
  phraseFrom,
  tokenize,
  withContextAt,
  withHeard,
  withoutAt,
  withoutHeardAt,
  withTermAt,
} from "./dictionaryEdit";

describe("tokenize", () => {
  it("separa palavras do que está entre elas", () => {
    expect(tokenize("Tia Magno caiu")).toEqual([
      { text: "Tia", word: true },
      { text: " ", word: false },
      { text: "Magno", word: true },
      { text: " ", word: false },
      { text: "caiu", word: true },
    ]);
  });

  it("mantém a pontuação, que não é clicável", () => {
    const tokens = tokenize("o alf, né?");
    expect(tokens.filter((t) => t.word).map((t) => t.text)).toEqual(["o", "alf", "né"]);
    // Remontar os tokens tem que devolver o texto original, ou a tela mostra
    // algo diferente do que o Whisper entregou.
    expect(tokens.map((t) => t.text).join("")).toBe("o alf, né?");
  });

  it("trata acento e número como parte da palavra", () => {
    expect(tokenize("versão 2 é").filter((t) => t.word).map((t) => t.text)).toEqual([
      "versão",
      "2",
      "é",
    ]);
  });

  it("texto vazio não produz token", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("phraseFrom", () => {
  const tokens = tokenize("o problema do Tia Magno agora");

  it("uma palavra só devolve a palavra", () => {
    const index = tokens.findIndex((t) => t.text === "Tia");
    expect(phraseFrom(tokens, index, index)).toBe("Tia");
  });

  it("duas palavras devolvem o trecho inteiro, com o que há entre elas", () => {
    // "Tia Magno" é duas palavras e um erro só — sem isto o usuário não
    // conseguiria ensinar termo composto.
    const from = tokens.findIndex((t) => t.text === "Tia");
    const to = tokens.findIndex((t) => t.text === "Magno");
    expect(phraseFrom(tokens, from, to)).toBe("Tia Magno");
  });

  it("aceita a seleção ao contrário", () => {
    // Clicar da direita para a esquerda é tão natural quanto o contrário.
    const from = tokens.findIndex((t) => t.text === "Magno");
    const to = tokens.findIndex((t) => t.text === "Tia");
    expect(phraseFrom(tokens, from, to)).toBe("Tia Magno");
  });

  it("apara o que sobra nas pontas", () => {
    const punctuated = tokenize("o alf, caiu");
    expect(phraseFrom(punctuated, 2, 4)).toBe("alf, caiu");
  });

  it("índice fora da faixa devolve vazio", () => {
    expect(phraseFrom(tokens, -1, 0)).toBe("");
    expect(phraseFrom(tokens, 0, 999)).toBe("");
  });
});

describe("withHeard", () => {
  const entries: Entry[] = [
    { term: "auth", heard: ["alf"] },
    { term: "BFF" },
  ];

  it("acrescenta a variante a um termo que já existe", () => {
    expect(withHeard(entries, "auth", "olf")).toEqual([
      { term: "auth", heard: ["alf", "olf"] },
      { term: "BFF" },
    ]);
  });

  it("cria a entrada quando o termo é novo", () => {
    expect(withHeard(entries, "hook", "Rook")).toEqual([
      { term: "auth", heard: ["alf"] },
      { term: "BFF" },
      { term: "hook", heard: ["Rook"] },
    ]);
  });

  it("cria a lista de ouvidos num termo que ainda não tinha", () => {
    expect(withHeard(entries, "BFF", "IBFF")[1]).toEqual({
      term: "BFF",
      heard: ["IBFF"],
    });
  });

  it("não duplica variante já registrada", () => {
    expect(withHeard(entries, "auth", "alf")).toEqual(entries);
    // Nem com caixa diferente: a busca é insensível a caixa, então "Alf" e
    // "alf" produziriam o mesmo padrão e a segunda seria inútil.
    expect(withHeard(entries, "auth", "Alf")).toEqual(entries);
  });

  it("apara espaço, que desligaria a entrada em silêncio", () => {
    expect(withHeard(entries, "auth", "  olf  ")[0]?.heard).toEqual(["alf", "olf"]);
  });

  it("recusa termo ou ouvido vazio em vez de gravar lixo", () => {
    expect(withHeard(entries, "", "olf")).toEqual(entries);
    expect(withHeard(entries, "auth", "   ")).toEqual(entries);
  });

  it("recusa quando o ouvido é igual ao termo", () => {
    // Seria uma regra que troca a palavra por ela mesma.
    expect(withHeard(entries, "auth", "auth")).toEqual(entries);
  });

  it("não altera o arranjo recebido", () => {
    const before = JSON.stringify(entries);
    withHeard(entries, "auth", "olf");
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("heardRejection", () => {
  const entries: Entry[] = [{ term: "auth", heard: ["alf"] }];

  it("aceita um par novo", () => {
    expect(heardRejection(entries, "auth", "olf")).toBeUndefined();
  });

  it("explica cada recusa em vez de engolir", () => {
    // Recusar em silêncio e limpar os campos torna sucesso e falha
    // indistinguíveis — a spec §10 proíbe falhar calado.
    expect(heardRejection(entries, "", "olf")).toBeDefined();
    expect(heardRejection(entries, "auth", "  ")).toBeDefined();
    expect(heardRejection(entries, "auth", "auth")).toBeDefined();
    expect(heardRejection(entries, "auth", "ALF")).toBeDefined();
  });
});

describe("edição por posição", () => {
  // A lista edita por índice e removia por termo. Duas entradas com o mesmo
  // termo — dois cliques em "Novo termo" bastavam — e "Remover" numa apagava
  // as duas.
  const entries: Entry[] = [
    { term: "auth", heard: ["alf"] },
    { term: "auth", context: "duplicata" },
    { term: "BFF" },
  ];

  it("remove só a posição pedida, mesmo com termo repetido", () => {
    expect(withoutAt(entries, 1)).toEqual([entries[0], entries[2]]);
  });

  it("índice fora da faixa não muda nada", () => {
    expect(withoutAt(entries, 9)).toEqual(entries);
    expect(withoutAt(entries, -1)).toEqual(entries);
  });

  it("troca o termo da posição", () => {
    expect(withTermAt(entries, 2, "bff")[2]).toEqual({ term: "bff" });
  });

  it("RECUSA apagar o termo, que destruiria a entrada em silêncio", () => {
    // `parseDictionary` descarta entrada sem termo. Comitar vazio faria a
    // linha sumir com todos os `heard` acumulados, sem confirmação.
    expect(withTermAt(entries, 0, "")).toEqual(entries);
    expect(withTermAt(entries, 0, "   ")).toEqual(entries);
  });

  it("troca o contexto, e vazio é legítimo ali", () => {
    expect(withContextAt(entries, 1, "")[1]).toEqual({ term: "auth" });
    expect(withContextAt(entries, 2, "novo")[2]).toEqual({
      term: "BFF",
      context: "novo",
    });
  });

  it("esquece uma variante sem tocar nas outras posições", () => {
    expect(withoutHeardAt(entries, 0, "alf")[0]).toEqual({ term: "auth" });
    expect(withoutHeardAt(entries, 0, "alf")[1]).toEqual(entries[1]);
  });
});
