import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  type Preferences,
} from "../shared/preferences";

/**
 * As preferências no disco.
 *
 * Síncrono de propósito: é um objeto de poucas chaves, lido uma vez no boot
 * e gravado quando você clica no menu. Tornar isso assíncrono só criaria
 * promises para ninguém tratar, contra a regra 4 do CODING_STANDARDS.
 *
 * O #9 é dono da interface; aqui existe só o mínimo que o #6 precisa para
 * cumprir "som desligável".
 */
const FILE = "preferences.json";

let cached: Preferences | undefined;

function path(): string {
  return join(app.getPath("userData"), FILE);
}

export function preferences(): Preferences {
  if (cached) return cached;

  let text: string | undefined;
  try {
    text = readFileSync(path(), "utf8");
  } catch (error) {
    // Arquivo ausente é o primeiro boot, não erro. Qualquer outra falha de
    // leitura vira o padrão, mas com registro: ficar em silêncio deixaria
    // você achando que a preferência não foi salva.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("não foi possível ler as preferências:", error);
    }
  }

  cached = parsePreferences(text);

  return cached;
}

/** Grava uma preferência, preservando o resto do arquivo. */
export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  const updated = { ...preferences(), [key]: value };
  cached = updated;

  try {
    writeFileSync(path(), `${JSON.stringify(updated, null, 2)}\n`);
  } catch (error) {
    console.error("não foi possível gravar as preferências:", error);
  }
}

export { DEFAULT_PREFERENCES };
