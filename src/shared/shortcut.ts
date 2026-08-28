/**
 * O atalho global e como ele se escreve na tela.
 *
 * Puro de propósito: o accelerator e o rótulo do menu precisam descrever as
 * mesmas teclas, e escrever os dois à mão não teria nada que os mantivesse
 * em sincronia.
 */

/**
 * `⌥⌘G`, na sintaxe de accelerator do Electron.
 *
 * O ticket 07 tinha escolhido `⌃⌥⌘G`. Mudou depois de usar: TRÊS
 * modificadores é uma garra, e o ticket 07 foi escrito quando o gatilho
 * ainda era push-to-talk, onde só importava segurar confortavelmente.
 * Com toggle, o que importa é a forma da mão no toque.
 *
 * `⌘` + tecla única foi pedido e recusado, com motivo concreto: atalho
 * global do macOS TEM PRECEDÊNCIA sobre atalho de menu de aplicativo, então
 * registrar `⌘/` tomaria o comentar-linha do Cursor e do Xcode — ambos
 * instalados nesta máquina — em todo lugar, e a medição do #5 mostra que o
 * app não teria como avisar. O mesmo vale para `⌃` + letra (`⌃A`/`⌃E`/`⌃K`
 * são navegação de linha em qualquer campo de texto do macOS) e `⌥` + letra
 * (digita caractere: `⌥G` é ©).
 *
 * Dois modificadores + letra é o ponto de equilíbrio, e `⌥⌘` são adjacentes
 * no teclado. Medido nos 43 atalhos de sistema habilitados nesta máquina:
 * `⌥⌘` só toma `D` (esconder o Dock) e `Space`.
 *
 * Risco que sobra, e não é pequeno: isso cobre atalhos DO SISTEMA. Conflito
 * com menu de aplicativo não aparece em lugar nenhum e não é detectável —
 * ver o comentário de `src/main/shortcut.ts`.
 *
 * Ressalva não testada: com VoiceOver ligado, `⌃⌥` é a tecla VO. `⌥⌘` não
 * encosta nisso, então a ressalva do ticket 07 deixa de valer.
 */
export const SHORTCUT_ACCELERATOR = "Alt+Command+G";

/**
 * Como o macOS escreve cada modificador, e em que ordem.
 *
 * A ordem é a dos menus do sistema (⌃⌥⇧⌘) e não a da string: `⌘⇧A` num menu
 * do macOS está errado mesmo que o accelerator diga "Command+Shift+A".
 */
const MODIFIERS: readonly (readonly [symbol: string, names: string[]])[] = [
  ["⌃", ["control", "ctrl"]],
  ["⌥", ["alt", "option"]],
  ["⇧", ["shift"]],
  // `CommandOrControl` é ⌘ aqui: o alvo é só macOS, e as preferências (#9)
  // podem gerar a forma portátil.
  ["⌘", ["command", "cmd", "super", "meta", "commandorcontrol", "cmdorctrl"]],
];

function symbolFor(part: string): string | undefined {
  const lowered = part.toLowerCase();

  return MODIFIERS.find(([, names]) => names.includes(lowered))?.[0];
}

/** Todo nome de modificador que o Electron aceita, em minúsculas. */
export const MODIFIER_NAMES: ReadonlySet<string> = new Set(
  MODIFIERS.flatMap(([, names]) => names),
);

/** Traduz um accelerator do Electron para os símbolos que o menu mostra. */
export function acceleratorToSymbols(accelerator: string): string {
  const parts = accelerator.split("+");
  const present = new Set(parts.map(symbolFor).filter(Boolean));

  const modifiers = MODIFIERS.filter(([symbol]) => present.has(symbol))
    .map(([symbol]) => symbol)
    .join("");

  return modifiers + parts.filter((part) => !symbolFor(part)).join("");
}


/**
 * A combinação é registrável?
 *
 * Exige ao menos um modificador. Não é preciosismo: registrar `G` como
 * atalho global sequestraria a letra G em TODO o sistema, e é exatamente o
 * que um campo de texto aceitaria de quem digitou sem pensar.
 *
 * Exige também exatamente UMA tecla base — `Command+G+K` não existe.
 */
export function isValidAccelerator(accelerator: string): boolean {
  const parts = accelerator.split("+");
  if (parts.some((part) => part.length === 0)) return false;

  const modifiers = parts.filter((part) => MODIFIER_NAMES.has(part.toLowerCase()));

  return modifiers.length > 0 && parts.length - modifiers.length === 1;
}

/** O que um `keydown` entrega, sem depender do DOM. */
export type KeyChord = {
  /** `KeyboardEvent.code`: a tecla FÍSICA, não o caractere que ela produz. */
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Teclas nomeadas que o Electron aceita, com o nome que ELE usa.
 *
 * `code` é a tecla física de propósito: com `key`, apertar ⌥G produziria
 * "©" e o accelerator sairia impossível de registrar.
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: "Space",
  Tab: "Tab",
  Escape: "Escape",
  Enter: "Return",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Slash: "/",
  Period: ".",
  Comma: ",",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};

/** A tecla base, ou `undefined` se não dá para traduzi-la com confiança. */
function baseKey(code: string): string | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];

  if (/^F\d{1,2}$/.test(code)) return code;

  return NAMED_KEYS[code];
}

/**
 * Converte teclas apertadas num accelerator do Electron.
 *
 * Existe para a tela de preferências CAPTURAR o atalho em vez de exigir que
 * você digite `Alt+Command+G` — sintaxe do Electron não deveria vazar para
 * a interface.
 *
 * Devolve `undefined` enquanto a combinação não serve: sem modificador
 * (registrar `G` sequestraria a letra em todo o sistema), só modificadores
 * (é o estado de quem ainda está apertando), ou tecla que não dá para
 * traduzir — inventar um nome produziria um accelerator que registra sem
 * erro e nunca dispara.
 */
export function acceleratorFromChord(chord: KeyChord): string | undefined {
  const key = baseKey(chord.code);
  if (key === undefined) return undefined;

  // Ordem canônica, para o accelerator de uma mesma combinação ser sempre a
  // mesma string — o que importa ao comparar com o que está gravado.
  const modifiers = [
    chord.ctrlKey ? "Control" : "",
    chord.altKey ? "Alt" : "",
    chord.shiftKey ? "Shift" : "",
    chord.metaKey ? "Command" : "",
  ].filter((name) => name.length > 0);

  if (modifiers.length === 0) return undefined;

  return [...modifiers, key].join("+");
}
