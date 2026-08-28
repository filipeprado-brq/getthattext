import { contextBridge, ipcRenderer } from "electron";
import type { Entry } from "../shared/dictionary";
import type { DictionaryBridge } from "../shared/bridge";

/**
 * Superfície do editor de dicionário.
 *
 * Preload próprio, separado do da janela de captura: o editor não tem nada
 * que fazer com o microfone, e a janela de captura não tem nada que fazer
 * com o dicionário. Expor as duas coisas nas duas janelas seria dar a cada
 * uma poder que ela não usa.
 */
const bridge: DictionaryBridge = {
  load: () => ipcRenderer.invoke("dictionary-load"),
  save: (entries: readonly Entry[]) => ipcRenderer.invoke("dictionary-save", entries),
};

contextBridge.exposeInMainWorld("dictionaryBridge", bridge);
