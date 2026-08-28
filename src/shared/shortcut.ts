/**
 * O atalho global e como ele se escreve na tela.
 *
 * Puro de propósito: o accelerator e o rótulo do menu precisam descrever as
 * mesmas teclas, e escrever os dois à mão não teria nada que os mantivesse
 * em sincronia.
 */

/**
 * `⌃⌥⌘G`, na sintaxe de accelerator do Electron.
 *
 * Escolhido no ticket 07 contra as 229 hotkeys registradas nesta máquina:
 * `⌃⌥⌘` + letra é quase livre no sistema. F13–F20 estavam ainda mais
 * livres, mas não existem em teclado de MacBook.
 *
 * `⇧⌘Space` seria mais confortável e também está livre — foi rejeitado
 * justamente por isso: é a primeira tecla que qualquer lançador novo vai
 * querer, e instalar um Raycast no futuro quebraria o atalho.
 *
 * Ressalva não testada: com VoiceOver ligado, `⌃⌥` é a tecla VO.
 * Acrescentar `⌘` deve evitar a colisão, mas isso não foi verificado.
 */
export const SHORTCUT_ACCELERATOR = "Control+Alt+Command+G";

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

/** Traduz um accelerator do Electron para os símbolos que o menu mostra. */
export function acceleratorToSymbols(accelerator: string): string {
  const parts = accelerator.split("+");
  const present = new Set(parts.map(symbolFor).filter(Boolean));

  const modifiers = MODIFIERS.filter(([symbol]) => present.has(symbol))
    .map(([symbol]) => symbol)
    .join("");

  return modifiers + parts.filter((part) => !symbolFor(part)).join("");
}

/** O mesmo atalho, do jeito que o menu do macOS o escreve. */
export const SHORTCUT_LABEL = acceleratorToSymbols(SHORTCUT_ACCELERATOR);
