import { app } from "electron";
import type { LoginItemState } from "../shared/bridge";

/**
 * "Abrir no login", lido do sistema em vez de guardado.
 *
 * O estado NÃO vai para o arquivo de preferências de propósito: o macOS é a
 * fonte da verdade, e guardar uma cópia criaria duas — que discordariam no
 * dia em que você mexesse pelo painel do sistema.
 *
 * Devolve o `status` cru, com os quatro valores, em vez de dois booleanos.
 * A armadilha que a spec (seção 11) avisa é justamente que `register()` pode
 * ter sucesso e ainda devolver `requires-approval`: um checkbox ligado só a
 * `openAtLogin` marca sozinho e MENTE. Reduzir para "ligado/desligado" aqui
 * jogaria fora exatamente a informação que impede a mentira.
 */
export function loginItem(): LoginItemState {
  return { status: app.getLoginItemSettings().status };
}

/** Liga ou desliga, e devolve o que o sistema DE FATO ficou. */
export function setLoginItem(enabled: boolean): LoginItemState {
  app.setLoginItemSettings({ openAtLogin: enabled });

  return loginItem();
}
