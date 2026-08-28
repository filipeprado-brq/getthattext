/**
 * O blip de "pronto": duas notas curtas subindo.
 *
 * Sintetizado em vez de tocado de arquivo. São 120 ms de senóide — um
 * arquivo de som seria mais um asset para empacotar e assinar, e o
 * `AudioContext` do renderer já está aberto e pré-aquecido.
 *
 * Subindo de propósito: uma sequência ascendente lê como conclusão. O mesmo
 * som serve para "cru", porque a distinção entre reescrito e cru é do ícone
 * — dois sons diferentes obrigariam a decorar qual é qual.
 *
 * Separado do `renderer.ts` para poder ser renderizado num
 * `OfflineAudioContext` e verificado sem ninguém ouvindo:
 * `npm run verify:blip`.
 */

const BLIP_NOTES = [880, 1320];
const NOTE_S = 0.055;

/** Baixo o bastante para não assustar quem está de fone. */
const BLIP_GAIN = 0.18;

/** Folga antes da primeira nota, para o agendamento não chegar atrasado. */
const LEAD_S = 0.01;

/**
 * Agenda o blip e devolve quanto tempo ele leva, em segundos.
 *
 * Recebe `BaseAudioContext` e não `AudioContext` porque é só disso que
 * precisa — e é o que permite renderizá-lo offline na verificação.
 */
export function scheduleBlip(context: BaseAudioContext): number {
  const startAt = context.currentTime + LEAD_S;

  BLIP_NOTES.forEach((frequency, index) => {
    const at = startAt + index * NOTE_S;
    const oscillator = new OscillatorNode(context, { type: "sine", frequency });
    const envelope = new GainNode(context, { gain: 0 });

    // A rampa de 5 ms existe para não estalar: começar uma senóide em
    // amplitude cheia produz um clique audível.
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(BLIP_GAIN, at + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_S);
  });

  return LEAD_S + BLIP_NOTES.length * NOTE_S;
}

/** O que a verificação confere. Exportado para não haver dois números. */
export const BLIP = { notes: BLIP_NOTES, gain: BLIP_GAIN, noteSeconds: NOTE_S, leadSeconds: LEAD_S };
