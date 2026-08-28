const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { microphoneGroup } = require("./mic-glyph.js");

/**
 * Gera o `build/icon.icns` — o ícone do app, não o da bandeja.
 *
 *   npm run build:icon
 *
 * São coisas diferentes com o mesmo desenho. O da bandeja é template
 * monocromático de 18 pt, tingido pelo sistema; este é colorido, de 1024 px,
 * e aparece no Finder, no Launchpad, em Ajustes → Privacidade → Microfone e
 * na lista de Itens de Início.
 *
 * O desenho é o glifo de GRAVANDO: cápsula vermelha, arco e haste brancos,
 * sobre grafite. O vermelho é o único ponto de cor do app, e promovê-lo a
 * identidade é o que torna o ícone reconhecível a 16 px — onde um microfone
 * de contorno vira um borrão igual ao de qualquer outro app de ditado.
 *
 * Grade do macOS (Big Sur em diante): a arte ocupa 824 px centrados numa
 * tela de 1024, com raio de 185. Fora dessa proporção o ícone fica maior ou
 * menor que os vizinhos no Dock e no Finder.
 *
 * Roda sob o Electron pelo mesmo motivo do `build-tray-icons.js`: o Chromium
 * é o rasterizador, e nenhum conversor de SVG está instalado. O `.icns` sai
 * do `iconutil`, que vem com o macOS.
 */
const CANVAS = 1024;
const ART = { origin: 100, size: 824, radius: 185 };

/** O vermelho de gravando, o único ponto de cor do app. */
const RECORDING_RED = "#ff3b30";
/** O grafite: o `--ink` da interface, com um leve alívio no topo. */
const SLAB_TOP = "#3a3a3f";
const SLAB_BOTTOM = "#1c1c1e";

/**
 * O microfone ocupa 540 dos 824 px da arte.
 *
 * O glifo é desenhado numa caixa de 18; ampliar por 30 dá 540, que é 65% da
 * arte — a proporção que a Apple usa nos ícones de sistema com uma figura
 * central. Mais que isso encosta na borda do squircle.
 */
const GLYPH_SCALE = 30;

function iconSource() {
  const center = CANVAS / 2;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" ` +
    `width="${CANVAS}" height="${CANVAS}">` +
    `<defs><linearGradient id="slab" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${SLAB_TOP}"/>` +
    `<stop offset="1" stop-color="${SLAB_BOTTOM}"/>` +
    `</linearGradient></defs>` +
    `<rect x="${ART.origin}" y="${ART.origin}" width="${ART.size}" height="${ART.size}" ` +
    `rx="${ART.radius}" fill="url(#slab)"/>` +
    microphoneGroup({
      stroke: "#ffffff",
      body: RECORDING_RED,
      transform: `translate(${center} ${center}) scale(${GLYPH_SCALE}) translate(-9 -9)`,
    }) +
    `</svg>`
  );
}

/**
 * Os dez arquivos que o `iconutil` espera, com os nomes que ele exige.
 *
 * Vão de 16 a 1024 porque o macOS escolhe por contexto: 16 na lista de
 * Itens de Início, 32 nos Ajustes, 512 no Finder em ícones grandes.
 */
const SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

const BUILD = join(__dirname, "..", "build");
const ICONSET = join(BUILD, "icon.iconset");

app.whenReady().then(async () => {
  try {
    await generate();
    app.exit(0);
  } catch (error) {
    // Sem isto o Electron fica pendurado sem dizer por quê.
    console.error(`falhou: ${error.message}`);
    app.exit(1);
  }
});

async function generate() {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL("data:text/html,<body></body>");

  mkdirSync(ICONSET, { recursive: true });

  for (const [name, side] of SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(`
      (async () => {
        const src = ${JSON.stringify(iconSource())};
        const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(src)));
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = reject; image.src = url;
        });
        const canvas = document.createElement("canvas");
        canvas.width = ${side}; canvas.height = ${side};
        canvas.getContext("2d").drawImage(image, 0, 0, ${side}, ${side});
        return canvas.toDataURL("image/png");
      })()
    `);

    writeFileSync(join(ICONSET, name), Buffer.from(dataUrl.split(",")[1], "base64"));
  }

  execFileSync("iconutil", ["-c", "icns", ICONSET, "-o", join(BUILD, "icon.icns")]);
  // O `.iconset` é intermediário: quem entra no repo é o `.icns`, do mesmo
  // jeito que os PNGs da bandeja.
  rmSync(ICONSET, { recursive: true, force: true });

  console.log("build/icon.icns gerado a partir de 10 tamanhos, de 16 a 1024 px.");
}
