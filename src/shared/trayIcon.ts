/**
 * A animação do ícone da barra: curvas de opacidade e o alfa do bitmap.
 *
 * Puro de propósito, e por dois motivos. As curvas são decisão de desenho
 * que vale travar em teste, e a escala de alfa é o tipo de laço onde um
 * índice errado passa despercebido — o ícone só fica "meio estranho".
 *
 * Isto existe para não precisar de quadros pré-renderizados no disco: a
 * respiração é variação de opacidade sobre o mesmo PNG. Quem aplica e
 * quando é `src/main/trayIcon.ts`.
 */

/** Os sete desenhos da seção 7 da spec. */
export type IconState =
  | "idle"
  | "opening"
  | "recording"
  | "processing"
  | "ready"
  | "ready-raw"
  | "error";

/** Um ponto da curva: em que fração do ciclo, com que opacidade. */
export type Keyframe = { readonly at: number; readonly opacity: number };

/**
 * Gravando: quase um piscar lento, não um seno.
 *
 * Fica aceso até 44% do ciclo, apaga rápido, segura apagado, e volta. Um
 * seno pareceria respiração calma; o que se quer aqui é "isto está vivo e
 * gravando". A cor já carrega o alarme — o movimento só confirma.
 */
export const RECORDING_BREATH: readonly Keyframe[] = [
  { at: 0, opacity: 1 },
  { at: 0.44, opacity: 1 },
  { at: 0.55, opacity: 0.18 },
  { at: 0.94, opacity: 0.18 },
  { at: 1, opacity: 1 },
];

/** 1,7 s, o período que a spec fixa na seção 7. */
export const RECORDING_PERIOD_MS = 1700;

/**
 * Abrindo o microfone: some menos, em ritmo diferente.
 *
 * Precisa ser distinguível de "gravando" de relance — se os dois pulsassem
 * igual, o estado que existe justamente para dizer "ainda não estou
 * gravando" seria lido como "estou".
 */
export const OPENING_BREATH: readonly Keyframe[] = [
  { at: 0, opacity: 0.35 },
  // Nunca chega a 1: a spec pede contorno ESMAECIDO, e no pico o desenho
  // ficaria idêntico ao de ocioso — o estado que existe para dizer "ainda
  // não estou gravando" seria lido como "não está acontecendo nada".
  { at: 0.5, opacity: 0.75 },
  { at: 1, opacity: 0.35 },
];

export const OPENING_PERIOD_MS = 1400;

/** Suaviza a passagem entre dois quadros, como o `ease-in-out` do CSS. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * A opacidade numa fração do ciclo.
 *
 * `phase` dá a volta: 1,44 é o mesmo que 0,44, e negativo conta de trás.
 * Sem isso, o relógio da animação precisaria de aritmética de módulo em
 * cada chamador.
 */
export function opacityAt(keyframes: readonly Keyframe[], phase: number): number {
  const wrapped = ((phase % 1) + 1) % 1;

  let previous = keyframes[0];
  if (!previous) return 1;

  for (const frame of keyframes) {
    if (frame.at >= wrapped) {
      const span = frame.at - previous.at;
      if (span <= 0) return frame.opacity;

      const t = easeInOut((wrapped - previous.at) / span);

      return previous.opacity + (frame.opacity - previous.opacity) * t;
    }
    previous = frame;
  }

  return previous.opacity;
}

/**
 * Devolve o bitmap com o alfa multiplicado.
 *
 * O quarto byte de cada pixel é o alfa tanto em RGBA quanto em BGRA — o que
 * muda entre os dois é a ordem das cores. Como só o alfa é tocado, esta
 * função não precisa saber qual dos dois o Electron entregou.
 */
export function scaleAlpha(bitmap: Uint8Array, opacity: number): Uint8Array {
  const clamped = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity;
  const out = new Uint8Array(bitmap);

  for (let i = 3; i < out.length; i += 4) {
    out[i] = Math.round(out[i]! * clamped);
  }

  return out;
}
