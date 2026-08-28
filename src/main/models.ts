import { app } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, statfsSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ModelProgress } from "../shared/bridge";
import {
  bytesNeeded,
  type Model,
  MODELS,
  planDownload,
  requiredModels,
} from "../shared/models";

/**
 * Os modelos no disco: onde ficam, se são íntegros, e como baixá-los.
 *
 * A verificação não é zelo excessivo. O `download-ggml-model.sh` do
 * whisper.cpp não confere nada, e um download truncado só se revela na
 * primeira ditação — com uma mensagem que não aponta para a causa.
 */

/** Margem sobre o tamanho dos modelos, para o disco não encher no fim. */
const FREE_SPACE_MARGIN = 200e6;

export function modelsDir(): string {
  return join(app.getPath("userData"), "models");
}

export function modelPath(file: string): string {
  return join(modelsDir(), file);
}

/** Quanto o volume do `userData` ainda tem livre. */
export function freeSpace(): number {
  try {
    const { bavail, bsize } = statfsSync(app.getPath("userData"));

    return bavail * bsize;
  } catch {
    // Sem saber, não bloqueia: o download falha com mensagem própria se
    // faltar espaço, e recusar por não conseguir medir seria pior.
    return Number.POSITIVE_INFINITY;
  }
}

export function hasRoomFor(bytes: number): boolean {
  return freeSpace() >= bytes + FREE_SPACE_MARGIN;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** O SHA-256 de um arquivo, lido em fluxo para não carregar 547 MB na memória. */
export async function hashOf(path: string): Promise<string> {
  const digest = createHash("sha256");
  await pipeline(createReadStream(path), digest);

  return digest.digest("hex");
}

/**
 * O arquivo está lá, com o tamanho publicado?
 *
 * SÓ o tamanho, de propósito: isto é consultado a cada tique de progresso e
 * a cada clique no ícone, e somar o SHA-256 de 547 MB nesses caminhos custa
 * ~1,1 s por chamada. O hash roda uma vez, no download, antes de o arquivo
 * ganhar o nome final — então um arquivo com o nome definitivo já passou por
 * ele. Arquivo adulterado depois disso é assunto da matriz de erros (#11).
 */
export function isModelPresent(model: Model): boolean {
  return sizeOf(modelPath(model.file)) === model.bytes;
}

/** Quais modelos do catálogo já estão no lugar. */
export function presentModels(): string[] {
  return MODELS.filter(isModelPresent).map((model) => model.file);
}

/** A conferência cara, para quando ela vale: depois de baixar, ou sob pedido. */
export async function isModelIntact(model: Model): Promise<boolean> {
  if (!isModelPresent(model)) return false;

  return (await hashOf(modelPath(model.file))) === model.sha256;
}

/** O tamanho do `.part` já no disco, que não precisa ser baixado de novo. */
export function partialBytes(model: Model): number {
  return sizeOf(`${modelPath(model.file)}.part`);
}

/**
 * Há espaço para tudo que ainda falta?
 *
 * AGREGADO e antes de começar, como a spec (seção 9) manda. Checar modelo a
 * modelo dentro do laço só descobriria a falta de espaço depois de gravar
 * 574 MB — e aí o disco já estaria cheio.
 */
export function hasRoomForAll(chosen: string, present: readonly string[]): boolean {
  const needed = requiredModels(chosen);
  const missing = needed.filter((model) => !present.includes(model.file));
  const alreadyPartial = missing.reduce((total, model) => total + partialBytes(model), 0);

  return hasRoomFor(bytesNeeded(needed, present) - alreadyPartial);
}

/**
 * O status HTTP, dito de um jeito acionável.
 *
 * Um número cru não diz o que fazer. 429 é a diferença entre "espere um
 * minuto" e "o modelo sumiu do servidor", e as duas exigem reações opostas.
 */
function explainStatus(status: number): string {
  if (status === 429) {
    return "o servidor pediu para esperar (429). Tente de novo em alguns minutos.";
  }
  if (status === 404) {
    return "o arquivo não está mais nesse endereço (404).";
  }
  if (status === 416) {
    // Não deveria acontecer: `planDownload` recomeça quando há bytes demais.
    return "o servidor recusou continuar de onde paramos (416).";
  }
  if (status >= 500) {
    return `o servidor falhou (${status}). Costuma ser temporário.`;
  }

  return `o servidor respondeu ${status}.`;
}

/** O começo que o servidor diz estar mandando, num 206. */
function rangeStart(header: string | null): number | undefined {
  const match = /bytes\s+(\d+)-/.exec(header ?? "");

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Uma passada de download. Devolve `true` se o hash conferiu. */
async function attemptDownload(
  model: Model,
  onProgress: (progress: Omit<ModelProgress, "file">) => void,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const target = modelPath(model.file);
  const partial = `${target}.part`;

  let plan = planDownload(model, sizeOf(partial));
  if (plan.kind === "restart") {
    await rm(partial, { force: true });
    plan = { kind: "download", from: 0 };
  }

  if (plan.kind === "download") {
    const response = await fetch(model.url, {
      ...(signal ? { signal } : {}),
      ...(plan.from > 0 ? { headers: { Range: `bytes=${plan.from}-` } } : {}),
    });

    if (!response.ok || !response.body) {
      throw new Error(`${model.label}: ${explainStatus(response.status)}`);
    }

    // 206 = retomou. Mas de ONDE: um servidor que responde 206 a partir de
    // outro ponto faria o append gravar o pedaço errado no meio do arquivo,
    // e só o hash pegaria — depois de meio giga.
    const resumed =
      response.status === 206 &&
      rangeStart(response.headers.get("content-range")) === plan.from;

    let received = resumed ? plan.from : 0;
    const file = createWriteStream(partial, { flags: resumed ? "a" : "w" });
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => {
      received += chunk.length;
      onProgress({ received, total: model.bytes });
    });

    await pipeline(body, file, ...(signal ? [{ signal }] : []));
  }

  if (sizeOf(partial) !== model.bytes) {
    throw new Error(
      `${model.label}: veio com ${sizeOf(partial)} bytes, esperava ${model.bytes}.`,
    );
  }

  if ((await hashOf(partial)) !== model.sha256) {
    // Apaga: deixar um arquivo com hash errado faria a próxima tentativa
    // "retomar" a partir de dados corrompidos, para sempre.
    await rm(partial, { force: true });

    return false;
  }

  await rename(partial, target);

  return true;
}

/**
 * Baixa um modelo, retomando de onde parou.
 *
 * Grava num `.part` e só renomeia depois do hash conferir: um arquivo com o
 * nome final é um arquivo que o app vai usar, e ele não pode existir antes
 * de ser confiável.
 *
 * Hash errado apaga e tenta MAIS UMA VEZ, como a issue 26 pede. Um download
 * corrompido costuma ser acidente de rede, e mandar a pessoa clicar de novo
 * depois de dez minutos de espera é fazê-la pagar pelo acidente.
 */
export async function downloadModel(
  model: Model,
  onProgress: (progress: Omit<ModelProgress, "file">) => void,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(modelsDir(), { recursive: true });

  if (await attemptDownload(model, onProgress, signal)) return;
  if (await attemptDownload(model, onProgress, signal)) return;

  throw new Error(
    `${model.label}: o arquivo baixado não confere com o publicado, duas vezes. ` +
      "Pode ser a rede ou o espelho do servidor.",
  );
}

/** Apaga um modelo corrompido, para a próxima tentativa começar limpa. */
export async function discardModel(model: Model): Promise<void> {
  await rm(modelPath(model.file), { force: true });
  await rm(`${modelPath(model.file)}.part`, { force: true });
}
