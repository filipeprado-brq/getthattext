import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, parsePreferences } from "./preferences";

describe("parsePreferences", () => {
  it("lê o que foi gravado", () => {
    expect(parsePreferences('{"sound":false}').sound).toBe(false);
    expect(parsePreferences('{"sound":true}').sound).toBe(true);
  });

  it("cai no padrão quando o arquivo não existe", () => {
    expect(parsePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it("cai no padrão quando o arquivo está corrompido", () => {
    // Preferência ilegível não pode derrubar o app: o pior que pode
    // acontecer é o som voltar ligado.
    expect(parsePreferences("{isto não é json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("null")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("[1,2,3]")).toEqual(DEFAULT_PREFERENCES);
  });

  it("ignora valor com o tipo errado em vez de propagá-lo", () => {
    // `sound: "false"` é string, e uma string não-vazia é truthy — deixar
    // passar ligaria o som de quem pediu para desligar.
    expect(parsePreferences('{"sound":"false"}').sound).toBe(true);
    expect(parsePreferences('{"sound":0}').sound).toBe(true);
  });

  it("preserva chaves que não conhece", () => {
    // O #9 vai acrescentar preferências. Reescrever o arquivo sem elas
    // apagaria configuração de outra versão do app.
    const parsed = parsePreferences('{"sound":false,"shortcut":"Cmd+J"}');
    expect(parsed.sound).toBe(false);
    expect((parsed as Record<string, unknown>)["shortcut"]).toBe("Cmd+J");
  });

  it("o som vem ligado por padrão", () => {
    // A spec: o som é o que fecha o ciclo, porque no momento em que o texto
    // fica pronto seu olhar está no input onde vai colar.
    expect(DEFAULT_PREFERENCES.sound).toBe(true);
  });
});
