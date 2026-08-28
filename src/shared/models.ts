/**
 * O catálogo de modelos e a aritmética do download.
 *
 * Puro de propósito: a decisão de retomar, descartar ou verificar um
 * arquivo parcial é onde um sinal trocado corrompe meio giga em silêncio, e
 * o app só descobre na primeira ditação.
 */

export type Model = {
  /** Nome do arquivo, dentro da pasta de modelos. */
  file: string;
  url: string;
  /** Tamanho publicado, em bytes. */
  bytes: number;
  /** SHA-256 publicado. */
  sha256: string;
  label: string;
};

/** Um modelo de transcrição, com o que a escolha precisa mostrar. */
export type TranscriptionModel = Model & {
  /** Como ele aparece na tela. */
  name: string;
  /**
   * O que se perde ao escolher este.
   *
   * Obrigatório de propósito: oferecer "60 MB" sem dizer que ele repete
   * trechos em loop seria oferecer uma armadilha.
   */
  tradeoff: string;
  /**
   * A potência, de 1 a 5.
   *
   * É a medição do corpus reduzida ao que cabe num card: 18/18 termos
   * técnicos vira 5, 9/18 vira 3, e o `base` cai para 1 porque errar sigla
   * e repetir trechos em loop são duas falhas, não uma pior.
   *
   * A nota some do card em traços, sem número. O número, o rótulo e a
   * medição atrás dele ficam na explicação — o card não é lugar de
   * argumentar.
   */
  power: 1 | 2 | 3 | 4 | 5;
  /** Como essa potência se chama, para quem não conta traços. */
  powerLabel: string;
  recommended?: true;
};

const HOST = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/**
 * Os modelos entre os quais se escolhe, do melhor para o menor.
 *
 * A ordem é de QUALIDADE, não de tamanho: a lista é lida de cima para
 * baixo, e o recomendado em primeiro é o que vira padrão de quem não lê.
 *
 * Tamanho e SHA-256 vêm da API do Hugging Face
 * (`/api/models/ggerganov/whisper.cpp/tree/main`), conferidos contra os
 * arquivos baixados. Ficam FIXOS aqui: buscar o hash da mesma origem que
 * serve o arquivo não verificaria nada.
 *
 * Os números dos trade-offs saíram do corpus completo, 30 amostras. A
 * medição está no #16; o que importa para a escolha é que "similaridade"
 * engana — o `small` fica em 93,3% no agregado e perde METADE dos termos
 * técnicos, que é o que este app existe para preservar.
 */
export const TRANSCRIPTION_MODELS: readonly TranscriptionModel[] = [
  {
    file: "ggml-large-v3-turbo-q5_0.bin",
    url: `${HOST}/ggml-large-v3-turbo-q5_0.bin`,
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    label: "Modelo de transcrição",
    name: "Completo",
    tradeoff: "Preserva nome de arquivo, camelCase e sigla.",
    power: 5,
    powerLabel: "Excelente",
    recommended: true,
  },
  {
    file: "ggml-small-q5_1.bin",
    url: `${HOST}/ggml-small-q5_1.bin`,
    bytes: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
    label: "Modelo de transcrição",
    name: "Compacto",
    tradeoff:
      "Um terço do tamanho. Erra cerca de metade das siglas e dos nomes de " +
      'arquivo — "PNR" vira "PNE", "IDS" vira "DS".',
    power: 3,
    powerLabel: "Bom para prosa",
  },
  {
    file: "ggml-base-q5_1.bin",
    url: `${HOST}/ggml-base-q5_1.bin`,
    bytes: 59_707_625,
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    label: "Modelo de transcrição",
    name: "Mínimo",
    tradeoff:
      "Dez vezes menor. Além de errar siglas, às vezes repete trechos em " +
      "loop e produz quase o dobro de texto.",
    power: 1,
    powerLabel: "Limitado",
  },
];

/** O padrão de quem não escolhe. */
export const RECOMMENDED_MODEL = TRANSCRIPTION_MODELS.find(
  (model) => model.recommended,
)!.file;

/**
 * O modelo do portão de fala. NÃO é escolha.
 *
 * Sem ele o Whisper alucina em gravação sem fala — medido, 8 de 8. E ele
 * custa 885 KB, 0,15% do modelo principal: não há trade-off para oferecer.
 */
