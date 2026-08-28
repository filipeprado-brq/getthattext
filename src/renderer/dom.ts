/**
 * O mínimo de DOM que as três janelas repetiam.
 *
 * Não vai para `shared/` porque depende do DOM, e a regra 8 manda para lá só
 * o que é puro. Fica aqui, do lado de quem usa.
 */

/** O elemento, ou um erro que diz qual id sumiu. */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento ausente: ${id}`);

  return node as T;
}

/** Escreve na linha de recado da janela. */
export function sayInto(target: HTMLElement): (message: string) => void {
  return (message) => {
    target.textContent = message;
  };
}
