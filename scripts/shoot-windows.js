const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Fotografa as janelas, tela por tela, sem subir o app inteiro.
 *
 * Layout é o que teste unitário não pega: colisão de classe entre folhas
 * irmãs, tela que passa da altura da janela, texto que estoura a coluna.
 * Três achados reais saíram daqui — `.row` do dicionário desenhando borda no
 * wizard, a margem entre `section` mudando a altura de cada passo, e a aba
 * mais cheia das preferências passando por 0,75 px.
 *
 * A ponte é FALSA (`shoot-preload.js`): as janelas perguntam o estado ao
 * main, e subir o app junto traria bandeja, atalho global e download de
 * verdade.
 *
 * Uso: npm run shoot:windows — as imagens saem em `.scratch/shots/`.
 */
const OUT = join(process.cwd(), ".scratch", "shots");

/** Deixa uma tela visível sem passar pelo fluxo que a abriria. */
const pane = (id) => `(() => {
  const kind = document.getElementById("pane-${id}") ? "pane" : "panel";
  const target = document.getElementById(kind + "-${id}");
  if (!target) throw new Error("tela inexistente: ${id}");

  for (const other of document.querySelectorAll("." + kind)) other.classList.remove("active");
  target.classList.add("active");
})()`;

/** Cada janela com o seu tamanho real, o do `openWindow` no main. */
const WINDOWS = [
  {
    name: "onboarding",
    file: "dist/renderer/onboarding.html",
    width: 680,
    height: 412,
    shots: [
      { name: "microphone", script: pane("microphone") },
      { name: "models", script: pane("models") },
      {
        name: "download",
        // A barra só anda com progresso vindo do main; aqui ela é posta à
        // mão, que é o estado que interessa fotografar.
        script: `${pane("download")};
          document.querySelector(".bar-fill").style.width = "37%";
          document.querySelector(".download-head span").textContent = "213 MB de 574 MB";`,
      },
      {
        // A falha do download volta para a escolha e fala AQUI, não no
        // rodapé: a frase tem duas linhas e o rodapé tem uma.
        name: "models-falhou",
        script: `${pane("models")};
          document.getElementById("models-note").textContent =
            "Não foi possível falar com huggingface.co. Verifique a conexão e clique em " +
            "Baixar de novo — o que já veio fica no disco e o download continua de onde parou.";`,
      },
      { name: "key", script: pane("key") },
      { name: "shortcut", script: pane("shortcut") },
    ],
  },
  {
    name: "preferences",
    file: "dist/renderer/preferences.html",
    width: 640,
    height: 412,
    shots: [
      { name: "dictation", script: pane("dictation") },
      { name: "model", script: pane("model") },
      {
        name: "model-baixando",
        script: `${pane("model")};
          document.getElementById("choices").hidden = true;
          document.getElementById("downloads").hidden = false;`,
      },
      {
        name: "model-falhou",
        script: `${pane("model")};
          const note = document.getElementById("model-note");
          note.className = "note bad";
          note.textContent =
            "Não foi possível falar com huggingface.co. Verifique a conexão e clique em " +
            "Baixar de novo — o que já veio fica no disco e o download continua de onde parou.";
          document.getElementById("model-get").textContent = "Tentar de novo";`,
      },
      { name: "rewrite", script: pane("rewrite") },
      { name: "system", script: pane("system") },
    ],
  },
  {
    name: "dictionary",
    file: "dist/renderer/editor.html",
    width: 660,
    height: 560,
    shots: [
      { name: "parado", script: "true" },
      {
        // A barra de aprender só existe COM seleção: sem clicar em palavra,
        // metade da tela nunca apareceria na foto.
        name: "selecionado",
        script: `(() => {
          const words = document.querySelectorAll("#heard-text .word");
          words[8].click();
          words[11].click();
        })()`,
      },
    ],
  },
];

// Sem isto o app SAI ao fechar a última janela — o Electron encerra por
// padrão — e a janela seguinte nunca chega a ser fotografada, em silêncio.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  let overflowed = false;

  for (const target of WINDOWS) {
    const win = new BrowserWindow({
      width: target.width,
      height: target.height,
      show: false,
      webPreferences: { preload: join(__dirname, "shoot-preload.js") },
    });

    await win.loadFile(join(process.cwd(), target.file));
    // A janela pede o estado ao carregar; fotografar antes da resposta
    // renderia a tela vazia.
    await new Promise((done) => setTimeout(done, 400));

    for (const shot of target.shots) {
      const fits = await win.webContents.executeJavaScript(
        `${shot.script};\ndocument.body.scrollHeight <= window.innerHeight`,
      );
      // `capturePage` devolve o último frame COMPOSTO: sem a pausa, cada
      // foto sai um passo atrasada em relação ao que foi pedido.
      await new Promise((done) => setTimeout(done, 250));

      const image = await win.webContents.capturePage();
      const path = join(OUT, `${target.name}-${shot.name}.png`);
      writeFileSync(path, image.toPNG());

      if (!fits) overflowed = true;
      console.log(`${fits ? "ok  " : "ROLA"} ${path}`);
    }

    // Fechar e esperar um tique: destruir a última janela e criar a próxima
    // no mesmo tique faz o `loadFile` seguinte falhar com ERR_FAILED.
    win.close();
    await new Promise((done) => setTimeout(done, 200));
  }

  if (overflowed) console.error("alguma tela passou da altura da janela");
  app.exit(overflowed ? 1 : 0);
});
