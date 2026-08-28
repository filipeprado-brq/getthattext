import Groq, { AuthenticationError } from "groq-sdk";
import type { Entry } from "../shared/dictionary";
import { cleanRewrite, systemPromptFor } from "../shared/rewrite";
import { clearApiKey, loadApiKey } from "./apiKey";

/**
 * A reescrita no Groq, incluindo o que fazer quando ela não acontece.
 *
 * Modelo confirmado por A/B sobre 29 transcrições reais contra o
 * `gpt-oss-120b`, que perdeu no caso mais difícil: manteve as duas versões
 * de uma auto-correção onde o 20b escolheu a certa.
 */
const MODEL = "openai/gpt-oss-20b";

/**
 * Os defaults do SDK (60 s, 2 retries) são de servidor, não de ditado: aqui
 * o texto cru já está pronto e esperar meio minuto por uma melhoria é pior
 * que colar o cru.
 *
 * `maxRetries: 1` é 1 RETENTATIVA, não 1 tentativa — no pior caso são duas
 * chamadas e ~20 s. É o valor que a spec fixa (seção 5); a prosa do ticket
 * 12 fala em 10 s, e as duas não batem.
 */
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;

/** Baixa o bastante para não reescrever criativamente. Valor da spec. */
const TEMPERATURE = 0.3;

/**
 * Teto de saída. Medido: uma ditação de 246 palavras — perto do limite de
 * 2 minutos que a gravação permite — consumiu 316 tokens de completion,
 * já contando o raciocínio oculto. 800 dá cerca do dobro de folga.
 *
 * A folga não é infinita, e por isso `finish_reason` é conferido: entregar
 * uma reescrita cortada no meio da frase seria pior que entregar o cru.
 */
const MAX_COMPLETION_TOKENS = 800;

/**
 * Por que a reescrita não aconteceu.
 *
 * Código, não a frase. A abertura das preferências depende de reconhecer a
 * chave recusada, e comparar a mensagem em português faria editar o texto
 * quebrar o comportamento em silêncio.
 */
export type RawReason =
  | "no-key"
  | "unreadable-key"
  | "rejected-key"
  | "no-answer"
  | "empty-answer"
  | "truncated";

/** O que aconteceu com a tentativa de reescrever a transcrição. */
export type Rewritten =
  | { kind: "rewritten"; text: string }
  | { kind: "raw"; reason: RawReason; why: string };

/** A chave que o Groq recusou — a única falha que exige ação sua. */
function isInvalidApiKey(error: unknown): boolean {
  return error instanceof AuthenticationError;
}

/**
 * Chama o Groq e devolve o texto puro, ou o motivo de ficar no cru.
 *
 * A chave chega por parâmetro e não é guardada aqui: ela nunca sai do main
 * process, e quem a lê do Keychain é o `apiKey.ts`.
 */
export async function rewrite(
  transcript: string,
  apiKey: string,
  entries: readonly Entry[],
): Promise<Rewritten> {
  const client = new Groq({
    apiKey,
    timeout: TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    // `dangerouslyAllowBrowser` fica fora de propósito: isto roda no main,
    // e ligá-lo é o caminho por onde a chave vazaria para o renderer.
  });

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPromptFor(entries, transcript) },
      { role: "user", content: transcript },
    ],
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    reasoning_effort: "low",
    reasoning_format: "hidden",
    // Streaming é o que a spec pede. Nada consome os incrementos hoje; o
    // ganho é o primeiro byte chegar antes, o que passa a importar quando
    // houver indicador de progresso.
    stream: true,
  });

  let answer = "";
  let finishReason: string | null | undefined;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    answer += choice?.delta?.content ?? "";
    finishReason = choice?.finish_reason ?? finishReason;
  }

  // Bater no teto significa frase cortada no meio — o prompt proíbe até
  // COMPLETAR uma frase incompleta, então entregar uma é pior que o cru.
  if (finishReason === "length") {
    return { kind: "raw", reason: "truncated", why: "a reescrita bateu no teto de tokens" };
  }

  const text = cleanRewrite(answer);
  if (text.length === 0) {
    return { kind: "raw", reason: "empty-answer", why: "o Groq devolveu vazio" };
  }

  return { kind: "rewritten", text };
}

/**
 * Reescreve, degradando para o cru em vez de perder a ditação.
 *
 * Nenhuma falha aqui pode custar o texto: o cru já está pronto e é bom o
 * bastante para colar. Por isso todo caminho de erro devolve `raw` com o
 * motivo, e o único que exige ação sua — chave recusada — apaga a chave,
 * porque continuar tentando com ela seria queimar 20 s por ditação.
 *
 * Abrir as preferências nesse caso é do #9, que ainda não existe.
 */
export async function rewriteOrRaw(
  transcript: string,
  entries: readonly Entry[],
): Promise<Rewritten> {
  let apiKey: string | undefined;
  try {
    apiKey = await loadApiKey();
  } catch (error) {
    console.error("não foi possível ler a chave do Groq:", describe(error));
    return { kind: "raw", reason: "unreadable-key", why: "chave ilegível" };
  }

  // Sem chave não é falha: é o modo cru, e ele não bloqueia nada.
  if (apiKey === undefined) {
    return { kind: "raw", reason: "no-key", why: "sem chave configurada" };
  }

  try {
    return await rewrite(transcript, apiKey, entries);
  } catch (error) {
    if (isInvalidApiKey(error)) {
      console.error("o Groq recusou a chave; apagando a chave guardada");
      await clearApiKey().catch((failure) =>
        console.error("falha ao apagar a chave:", describe(failure)),
      );
      return { kind: "raw", reason: "rejected-key", why: "chave recusada pelo Groq" };
    }

    console.error("reescrita falhou:", describe(error));
    return { kind: "raw", reason: "no-answer", why: "o Groq não respondeu" };
  }
}

/**
 * Reduz um erro à mensagem antes de logar.
 *
 * Despejar o objeto inteiro do SDK arrasta o `cause` cru do fetch, que numa
 * falha de conexão pode carregar detalhes da requisição — e a requisição
 * leva a chave no header.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
