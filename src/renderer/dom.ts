import type { TranscriptionModel } from "../shared/models.js";

/**
 * O mínimo de DOM que as três janelas repetiam.
 *
 * `el` existe porque `getElementById` devolve `HTMLElement | null` e cada
 * uso pedia um `!` ou um `as`. Um id errado passa a falhar no carregamento
 * da janela, com o nome do id — não numa linha adiante, com "null".
 */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`elemento ausente no HTML: #${id}`);

  return found as T;
}

/** O escritor de recado de uma janela, preso ao seu elemento. */
export function sayInto(target: HTMLElement): (message: string) => void {
  return (message: string) => {
    target.textContent = message;
  };
}

/** Os cinco traços da potência, sem número e sem rótulo. */
const POWER_STEPS = [1, 2, 3, 4, 5];

const INFO_ICON =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/>' +
  '<path d="M8 7.1v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  '<circle cx="8" cy="4.9" r="0.85" fill="currentColor"/></svg>';

export type ChoiceOptions = {
  models: readonly TranscriptionModel[];
  chosen: string;
  /**
   * Quais estão no disco.
   *
   * Omitido no onboarding: lá nada está no disco ainda, e dizer "falta
   * baixar" em três cards seria dizer o óbvio três vezes.
   */
  present?: readonly string[];
  format: (bytes: number) => string;
  onPick: (file: string) => void;
};

/**
 * As opções de modelo, em cards horizontais do mesmo tamanho.
 *
 * Uma só implementação: o onboarding e as preferências mostram exatamente a
 * mesma escolha, e duas cópias já tinham divergido sozinhas — uma marcava
 * "no disco", a outra "falta", invertendo o sentido da mesma classe.
 *
 * O card mostra tipo, arquivo, peso e potência, e NENHUMA frase. O que se
 * perde ao escolher cada um — a medição das 30 amostras — fica na
 * explicação do `ⓘ`: um card com parágrafo não é comparável de relance, e
 * comparar é a única coisa que se faz com três deles lado a lado.
 *
 * A seleção é a BORDA. Um círculo de rádio ao lado de um card inteiro
 * clicável é o mesmo estado dito duas vezes.
 */
export function paintChoices(container: HTMLElement, options: ChoiceOptions): void {
  const { models, chosen, present, format, onPick } = options;

  container.replaceChildren(
    ...models.map((model, index) => {
      const wrap = document.createElement("div");
      wrap.className = "card-wrap";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "model-card";
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", String(model.file === chosen));
      card.addEventListener("click", () => onPick(model.file));

      const head = document.createElement("div");
      head.className = "card-head";

      const tipo = document.createElement("span");
      tipo.className = "card-tipo";
      tipo.textContent = model.name;
      head.append(tipo);

      if (model.recommended) {
        const badge = document.createElement("span");
        badge.className = "card-badge";
        badge.textContent = "recomendado";
        head.append(badge);
      }

      const file = document.createElement("span");
      file.className = "card-file";
      file.textContent = model.file;
      file.title = model.file;

      const size = document.createElement("span");
      size.className = "card-size";
      const bytes = document.createElement("b");
      bytes.textContent = format(model.bytes);
      size.append(bytes);

      if (present !== undefined) {
        const state = document.createElement("span");
        const here = present.includes(model.file);
        state.className = here ? "here" : "missing";
        state.textContent = here ? " · no disco" : " · falta baixar";
        size.append(state);
      }

      const meta = document.createElement("div");
      meta.className = "card-meta";
      meta.append(file, size);

      const top = document.createElement("div");
      top.append(head, meta);

      const power = document.createElement("div");
      power.className = "power";
      power.dataset["level"] = String(model.power);
      power.setAttribute("aria-hidden", "true");
      power.append(
        ...POWER_STEPS.map((step) => {
          const mark = document.createElement("i");
          if (step <= model.power) mark.className = "on";

          return mark;
        }),
      );

      card.append(top, power);

      // Botão IRMÃO do card, não filho: botão dentro de botão é HTML
      // inválido, e o clique no ícone viraria clique no card.
      const info = document.createElement("button");
      info.type = "button";
      info.className = "info";
      info.setAttribute("aria-expanded", "false");
      info.setAttribute("aria-label", `Detalhes do modelo ${model.name}`);
      info.innerHTML = INFO_ICON;
      info.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = info.getAttribute("aria-expanded") === "true";

        for (const other of container.querySelectorAll(".info")) {
          other.setAttribute("aria-expanded", "false");
        }
        info.setAttribute("aria-expanded", String(!open));
      });

      const tip = document.createElement("div");
      // O último abre para a esquerda, ou a explicação sairia da janela.
      tip.className = index === models.length - 1 ? "tip right" : "tip";
      tip.setAttribute("role", "tooltip");

      const grade = document.createElement("b");
      grade.textContent = `${model.power} de 5 · ${model.powerLabel}`;
      tip.append(grade, document.createTextNode(model.tradeoff));

      wrap.append(card, info, tip);

      return wrap;
    }),
  );
}
