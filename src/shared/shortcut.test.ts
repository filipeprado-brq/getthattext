import { describe, expect, it } from "vitest";
import {
  acceleratorToSymbols,
  SHORTCUT_ACCELERATOR,
  SHORTCUT_LABEL,
} from "./shortcut";

describe("o atalho padrão", () => {
  it("é ⌥⌘G: dois modificadores adjacentes, não três", () => {
    expect(SHORTCUT_ACCELERATOR).toBe("Alt+Command+G");
    expect(SHORTCUT_LABEL).toBe("⌥⌘G");
  });

  it("não é ⌘ + tecla única", () => {
    // Atalho global tem precedência sobre atalho de menu de app, então
    // ⌘/ tomaria o comentar-linha do Cursor e do Xcode em todo lugar — e o
    // #5 mediu que o app não teria como avisar.
    expect(SHORTCUT_ACCELERATOR.split("+").length).toBeGreaterThan(2);
  });

  it("o rótulo do menu sai do accelerator, não de uma segunda fonte", () => {
    // Escrever "⌃⌥⌘G" à mão no menu e "Control+Alt+Command+G" no register
    // não teria nada que os mantivesse em sincronia.
    expect(SHORTCUT_LABEL).toBe(acceleratorToSymbols(SHORTCUT_ACCELERATOR));
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
