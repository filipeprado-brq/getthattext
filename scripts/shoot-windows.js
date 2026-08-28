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
];

/** Deixa uma tela do wizard visível, sem passar pelo fluxo que a abriria. */
function showPane(id) {
  return `(() => {
    for (const pane of document.querySelectorAll(".pane")) pane.classList.remove("active");
    document.getElementById("pane-${id}").classList.add("active");
    if ("${id}" === "download") {
      const fill = document.querySelector(".bar-fill");
      const amount = document.querySelector(".download-head span");
      if (fill) fill.style.width = "37%";
      if (amount) amount.textContent = "213 MB de 574 MB";
    }
    return document.body.scrollHeight <= window.innerHeight;
  })()`;
}

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

    win.destroy();
  }

  if (overflowed) console.error("alguma tela passou da altura da janela");
  app.exit(overflowed ? 1 : 0);
});
