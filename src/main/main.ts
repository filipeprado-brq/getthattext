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
function createWindow(): void {
  const window = new BrowserWindow({
    width: 560,
    height: 420,
    title: "getthattext — captura",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void window.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * Nome ordenável e sem ambiguidade de fuso, com milissegundos — duas
 * gravações no mesmo segundo não se sobrescrevem.
 */
function timestampedFilename(): string {
  return `getthattext-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
}

ipcMain.handle("save-wav", async (_event, bytes: ArrayBuffer) => {
  const path = join(app.getPath("temp"), timestampedFilename());
  // Deixar rejeitar: o `invoke` propaga o erro ao renderer, que mostra a falha.
  await writeFile(path, Buffer.from(bytes));
  return path;
});

ipcMain.handle("reveal-in-finder", (_event, path: string) => {
  shell.showItemInFolder(path);
});

void app.whenReady().then(createWindow);

// Sem ícone na barra ainda (ticket #2): fechar a janela encerra o app, e por
// isso não há caminho de reativação a tratar.
app.on("window-all-closed", () => {
  app.quit();
});
