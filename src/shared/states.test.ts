import { describe, expect, it } from "vitest";
import { PRESENTATION, type State } from "./states";

const STATES = Object.keys(PRESENTATION) as State[];

describe("PRESENTATION", () => {
  it("nenhum estado fica sem saída, exceto 'processando'", () => {
    // O INVARIANTE QUE FALTAVA, e que teria pego o bug: um estado sem
    // `fades` fica na tela até alguém agir, e se ele também ignora o clique,
    // o app trava ali para sempre. Foi o que aconteceu quando `failed` saiu
    // do auto-retorno e ninguém ensinou o clique a aceitá-lo.
    //
    // "Processando" é a exceção legítima: ele sai por trabalho terminando,
    // quando o handler de áudio o substitui pelo resultado. É o único assim,
    // e é por isso que a exceção é nominal em vez de uma flag na tabela.
    const trapped = STATES.filter(
      (state) =>
        state !== "processing" &&
        !PRESENTATION[state].fades &&
        PRESENTATION[state].click === "ignore",
    );

    expect(trapped).toEqual([]);
  });

  it("o erro persiste até o clique, e o clique tira dele", () => {
    expect(PRESENTATION.failed.fades).toBeUndefined();
    expect(PRESENTATION.failed.click).toBe("start");
  });

  it("só 'processando' engole o clique, e ele some sozinho", () => {
    const ignoring = STATES.filter((s) => PRESENTATION[s].click === "ignore");
    expect(ignoring).toEqual(["processing"]);
  });

  it("todo estado tem tooltip, e nenhum é vazio", () => {
    for (const state of STATES) {
      expect(PRESENTATION[state].tooltip.length).toBeGreaterThan(0);
    }
  });

  it("o som toca em TODO estado que põe texto no clipboard, e só neles", () => {
    // A regra é essa, não a lista: "vazio" volta a ocioso em silêncio, e um
    // som de sucesso numa falha ensinaria a ignorar o som. Os quatro que
    // tocam entregaram texto — dois deles com ressalva, mas entregaram.
    const chiming = STATES.filter((s) => PRESENTATION[s].chime).sort();
    expect(chiming).toEqual(["done", "interrupted", "raw", "unguarded"]);

    for (const silent of ["idle", "opening", "recording", "processing", "empty", "failed"] as const) {
      expect(PRESENTATION[silent].chime).toBeUndefined();
    }
  });

  it("o microfone caindo no meio não descarta e não some sozinho do radar", () => {
    // A §10 manda transcrever o que capturou, nunca descartar, e mostrar
    // variante de erro no ícone. O texto está no clipboard — por isso toca
    // o som — mas falta o que veio depois da queda.
    expect(PRESENTATION.interrupted.icon).toBe("error");
    expect(PRESENTATION.interrupted.chime).toBe(true);
    expect(PRESENTATION.interrupted.click).toBe("start");
  });

  it("nenhum estado de resultado usa o mesmo ícone de outro com sentido diferente", () => {
    // O check vazado significa "o clipboard tem o CRU". `unguarded` entregou
    // texto reescrito, então não pode usá-lo — usaria para mentir.
    expect(PRESENTATION.raw.icon).toBe("ready-raw");
    expect(PRESENTATION.unguarded.icon).not.toBe("ready-raw");
    expect(PRESENTATION.done.icon).toBe("ready");
  });

  it("gravar e abrir o microfone param com o clique", () => {
    expect(PRESENTATION.opening.click).toBe("stop");
    expect(PRESENTATION.recording.click).toBe("stop");
  });
});
