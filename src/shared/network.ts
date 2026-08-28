/**
 * Reconhecer falha de rede, para poder tentar de novo.
 *
 * Puro e em `shared/` porque a decisão "isto vale outra tentativa" precisa
 * ser testável: o `fetch` do Node embrulha tudo num `TypeError: fetch
 * failed` e põe o motivo real no `cause`, então distinguir "o servidor
 * recusou" de "o disco encheu" é leitura de estrutura, não de prosa.
 *
 * MEDIDO, e é o que motiva o módulo: um download de modelo morreu com
 * `UND_ERR_CONNECT_TIMEOUT` num endereço IPv6 do CloudFront. Minutos depois,
 * IPv4 e IPv6 do mesmo host respondiam em 60 ms — o nó de borda daquele
 * momento é que estava inalcançável. Falha assim não é para reportar, é
 * para repetir: cada tentativa nova resolve o DNS de novo e costuma cair em
 * outro nó.
 */

/**
 * Os códigos que significam "a conexão não aconteceu".
 *
 * Todos são de transporte, não de conteúdo: nenhum deles diz que o servidor
 * respondeu alguma coisa. Um 404 ou um 416 são outra conversa — esses não
 * melhoram tentando de novo, e por isso não estão aqui.
 */
const RETRYABLE = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

/** O código de erro, se houver, em qualquer nível do `cause`. */
function codesOf(error: unknown, depth = 3): string[] {
  if (depth <= 0 || typeof error !== "object" || error === null) return [];

  const { code, cause } = error as { code?: unknown; cause?: unknown };

  return [
    ...(typeof code === "string" ? [code] : []),
    ...codesOf(cause, depth - 1),
  ];
}

/**
 * Vale tentar de novo?
 *
 * O cancelamento NÃO vale: fechar a janela aborta o download de propósito,
 * e repetir seria reabrir sozinho o que você acabou de fechar.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;

  const codes = codesOf(error);
  if (codes.some((code) => RETRYABLE.has(code))) return true;

  // Sem `cause` legível, sobra a assinatura do `fetch` do Node: ele embrulha
  // qualquer falha de transporte neste TypeError.
  return (
    error instanceof TypeError && error.message.toLowerCase().includes("fetch failed")
  );
}

/**
 * O que dizer quando as tentativas acabaram.
 *
 * Diz onde parou de funcionar e o que NÃO se perdeu: o `.part` fica no
 * disco, e clicar em Baixar de novo retoma de onde estava. Sem essa frase,
 * quem viu meio giga pela metade supõe que vai recomeçar do zero.
 */
export function networkFailureMessage(host: string): string {
  return (
    `Não foi possível falar com ${host}. Verifique a conexão e clique em ` +
    "Baixar de novo — o que já veio fica no disco e o download continua de onde parou."
  );
}
