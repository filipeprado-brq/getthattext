import { acceleratorFromChord, acceleratorToSymbols } from "../shared/shortcut.js";

/**
 * A captura da próxima combinação de teclas.
 *
 * Duas janelas gravam atalho — preferências e a primeira abertura — e a
 * captura é a parte cheia de armadilha: `preventDefault` em captura para o
 * ⌘Q não fechar o app no meio da gravação, Esc como saída, e o parcial na
 * tela enquanto só há modificador apertado, senão o campo fica mudo
 * enquanto você segura ⌥⌘.
 *
 * `onDone(undefined)` é cancelamento. Quem chamou é que sabe o que
 * restaurar na tela, então a função não escreve nada depois de terminar.
 */
export function recordShortcut(options: {
  /** Onde o parcial aparece enquanto você aperta. */
  output: HTMLElement;
  onDone: (accelerator: string | undefined) => void;
}): void {
  const { output, onDone } = options;

  const onKey = (event: KeyboardEvent): void => {
    event.preventDefault();

    if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      stop();
      onDone(undefined);

      return;
    }

    const accelerator = acceleratorFromChord(event);
    if (accelerator === undefined) {
      output.textContent = partial(event) || "Aperte a combinação…";

      return;
    }

    stop();
    onDone(accelerator);
  };

  const stop = (): void => window.removeEventListener("keydown", onKey, true);

  output.textContent = "Aperte a combinação…";
  window.addEventListener("keydown", onKey, true);
}

/** Os modificadores já apertados, para a tela responder ao dedo. */
function partial(event: KeyboardEvent): string {
  return acceleratorToSymbols(
    [
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.metaKey ? "Command" : "",
    ]
      .filter((name) => name.length > 0)
      .join("+"),
  );
}
