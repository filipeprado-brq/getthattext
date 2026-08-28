import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Onde estão os executáveis do whisper.cpp.
 *
 * Empacotado, eles vêm de `Contents/Resources/whisper`, embarcados como
 * `extraResources` — fora do asar, porque o macOS não executa binário de
 * dentro de um arquivo.
 *
 * Em desenvolvimento, caem no Homebrew. Isso NÃO serve para o app
 * distribuído: o `whisper-cli` do Homebrew é dinamicamente ligado a
 * `libwhisper` e `libggml` de `/opt/homebrew`, e um bundle que dependesse
 * dele quebraria em qualquer máquina sem Homebrew — exatamente o que o
 * critério "roda numa sessão limpa" do #12 existe para impedir.
 */
const HOMEBREW = "/opt/homebrew/bin";

function bundled(name: string): string {
  return join(process.resourcesPath, "whisper", name);
}

/**
 * O caminho de um executável, preferindo o embarcado.
 *
 * A preferência importa mesmo em desenvolvimento: quando `vendor/whisper`
 * estiver preenchido, o app passa a exercitar o binário que vai ser
 * distribuído, em vez de continuar testando o do Homebrew e descobrir a
 * diferença só depois de empacotar.
 */
export function binaryPath(name: string): string {
  if (app.isPackaged) return bundled(name);

  const vendored = join(app.getAppPath(), "vendor", "whisper", name);

  return existsSync(vendored) ? vendored : join(HOMEBREW, name);
}

/** De onde o binário em uso veio, para o diagnóstico não virar adivinhação. */
export function binarySource(name: string): "bundled" | "vendored" | "homebrew" {
  const path = binaryPath(name);
  if (path.startsWith(process.resourcesPath)) return "bundled";

  return path.startsWith(HOMEBREW) ? "homebrew" : "vendored";
}
