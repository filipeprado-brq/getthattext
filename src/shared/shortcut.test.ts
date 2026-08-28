import { describe, expect, it } from "vitest";
import {
  acceleratorFromChord,
  acceleratorToSymbols,
  isValidAccelerator,
  type KeyChord,
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

describe("acceleratorFromChord", () => {
  /** O que o teclado entrega, com nada apertado. */
  const nothing: KeyChord = {
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };

  it("monta o accelerator a partir das teclas apertadas", () => {
    expect(
      acceleratorFromChord({ ...nothing, code: "KeyG", metaKey: true, altKey: true }),
    ).toBe("Alt+Command+G");
  });

  it("usa ordem canônica, não a ordem em que o teclado reporta", () => {
    expect(
      acceleratorFromChord({
        ...nothing,
        code: "KeyZ",
        metaKey: true,
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe("Control+Alt+Shift+Command+Z");
  });

  it("RECUSA tecla sem modificador", () => {
    // Gravar "G" sozinho sequestraria a letra G em todo o sistema, e é o
    // primeiro acidente possível num campo que captura teclado.
    expect(acceleratorFromChord({ ...nothing, code: "KeyG" })).toBeUndefined();
  });

  it("recusa modificador sozinho, que é o estado de quem ainda está apertando", () => {
    expect(
      acceleratorFromChord({ ...nothing, code: "MetaLeft", metaKey: true }),
    ).toBeUndefined();
    expect(
      acceleratorFromChord({ ...nothing, code: "ShiftRight", shiftKey: true }),
    ).toBeUndefined();
  });

  it("traduz dígito, função e teclas nomeadas", () => {
    expect(acceleratorFromChord({ ...nothing, code: "Digit1", ctrlKey: true })).toBe(
      "Control+1",
    );
    expect(acceleratorFromChord({ ...nothing, code: "F5", altKey: true })).toBe("Alt+F5");
    expect(acceleratorFromChord({ ...nothing, code: "Space", metaKey: true })).toBe(
      "Command+Space",
    );
    expect(acceleratorFromChord({ ...nothing, code: "Enter", metaKey: true })).toBe(
      "Command+Return",
    );
    expect(acceleratorFromChord({ ...nothing, code: "ArrowUp", metaKey: true })).toBe(
      "Command+Up",
    );
  });

  it("traduz pontuação, que é onde mora o ⌘/ que o usuário vai tentar", () => {
    expect(acceleratorFromChord({ ...nothing, code: "Slash", metaKey: true })).toBe(
      "Command+/",
    );
    expect(acceleratorFromChord({ ...nothing, code: "Comma", metaKey: true })).toBe(
      "Command+,",
    );
  });

  it("recusa tecla que não sabe traduzir em vez de inventar", () => {
    // Um accelerator inventado registra sem erro e nunca dispara.
    expect(
      acceleratorFromChord({ ...nothing, code: "IntlBackslash", metaKey: true }),
    ).toBeUndefined();
  });

  it("o que ele produz passa pela própria validação", () => {
    const built = acceleratorFromChord({ ...nothing, code: "KeyK", ctrlKey: true });
    expect(built).toBeDefined();
    expect(isValidAccelerator(built ?? "")).toBe(true);
  });
});
