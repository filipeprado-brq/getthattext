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

const snapshot = {
  preferences: {
    sound: true,
    rewrite: true,
    shortcut: "Alt+Command+G",
    language: "pt",
    model: "ggml-small-q5_1.bin",
    provider: "groq",
  },
  // O escolhido NÃO está no disco: é o estado que a aba Modelo precisa
  // mostrar — falta baixar, e o que está lá continua transcrevendo.
  models: ["ggml-large-v3-turbo-q5_0.bin"],
  loginItem: { status: "not-registered" },
  hasApiKey: true,
};

contextBridge.exposeInMainWorld("preferencesBridge", {
  load: async () => snapshot,
  save: async () => snapshot,
  setLoginItem: async () => snapshot.loginItem,
  setApiKey: async () => true,
  testApiKey: async () => ({ kind: "ok" }),
  downloadModels: pending,
  onProgress: () => {},
  openDictionary: () => {},
  openOnboarding: () => {},
  testShortcut: pending,
});

const RAW =
  "Coloca o endpoint barra api barra v1 barra usuários no services alf ponto ts, " +
  "e o date format tem que sair do use menu antes de o PNE responder.";

const ENTRIES = [
  { term: "services.auth.ts", heard: ["services alf ponto ts"], context: "arquivo do projeto" },
  { term: "useMenu", context: "hook do React" },
  { term: "PNR", heard: ["PNE", "peneira"], context: "sigla de reserva" },
  { term: "shadcn", heard: ["chedissiene"], context: "biblioteca de componentes" },
];

contextBridge.exposeInMainWorld("dictionaryBridge", {
  load: async () => ({ entries: ENTRIES, heard: RAW }),
  save: async (entries) => entries,
});

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