export const VAD_MODEL: Model = {
  file: "ggml-silero-v5.1.2.bin",
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
  bytes: 885_098,
  sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
  label: "Modelo do portão de fala",
};

/** Tudo que o catálogo conhece, para verificação e download. */
export const MODELS: readonly Model[] = [...TRANSCRIPTION_MODELS, VAD_MODEL];

/**
 * Os modelos que precisam estar no disco, dado o escolhido.
 *
 * Só o escolhido e o portão. Baixar os três custaria 824 MB — pior que o
 * problema que a escolha resolve.
 *
 * Escolha desconhecida cai no recomendado: preferência editada à mão, ou
 * vinda de uma versão que oferecia outro modelo, não pode virar "não baixa
 * nada".
 */
export function requiredModels(chosen: string): readonly Model[] {
  const model =
    TRANSCRIPTION_MODELS.find(({ file }) => file === chosen) ??
    TRANSCRIPTION_MODELS.find(({ recommended }) => recommended)!;

  return [model, VAD_MODEL];
}

/**
 * O modelo que a transcrição vai usar DE VERDADE.
 *
 * Escolher um modelo que ainda não está no disco não pode parar a ditação:
 * a escolha vale, o download pode esperar o dia que você quiser, e até lá o
 * que já está no disco continua transcrevendo. Sem isto, escolher e adiar
 * deixaria o app chamando o whisper com um arquivo que não existe — e o
 * erro falaria de "model load", não de escolha.
 *
 * A ordem do catálogo é de QUALIDADE, então o primeiro presente é o melhor
 * presente. `undefined` significa que não há nenhum: é o estado da primeira
 * abertura, e quem responde por ele é o onboarding.
 */
export function activeModel(
  chosen: string,
  present: readonly string[],
): string | undefined {
  const wanted = TRANSCRIPTION_MODELS.find(({ file }) => file === chosen);
  if (wanted && present.includes(wanted.file)) return wanted.file;

  return TRANSCRIPTION_MODELS.find(({ file }) => present.includes(file))?.file;
}

/** O que fazer com um arquivo que já está no disco pela metade. */
export type DownloadPlan =
  | { kind: "download"; from: number }
  | { kind: "verify" }
  | { kind: "restart" };

/**
 * Decide entre retomar, verificar e recomeçar.
 *
 * Mais bytes do que o esperado manda RECOMEÇAR, não retomar: pedir um range
 * além do fim renderia 416, e ignorar renderia um arquivo com lixo no meio
 * que só o hash pegaria — depois de meio giga de espera.
 */
export function planDownload(model: Model, onDisk: number): DownloadPlan {
  const have = Math.max(0, Math.trunc(onDisk));

  if (have > model.bytes) return { kind: "restart" };
  if (have === model.bytes) return { kind: "verify" };

  return { kind: "download", from: have };
}

/** O quanto já veio, de 0 a 100. */
export function progressPercent(received: number, total: number): number {
  if (total <= 0) return 0;

  const ratio = received / total;

  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Escalas em que faz sentido mostrar um download deste tamanho. */
const UNITS = [
  { unit: "gigabyte", from: 1e9 },
  { unit: "megabyte", from: 1e6 },
  { unit: "kilobyte", from: 1e3 },
  { unit: "byte", from: 0 },
] as const;

/**
 * O tamanho como se lê na tela.
 *
 * Quem arredonda e escolhe o separador é o `Intl`: a regra 3 do
 * CODING_STANDARDS proíbe formatar número à mão, e "0,5 GB" contra "0.5 GB"
 * é exatamente o tipo de coisa que sai errado à mão.
 */
export function formatBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  const scale = UNITS.find(({ from }) => safe >= from) ?? UNITS[UNITS.length - 1]!;
  const value = scale.from === 0 ? safe : safe / scale.from;

  return new Intl.NumberFormat("pt-BR", {
    style: "unit",
    unit: scale.unit,
    unitDisplay: "short",
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

/** Quantos bytes ainda precisam ser baixados. */
export function bytesNeeded(
  models: readonly Model[],
  present: readonly string[],
): number {
  return models
    .filter((model) => !present.includes(model.file))
    .reduce((total, model) => total + model.bytes, 0);
}
