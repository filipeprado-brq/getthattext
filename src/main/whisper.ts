import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { VAD_MODEL } from "../shared/models";
import { binaryPath } from "./binaries";
import { modelPath, modelsDir } from "./models";
import { preferences } from "./preferences";
import { type FailureKind, isModelLoadFailure } from "../shared/failures";
import { buildVadArgs, countSpeechSegments } from "../shared/speechGate";
import { buildWhisperArgs, cleanTranscript } from "../shared/transcript";

/**
 * Caminhos de desenvolvimento.
 *
 * O ticket #12 empacota os binários como `extraResource` e baixa os modelos
 * no onboarding (#10). Até lá, aponta para o que o Homebrew e o corpus já
 * deixaram na máquina.
 */
/** Os nomes dos executáveis. Onde eles moram é decisão do `binaries.ts`. */
const WHISPER_CLI = "whisper-cli";
const VAD_CLI = "whisper-vad-speech-segments";

export const whisperBin = (): string => binaryPath(WHISPER_CLI);
export const vadBin = (): string => binaryPath(VAD_CLI);

/**
 * O modelo do portão, vindo do catálogo POR NOME.
 *
 * Já foi `MODELS[1]`, para não repetir o literal. Quando o catálogo passou a
 * oferecer três modelos de transcrição, o índice 1 virou `small-q5_1` — e o
 * portão passou a ser invocado com um modelo de transcrição que nem estava
 * no disco. Índice posicional não é referência: é uma aposta na ordem.
 */
const VAD_MODEL_FILE = VAD_MODEL.file;

/** Os modelos de transcrição presentes, para a tela de preferências listar. */
export function availableModels(): string[] {
  try {
    return readdirSync(modelsDir())
      .filter((name) => name.endsWith(".bin") && !name.includes("silero"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Uma falha do whisper, já classificada na origem.
 *
 * A classificação nasce aqui porque é aqui que a informação existe: o
 * `spawn` sabe se o executável está lá, e o stderr sabe se o modelo
 * carregou. Reconstruir isso depois, lendo mensagem formatada, seria
 * adivinhar a partir de texto que eu mesmo escrevi.
 */
export class WhisperFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = "WhisperFailure";
  }
}

/**
 * Roda um binário do whisper.cpp com o WAV no stdin e devolve o stdout.
 *
 * Sem arquivo temporário: sem disco, sem limpeza a errar. Os logs saem no
 * stderr e são ignorados no caminho feliz, mas viram a mensagem de erro
 * quando o processo falha.
 */
function runWithWavOnStdin(
  bin: string,
  args: string[],
  wav: Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new WhisperFailure(
          missing ? "binary-missing" : "other",
          `Não foi possível executar ${bin}: ${error.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);

        return;
      }

      // Modelo ausente, corrompido e truncado dão a MESMA mensagem aqui —
      // medido. Quem distingue é quem olha o arquivo, depois.
      reject(
        new WhisperFailure(
          isModelLoadFailure(stderr) ? "model-load" : "other",
          `${bin} saiu com código ${code}. ${stderr.trim()}`,
        ),
      );
    });

    child.stdin.on("error", () => {
      // O processo pode fechar o stdin antes de terminarmos de escrever;
      // o resultado real vem pelo `close`, então aqui basta não derrubar.
    });
    child.stdin.end(wav);
  });
}

/**
 * O portão de fala: houve fala nesta gravação?
 *
 * Roda o Silero sobre o áudio inteiro e responde pela contagem de segmentos.
 * Sem ele o Whisper alucina em 8 de 8 gravações sem fala — 1 s de silêncio
 * vira `Obrigado.`, meio segundo vira `Legenda por Sônia Ruberti`, que é
 * vazamento de dado de treino.
 *
 * Custa ~110 ms e 885 KB de modelo.
 */
export async function hasSpeech(wav: Buffer): Promise<boolean> {
  const stdout = await runWithWavOnStdin(
    vadBin(),
    buildVadArgs(modelPath(VAD_MODEL_FILE)),
    wav,
  );

  return countSpeechSegments(stdout) > 0;
}

/**
 * Transcreve um WAV alimentando o `whisper-cli` pelo stdin.
 *
 * O áudio vai INTEIRO, sem `--vad`: o portão já decidiu se vale transcrever,
 * e o VAD dentro da transcrição engoliria conteúdo real.
 */
export async function transcribe(wav: Buffer): Promise<string> {
  const { model, language } = preferences();
  const stdout = await runWithWavOnStdin(
    whisperBin(),
    buildWhisperArgs(modelPath(model), language),
    wav,
  );

  return cleanTranscript(stdout);
}

/** O executável está no lugar? Verificado no boot, não na primeira ditação. */
export function isWhisperInstalled(): boolean {
  return existsSync(whisperBin());
}
