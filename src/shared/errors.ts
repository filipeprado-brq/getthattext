/**
 * A mensagem de um erro, sem o "Error:" que o `String(error)` empilha.
 *
 * Puro e em `shared/` porque as duas janelas mostram falha na tela e as duas
 * precisavam da mesma coisa — e prosa duplicada diverge como código
 * duplicado.
 */
/**
 * O Electron embrulha toda rejeição de `ipcRenderer.invoke` assim, e o
 * embrulho chega inteiro à tela: "Error invoking remote method
 * 'onboarding-download': Error: Não foi possível falar com…". O nome do
 * canal é diagnóstico de quem escreve o app, não recado de quem usa.
 */
const IPC_WRAPPER = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

export function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.replace(IPC_WRAPPER, "");
}
