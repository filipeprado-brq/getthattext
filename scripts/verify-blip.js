/**
 * Verificação de plataforma do blip (#6).
 *
 *   npm run build && npm run verify:blip
 *
 * O que teste unitário não alcança: se o envelope de fato produz som. Uma
 * rampa errada rende silêncio ou um estalo, e os dois passam despercebidos
 * em revisão de código — mas não numa renderização.
 *
 * Roda offline, sem tocar nada: `OfflineAudioContext` renderiza o mesmo
 * grafo que o app usa e devolve as amostras para conferir.
 */
const { app, BrowserWindow } = require("electron");
const { writeFileSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");

const RENDERER = join(__dirname, "..", "dist", "renderer");
/** A taxa do app. O blip é renderizado nela, não numa taxa conveniente. */
const SAMPLE_RATE = 16_000;

/** Página mínima só para ter um escopo de módulo com Web Audio. */
const HARNESS = join(RENDERER, "__verify-blip.html");

app.whenReady().then(async () => {
  let failures = 0;
  try {
    writeFileSync(HARNESS, "<!doctype html><meta charset=utf-8><body>");

    const win = new BrowserWindow({ show: false });
    await win.loadFile(HARNESS);

    const measured = await win.webContents.executeJavaScript(`
      (async () => {
        const { scheduleBlip, BLIP } = await import("./blip.js");
        const context = new OfflineAudioContext(1, ${SAMPLE_RATE}, ${SAMPLE_RATE});
        const seconds = scheduleBlip(context);
        const samples = (await context.startRendering()).getChannelData(0);

        let peak = 0, firstSound = -1, lastSound = -1;
        for (let i = 0; i < samples.length; i++) {
          const level = Math.abs(samples[i]);
          if (level > peak) peak = level;
          if (level > 0.001) { if (firstSound < 0) firstSound = i; lastSound = i; }
        }
        return {
          seconds, peak,
          expectedPeak: BLIP.gain,
          firstSoundS: firstSound / ${SAMPLE_RATE},
          lastSoundS: lastSound / ${SAMPLE_RATE},
          expectedSeconds: BLIP.leadSeconds + BLIP.notes.length * BLIP.noteSeconds,
        };
      })()
    `);

    const checks = [
      ["produz som, não silêncio", measured.peak > 0.01],
      ["não clipa", measured.peak <= 1],
      [
        `respeita o ganho de ${measured.expectedPeak}`,
        Math.abs(measured.peak - measured.expectedPeak) < 0.02,
      ],
      ["começa logo, não no meio do buffer", measured.firstSoundS < 0.05],
      [
        "cabe na duração que anuncia",
        measured.lastSoundS <= measured.seconds + 0.01,
      ],
      [
        "a duração anunciada bate com os parâmetros",
        Math.abs(measured.seconds - measured.expectedSeconds) < 1e-9,
      ],
    ];

    for (const [name, ok] of checks) {
      if (!ok) failures++;
      console.log(`${ok ? "ok  " : "FALHOU"} ${name}`);
    }
    console.log(
      `\npico ${measured.peak.toFixed(4)} · som de ` +
        `${measured.firstSoundS.toFixed(3)}s a ${measured.lastSoundS.toFixed(3)}s · ` +
        `duração ${measured.seconds.toFixed(3)}s`,
    );
    console.log(`${failures} falha(s) em ${checks.length} checagens.`);
  } catch (error) {
    console.error(`falhou: ${error.message}`);
    failures = 1;
  } finally {
    try {
      unlinkSync(HARNESS);
    } catch {
      // O arquivo é temporário dentro de dist/, que é gitignored.
    }
  }

  app.exit(failures === 0 ? 0 : 1);
});
