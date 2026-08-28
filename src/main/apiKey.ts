import { app, safeStorage } from "electron";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A chave do Groq, guardada cifrada pelo Keychain.
 *
 * Regras não-negociáveis da spec (seção 11): a chave só existe no main
 * process, nunca cruza o IPC, e se o `safeStorage` não estiver disponível o
 * app FALHA em vez de gravar em texto claro. Um segredo em claro no disco é
 * pior que não ter a funcionalidade.
 *
 * DIVERGÊNCIA DA SPEC, medida: a seção 11 pede `encryptStringAsync` e
 * `isAsyncEncryptionAvailable()`. Nenhum dos dois existe no Electron 41.7.1
 * — verificado em runtime, o `safeStorage` expõe só `encryptString`,
 * `decryptString`, `isEncryptionAvailable` e `setUsePlainTextEncryption`.
 * As síncronas dão a mesma garantia (Keychain, mesma chave por app); o que
 * se perde é não bloquear a thread, e o payload é uma linha de texto.
 */

/** O ciphertext mora aqui, dentro do `userData`. */
const KEY_FILE = "groq.key.enc";

/** Só o dono lê. */
const OWNER_ONLY = 0o600;

function keyPath(): string {
  return join(app.getPath("userData"), KEY_FILE);
}

/** O `safeStorage` não está pronto — nunca cair para texto claro. */
function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "O Keychain não está disponível, então a chave do Groq não pode ser " +
        "guardada com segurança. O app não grava a chave em texto claro.",
    );
  }
}

export async function saveApiKey(key: string): Promise<void> {
  assertEncryptionAvailable();

  const path = keyPath();
  await writeFile(path, safeStorage.encryptString(key), { mode: OWNER_ONLY });
  // O `mode` do writeFile só vale quando o arquivo é criado: sobrescrever
  // um arquivo existente mantém a permissão antiga.
  await chmod(path, OWNER_ONLY);
}

/**
 * Lê a chave, ou `undefined` quando não há nenhuma configurada.
 *
 * Ausência é estado normal — o app funciona em modo cru sem chave, e isso
 * não pode virar erro. Já uma falha de leitura de verdade (permissão,
 * disco) sobe: engolir isso deixaria você em modo cru sem saber por quê.
 */
export async function loadApiKey(): Promise<string | undefined> {
  let ciphertext: Buffer;
  try {
    ciphertext = await readFile(keyPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  assertEncryptionAvailable();

  return safeStorage.decryptString(ciphertext);
}

/** Apaga a chave. Usado quando o Groq responde que ela é inválida. */
export async function clearApiKey(): Promise<void> {
  await rm(keyPath(), { force: true });
}
