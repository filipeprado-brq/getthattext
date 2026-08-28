import { dialog, globalShortcut, powerMonitor } from "electron";
import { SHORTCUT_ACCELERATOR, SHORTCUT_LABEL } from "../shared/shortcut";

/**
 * Mantém `⌃⌥⌘G` registrado, inclusive depois que o Mac dorme.
 *
 * MEDIDO, e o resultado contraria o que o ticket assumiu: no macOS 15 com
 * Electron 41.7.1, `register` devolve `true` para TUDO. Testado com outro
 * processo segurando a mesma combinação (`true` nos dois), e com hotkeys do
 * próprio sistema — `⌘Space` do Spotlight, `⌘Tab`, `⇧⌘3`, `⌘⌥Esc`: todas
 * `true`. `isRegistered` também só enxerga o que ESTE app registrou.
 *
 * Duas consequências, e as duas moldaram este módulo:
 *
 * 1. O ramo de falha NÃO é detector de conflito, porque conflito não chega
 *    nele. É rede para o que `register` de fato recusa — accelerator
 *    inválido, outra plataforma, outra versão do Electron. Por isso a
 *    mensagem não acusa outro aplicativo: seria afirmar o que não se sabe.
 *
 * 2. O re-registro não pode consultar `isRegistered` para decidir se age.
 *    O cenário do ticket é justamente aquele em que o Electron ainda acha
 *    que registrou e o macOS já soltou a hotkey — ali `isRegistered` diz
 *    `true` e pular o registro deixaria o atalho morto para sempre.
 *
 * O buraco continua aberto: um atalho tomado por outro app registra "com
 * sucesso" e simplesmente não dispara, que é indistinguível de você não ter
 * apertado. Detectar isso de verdade precisa de outro mecanismo — um "teste
 * seu atalho" nas preferências, que confirma o recebimento. É do #9.
 */

/**
 * `register` aceitou o atalho?
 *
 * O nome é o que o dado é: aceitação do registro, não garantia de que a
 * tecla chega. Pela medição acima, as duas coisas não são a mesma.
 */
let registered = false;

export function isShortcutRegistered(): boolean {
  return registered;
}

/**
 * Registra do zero, sempre.
 *
 * `unregister` antes de `register` é o que torna o re-registro real: sem
 * ele o Electron acha que já está feito e não toca no lado nativo.
 * Desregistrar o que não está registrado é no-op.
 */
function register(onTrigger: () => void): void {
  globalShortcut.unregister(SHORTCUT_ACCELERATOR);
  registered = globalShortcut.register(SHORTCUT_ACCELERATOR, onTrigger);

  if (!registered) {
    console.error(`o atalho ${SHORTCUT_LABEL} não pôde ser registrado`);
  }
}

/**
 * Registra agora e a cada vez que o Mac volta.
 *
 * O atalho se perde depois que a máquina dorme, e a alternativa a
 * re-registrar é impossível de diagnosticar: um atalho que não chega é
 * indistinguível de um atalho que não foi apertado.
 */
export function keepShortcutRegistered(onTrigger: () => void): void {
  register(onTrigger);

  powerMonitor.on("resume", () => register(onTrigger));
  powerMonitor.on("unlock-screen", () => register(onTrigger));
  powerMonitor.on("user-did-become-active", () => register(onTrigger));
}

/**
 * Avisa, uma vez, que o atalho não entrou.
 *
 * Separado do registro porque o `showErrorBox` é modal e bloqueia: chamá-lo
 * de dentro de um handler do `powerMonitor` travaria o acordar do app.
 */
export function warnIfShortcutMissing(): void {
  if (registered) return;

  dialog.showErrorBox(
    `Não foi possível registrar o atalho ${SHORTCUT_LABEL}`,
    `O atalho global do getthattext não vai funcionar nesta sessão. O ` +
      "clique no ícone da barra de menu continua funcionando normalmente.\n\n" +
      "Escolher outra combinação será possível nas preferências.",
  );
}

/** Solta o atalho na saída, para não deixá-lo pendurado no sistema. */
export function releaseShortcut(): void {
  globalShortcut.unregisterAll();
}
