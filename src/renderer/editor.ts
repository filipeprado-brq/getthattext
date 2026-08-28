import { spokenForms, type Entry } from "../shared/dictionary.js";
import { reason } from "../shared/errors.js";
import { el, sayInto } from "./dom.js";
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
 *
 * A barra do meio só existe QUANDO há seleção. Antes eram dois campos
 * vazios esperando digitação, e o furo que esta janela fecha nunca foi
 * digitar a entrada — foi lembrar de cabeça como o Whisper escreveu errado.
 * Com o cru na tela e o campo já preenchido pelo clique, some.
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

const learn = el<HTMLFormElement>("learn");
const heardText = el("heard-text");
const when = el("when");
const status = el("status");
const list = el("list");
const count = el("count");
const say = sayInto(status);

function fail(message: string): void {
  status.className = "bad";
  say(message);
}

function clear(): void {
  status.className = "";
  say("");
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
    clear();
  } catch (error) {
    fail(`Não foi possível gravar: ${reason(error)}`);
  }

  renderEntries();
}

/* ---------- a metade de cima: aprender do último ditado ---------- */

function renderHeard(heard: string | undefined): void {
  if (heard === undefined) {
    source = { heard: undefined, tokens: [] };
    when.textContent = "";
    heardText.classList.add("empty");
    heardText.textContent = "Nenhuma ditação nesta sessão.";
    renderLearn();

    return;
  }

  source = { heard, tokens: tokenize(heard) };
  when.textContent = "último ditado";
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
  renderLearn();
}

/** O trecho entre os dois cliques, já pronto para virar `heard`. */
function pickedPhrase(): string {
  if (!source?.picked) return "";

  const { anchor, extent } = source.picked;

  return phraseFrom(source.tokens, Math.min(anchor, extent), Math.max(anchor, extent));
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

  paintPicked();
  renderLearn();
}

function paintPicked(): void {
  const picked = source?.picked;
  const from = picked ? Math.min(picked.anchor, picked.extent) : -1;
  const to = picked ? Math.max(picked.anchor, picked.extent) : -1;

  heardText.childNodes.forEach((node, position) => {
    if (!(node instanceof HTMLElement)) return;
    node.classList.toggle("picked", position >= from && position <= to);
  });
}

function unpick(): void {
  if (source) source.picked = undefined;
  paintPicked();
  renderLearn();
}

/** A barra: calada sem seleção, e já preenchida com ela. */
function renderLearn(): void {
  const phrase = pickedPhrase();
  learn.classList.toggle("armed", phrase.length > 0);

  if (phrase.length === 0) {
    const idle = document.createElement("span");
    idle.className = "idle";
    idle.textContent =
      source?.heard === undefined
        ? "Dite uma vez e volte: é do texto cru que as entradas saem."
        : "Clique numa palavra acima para começar uma entrada.";
    learn.replaceChildren(idle);

    return;
  }

  const heard = document.createElement("span");
  heard.className = "picked-phrase";
  heard.textContent = phrase;
  heard.title = phrase;

  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");

  const term = document.createElement("input");
  term.id = "term";
  term.placeholder = "como se escreve";
  term.spellcheck = false;
  term.autocomplete = "off";
  term.setAttribute("aria-label", "forma correta");

  const add = document.createElement("button");
  add.type = "submit";
  add.className = "primary";
  add.textContent = "Adicionar";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "quiet";
  cancel.textContent = "Limpar";
  cancel.addEventListener("click", unpick);

  learn.replaceChildren(heard, arrow, term, add, cancel);
  term.focus();
}

learn.addEventListener("submit", (event) => {
  event.preventDefault();

  const term = learn.querySelector<HTMLInputElement>("#term");
  const phrase = pickedPhrase();
  if (!term || phrase.length === 0) return;

  const rejection = heardRejection(entries, term.value, phrase);
  if (rejection !== undefined) {
    fail(rejection);

    return;
  }

  void commit(withHeard(entries, term.value, phrase)).then(unpick);
});

/* ---------- a metade de baixo: a lista ---------- */

function field(
  value: string,
  placeholder: string,
  className: string,
  onChange: (value: string) => void,
): HTMLInputElement {
  const input = document.createElement("input");
  input.value = value;
  input.className = className;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.addEventListener("change", () => onChange(input.value));

  return input;
}

/** Uma variante: removível quando você a ensinou, fixa quando é regra. */
function chip(variant: string, onDrop?: () => void): HTMLElement {
  const chip = document.createElement("span");
  chip.className = onDrop ? "chip" : "chip auto";

  const label = document.createElement("span");
  label.textContent = variant;
  chip.append(label);

  if (onDrop) {
    const drop = document.createElement("button");
    drop.type = "button";
    drop.textContent = "×";
    drop.title = `esquecer "${variant}"`;
    drop.addEventListener("click", onDrop);
    chip.append(drop);
  } else {
    chip.title = "Derivada do camelCase — o app deduz sozinho.";
  }

  return chip;
}

function entryRow(entry: Entry, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const term = field(entry.term, "termo", "term", (value) => {
    if (value.trim().length === 0) {
      // Repõe o que estava: apagar o campo destruiria a entrada com todos os
      // `heard` acumulados, sem confirmação e sem desfazer.
      term.value = entry.term;
      fail("O termo não pode ficar vazio. Use o × se quiser apagar a entrada.");

      return;
    }
    void commit(withTermAt(entries, index, value));
  });

  const chips = document.createElement("div");
  chips.className = "chips";
  for (const variant of entry.heard ?? []) {
    chips.append(chip(variant, () => void commit(withoutHeardAt(entries, index, variant))));
  }
  // A derivada aparece marcada e sem ×: ela vem da regra, não da sua mão, e
  // "sem variante" numa entrada que casa com "date format" seria mentira.
  for (const derived of spokenForms(entry.term)) chips.append(chip(derived));
  if ((entry.heard ?? []).length === 0 && spokenForms(entry.term).length === 0) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "sem variante";
    chips.append(none);
  }

  const context = field(entry.context ?? "", "para o LLM", "context", (value) => {
    void commit(withContextAt(entries, index, value));
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.setAttribute("aria-label", `Remover ${entry.term}`);
  remove.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // Por POSIÇÃO, não por termo: termo não é chave, e remover por termo
  // apagava todas as entradas homônimas de uma vez.
  remove.addEventListener("click", () => void commit(withoutAt(entries, index)));

  row.append(term, chips, context, remove);

  return row;
}

/** A linha em branco, que só vira entrada quando ganha um termo. */
function draftRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const term = field("", "termo novo", "term", (value) => {
    if (value.trim().length === 0) return;
    void commit([...entries, { term: value }]);
  });

  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "remove";
  discard.setAttribute("aria-label", "Descartar a linha nova");
  discard.textContent = "×";
  discard.addEventListener("click", () => {
    draft = false;
    renderEntries();
  });

  row.append(
    term,
    document.createElement("span"),
    document.createElement("span"),
    discard,
  );
  queueMicrotask(() => term.focus());

  return row;
}

function renderEntries(): void {
  count.textContent = entries.length > 0 ? `${entries.length} no dicionário` : "";

  if (entries.length === 0 && !draft) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Nenhum termo ainda. Ensine um a partir do último ditado.";
    list.replaceChildren(empty);

    return;
  }

  list.replaceChildren(...entries.map(entryRow));
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
    fail(`Não foi possível abrir o dicionário: ${reason(error)}`);
  }
}

window.addEventListener("focus", () => void reload());
void reload();
