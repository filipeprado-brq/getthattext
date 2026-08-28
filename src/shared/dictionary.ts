/**
 * O dicionário de termos e a substituição determinística.
 *
 * Roda ANTES do Groq. Na ordem contrária ela desfaria escolhas boas do LLM:
 * o modelo reescreve a frase inteira, e trocar palavras depois disso
 * quebraria concordância que ele acabou de acertar.
 *
 * Puro de propósito. É onde uma fronteira de palavra errada come pedaço de
 * outra palavra, um metacaractere não escapado vira coringa, e um arquivo
 * malformado derruba a ditação — três coisas invisíveis em revisão.
 *
 * Dimensionamento medido no corpus: 10 a 30 entradas, não 500. O Whisper
 * erra de forma estreita e sistemática.
 */

export type Entry = {
  /** Como o termo deve sair. É isto que vai para o texto. */
  term: string;
  /**
   * Como o Whisper errou.
   *
   * Opcional de propósito: você não sabe de antemão como ele vai errar
   * "shadcn" — descobre errando. O #8 popula isto a partir do último ditado.
   */
  heard?: string[];
  /** Para o Groq saber o que o termo é. Não afeta a substituição. */
  context?: string;
};

/**
 * As formas faladas que dá para DERIVAR do termo, sem o usuário declarar.
 *
 * Só camelCase, e por medição: no corpus ele quebrou 3 de 3 — `dateFormat`
 * virou "date format", `useMenu` virou "use menu". Sendo sistemático, vira
 * regra; uma regra cobre infinitos identificadores que uma lista nunca
 * cobriria.
 *
 * `auth` → `alf` e `Danger` → `dungeon` erram por som, não por composição:
 * esses precisam de `heard`, e nenhuma regra os alcançaria.
 */
export function spokenForms(term: string): string[] {
  const spaced = term
    // dateFormat → date Format
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    // getHTTPResponse → get HTTP Response
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .toLowerCase();

  return spaced === term.toLowerCase() ? [] : [spaced];
}

/** Metacaracteres de regex, para o termo ser buscado literalmente. */
function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fronteira de palavra ciente de acento.
 *
 * `\b` do JavaScript é ASCII, e em português a fronteira cai ao lado de
 * letra acentuada o tempo todo.
 */
const WORD_BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_])";
const WORD_BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";

/** É caractere que a fronteira de palavra separa? */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

/**
 * Cerca o padrão com fronteira de palavra, mas SÓ onde ela faz sentido.
 *
 * A fronteira existe para `auth` não casar dentro de `author`. Exigi-la
 * sempre desliga padrões que começam ou terminam em pontuação: `->` nunca
 * casaria em `a->b`, e `/me` nunca casaria depois de uma palavra — que são
 * exatamente os endpoints e operadores que este app existe para preservar.
 *
 * A regra é a borda do PADRÃO, não a do texto: onde o padrão termina em
 * letra, o texto não pode continuar com letra.
 */
function bounded(pattern: string): string {
  const before = isWordCharacter(pattern[0]) ? WORD_BOUNDARY_BEFORE : "";
  const after = isWordCharacter(pattern.at(-1)) ? WORD_BOUNDARY_AFTER : "";

  return `${before}${escapeForRegex(pattern)}${after}`;
}

/** Tudo que, encontrado no texto, vira este termo. */
function patternsFor(entry: Entry): string[] {
  return [entry.term, ...(entry.heard ?? []), ...spokenForms(entry.term)];
}

/**
 * Aplica o dicionário ao texto transcrito.
 *
 * Passada ÚNICA, com todas as alternativas num regex só. Isso garante que o
 * que acabou de ser trocado não seja reprocessado — uma entrada que produz
 * o gatilho de outra causaria substituição em cascata.
 *
 * As alternativas vão da mais longa para a mais curta, não na ordem do
 * arquivo. Sem isso `auth` casaria dentro de "auth service" e deixaria o
 * resto pendurado; a ordem do arquivo continua valendo como desempate.
 */
