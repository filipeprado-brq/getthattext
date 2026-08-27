import { contextBridge, ipcRenderer } from "electron";

/**
 * Superfície mínima exposta ao renderer.
 *
 * `contextIsolation` fica ligado e `nodeIntegration` desligado: o renderer
 * não enxerga Node. Tudo que ele precisa passa por aqui, explicitamente.
 */
contextBridge.exposeInMainWorld("ponte", {
  salvarWav: (bytes: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke("salvar-wav", bytes),
  revelar: (caminho: string): Promise<void> =>
    ipcRenderer.invoke("revelar", caminho),
});
