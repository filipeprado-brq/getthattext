import type { Entry } from "../shared/dictionary.js";
import { reason } from "../shared/errors.js";
import { el } from "./dom.js";
import {
  heardRejection,
  phraseFrom,
  tokenize,
  type Token,
  withContextAt,
  withHeard,
  withoutAt,
  withoutHeardAt,
  withTermAt,
} from "../shared/dictionaryEdit.js";

/**
 * O editor de dicionário.
 *
 * Toda mudança grava na hora e a tela é redesenhada com o que voltou do
 * disco. Não há estado "não salvo": o que você vê é o que o app vai usar na
 * próxima ditação, que é a promessa do ticket.
 */

/**
 * O que está DESENHADO na área do cru, e o trecho selecionado nele.
 *
 * `source === undefined` significa "ainda não desenhei nada", que é
 * diferente de `source.heard === undefined` — "desenhei o estado sem
 * ditação". A distinção não é sutileza: sem ela, o primeiro desenho de uma
 * sessão sem ditação era pulado pela guarda de "só redesenha se mudou", e o
 * formulário nunca era desabilitado.
 */
type Source = {
  heard: string | undefined;
  tokens: Token[];
  /** As duas pontas do trecho, na ordem em que foram clicadas. */
  picked?: { anchor: number; extent: number };
};

let entries: Entry[] = [];
let source: Source | undefined;

/**
 * A linha em branco criada por "Novo termo".
 *
 * Fica FORA do arquivo até ganhar um termo: gravar `{ term: "" }` faria o
 * parse descartá-la na volta, e a linha sumiria sozinha; gravar um termo de
 * mentira deixaria "novo termo" virando regra de substituição de verdade.
 */
let draft = false;

const learn = el("learn");
const heardText = el("heard-text");
const heardInput = el<HTMLInputElement>("heard");
const termInput = el<HTMLInputElement>("term");
const status = el("status");
const list = el("list");
const count = el("count");

function say(message: string): void {
  status.textContent = message;
}

/**
 * Grava e redesenha com o que ficou no disco.
 *
 * O `catch` não é formalidade: sem ele um `save` que rejeita deixaria a tela
 * mostrando entradas que não estão no arquivo, em silêncio — que é
 * exatamente o estado intermediário que a regra 4 do CODING_STANDARDS
 * existe para impedir.
 */
async function commit(next: readonly Entry[]): Promise<void> {
  try {
    entries = await window.dictionaryBridge.save(next);
    draft = false;
    say("");
  } catch (error) {
    say(`Não foi possível gravar: ${reason(error)}`);
  }

  renderEntries();
}

/* ---------- a metade de cima: aprender do último ditado ---------- */

/** Sem ditação na sessão, o formulário sai de alcance de verdade. */
function setLearnAvailable(available: boolean): void {
  learn.classList.toggle("unavailable", !available);

  // `pointer-events: none` no CSS não basta: o formulário é o primeiro
  // elemento focável do documento, e um Tab levava ao campo, digitava e o
  // Enter gravava.
  for (const field of [heardInput, termInput, el<HTMLButtonElement>("submit")]) {
    field.disabled = !available;
  }
}

function clearPicked(): void {
  for (const node of heardText.childNodes) {
    if (node instanceof HTMLElement) node.classList.remove("picked");
  }
}

function renderHeard(heard: string | undefined): void {
  if (heard === undefined) {
    source = { heard: undefined, tokens: [] };
    setLearnAvailable(false);
    heardText.classList.add("empty");
    heardText.textContent = "Nenhuma ditação nesta sessão.";

    return;
  }

  source = { heard, tokens: tokenize(heard) };
  setLearnAvailable(true);
  heardText.classList.remove("empty");
  heardText.replaceChildren(
    ...source.tokens.map((token, index) => {
      if (!token.word) return document.createTextNode(token.text);

      const word = document.createElement("span");
      word.className = "word";
      word.textContent = token.text;
      word.addEventListener("click", () => pick(index));

      return word;
    }),
  );
}

/**
 * Primeiro clique ancora, segundo estende.
 *
 * Estender importa porque termo composto é comum — "Tia Magno" é duas
 * palavras e um erro só. Clicar de novo na mesma palavra recomeça, para não
 * haver seleção da qual não se sai.
 */
