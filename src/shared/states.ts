/**
 * A máquina de estados da ditação, como dado.
 *
 * Puro e em `shared` por uma razão concreta: isto já foi quatro tabelas
 * paralelas, elas saíram de sincronia, e o app passou a ficar PRESO no
 * estado de erro — o clique não o aceitava mais e o tooltip prometia o
 * contrário. Como dado num lugar só, o invariante que faltava vira teste.
 */
import type { IconState } from "./trayIcon";

/** Estados que o app assume durante uma ditação. */
export type State =
  | "idle"
  | "opening"
  | "recording"
  | "processing"
  | "done"
  | "raw"
  | "unguarded"
  | "interrupted"
  | "empty"
  | "failed";

/** O que cada estado determina na interface. */
export type Presentation = {
  icon: IconState;
  tooltip: string;
  /** Fecha o ciclo com som. */
  chime?: true;
  /** Volta a ocioso sozinho depois de `TERMINAL_MS`. */
  fades?: true;
  /** O que um clique faz aqui. */
  click: "start" | "stop" | "ignore";
};

/**
 * A spec (seção 7) tem sete desenhos e o app tem nove estados, então dois
 * compartilham:
 *
 * `empty` usa o ícone de ocioso porque é isso que a spec manda — gravação
 * sem fala "volta a ocioso EM SILÊNCIO". O estado continua distinto por
 * dentro, que é o que a seção 10 exige ao separar "vazio" de "falhou".
 *
 * `unguarded` usa o ícone de erro, não o check vazado. O check vazado
 * significa "o clipboard tem o CRU", e em `unguarded` a reescrita deu certo
 * — dizer cru ali seria mentir sobre o que você vai colar. A seção 10 já
 * trata o caso análogo, o device de áudio trocando no meio, como "variante
 * de erro no ícone, nunca descarta". Diferente de `failed`, ele some
 * sozinho: o texto está lá, e o que está quebrado é a instalação.
 */
export const PRESENTATION: Record<State, Presentation> = {
  idle: { icon: "idle", tooltip: "clique para ditar", click: "start" },
  opening: { icon: "opening", tooltip: "abrindo o microfone…", click: "stop" },
  recording: { icon: "recording", tooltip: "gravando", click: "stop" },
  // "Processando" é um estado só: transcrever e reescrever somam ~2 s e você
  // não faz nada diferente sabendo em qual está. O tooltip não pode nomear
  // um dos dois, ou passa a mentir durante o outro.
  processing: { icon: "processing", tooltip: "processando…", click: "ignore" },
  done: { icon: "ready", tooltip: "copiado", chime: true, fades: true, click: "start" },
  raw: {
    icon: "ready-raw",
    tooltip: "copiado — texto cru, a reescrita falhou",
    chime: true,
    fades: true,
    click: "start",
  },
  unguarded: {
    icon: "error",
    tooltip: "copiado — o portão de fala não rodou",
    chime: true,
    fades: true,
    click: "start",
  },
  // O microfone caiu no meio. O texto ESTÁ no clipboard — a spec manda
  // transcrever o que capturou e nunca descartar — mas com ressalva, porque
  // o que você falou depois da queda não entrou.
  interrupted: {
    icon: "error",
    tooltip: "copiado — o microfone caiu no meio da gravação",
    chime: true,
    fades: true,
    click: "start",
  },
  empty: { icon: "idle", tooltip: "nada foi ouvido", fades: true, click: "start" },
  // Sem `fades`: a spec manda o erro PERSISTIR até o clique. Um erro que
  // some sozinho depois de 2 s é um erro que você perde quando estava
  // olhando para outro lugar — e aí o texto se perdeu sem você saber.
  failed: {
    icon: "error",
    tooltip: "falhou — clique para tentar de novo",
    click: "start",
  },
};
