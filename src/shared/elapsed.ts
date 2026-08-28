/**
 * O tempo de gravação, como ele aparece na barra de menu.
 *
 * Existe separado porque a regra 3 do CODING_STANDARDS proíbe exatamente o
 * jeito óbvio de fazer isto:
 *
 *   // ✗ formatação de número à mão
 *   `${minutes}:${String(seconds).padStart(2, "0")}`
 *
 * `Intl` cuida do preenchimento, e o locale é explícito para o separador
 * não mudar conforme a máquina.
 */

const SECONDS_PER_MINUTE = 60;

/** Segundos sempre com dois dígitos; minutos sem preenchimento. */
const seconds = new Intl.NumberFormat("pt-BR", {
  minimumIntegerDigits: 2,
  useGrouping: false,
});
const minutes = new Intl.NumberFormat("pt-BR", { useGrouping: false });

/**
 * `mm:ss` do tempo decorrido.
 *
 * Trunca em vez de arredondar: `0:01` só aparece quando um segundo de fato
 * passou. Arredondar mostraria `0:01` com 600 ms, e o número mentiria sobre
 * o que está no WAV.
 */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.floor(Math.max(0, elapsedMs) / 1000);

  return `${minutes.format(Math.floor(total / SECONDS_PER_MINUTE))}:${seconds.format(
    total % SECONDS_PER_MINUTE,
  )}`;
}
