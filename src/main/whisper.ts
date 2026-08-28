import { spawn } from "node:child_process";
import { buildWhisperArgs, cleanTranscript } from "../shared/transcript";

/**
 * Caminhos de desenvolvimento.
 *
 * O ticket #12 empacota o binário como `extraResource` e baixa o modelo no
 * onboarding (#10). Até lá, aponta para o que o Homebrew e o corpus já
 * deixaram na máquina.
 */
export const WHISPER_BIN = "/opt/homebrew/bin/whisper-cli";
export const MODEL_PATH = `${process.env["HOME"]}/.cache/whisper/ggml-large-v3-turbo-q5_0.bin`;

/**
 * Transcreve um WAV alimentando o `whisper-cli` pelo stdin.
 *
 * Sem arquivo temporário: sem disco, sem limpeza a errar. O texto sai no
 * stdout; os logs do whisper saem no stderr e são ignorados no caminho feliz,
 * mas viram a mensagem de erro quando o processo falha.
 */
export function transcribe(wav: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(WHISPER_BIN, buildWhisperArgs(MODEL_PATH));

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => {
      reject(
        new Error(
          `Não foi possível executar o whisper-cli em ${WHISPER_BIN}: ${error.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (code === 0) resolve(cleanTranscript(stdout));
      else reject(new Error(`whisper-cli saiu com código ${code}. ${stderr.trim()}`));
    });

    child.stdin.on("error", () => {
      // O whisper pode fechar o stdin antes de terminarmos de escrever;
      // o resultado real vem pelo `close`, então aqui basta não derrubar.
    });
    child.stdin.end(wav);
  });
}
