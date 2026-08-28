import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, Command } from "../shared/bridge";

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
  onCommand: (handler) => {
    ipcRenderer.on("command", (_event, command: Command) => handler(command));
  },
  deliverAudio: (bytes) => ipcRenderer.invoke("deliver-audio", bytes),
  reportAudioFlowing: () => ipcRenderer.send("audio-flowing"),
  reportEmpty: () => ipcRenderer.send("capture-empty"),
  reportFailure: (reason) => ipcRenderer.send("capture-failed", reason),
};

contextBridge.exposeInMainWorld("bridge", bridge);
