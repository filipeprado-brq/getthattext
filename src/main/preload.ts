import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../shared/bridge";

/**
 * Superfície mínima exposta ao renderer.
 *
 * `contextIsolation` fica ligado e `nodeIntegration` desligado: o renderer
 * não enxerga Node. Tudo que ele precisa passa por aqui, explicitamente.
 *
 * O tipo `Bridge` vem de `src/shared/` e é o mesmo que o renderer consome —
 * assim as duas pontas não podem divergir em silêncio.
 */
const bridge: Bridge = {
  saveWav: (bytes) => ipcRenderer.invoke("save-wav", bytes),
  revealInFinder: (path) => ipcRenderer.invoke("reveal-in-finder", path),
};

contextBridge.exposeInMainWorld("bridge", bridge);
