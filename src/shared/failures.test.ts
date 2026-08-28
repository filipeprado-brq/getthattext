import { describe, expect, it } from "vitest";
import { isModelLoadFailure, recoveryFor } from "./failures";

describe("isModelLoadFailure", () => {
  it("reconhece a mensagem do whisper", () => {
    expect(isModelLoadFailure("error: failed to initialize whisper context")).toBe(true);
  });

  it("reconhece mesmo com o resto do log em volta", () => {
    // O stderr vem com dezenas de linhas de backend do ggml antes.
    expect(
      isModelLoadFailure(
        "load_backend: loaded CPU backend\nerror: failed to initialize whisper context\n",
      ),
    ).toBe(true);
  });

  it("não confunde com outra falha", () => {
    expect(isModelLoadFailure("error: failed to read audio data from -")).toBe(false);
    expect(isModelLoadFailure("")).toBe(false);
  });
});

describe("recoveryFor", () => {
  const intact = { present: true, intact: true };

  it("binário ausente: o app não pode seguir", () => {
    // "Sem whisper não há produto; degradar seria fingir."
    expect(recoveryFor("binary-missing", intact).action).toBe("reinstall");
  });

  it("modelo ausente: refazer o onboarding, que baixa", () => {
    expect(recoveryFor("model-load", { present: false, intact: false }).action).toBe(
      "onboard",
    );
  });

  it("modelo presente mas corrompido: APAGA antes de refazer", () => {
    // Sem apagar, o onboarding veria o arquivo do tamanho certo, acharia que
    // está tudo bem, e a próxima ditação falharia igual — para sempre.
    expect(recoveryFor("model-load", { present: true, intact: false }).action).toBe(
      "discard-model",
    );
  });

  it("modelo íntegro e ainda assim não carrega: não inventa diagnóstico", () => {
    // Apagar um arquivo que confere com o hash publicado seria destruir 574
    // MB por um palpite errado.
    expect(recoveryFor("model-load", intact).action).toBe("report");
  });

  it("falha desconhecida vira relato, não ação destrutiva", () => {
    expect(recoveryFor("other", intact).action).toBe("report");
    expect(recoveryFor("other", { present: false, intact: false }).action).toBe("report");
  });

  it("a mensagem de falha desconhecida não promete o que não sabe", () => {
    // "O texto não foi perdido" seria falso quando quem falhou foi a
    // transcrição. O que se pode afirmar é que o clipboard ficou intacto.
    const { message } = recoveryFor("other", intact);
    expect(message).toContain("área de transferência não foi alterada");
  });

  it("toda recuperação traz uma mensagem utilizável", () => {
    const recoveries = [
      recoveryFor("binary-missing", intact),
      recoveryFor("model-load", { present: false, intact: false }),
      recoveryFor("model-load", { present: true, intact: false }),
      recoveryFor("other", intact),
    ];
    for (const recovery of recoveries) {
      expect(recovery.message.length).toBeGreaterThan(20);
    }
  });
});
