/**
 * O que fazer diante de cada falha da transcrição.
 *
 * Puro e em `shared/` porque é a tabela da seção 10 da spec virando código:
 * errar aqui é apagar 574 MB por engano, ou insistir para sempre num arquivo
 * que nunca vai carregar.
 *
 * MEDIDO, e é o que molda este módulo: modelo ausente, corrompido e truncado
 * produzem EXATAMENTE a mesma mensagem no whisper —
 * `failed to initialize whisper context`. O stderr não distingue os três, e
 * por isso o diagnóstico vem de olhar o arquivo, não de ler o log.
 */

/** O que o whisper diz quando não conseguiu carregar o modelo. */
const MODEL_LOAD_FAILURE = "failed to initialize whisper context";

export function isModelLoadFailure(stderr: string): boolean {
  return stderr.includes(MODEL_LOAD_FAILURE);
}

/** De onde a falha veio, no nível em que dá para saber com certeza. */
export type FailureKind =
  /** O `spawn` devolveu ENOENT: o executável não está lá. */
  | "binary-missing"
  /** O whisper subiu e não carregou o modelo. */
  | "model-load"
  | "other";

/** Como o modelo está no disco, para o diagnóstico que o log não dá. */
export type ModelHealth = { present: boolean; intact: boolean };

export type Recovery = {
  action: "reinstall" | "onboard" | "discard-model" | "report";
  message: string;
};

/**
 * A ação para cada combinação de falha e estado do modelo.
 *
 * `report` é o padrão diante da dúvida, de propósito: as outras ações apagam
 * arquivo ou fecham o app, e fazer isso por palpite errado custa caro.
 */
export const MISSING_BINARY_MESSAGE =
  "O whisper-cli não está instalado, e sem ele o getthattext não transcreve " +
  "nada. Reinstale o app.";

export function recoveryFor(kind: FailureKind, model: ModelHealth): Recovery {
  if (kind === "binary-missing") {
    return { action: "reinstall", message: MISSING_BINARY_MESSAGE };
  }

  if (kind === "model-load" && !model.present) {
    return {
      action: "onboard",
      message:
        "O modelo de transcrição sumiu. Abra o onboarding e baixe de novo.",
    };
  }

  if (kind === "model-load" && !model.intact) {
    return {
      action: "discard-model",
      // Diz o que aconteceu e o que falta fazer. A versão anterior prometia
      // "vou baixá-lo de novo", e o download não é automático: quem clica
      // em Baixar é você.
      message:
        "O modelo de transcrição estava corrompido. Apaguei o arquivo — " +
        "baixe de novo no onboarding.",
    };
  }

  // "O texto não foi perdido" seria falso: quem falhou foi a transcrição, e
  // não há texto. O que se pode dizer com honestidade é que o clipboard não
  // foi tocado.
  return {
    action: "report",
    message:
      "A transcrição falhou e a área de transferência não foi alterada. " +
      "Tente de novo.",
  };
}
