import type { Entry } from "./dictionary.js";

/**
 * O que o editor de dicionário faz com as entradas e com o texto cru.
 *
 * Puro de propósito, e é a metade do editor onde bug se esconde: uma
 * seleção de palavras que não remonta o texto original mostra na tela algo
 * diferente do que o Whisper entregou, e uma variante duplicada ou com
 * espaço sobrando vira regra que nunca dispara.
 *
 * O furo que este editor fecha nunca foi digitar a entrada — foi LEMBRAR de
 * cabeça como o Whisper escreveu errado. Com o cru na tela, some.
 */

/** Um pedaço do texto cru: palavra clicável, ou o que vem entre elas. */
export type Token = { text: string; word: boolean };

/** Palavra é letra, número ou sublinhado; o resto separa. */
const WORDS = /[\p{L}\p{N}_]+/gu;

/**
 * Quebra o texto em palavras e separadores.
 *
 * Os separadores ficam na lista, não são descartados: remontar os tokens
 * tem que devolver o texto original, ou a tela mostraria uma versão
 * mutilada do que foi transcrito.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of text.matchAll(WORDS)) {
    if (match.index > cursor) {
      tokens.push({ text: text.slice(cursor, match.index), word: false });
    }
    tokens.push({ text: match[0], word: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) tokens.push({ text: text.slice(cursor), word: false });

  return tokens;
}

/**
 * O trecho entre dois cliques, inclusive.
 *
 * Aceita a seleção ao contrário porque clicar da direita para a esquerda é
 * tão natural quanto o contrário. Termo composto depende disto: "Tia Magno"
 * é duas palavras e um erro só.
 */
export function phraseFrom(tokens: readonly Token[], from: number, to: number): string {
  const start = Math.min(from, to);
  const end = Math.max(from, to);

  if (start < 0 || end >= tokens.length) return "";

  return tokens
    .slice(start, end + 1)
    .map(({ text }) => text)
    .join("");
}

/** Duas variantes com a mesma grafia em minúsculas são a mesma regra. */
function alreadyKnown(entry: Entry, variant: string): boolean {
  const lowered = variant.toLowerCase();

  return (entry.heard ?? []).some((known) => known.toLowerCase() === lowered);
}

/**
 * Por que este par não vira regra — ou `undefined` se virar.
 *
 * Existe para a recusa poder ser DITA. Recusar em silêncio e limpar os
 * campos do mesmo jeito torna sucesso e falha indistinguíveis, que é
 * exatamente o que a seção 10 da spec proíbe.
 */
export function heardRejection(
  entries: readonly Entry[],
  term: string,
  heard: string,
): string | undefined {
  const cleanTerm = term.trim();
  const cleanHeard = heard.trim();

  if (cleanTerm.length === 0) return "Falta dizer qual é a forma correta.";
  if (cleanHeard.length === 0) return "Falta dizer o que o Whisper ouviu.";
  if (cleanTerm.toLowerCase() === cleanHeard.toLowerCase()) {
    return "O ouvido e o correto são o mesmo — isso trocaria a palavra por ela mesma.";
  }

  const existing = entries.find((entry) => entry.term === cleanTerm);
  if (existing && alreadyKnown(existing, cleanHeard)) {
    return `"${cleanHeard}" já está registrado em ${cleanTerm}.`;
  }

  return undefined;
}

/**
 * Registra "ouvi X, era Y", criando a entrada se ela não existir.
 *
 * Recusa em silêncio o que não vira regra útil: vazio, ouvido igual ao
 * termo (trocaria a palavra por ela mesma), e variante já conhecida — a
 * busca é insensível a caixa, então "Alf" e "alf" produzem o mesmo padrão e
 * a segunda nunca dispararia.
 *
 * Devolve arranjo novo. O editor guarda o resultado; mutar o recebido
 * deixaria a tela e o arquivo discordando na primeira falha de gravação.
 */
export function withHeard(
  entries: readonly Entry[],
  term: string,
  heard: string,
): Entry[] {
  const cleanTerm = term.trim();
  const cleanHeard = heard.trim();

  if (cleanTerm.length === 0 || cleanHeard.length === 0) return [...entries];
  if (cleanTerm.toLowerCase() === cleanHeard.toLowerCase()) return [...entries];

  const existing = entries.find((entry) => entry.term === cleanTerm);

  if (!existing) {
    return [...entries, { term: cleanTerm, heard: [cleanHeard] }];
  }

  if (alreadyKnown(existing, cleanHeard)) return [...entries];

  return entries.map((entry) =>
    entry === existing
      ? { ...entry, heard: [...(entry.heard ?? []), cleanHeard] }
      : entry,
  );
}


/**
 * As edições da lista, todas POR POSIÇÃO.
 *
 * Por posição e não por termo porque termo não é chave: dois cliques em
 * "Novo termo" bastavam para criar duas entradas iguais, e remover por termo
 * apagava as duas de uma vez. A lista já indexava por posição ao editar; o
 * conserto é a remoção fazer o mesmo.
 */
function replaceAt(entries: readonly Entry[], index: number, entry: Entry): Entry[] {
  return entries.map((current, position) => (position === index ? entry : current));
}

function inRange(entries: readonly Entry[], index: number): boolean {
  return index >= 0 && index < entries.length;
}

export function withoutAt(entries: readonly Entry[], index: number): Entry[] {
  return inRange(entries, index)
    ? entries.filter((_entry, position) => position !== index)
    : [...entries];
}

/**
 * Troca o termo, recusando apagá-lo.
 *
 * `parseDictionary` descarta entrada sem termo, então gravar vazio faria a
 * linha sumir com todos os `heard` acumulados — sem confirmação e sem
 * desfazer. Um campo que você limpou sem querer não pode custar isso.
 */
export function withTermAt(
  entries: readonly Entry[],
  index: number,
  term: string,
): Entry[] {
  const clean = term.trim();
  const current = entries[index];
  if (!current || clean.length === 0) return [...entries];

  return replaceAt(entries, index, { ...current, term: clean });
}

/** Troca o contexto. Vazio é legítimo aqui: o campo é opcional. */
export function withContextAt(
  entries: readonly Entry[],
  index: number,
  context: string,
): Entry[] {
  const current = entries[index];
  if (!current) return [...entries];

  const clean = context.trim();
  const { context: _dropped, ...rest } = current;

  return replaceAt(entries, index, clean.length === 0 ? rest : { ...rest, context: clean });
}

/** Esquece uma variante de uma entrada. */
export function withoutHeardAt(
  entries: readonly Entry[],
  index: number,
  variant: string,
): Entry[] {
  const current = entries[index];
  if (!current) return [...entries];

  const kept = (current.heard ?? []).filter((known) => known !== variant);
  const { heard: _dropped, ...rest } = current;

  return replaceAt(entries, index, kept.length > 0 ? { ...rest, heard: kept } : rest);
}
