import { contextBridge, ipcRenderer } from "electron";
import type { ModelProgress, OnboardingBridge } from "../shared/bridge";

/**
 * Superfície da primeira abertura.
 *
 * `onProgress` é o único ponto do app em que o main EMPURRA algo para uma
 * janela visível: o download leva minutos, e perguntar de tempos em tempos
 * mostraria uma barra que anda aos saltos.
 */
const bridge: OnboardingBridge = {
  load: () => ipcRenderer.invoke("onboarding-load"),
  requestMicrophone: () => ipcRenderer.invoke("onboarding-microphone"),
  openMicrophoneSettings: () => ipcRenderer.invoke("onboarding-microphone-settings"),
  chooseModel: (file: string) => ipcRenderer.invoke("onboarding-choose-model", file),
  downloadModels: () => ipcRenderer.invoke("onboarding-download"),
  onProgress: (handler) => {
    ipcRenderer.on("onboarding-progress", (_event, progress: ModelProgress) =>
      handler(progress),
    );
  },
  setApiKey: (key: string) => ipcRenderer.invoke("preferences-api-key", key),
  testShortcut: () => ipcRenderer.invoke("preferences-test-shortcut"),
  finish: () => ipcRenderer.send("onboarding-finish"),
};

contextBridge.exposeInMainWorld("onboardingBridge", bridge);
