import { contextBridge, ipcRenderer } from "electron";
import type { Preferences } from "../shared/preferences";
import type { PreferencesBridge } from "../shared/bridge";

/**
 * Superfície da tela de preferências.
 *
 * `setApiKey` manda a chave para o main e não devolve nada além de "existe
 * ou não". A chave NUNCA volta pelo IPC: a regra da seção 11 da spec é que
 * ela só vive no main, e um campo que a exibisse de volta seria um caminho
 * de vazamento para o renderer.
 */
const bridge: PreferencesBridge = {
  load: () => ipcRenderer.invoke("preferences-load"),
  save: (patch: Partial<Preferences>) => ipcRenderer.invoke("preferences-save", patch),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke("preferences-login-item", enabled),
  setApiKey: (key: string) => ipcRenderer.invoke("preferences-api-key", key),
  testShortcut: () => ipcRenderer.invoke("preferences-test-shortcut"),
};

contextBridge.exposeInMainWorld("preferencesBridge", bridge);