export function applyDictionary(text: string, entries: readonly Entry[]): string {
  const alternatives = entries
    .flatMap((entry) => patternsFor(entry).map((pattern) => ({ pattern, entry })))
    .filter(({ pattern }) => pattern.length > 0)
    .sort((a, b) => b.pattern.length - a.pattern.length);

  if (alternatives.length === 0) return text;

  // Primeira entrada vence. Duas podem produzir o mesmo padrão em
  // minúsculas — `auth` e `AUTH`, ou `dateFormat` e `DateFormat` via a
  // regra de camelCase — e sem isto a última sequestraria a correção da
  // primeira, sem nada avisar.
  const byPattern = new Map<string, string>();
  for (const { pattern, entry } of alternatives) {
    const key = pattern.toLowerCase();
    if (!byPattern.has(key)) byPattern.set(key, entry.term);
  }

  const matcher = new RegExp(
    `(${alternatives.map(({ pattern }) => bounded(pattern)).join("|")})`,
    "giu",
  );

  return text.replace(matcher, (match) => byPattern.get(match.toLowerCase()) ?? match);
}

/** Uma entrada só é útil se disser como o termo se escreve. */
function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;

  // Só o `term` é essencial. `heard` e `context` malformados são
  // descartados na hora de montar a entrada, sem levar o termo junto:
  // perder a correção inteira por causa de um campo opcional errado seria
  // pagar caro demais por um erro de digitação no arquivo.
  return typeof candidate["term"] === "string" && candidate["term"].trim().length > 0;
}

/**
 * Lê o dicionário, descartando o que não dá para usar.
 *
 * Nada aqui pode derrubar uma ditação: sem arquivo, JSON quebrado, ou
 * entrada com o tipo errado, o resultado é um dicionário menor. O pior
 * desfecho é um termo sair errado, que é o estado anterior a este ticket.
 *
 * Descarta a entrada ruim, não o arquivo: uma linha editada à mão com erro
 * não pode custar as outras 29.
 */
export function parseDictionary(text: string | undefined): Entry[] {
  if (text === undefined) return [];

  try {
    return normalizeEntries(JSON.parse(text));
  } catch {
    return [];
  }
}

/**
 * Reduz qualquer valor a entradas utilizáveis.
 *
 * Separado do parse porque o arquivo não é a única fronteira: o editor
 * manda entradas pelo IPC, e o repo valida em toda fronteira em vez de
 * confiar no tipo declarado.
 */
export function normalizeEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isEntry).map(({ term, heard, context }) => {
    // Aparar não é capricho: a fronteira de palavra exige não-letra dos dois
    // lados, então " alf " com espaço sobrando nunca casaria — e o modo de
    // falha seria a correção simplesmente não acontecer, sem aviso. É o erro
    // clássico de arquivo editado à mão.
    const variants = Array.isArray(heard)
      ? heard
          .filter((variant): variant is string => typeof variant === "string")
          .map((variant) => variant.trim())
          .filter((variant) => variant.length > 0)
      : [];

    return {
      term: term.trim(),
      ...(variants.length > 0 ? { heard: variants } : {}),
      ...(typeof context === "string" ? { context } : {}),
    };
  });
}

/**
 * A lista de termos para o prompt do Groq.
 *
 * A substituição já colocou os termos certos no texto; isto impede o modelo
 * de "consertá-los" de volta. As travas do prompt protegem nomes de arquivo
 * e siglas em geral, mas não sabem que `useMenu` é um identificador e não
 * um erro de digitação.
 *
 * Quem monta o prompt final é `systemPromptFor`, em `rewrite.ts`.
 *
 * Esta é a explicação canônica da lista de termos; os outros pontos do
 * caminho apontam para cá em vez de repeti-la.
 */
export function termsForPrompt(entries: readonly Entry[], text: string): string {
  // Só os termos que de fato aparecem. O bloco afirma "já corretos no
  // texto": listar termo ausente é dizer ao modelo algo que não é verdade,
  // logo abaixo de uma trava que proíbe acrescentar o que não está lá. E
  // ainda gasta tokens de um orçamento de 8.000 por minuto.
  const present = entries.filter(({ term }) =>
    new RegExp(bounded(term), "iu").test(text),
  );

  if (present.length === 0) return "";

  const lines = present.map(({ term, context }) =>
    context ? `- ${term} (${context})` : `- ${term}`,
  );

  return [
    "TERMOS DESTE USUÁRIO, já corretos no texto — mantenha exatamente assim:",
    ...lines,
  ].join("\n");
}