function pick(index: number): void {
  if (!source) return;

  const current = source.picked;
  source.picked =
    current === undefined || (current.anchor === index && current.extent === index)
      ? { anchor: index, extent: index }
      : { anchor: current.anchor, extent: index };

  const from = Math.min(source.picked.anchor, source.picked.extent);
  const to = Math.max(source.picked.anchor, source.picked.extent);

  clearPicked();
  source.tokens.forEach((token, position) => {
    if (!token.word || position < from || position > to) return;

    const node = heardText.childNodes[position];
    if (node instanceof HTMLElement) node.classList.add("picked");
  });

  heardInput.value = phraseFrom(source.tokens, from, to);
  termInput.focus();
}

el<HTMLFormElement>("learn-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const rejection = heardRejection(entries, termInput.value, heardInput.value);
  if (rejection !== undefined) {
    say(rejection);

    return;
  }

  void commit(withHeard(entries, termInput.value, heardInput.value)).then(() => {
    heardInput.value = "";
    termInput.value = "";
    if (source) source.picked = undefined;
    clearPicked();
  });
});

/* ---------- a metade de baixo: a lista ---------- */

function field(value: string, placeholder: string, onChange: (v: string) => void) {
  const input = document.createElement("input");
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.addEventListener("change", () => onChange(input.value));

  return input;
}

function entryRow(entry: Entry, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const term = field(entry.term, "termo", (value) => {
    if (value.trim().length === 0) {
      // Repõe o que estava: apagar o campo destruiria a entrada com todos os
      // `heard` acumulados, sem confirmação e sem desfazer.
      term.value = entry.term;
      say("O termo não pode ficar vazio. Use Remover se quiser apagar a entrada.");

      return;
    }
    void commit(withTermAt(entries, index, value));
  });

  const context = field(entry.context ?? "", "contexto", (value) => {
    void commit(withContextAt(entries, index, value));
  });

  const chips = document.createElement("div");
  chips.className = "chips";
  for (const variant of entry.heard ?? []) {
    const chip = document.createElement("span");
    chip.className = "chip";

    const label = document.createElement("span");
    label.textContent = variant;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.textContent = "×";
    drop.title = `esquecer "${variant}"`;
    drop.addEventListener("click", () => {
      void commit(withoutHeardAt(entries, index, variant));
    });

    chip.append(label, drop);
    chips.append(chip);
  }
  if ((entry.heard ?? []).length === 0) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "só a regra de camelCase";
    chips.append(none);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "Remover";
  // Por POSIÇÃO, não por termo: termo não é chave, e remover por termo
  // apagava todas as entradas homônimas de uma vez.
  remove.addEventListener("click", () => void commit(withoutAt(entries, index)));

  row.append(term, context, chips, remove);

  return row;
}

/** A linha em branco, que só vira entrada quando ganha um termo. */
function draftRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const term = field("", "termo novo", (value) => {
    if (value.trim().length === 0) return;
    void commit([...entries, { term: value }]);
  });

  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "remove";
  discard.textContent = "Descartar";
  discard.addEventListener("click", () => {
    draft = false;
    renderEntries();
  });

  row.append(term, document.createElement("span"), document.createElement("span"), discard);
  queueMicrotask(() => term.focus());

  return row;
}

function renderEntries(): void {
  count.textContent = entries.length > 0 ? `(${entries.length})` : "";
  list.replaceChildren();

  if (entries.length === 0 && !draft) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Nenhum termo ainda. Ensine um a partir do último ditado.";
    list.append(empty);

    return;
  }

  const head = document.createElement("div");
  head.className = "head";
  for (const label of ["termo", "contexto", "como o whisper ouviu", "x"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.append(cell);
  }
  list.append(head, ...entries.map(entryRow));
  if (draft) list.append(draftRow());
}

el<HTMLButtonElement>("add-blank").addEventListener("click", () => {
  draft = true;
  renderEntries();
});

/**
 * Recarrega ao ganhar o foco.
 *
 * A janela fica aberta enquanto você dita — o fluxo é justamente "abro o
 * dicionário, dito, volto para corrigir". Sem isso o cru na tela seria o da
 * ditação anterior, sem nada indicando que está velho, e você clicaria numa
 * palavra do ditado errado.
 *
 * O redesenho do cru só acontece quando ele MUDOU, para uma seleção em curso
 * não se perder a cada vez que a janela recebe foco.
 */
async function reload(): Promise<void> {
  try {
    const { entries: stored, heard } = await window.dictionaryBridge.load();
    entries = stored;
    if (!source || source.heard !== heard) renderHeard(heard);
    renderEntries();
  } catch (error) {
    say(`Não foi possível abrir o dicionário: ${reason(error)}`);
  }
}

window.addEventListener("focus", () => void reload());
void reload();
