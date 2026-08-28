import { describe, expect, it } from "vitest";
import {
  acceleratorToSymbols,
  isValidAccelerator,
  SHORTCUT_ACCELERATOR,
} from "./shortcut";

describe("o atalho padrão", () => {
  it("é ⌥⌘G: dois modificadores adjacentes, não três", () => {
    expect(SHORTCUT_ACCELERATOR).toBe("Alt+Command+G");
    expect(acceleratorToSymbols(SHORTCUT_ACCELERATOR)).toBe("⌥⌘G");
  });

  it("não é ⌘ + tecla única", () => {
    // Atalho global tem precedência sobre atalho de menu de app, então
    // ⌘/ tomaria o comentar-linha do Cursor e do Xcode em todo lugar — e o
    // #5 mediu que o app não teria como avisar.
    expect(SHORTCUT_ACCELERATOR.split("+").length).toBeGreaterThan(2);
  });

  it("é sempre válido pelas próprias regras", () => {
    // O padrão não pode ser algo que a tela de preferências recusaria.
    expect(isValidAccelerator(SHORTCUT_ACCELERATOR)).toBe(true);
  });
});

describe("acceleratorToSymbols", () => {
  it("traduz os modificadores do Electron para os símbolos do macOS", () => {
    expect(acceleratorToSymbols("Control+Alt+Command+G")).toBe("⌃⌥⌘G");
  });

  it("usa a ordem canônica do macOS, não a ordem escrita", () => {
    // Os menus do sistema sempre mostram ⌃⌥⇧⌘, em qualquer ordem de escrita.
    expect(acceleratorToSymbols("Command+Shift+A")).toBe("⇧⌘A");
    expect(acceleratorToSymbols("Command+Control+B")).toBe("⌃⌘B");
    expect(acceleratorToSymbols("Shift+Alt+Control+Command+Z")).toBe("⌃⌥⇧⌘Z");
  });

  it("aceita os apelidos que o Electron também aceita", () => {
    expect(acceleratorToSymbols("Ctrl+Option+Cmd+G")).toBe("⌃⌥⌘G");
    // A forma portátil que as preferências (#9) podem gerar.
    expect(acceleratorToSymbols("CommandOrControl+G")).toBe("⌘G");
  });

  it("deixa a tecla base como está", () => {
    expect(acceleratorToSymbols("Command+Space")).toBe("⌘Space");
    expect(acceleratorToSymbols("F13")).toBe("F13");
  });
});

describe("isValidAccelerator", () => {
  it("aceita modificador mais tecla", () => {
    expect(isValidAccelerator("Alt+Command+G")).toBe(true);
    expect(isValidAccelerator("Control+Shift+F5")).toBe(true);
    expect(isValidAccelerator("CommandOrControl+J")).toBe(true);
  });

  it("RECUSA tecla sem modificador", () => {
    // Registrar "G" global sequestraria a letra G em TODO o sistema. Não é
    // hipótese: é o que o campo de atalho aceitaria digitado sem cuidado.
    expect(isValidAccelerator("G")).toBe(false);
    expect(isValidAccelerator("Space")).toBe(false);
  });

  it("recusa só modificadores, sem tecla", () => {
    expect(isValidAccelerator("Alt+Command")).toBe(false);
  });

  it("recusa duas teclas base", () => {
    expect(isValidAccelerator("Command+G+K")).toBe(false);
  });

  it("recusa lixo", () => {
    expect(isValidAccelerator("")).toBe(false);
    expect(isValidAccelerator("+++")).toBe(false);
    expect(isValidAccelerator("Comand+G")).toBe(false);
  });
});
