/**
 * Importa a chave do Groq do arquivo de desenvolvimento para o cofre do app.
 *
 *   npm run build && npm run key:import
 *
 * Ponte até o #9 (Preferências) e o #10 (Onboarding), que são donos da UI de
 * chave. Roda sob o Electron porque `safeStorage` e `app.getPath` só existem
 * lá. Verifica o que a spec exige: ciphertext no `userData`, permissão 0600,
 * e round-trip pelo Keychain. A chave nunca é impressa.
 */
const { app, safeStorage } = require("electron");
const { readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

const { loadApiKey, saveApiKey } = require("../dist/main/apiKey.js");

const SOURCE = join(process.env.HOME ?? "", ".config/groq/key");

app.whenReady().then(async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Keychain indisponível — a chave não seria cifrada.");
    }

    const key = readFileSync(SOURCE, "utf8").trim();
    if (key.length === 0) throw new Error(`${SOURCE} está vazio.`);

    await saveApiKey(key);

    const stored = join(app.getPath("userData"), "groq.key.enc");
    const mode = (statSync(stored).mode & 0o777).toString(8);
    const roundTrip = (await loadApiKey()) === key;

    console.log(`arquivo:    ${stored}`);
    console.log(`permissão:  0${mode} ${mode === "600" ? "ok" : "ERRADA, esperava 600"}`);
    console.log(`round-trip: ${roundTrip ? "ok" : "FALHOU — o que voltou não é o que entrou"}`);
    console.log(`em claro:   ${readFileSync(stored).includes(key) ? "VAZOU" : "não (ciphertext)"}`);
    console.log(`\nA fonte ${SOURCE} continua em texto claro no disco — é o elo`);
    console.log("mais fraco da cadeia. Apague se não precisar mais dela.");

    app.exit(mode === "600" && roundTrip ? 0 : 1);
  } catch (error) {
    console.error(`falhou: ${error.message}`);
    app.exit(1);
  }
});
