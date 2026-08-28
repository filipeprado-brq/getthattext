/**
 * Contrato de invocação do `whisper-cli` e limpeza da saída dele.
 *
 * Puro de propósito: as flags e o formato do texto são decisões da spec
 * (seção 3) que valem a pena travar em teste, separadas do `spawn`.
 */

/**
 * Monta os argumentos da transcrição.
 *
 * O áudio vai pelo stdin (`-f -`), sem arquivo temporário. O modo é o de
 * menor latência: greedy e sem temperature fallback.
 *
 * Duas ausências são deliberadas: `--prompt`, porque é apagado após a
 * primeira janela de 30 s e some de vez no áudio difícil; e `--vad`, porque
 * dentro da transcrição ele engole conteúdo real — o portão de fala roda
 * separado, antes.
 */
export function buildWhisperArgs(modelPath: string, language: string): string[] {
  return [
    "-m", modelPath,
    "-f", "-",
    // `auto` é aceito pelo whisper e significa detectar. É questão aberta
    // declarada na spec (seção 13): nunca foi testado, e o corpus inteiro
    // rodou com o idioma forçado.
    "-l", language,
    "-nt",  // sem timestamps
    "-np",  // sem prints de progresso
    "-sns", // suprime tokens de não-fala
    "-bs", "1", // greedy
    "-nf",  // sem temperature fallback
    // Obrigatórios quando a entrada é stdin, e a razão não é óbvia: o
    // whisper-cli deriva o nome do arquivo de saída do nome da entrada.
    // Com entrada "-", a saída vira "-", e sem um formato --output-*
    // pedido explicitamente ele NÃO imprime a transcrição em lugar nenhum:
    // lê o áudio, transcreve, e descarta. Medido — com "-f -" sozinho o
    // stdout volta vazio e o exit code é 0.
    "-otxt", "-of", "-",
  ];
}

/**
 * Normaliza a saída do whisper para o que vai à área de transferência.
 *
 * Ele recua cada linha e quebra por segmento; para colar, isso é um
 * parágrafo só. Ausência de fala precisa virar string vazia, não espaço.
 */
export function cleanTranscript(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}
