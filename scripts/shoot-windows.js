const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Fotografa as janelas, tela por tela, sem depender do app inteiro.
 *
 * Layout é o que teste unitário não pega: colisão de classe entre folhas
 * irmãs, tela que passa da altura da janela, texto que estoura a coluna.
 * Duas colisões reais saíram daqui — `.row` do dicionário desenhando borda
 * no onboarding, e a margem entre `section` do `editor.css` mudando a
 * altura de cada passo.
 *
 * A ponte é FALSA (`shoot-preload.js`): a janela pergunta o estado ao main,
 * e subir o app inteiro só para tirar uma foto traria bandeja, atalho
 * global e download de verdade junto.
 *
 * Uso: npm run shoot:windows — as imagens saem em `.scratch/shots/`.
 */
const OUT = join(process.cwd(), ".scratch", "shots");

/** Cada janela com o seu tamanho real, o do `openWindow` no main. */
const WINDOWS = [
  {
    name: "onboarding",
    file: "dist/renderer/onboarding.html",
    width: 680,
    height: 412,
    // As telas do wizard, incluindo a de download, que só aparece baixando.
    panes: ["microphone", "models", "download", "key", "shortcut"],
  },
  {
    name: "preferences",
    file: "dist/renderer/preferences.html",
    width: 640,
    height: 412,
    panes: ["dictation", "model", "rewrite", "system"],
  },
];

/**
 * Deixa uma tela visível, sem passar pelo fluxo que a abriria.
 *
 * As duas janelas empilham telas no mesmo lugar com nomes próprios — o
 * wizard chama de `pane`, as preferências de `panel` —, então a troca aqui
 * aceita as duas.
 */
function showPane(id) {
  return `(() => {
    const kind = document.getElementById("pane-${id}") ? "pane" : "panel";
    const target = document.getElementById(kind + "-${id}");
    if (!target) throw new Error("tela inexistente: ${id}");

    for (const other of document.querySelectorAll("." + kind)) other.classList.remove("active");
    target.classList.add("active");

    if ("${id}" === "download") {
      const fill = document.querySelector(".bar-fill");
      const amount = document.querySelector(".download-head span");
      if (fill) fill.style.width = "37%";
      if (amount) amount.textContent = "213 MB de 574 MB";
    }
    return document.body.scrollHeight <= window.innerHeight;
  })()`;
}

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

    for (const pane of target.panes) {
      const fits = await win.webContents.executeJavaScript(showPane(pane));
      // `capturePage` devolve o último frame COMPOSTO: sem a pausa, cada
      // foto sai um passo atrasada em relação ao que foi pedido.
      await new Promise((done) => setTimeout(done, 250));

      const image = await win.webContents.capturePage();
      const path = join(OUT, `${target.name}-${pane}.png`);
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
