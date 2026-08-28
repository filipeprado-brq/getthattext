/**
 * O prompt de reescrita e a limpeza defensiva da resposta.
 *
 * Puro de propósito: o prompt é a decisão mais cara da spec (seção 5, com o
 * A/B da issue 08 por trás) e a limpeza é onde um regex frouxo destrói
 * conteúdo. Os dois ficam travados em teste, longe do cliente HTTP.
 */

/**
 * O prompt da seção 5 da spec, literal.
 *
 * As travas não são precaução teórica: sem elas, com prompt mínimo,
 * `"ok pode subir"` virou `"Upload concluído com sucesso!"` — invenção
 * total. Com elas, 0 invenções em 9 amostras curtas e nomes de arquivo
 * intactos em todas.
 *
 * O limiar de 40 palavras foi medido, não estimado: pedindo brevidade
 * explícita, a fala natural saiu com 9, 14, 19, 27, 33, 35 e 37 palavras,
 * e o limiar anterior de 15 quase nunca dispararia.
 */
export const SYSTEM_PROMPT = `Você reescreve transcrições de ditado em português do Brasil.

A saída é EXCLUSIVAMENTE o texto reescrito. Nenhum preâmbulo, nenhuma
explicação, nenhuma aspas em volta. O que você responder vai direto para
a área de transferência do usuário.

O texto de entrada está em português do Brasil e a saída deve estar em
português do Brasil. Nunca traduza.

AGRESSIVIDADE PELO TAMANHO:
- Menos de 40 palavras: corrija APENAS pontuação, capitalização e
  acentuação. Não reformule, não expanda, não mude o registro.
- 40 palavras ou mais: reescreva para ficar bem escrito.

MUDE:
- disfluências ("é...", "tipo", "né", "assim", "então" de preenchimento)
- falsos começos e repetições ("no, no endpoint")
- pontuação, capitalização, acentuação e concordância
- quebra em parágrafos quando o texto for longo
- quando a pessoa se corrigir no meio, mantenha APENAS a versão corrigida

NUNCA MUDE:
- números, datas, valores, quantidades, prazos
- nomes próprios, de pessoas, empresas e produtos
- nomes de arquivos, variáveis, funções, comandos, endpoints
- siglas
- termos técnicos em inglês — mantenha em inglês
- o grau de certeza: se a pessoa disse "acho que", não afirme

NUNCA ACRESCENTE:
- informação que não está no texto
- conclusões, aprovações ou decisões que a pessoa não disse
- o final de uma frase que ficou incompleta — deixe incompleta`;

/**
 * Preâmbulos que o modelo às vezes cola apesar da instrução.
 *
 * Exigir que a frase nomeie o artefato ("o texto", "a versão") não é
 * capricho: é o que separa o preâmbulo do modelo de um ditado legítimo.
 * "Aqui está o que eu preciso:" e "Segue o link do board:" são fala de
 * verdade, e cortá-las destruiria conteúdo — pior que deixar passar um
 * preâmbulo, que você percebe e apaga.
 */
const PREAMBLES: readonly RegExp[] = [
  /^(?:aqui (?:está|vai)|segue)\s+(?:o|a)\s+(?:texto|versão|transcrição|reescrita|revisão)\b[^:\n]{0,30}:\s*/i,
  /^(?:texto|versão|transcrição)\s+(?:revisad|reescrit|corrigid)[oa]\s*:\s*/i,
];

/** Pares de aspas que o modelo usa para envolver a resposta inteira. */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
];

/**
 * Tira as aspas que envolvem o texto inteiro.
 *
 * Só corta quando o miolo não tem a mesma aspa por dentro: em
 * `"Ele disse "oi" e saiu."` as pontas parecem um par, mas cortá-las
 * quebraria o par de dentro. Na dúvida, não mexe.
 */
function unwrapQuotes(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length + close.length &&
        text.startsWith(open) &&
        text.endsWith(close)) {
      const inner = text.slice(open.length, -close.length);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }

  return text;
}

/**
 * Limpeza defensiva da resposta do Groq, antes do clipboard.
 *
 * A instrução já pede texto puro; isto é a rede embaixo dela. Toda regra
 * aqui erra para o lado de não mexer: o texto vai direto para a área de
 * transferência, e remover demais é invisível até você colar.
 */
export function cleanRewrite(answer: string): string {
  let text = answer.trim();

  for (const preamble of PREAMBLES) {
    text = text.replace(preamble, "").trim();
  }

  return unwrapQuotes(text);
}
