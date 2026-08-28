/**
 * Os provedores de reescrita.
 *
 * Só um está disponível hoje. O catálogo existe assim mesmo porque a tela
 * passou a pedir PROVEDOR antes da chave: sem lista, "Groq" ficaria cravado
 * no HTML e no texto de ajuda, e ligar o segundo provedor viraria reescrever
 * duas telas em vez de acrescentar uma linha aqui.
 *
 * `available: false` é anúncio, não promessa: a opção aparece desabilitada
 * para a escolha não parecer única quando ela não é.
 */
export type Provider = {
  id: string;
  /** Como aparece na tela. */
  name: string;
  /** O modelo que faz a reescrita — a tela não esconde o que roda. */
  model: string;
  /** Como a chave começa, para o campo dizer o que espera. */
  keyPrefix: string;
  /** Onde a chave é emitida. */
  keyUrl: string;
  /** Dá para escolher agora? */
  available: boolean;
};

export const PROVIDERS: readonly Provider[] = [
  {
    id: "groq",
    name: "Groq",
    // Confirmado por A/B sobre 29 transcrições reais contra o `gpt-oss-120b`.
    model: "openai/gpt-oss-20b",
    keyPrefix: "gsk_",
    keyUrl: "https://console.groq.com/keys",
    available: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    model: "gpt-4o-mini",
    keyPrefix: "sk-",
    keyUrl: "https://platform.openai.com/api-keys",
    available: false,
  },
  {
    id: "xai",
    name: "xAI Grok",
    model: "grok-3-mini",
    keyPrefix: "xai-",
    keyUrl: "https://console.x.ai",
    available: false,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    model: "claude-haiku-4-5",
    keyPrefix: "sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
    available: false,
  },
];

/** O provedor de quem não escolhe. */
export const DEFAULT_PROVIDER = "groq";

/**
 * O provedor pelo id, caindo no padrão quando ele não existe mais.
 *
 * Preferência editada à mão, ou vinda de uma versão que oferecia outro
 * provedor, não pode virar "sem provedor" — a reescrita ficaria desligada
 * sem ninguém ter desligado.
 */
export function providerFor(id: string): Provider {
  return (
    PROVIDERS.find((provider) => provider.id === id && provider.available) ??
    PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER)!
  );
}

/** É um provedor que dá para usar hoje? */
export function isUsableProvider(value: unknown): boolean {
  return PROVIDERS.some((provider) => provider.id === value && provider.available);
}
