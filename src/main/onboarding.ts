import { shell, systemPreferences } from "electron";
import { hasApiKey } from "./apiKey";
import { presentModels } from "./models";
import { preferences } from "./preferences";
import { requiredModels } from "../shared/models";
import type { OnboardingState } from "../shared/onboarding";

/**
 * O estado da primeira abertura.
 *
 * DERIVADO, nunca guardado. Um sinalizador de "já fez o onboarding" mentiria
 * no dia em que um modelo fosse apagado ou a permissão revogada pelo painel
 * do sistema — e o app tentaria ditar sem ter com quê.
 */
export function onboardingState(): OnboardingState {
  const microphone = systemPreferences.getMediaAccessStatus("microphone");
  const present = presentModels();

  const chosenModel = preferences().model;

  return {
    microphone,
    chosenModel,
    models: requiredModels(chosenModel).map((model) => ({
      file: model.file,
      label: model.label,
      bytes: model.bytes,
      present: present.includes(model.file),
    })),
    hasApiKey: hasApiKey(),
    shortcut: preferences().shortcut,
  };
}

/**
 * O app está pronto para ditar?
 *
 * A chave do Groq NÃO entra: sem ela o app funciona em modo cru, e a spec
 * (seção 9) marca esse passo como opcional. Microfone e modelos, sim — sem
 * eles não há o que fazer.
 */
export function isReady(state: OnboardingState): boolean {
  return state.microphone === "granted" && state.models.every((model) => model.present);
}

/**
 * Pede a permissão de microfone.
 *
 * `askForMediaAccess` só abre o prompt uma vez na vida do app; depois disso
 * ele devolve a resposta guardada sem perguntar nada. Por isso a tela precisa
 * do caminho para o painel do sistema: uma vez negado, não há como pedir de
 * novo por código.
 */
export async function requestMicrophone(): Promise<OnboardingState> {
  if (systemPreferences.getMediaAccessStatus("microphone") === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }

  return onboardingState();
}

/**
 * Leva ao painel de privacidade do microfone.
 *
 * O scheme `x-apple.systempreferences:` não é suportado pela Apple e pode
 * parar de funcionar — por isso a tela mostra o caminho por escrito ao lado,
 * e isto é conveniência, não o único caminho.
 */
export async function openMicrophoneSettings(): Promise<void> {
  await shell.openExternal(
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
  );
}
