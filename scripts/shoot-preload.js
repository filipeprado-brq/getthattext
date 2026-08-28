const { contextBridge } = require("electron");

/**
 * A ponte falsa das fotos.
 *
 * Devolve um estado plausível e nunca resolve o que levaria tempo real —
 * download e teste de atalho ficam pendurados de propósito, que é o estado
 * que a tela mostra enquanto espera.
 */
const state = {
  microphone: "not-determined",
  models: [
    {
      file: "ggml-large-v3-turbo-q5_0.bin",
      label: "Modelo de transcrição",
      bytes: 574041195,
      present: false,
    },
    {
      file: "ggml-silero-v5.1.2.bin",
      label: "Modelo do portão de fala",
      bytes: 885098,
      present: false,
    },
  ],
  chosenModel: "ggml-large-v3-turbo-q5_0.bin",
  hasApiKey: false,
  provider: "groq",
  shortcut: "Alt+Command+G",
};

const pending = () => new Promise(() => {});

contextBridge.exposeInMainWorld("onboardingBridge", {
  load: async () => state,
  requestMicrophone: async () => ({ ...state, microphone: "granted" }),
  openMicrophoneSettings: async () => {},
  chooseModel: async (file) => ({ ...state, chosenModel: file }),
  chooseProvider: async (id) => ({ ...state, provider: id }),
  chooseShortcut: async () => state,
  downloadModels: pending,
  onProgress: () => {},
  setApiKey: async () => true,
  testApiKey: async () => ({ kind: "ok" }),
  testShortcut: pending,
  finish: () => {},
});
