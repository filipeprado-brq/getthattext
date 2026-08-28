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

/**
 * Os dois modelos que o app precisa.
 *
 * Tamanho e hash vieram dos headers `x-linked-size` e `x-linked-etag` do
 * próprio Hugging Face, conferidos contra os arquivos que rodaram o corpus.
 * O do `large-v3-turbo` bate com o que a spec (seção 9) registrou.
 *
 * Ficam FIXOS aqui, e não são lidos do servidor a cada download: buscar o
 * hash da mesma origem que serve o arquivo não verificaria nada — quem
 * servisse um arquivo trocado serviria o hash dele junto.
 */
export const MODELS: readonly Model[] = [
  {
    file: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    label: "Modelo de transcrição",
  },
  {
    file: "ggml-silero-v5.1.2.bin",
    url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
    bytes: 885_098,
    sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
    label: "Modelo do portão de fala",
  },
];

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
