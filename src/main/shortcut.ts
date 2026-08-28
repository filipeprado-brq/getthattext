import { dialog, globalShortcut, powerMonitor } from "electron";
import { acceleratorToSymbols } from "../shared/shortcut";
import type { ShortcutTest } from "../shared/bridge";
import { preferences } from "./preferences";

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
/**
 * O que está registrado AGORA, que pode diferir do que as preferências
 * pedem — entre uma troca na tela e o re-registro, ou quando o registro
 * falha. Os dois campos mudam sempre juntos.
 */
let active: { accelerator: string; registered: boolean } | undefined;

export function isShortcutRegistered(): boolean {
  return active?.registered === true;
}

/** O atalho efetivamente registrado, para a interface não anunciar o que não vale. */
export function registeredShortcut(): string | undefined {
  return active?.registered === true ? active.accelerator : undefined;
}

/** O atalho em vigor, na sintaxe do Electron. */
export function currentShortcut(): string {
  return preferences().shortcut;
}

/** O que o atalho faz normalmente: ditar. */
let trigger: (() => void) | undefined;

/**
 * Quem está esperando o atalho para CONFERIR que ele chega.
 *
 * Existe porque `register` nunca devolve `false` neste sistema — medido — e
 * a única verificação honesta é você apertar a tecla e o app dizer que
 * recebeu. Enquanto isso está armado, o atalho não inicia uma ditação: você
 * está testando, não ditando.
 */
let listener:
  | { settle: (result: ShortcutTest) => void; timer: ReturnType<typeof setTimeout> }
  | undefined;

function settle(result: ShortcutTest): void {
  if (!listener) return;

  const { settle: resolve, timer } = listener;
  listener = undefined;
  clearTimeout(timer);
  resolve(result);
}

function fire(): void {
  if (listener) {
    settle("arrived");

    return;
  }

  trigger?.();
}

/** Quanto tempo o teste espera antes de desistir. */
const TEST_WINDOW_MS = 10_000;

/**
 * Espera o atalho chegar.
 *
 * SEMPRE resolve: chegou, estourou o tempo, ou foi cancelado. Abandonar o
 * anterior sem resolver deixaria o `invoke` do renderer pendurado para
 * sempre — bastava clicar "Testar" duas vezes.
 */
export function armShortcutTest(): Promise<ShortcutTest> {
  cancelShortcutTest();

  return new Promise<ShortcutTest>((resolve) => {
    listener = {
      settle: resolve,
      timer: setTimeout(() => settle("timeout"), TEST_WINDOW_MS),
    };
  });
}

export function cancelShortcutTest(): void {
  settle("cancelled");
}

/**
 * Registra do zero, sempre.
 *
 * `unregister` antes de `register` é o que torna o re-registro real: sem
 * ele o Electron acha que já está feito e não toca no lado nativo.
 * Desregistrar o que não está registrado é no-op.
 */
function register(onTrigger: () => void): void {
  // Solta o que estava registrado ANTES, não o que as preferências pedem
  // agora: trocar o atalho na tela deixaria o antigo pendurado no sistema.
  if (active) globalShortcut.unregister(active.accelerator);

  const accelerator = currentShortcut();
  globalShortcut.unregister(accelerator);
  active = { accelerator, registered: globalShortcut.register(accelerator, onTrigger) };

  if (!active.registered) {
    console.error(`o atalho ${acceleratorToSymbols(accelerator)} não pôde ser registrado`);
  }
}

/**
 * Registra agora e a cada vez que o Mac volta.
 *
 * O atalho se perde depois que a máquina dorme, e a alternativa a
 * re-registrar é impossível de diagnosticar: um atalho que não chega é
 * indistinguível de um atalho que não foi apertado.
 */
/** Reaplica o atalho depois que ele muda nas preferências. */
export function reapplyShortcut(): void {
  register(fire);
}

export function keepShortcutRegistered(onTrigger: () => void): void {
  trigger = onTrigger;
  register(fire);

  powerMonitor.on("resume", () => register(fire));
  powerMonitor.on("unlock-screen", () => register(fire));
  powerMonitor.on("user-did-become-active", () => register(fire));
}

/**
 * Avisa, uma vez, que o atalho não entrou.
 *
 * Separado do registro porque o `showErrorBox` é modal e bloqueia: chamá-lo
 * de dentro de um handler do `powerMonitor` travaria o acordar do app.
 */
export function warnIfShortcutMissing(): void {
  if (isShortcutRegistered()) return;

  dialog.showErrorBox(
    `Não foi possível registrar o atalho ${acceleratorToSymbols(currentShortcut())}`,
    `O atalho global do getthattext não vai funcionar nesta sessão. O ` +
      "clique no ícone da barra de menu continua funcionando normalmente.\n\n" +
      "Escolher outra combinação será possível nas preferências.",
  );
}

/** Solta o atalho na saída, para não deixá-lo pendurado no sistema. */
export function releaseShortcut(): void {
  globalShortcut.unregisterAll();
}
