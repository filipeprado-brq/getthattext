/**
 * Contrato de invocação do portão de fala e leitura da saída dele.
 *
 * O portão roda ANTES da transcrição e NUNCA dentro dela. A diferença não é
 * estilística: ligar `--vad` no `whisper-cli` suprime a alucinação, mas
 * danifica conteúdo real — no corpus de 30 ditações engoliu
 * `modules/home/hooks/useMenu.ts` e perdeu uma frase inteira. Como portão
 * separado ele acertou 6 de 6, sem falso negativo na fala mais fraca.
 *
 * Puro de propósito: as flags e o formato da saída ficam travados em teste,
 * longe do `spawn` que os executa.
 */

/**
 * Monta os argumentos do `whisper-vad-speech-segments`.
 *
 * O áudio vai pelo stdin (`-f -`), como na transcrição. Ao contrário do
 * `whisper-cli`, aqui não há armadilha de `--output-*`: este binário imprime
 * a contagem no stdout sozinho.
 *
 * O limiar (`-vt`) fica no default de 0,50, o valor que o corpus mediu.
 *
 * ATENÇÃO, medido depois: 0,50 foi validado contra um corpus gravado com
 * `rec` (sox), captura crua do device — não contra o áudio deste app, que
 * vem do `getUserMedia` e passa pelo AGC, pelo supressor de ruído e pelo
 * cancelador de eco do Chromium. São cadeias de sinal diferentes, e a
 * diferença aparece: uma gravação sem fala feita pelo app (RMS 0,0045,
 * contra 0,0011 do silêncio do corpus) produziu 1 segmento e passou pelo
 * portão. A fala tem folga de 7,8x e não é afetada — só o silêncio vive na
 * faixa estreita onde a discrepância decide.
 *
 * Varredura medida: o falso positivo some em 0,60, e nenhuma amostra de
 * fala do corpus perde o único segmento que o portão exige, nem em 0,95.
 * Subir o limiar e casar a cadeia de captura são os dois caminhos; nenhum
 * foi tomado ainda por falta de mais de uma amostra de silêncio do app.
 */
export function buildVadArgs(modelPath: string): string[] {
  return [
    "-vm", modelPath,
    "-f", "-",
    "-np", // sem prints: os logs de backend poluiriam o stdout
  ];
}

/** A linha que o binário imprime antes de listar os segmentos. */
const SEGMENT_COUNT_LINE = /Detected\s+(\d+)\s+speech segments/;

/**
 * Lê quantos segmentos de fala o VAD encontrou.
 *
 * Explode quando a saída não traz a contagem. Isso é deliberado: saída
 * ilegível não é ausência de fala, e tratar as duas igual descartaria uma
 * ditação de verdade sem dizer por quê. Quem chama decide a política —
 * aqui a função só se recusa a inventar um número.
 */
export function countSpeechSegments(stdout: string): number {
  const match = SEGMENT_COUNT_LINE.exec(stdout);

  if (!match?.[1]) {
    throw new Error(
      `saída do VAD não traz a contagem de segmentos: ${JSON.stringify(stdout.trim())}`,
    );
  }

  return Number(match[1]);
}
