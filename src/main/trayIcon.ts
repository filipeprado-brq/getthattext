import { nativeImage, type NativeImage, type Tray } from "electron";
import { join } from "node:path";
import {
  type IconState,
  OPENING_BREATH,
  OPENING_PERIOD_MS,
  opacityAt,
  RECORDING_BREATH,
  RECORDING_PERIOD_MS,
  scaleAlpha,
} from "../shared/trayIcon";

/**
 * Os sete desenhos do ícone da barra, animados.
 *
 * A animação não usa quadros pré-renderizados no disco: cada estado tem um
 * PNG só, e as variações de opacidade são computadas UMA VEZ no boot e
 * guardadas como `NativeImage`. O tique da animação só troca de imagem.
 *
 * Por que no boot e não a cada tique: escalar o alfa de dois bitmaps é
 * trabalho bobo para repetir 10 vezes por segundo enquanto você grava, e o
 * app tem um orçamento de latência a respeitar.
 */
/** Lado do ícone em pontos. O @2x no disco tem o dobro em pixels. */
const SIZE = 18;

/** Cadência da animação. 100 ms é suave sem custar nada. */
const FRAME_MS = 100;

const ASSETS = join(__dirname, "../../assets");

function load(glyph: string, template: boolean): NativeImage {
  // O Electron acha o @2x sozinho quando ele está ao lado, com o mesmo nome.
  const image = nativeImage.createFromPath(join(ASSETS, `tray-${glyph}.png`));
  image.setTemplateImage(template);

  return image;
}

/**
 * Copia a imagem com o alfa multiplicado, preservando as duas resoluções.
 *
 * As duas representações precisam ser tratadas separadamente: `toBitmap`
 * devolve uma de cada vez, e perder a de @2x deixaria o ícone borrado numa
 * tela Retina — que é a única tela onde este app roda.
 */
function withOpacity(source: NativeImage, opacity: number, template: boolean): NativeImage {
  const fade = (scaleFactor: number): Buffer =>
    Buffer.from(scaleAlpha(source.toBitmap({ scaleFactor }), opacity));

  const faded = nativeImage.createFromBuffer(fade(1), {
    width: SIZE,
    height: SIZE,
    scaleFactor: 1,
  });
  faded.addRepresentation({
    scaleFactor: 2,
    width: SIZE * 2,
    height: SIZE * 2,
    buffer: fade(2),
  });
  faded.setTemplateImage(template);

  return faded;
}

/** Quantos quadros cabem num ciclo, na cadência escolhida. */
function framesFor(periodMs: number): number {
  return Math.round(periodMs / FRAME_MS);
}

/** Gera o ciclo de um estado que respira. */
function breathe(
  source: NativeImage,
  keyframes: readonly { at: number; opacity: number }[],
  periodMs: number,
  template: boolean,
): NativeImage[] {
  const count = framesFor(periodMs);

  return Array.from({ length: count }, (_, i) =>
    withOpacity(source, opacityAt(keyframes, i / count), template),
  );
}

/** Um estado desenhado: os quadros e quanto cada um dura. */
type Animation = { frames: readonly NativeImage[]; frameMs: number };

let animations: Record<IconState, Animation> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Desenha todos os estados uma vez.
 *
 * Chamado no boot, depois do `app.whenReady()`: `nativeImage` não carrega
 * antes disso.
 */
export function prepareIcons(): NativeImage {
  const idle = load("idle", true);
  // "Gravando" é o ÚNICO que não é template: todo o orçamento de cor do app
  // vai para o estado em que não perceber custa algo. Marcar como template
  // faria o sistema pintar por cima e comer o vermelho.
  const recording = load("recording", false);

  const still = (glyph: string): Animation => ({
    frames: [load(glyph, true)],
    frameMs: FRAME_MS,
  });

  animations = {
    idle: { frames: [idle], frameMs: FRAME_MS },
    // "Abrindo" é o mesmo desenho de "ocioso", esmaecido e respirando: o
    // microfone já é o assunto, o que muda é ele ainda não estar valendo.
    opening: {
      frames: breathe(idle, OPENING_BREATH, OPENING_PERIOD_MS, true),
      frameMs: FRAME_MS,
    },
    recording: {
      frames: breathe(recording, RECORDING_BREATH, RECORDING_PERIOD_MS, false),
      frameMs: FRAME_MS,
    },
    // Os três pontos já vêm desenhados em três posições; a "animação" é
    // percorrê-las.
    processing: {
      frames: [
        load("processing-0", true),
        load("processing-1", true),
        load("processing-2", true),
      ],
      frameMs: 260,
    },
    ready: still("ready"),
    "ready-raw": still("ready-raw"),
    error: still("error"),
  };

  // Devolvido em vez de recarregado do disco: o `Tray` exige uma imagem no
  // construtor, e é a mesma.
  return idle;
}

/** Mostra um estado, iniciando ou parando a animação conforme o caso. */
export function showIcon(tray: Tray, state: IconState): void {
  if (!animations) throw new Error("prepareIcons() precisa rodar antes");

  clearInterval(timer);
  timer = undefined;

  const { frames, frameMs } = animations[state];
  const first = frames[0];
  if (!first) return;

  tray.setImage(first);
  if (frames.length === 1) return;

  let index = 0;
  timer = setInterval(() => {
    index = (index + 1) % frames.length;
    tray.setImage(frames[index]!);
  }, frameMs);
}

/** Para a animação. Usado na saída, para não segurar o processo. */
export function stopIconAnimation(): void {
  clearInterval(timer);
  timer = undefined;
}
