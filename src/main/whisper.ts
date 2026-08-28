import { spawn } from "node:child_process";
import { buildVadArgs, countSpeechSegments } from "../shared/speechGate";
import { buildWhisperArgs, cleanTranscript } from "../shared/transcript";

/**
 * Caminhos de desenvolvimento.
 *
 * O ticket #12 empacota os binários como `extraResource` e baixa os modelos
 * no onboarding (#10). Até lá, aponta para o que o Homebrew e o corpus já
 * deixaram na máquina.
 */
export const WHISPER_BIN = "/opt/homebrew/bin/whisper-cli";
export const VAD_BIN = "/opt/homebrew/bin/whisper-vad-speech-segments";
export const MODEL_PATH = `${process.env["HOME"]}/.cache/whisper/ggml-large-v3-turbo-q5_0.bin`;
export const VAD_MODEL_PATH = `${process.env["HOME"]}/.cache/whisper/ggml-silero-v5.1.2.bin`;

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
      reject(new Error(`Não foi possível executar ${bin}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} saiu com código ${code}. ${stderr.trim()}`));
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
    VAD_BIN,
    buildVadArgs(VAD_MODEL_PATH),
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
  const stdout = await runWithWavOnStdin(
    WHISPER_BIN,
    buildWhisperArgs(MODEL_PATH),
    wav,
  );

  return cleanTranscript(stdout);
}
