import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, LANGUAGES, parsePreferences } from "./preferences";
import { isValidAccelerator } from "./shortcut";

describe("parsePreferences", () => {
  it("lê o que foi gravado", () => {
    const parsed = parsePreferences(
      '{"sound":false,"rewrite":false,"shortcut":"Control+Command+K","language":"en","model":"ggml-small-q5_1.bin"}',
    );

    expect(parsed).toMatchObject({
      sound: false,
      rewrite: false,
      shortcut: "Control+Command+K",
      language: "en",
      model: "ggml-small-q5_1.bin",
    });
  });

  it("cai no padrão quando o arquivo não existe ou está corrompido", () => {
    // Preferência ilegível não pode derrubar o app: o pior que acontece é
    // uma configuração voltar ao default, que é visível e corrigível.
    for (const bad of [undefined, "{isto não é json", "", "null", "[1,2,3]"]) {
      expect(parsePreferences(bad)).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it("cada campo cai no padrão SOZINHO", () => {
    // Um campo estragado não pode custar os outros: você perderia a chave
    // do atalho por causa de um typo no idioma.
    const parsed = parsePreferences('{"sound":false,"language":"klingon","model":123}');

    expect(parsed.sound).toBe(false);
    expect(parsed.language).toBe(DEFAULT_PREFERENCES.language);
    expect(parsed.model).toBe(DEFAULT_PREFERENCES.model);
  });

  it("recusa modelo que o app não sabe baixar nem verificar", () => {
    // Qualquer string deixava passar um nome sem URL nem hash no catálogo,
    // e a falha só apareceria na primeira ditação — com o diagnóstico
    // errado, porque "modelo ausente" e "modelo corrompido" dão a mesma
    // mensagem no whisper.
    expect(parsePreferences('{"model":"ggml-inventado.bin"}').model).toBe(
      DEFAULT_PREFERENCES.model,
    );
  });

  it("ignora booleano com o tipo errado em vez de propagá-lo", () => {
    // `sound: "false"` é string, e string não-vazia é truthy — deixar
    // passar ligaria o som de quem pediu para desligar.
    expect(parsePreferences('{"sound":"false"}').sound).toBe(true);
    expect(parsePreferences('{"rewrite":0}').rewrite).toBe(true);
  });

  it("recusa atalho que não é atalho", () => {
    // Um atalho inválido não registra, e o sintoma seria a tecla
    // simplesmente não fazer nada — indistinguível de não ter apertado.
    expect(parsePreferences('{"shortcut":"banana"}').shortcut).toBe(
      DEFAULT_PREFERENCES.shortcut,
    );
    expect(parsePreferences('{"shortcut":""}').shortcut).toBe(DEFAULT_PREFERENCES.shortcut);
  });

  it("preserva chaves que não conhece", () => {
    // Reescrever o arquivo sem elas apagaria configuração de outra versão.
    const parsed = parsePreferences('{"sound":false,"futuro":"x"}');
    expect((parsed as Record<string, unknown>)["futuro"]).toBe("x");
  });
});

describe("DEFAULT_PREFERENCES", () => {
  it("som e reescrita vêm ligados", () => {
    // O som fecha o ciclo, porque no momento em que o texto fica pronto seu
    // olhar está no input onde vai colar. A reescrita é o produto.
    expect(DEFAULT_PREFERENCES.sound).toBe(true);
    expect(DEFAULT_PREFERENCES.rewrite).toBe(true);
  });

  it("o idioma padrão está entre os oferecidos", () => {
    expect(LANGUAGES.map((l) => l.code)).toContain(DEFAULT_PREFERENCES.language);
  });

  it("o atalho padrão é válido pelas próprias regras", () => {
    expect(isValidAccelerator(DEFAULT_PREFERENCES.shortcut)).toBe(true);
  });
});
