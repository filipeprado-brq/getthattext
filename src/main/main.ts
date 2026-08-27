import { app, BrowserWindow, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Janela descartável do ticket #1.
 *
 * O app final não tem janela — vive na barra de menu. Esta existe só para
 * acionar a captura e mostrar onde o arquivo caiu, para que o pipeline de
 * áudio seja verificável sozinho.
 */
function criarJanela(): void {
  const janela = new BrowserWindow({
    width: 560,
    height: 420,
    title: "getthattext — captura",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void janela.loadFile(join(__dirname, "../renderer/index.html"));
}

/** Nome com carimbo de tempo, para gravações sucessivas não se sobrescreverem. */
function nomeDoArquivo(): string {
  const agora = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return [
    "getthattext",
    `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}`,
    `${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`,
  ].join("-") + ".wav";
}

ipcMain.handle("salvar-wav", async (_evento, bytes: ArrayBuffer) => {
  const caminho = join(app.getPath("temp"), nomeDoArquivo());
  await writeFile(caminho, Buffer.from(bytes));
  return caminho;
});

ipcMain.handle("revelar", (_evento, caminho: string) => {
  shell.showItemInFolder(caminho);
});

void app.whenReady().then(() => {
  criarJanela();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
