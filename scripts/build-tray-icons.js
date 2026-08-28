/**
 * Gera os PNGs do ícone da barra a partir da geometria do protótipo.
 *
 *   npm run build:icons
 *
 * Roda sob o Electron porque o Chromium é o rasterizador — nenhum conversor
 * de SVG está instalado, e o que renderiza o ícone em produção é o mesmo
 * motor que o desenha aqui.
 *
 * A geometria vem do protótipo do #6 (viewBox 18x18, traço de 1,4). Os
 * arquivos gerados são commitados: isto é build de asset, não de código, e
 * roda de novo só quando o desenho mudar.
 *
 * NÃO gera quadros de animação. A respiração é variação de opacidade, feita
 * em runtime sobre o bitmap — ver `src/shared/trayIcon.ts`.
 */
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { microphoneGroup } = require("./mic-glyph.js");

const ASSETS = join(__dirname, "..", "assets");

/** O vermelho do protótipo, o único ponto de cor do app. */
const RECORDING_RED = "#ff3b30";

/** Tamanho de projeto: 18 pt, como o protótipo. */
const SIZE = 18;

const GLYPHS = [
  // `opening` não está aqui de propósito: é o mesmo desenho de `idle`,
  // esmaecido em runtime.
  "idle",
  "recording",
  "processing-0",
  "processing-1",
  "processing-2",
  "ready",
  "ready-raw",
  "error",
];

/**
 * Desenha um glifo como string SVG.
 *
 * Roda dentro da página, então é auto-contida de propósito — nada aqui pode
 * depender do escopo do Node.
 */
function svgSource(glyph, tone, red) {
  const elements = [];
  const add = (tag, attributes) =>
    elements.push(
      `<${tag} ${Object.entries(attributes)
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ")}/>`,
    );

  // O corpo do microfone vem de `mic-glyph.js`: o ícone do app desenha o
  // MESMO microfone em 1024 px, e duas cópias da cápsula divergiriam.
  const microphone = (stroke, fill) =>
    elements.push(microphoneGroup({ stroke, body: fill || "none" }));

  let defs = "";

  if (glyph === "idle") microphone(tone);
  else if (glyph === "recording") microphone(red, red);
  else if (glyph.startsWith("processing-")) {
    const active = Number(glyph.slice(-1));
    [3.6, 9, 14.4].forEach((cx, i) => {
      add("circle", { cx, cy: 9, r: 1.5, fill: tone, opacity: i === active ? 1 : 0.3 });
    });
  } else if (glyph === "ready") {
    // Preenchido: o disco é sólido e o check é um furo. Num template image
    // furo é transparência, que o sistema respeita ao tingir.
    defs =
      `<defs><mask id="c">` +
      `<circle cx="9" cy="9" r="6.6" fill="white"/>` +
      `<path d="M5.9 9.2l2.1 2.1 4.1-4.4" stroke="black" stroke-width="1.9" ` +
      `stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `</mask></defs>`;
    add("circle", { cx: 9, cy: 9, r: 6.6, fill: tone, mask: "url(#c)" });
  } else if (glyph === "ready-raw") {
    // Vazado: mesmo desenho, só contorno. É o "o Groq falhou, isto é o cru".
    add("circle", { cx: 9, cy: 9, r: 6.6, stroke: tone, "stroke-width": 1.4, fill: "none" });
    add("path", {
      d: "M5.9 9.2l2.1 2.1 4.1-4.4",
      stroke: tone, "stroke-width": 1.6,
      "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none",
    });
  } else if (glyph === "error") {
    add("circle", { cx: 9, cy: 9, r: 6.6, stroke: tone, "stroke-width": 1.4, fill: "none" });
    add("path", { d: "M9 5.4v4.4", stroke: tone, "stroke-width": 1.6, "stroke-linecap": "round" });
    add("circle", { cx: 9, cy: 12.4, r: 0.95, fill: tone });
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" ` +
    `width="18" height="18" fill="none">${defs}${elements.join("")}</svg>`
  );
}

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

  for (const glyph of GLYPHS) {
    for (const scale of [1, 2]) {
      const dataUrl = await win.webContents.executeJavaScript(`
        (async () => {
          const src = ${JSON.stringify(svgSource(glyph, "#000000", RECORDING_RED))};
          const blobUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(src)));
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve; image.onerror = reject; image.src = blobUrl;
          });
          const side = ${SIZE * scale};
          const canvas = document.createElement("canvas");
          canvas.width = side; canvas.height = side;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, side, side);
          return canvas.toDataURL("image/png");
        })()
      `);

      const name = `tray-${glyph}${scale === 2 ? "@2x" : ""}.png`;
      const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
      writeFileSync(join(ASSETS, name), bytes);
      console.log(`${name.padEnd(28)} ${String(bytes.length).padStart(5)} bytes`);
    }
  }
}
