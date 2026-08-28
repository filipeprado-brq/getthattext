import { isValidAccelerator, SHORTCUT_ACCELERATOR } from "./shortcut.js";

/**
 * As preferências do app, e como ler o arquivo delas sem confiar nele.
 *
 * Puro de propósito: o parse é onde um arquivo editado à mão, truncado por
 * disco cheio ou escrito por outra versão do app vira comportamento errado
 * em silêncio.
 *
 * "Abrir no login" NÃO mora aqui. O sistema é a fonte da verdade daquilo, e
 * guardar uma cópia criaria duas — que discordariam no dia em que você
 * mexesse pelo painel do macOS.
 */

/** Os idiomas oferecidos na tela. O whisper aceita mais; estes são os úteis. */
export const LANGUAGES = [
  { code: "pt", label: "Português" },
  { code: "en", label: "Inglês" },
  { code: "es", label: "Espanhol" },
  { code: "fr", label: "Francês" },
  { code: "de", label: "Alemão" },
  { code: "it", label: "Italiano" },
  // Questão aberta declarada na seção 13 da spec: nunca foi testado, e o
  // corpus inteiro rodou com o idioma forçado.
  { code: "auto", label: "Detectar (não testado)" },
] as const;

export type Preferences = {
  /**
   * O blip ao terminar.
   *
   * Ligado por padrão: é o que fecha o ciclo, porque no momento em que o
   * texto fica pronto seu olhar está no input onde vai colar, não na barra
   * de menu.
   */
  sound: boolean;
  /**
   * Passar o texto pelo Groq.
   *
   * Ligado por padrão. Desligar quando o texto não pode ser alterado:
   * citação literal, trecho contratual, nome que precisa sair exato.
   */
  rewrite: boolean;
  /** O atalho global, em sintaxe de accelerator do Electron. */
  shortcut: string;
  /** Código de idioma passado ao whisper, ou `auto`. */
  language: string;
  /** Nome do arquivo do modelo, dentro da pasta de modelos. */
  model: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  sound: true,
  rewrite: true,
  shortcut: SHORTCUT_ACCELERATOR,
  language: "pt",
  model: "ggml-large-v3-turbo-q5_0.bin",
};

/** Fica com o valor gravado só se ele for do tipo certo. */
function pick<K extends keyof Preferences>(
  stored: Record<string, unknown>,
  key: K,
  accept: (value: unknown) => boolean,
): Preferences[K] {
  return accept(stored[key])
    ? (stored[key] as Preferences[K])
    : DEFAULT_PREFERENCES[key];
}

const isBoolean = (value: unknown): boolean => typeof value === "boolean";

/**
 * Lê o arquivo de preferências, caindo no padrão a cada dúvida.
 *
 * CAMPO A CAMPO, não o arquivo inteiro: um idioma com typo não pode custar
 * o atalho que você configurou. Chaves desconhecidas são preservadas —
 * reescrever o arquivo sem elas apagaria configuração de outra versão.
 */
export function parsePreferences(text: string | undefined): Preferences {
  if (text === undefined) return { ...DEFAULT_PREFERENCES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_PREFERENCES };
  }

  const stored = parsed as Record<string, unknown>;

  return {
    ...stored,
    sound: pick(stored, "sound", isBoolean),
    rewrite: pick(stored, "rewrite", isBoolean),
    shortcut: pick(
      stored,
      "shortcut",
      (value) => typeof value === "string" && isValidAccelerator(value),
    ),
    language: pick(
      stored,
      "language",
      (value) => LANGUAGES.some((language) => language.code === value),
    ),
    model: pick(
      stored,
      "model",
      (value) => typeof value === "string" && value.length > 0,
    ),
  };
}
