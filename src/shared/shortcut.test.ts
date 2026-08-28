import { describe, expect, it } from "vitest";
import {
  acceleratorToSymbols,
  SHORTCUT_ACCELERATOR,
  SHORTCUT_LABEL,
} from "./shortcut";

describe("o atalho padrão", () => {
  it("é o ⌃⌥⌘G escolhido no ticket 07", () => {
    expect(SHORTCUT_ACCELERATOR).toBe("Control+Alt+Command+G");
    // ⌃⌥⌘ + letra é quase livre no sistema. ⇧⌘Space seria mais confortável
    // e foi rejeitado: é a primeira tecla que qualquer lançador novo quer,
    // então instalar um Raycast no futuro quebraria o atalho.
    expect(SHORTCUT_LABEL).toBe("⌃⌥⌘G");
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
