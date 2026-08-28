/**
 * As preferências do app, e como ler o arquivo delas sem confiar nele.
 *
 * Puro de propósito: o parse é onde um arquivo editado à mão, truncado por
 * disco cheio ou escrito por outra versão do app vira comportamento errado
 * em silêncio.
 *
 * O #9 é dono da interface de preferências e vai acrescentar chaves aqui.
 */

export type Preferences = {
  /**
   * O blip ao terminar.
   *
   * Ligado por padrão: é o que fecha o ciclo, porque no momento em que o
   * texto fica pronto seu olhar está no input onde vai colar, não na barra
   * de menu.
   */
  sound: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = { sound: true };

/**
 * Lê o arquivo de preferências, caindo no padrão a cada dúvida.
 *
 * Nenhuma entrada ruim pode derrubar o app: sem arquivo, JSON quebrado, ou
 * valor com o tipo errado, tudo vira o padrão. O pior desfecho possível é
 * uma preferência voltar ao default, e isso é visível e corrigível.
 *
 * Chaves desconhecidas são PRESERVADAS. O #9 vai acrescentar preferências,
 * e reescrever o arquivo sem o que não se reconhece apagaria configuração
 * de outra versão do app.
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
    // `sound: "false"` é string, e string não-vazia é truthy: deixar passar
    // ligaria o som de quem pediu para desligar.
    sound: typeof stored["sound"] === "boolean" ? stored["sound"] : DEFAULT_PREFERENCES.sound,
  };
}
