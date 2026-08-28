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
