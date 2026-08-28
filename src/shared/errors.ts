/**
 * A mensagem de um erro, sem o "Error:" que o `String(error)` empilha.
 *
 * Puro e em `shared/` porque as duas janelas mostram falha na tela e as duas
 * precisavam da mesma coisa — e prosa duplicada diverge como código
 * duplicado.
 */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
