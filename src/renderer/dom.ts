import type { TranscriptionModel } from "../shared/models.js";

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

/**
 * As opções de modelo de transcrição.
 *
 * Uma só implementação: o onboarding e as preferências mostram exatamente a
 * mesma escolha, e duas cópias já tinham divergido sozinhas — uma marcava
 * "no disco", a outra "falta", invertendo o sentido da mesma classe.
 *
 * Cada opção mostra o que se PERDE, não só o tamanho. Os números vieram do
 * corpus completo, e "similaridade" engana: o compacto fica em 93,3% no
 * agregado e perde METADE dos termos técnicos, que é o que este app existe
 * para preservar.
 */
export function paintChoices(
  container: HTMLElement,
  options: {
    models: readonly TranscriptionModel[];
    chosen: string;
    present: readonly string[];
    format: (bytes: number) => string;
    onPick: (file: string) => void;
  },
): void {
  const { models, chosen, present, format, onPick } = options;

  container.replaceChildren(
    ...models.map((model) => {
      const picked = model.file === chosen;

      const option = document.createElement("label");
      option.className = `choice${picked ? " picked" : ""}${
        present.includes(model.file) ? "" : " absent"
      }`;

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "model";
      radio.checked = picked;
      radio.addEventListener("change", () => onPick(model.file));

      const name = document.createElement("span");
      name.className = "choice-name";
      name.textContent = model.name;
      if (model.recommended) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "recomendado";
        name.append(badge);
      }

      const size = document.createElement("span");
      size.className = "choice-size";
      size.textContent = format(model.bytes);

      const tradeoff = document.createElement("span");
      tradeoff.className = "choice-tradeoff";
      tradeoff.textContent = model.tradeoff;

      option.append(radio, name, size, tradeoff);

      return option;
    }),
  );
}
