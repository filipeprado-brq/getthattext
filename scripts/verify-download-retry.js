const { app } = require("electron");

/**
 * Prova que o download insiste quando a CONEXÃO falha, e desiste falando.
 *
 * Existe porque o caminho não dá para testar em unidade: `downloadModel`
 * depende de `fetch`, do disco e do relógio. O que é puro — reconhecer a
 * falha — está em `src/shared/network.test.ts`; aqui se vê o laço rodando.
 *
 * O alvo é a porta 9 do localhost (descarte, sempre recusada): dá
 * ECONNREFUSED na hora, então as três tentativas passam em segundos em vez
 * dos dez de timeout que um host inalcançável cobraria.
 *
 * Uso: npm run verify:download-retry
 */
app.whenReady().then(async () => {
  const { downloadModel } = require("../dist/main/models.js");

  const model = {
    file: "verificacao-retentativa.bin",
    url: "http://127.0.0.1:9/modelo.bin",
    bytes: 1024,
    sha256: "0".repeat(64),
    label: "Modelo de mentira",
  };

  const started = Date.now();
  try {
    await downloadModel(model, () => {});
    console.error("FALHOU: o download não deveria ter dado certo.");
    app.exit(1);
  } catch (error) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`desistiu depois de ${seconds}s dizendo:`);
    console.log(`  "${error.message}"`);

    const named = error.message.includes("127.0.0.1");
    const resumable = error.message.includes("de onde parou");
    console.log(named ? "ok   nomeia o host" : "ERRO não diz com quem falhou");
    console.log(resumable ? "ok   promete retomar" : "ERRO não diz que o .part fica");
    app.exit(named && resumable ? 0 : 1);
  }
});
