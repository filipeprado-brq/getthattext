# API do Groq

Type: research
Status: resolved

## Question

Como o passo de reescrita via Groq funciona na prática, a partir de um app Electron?

Cobrir:
- `groq-sdk` (npm oficial): estado, como se usa, se funciona no main process do Electron
- **Quais modelos de chat estão disponíveis hoje** no Groq, e quais são adequados para reescrita de texto curto em português — qualidade em pt-BR importa mais que benchmark geral
- **Latência real** — Groq é rápido, mas quanto? Tempo até o primeiro token e tempo total para uma reescrita de ~200 palavras
- **Rate limits e custo** do tier gratuito e dos pagos
- **Onde guardar a API key** num app Electron desktop: Keychain do macOS via `safeStorage` do Electron ou módulo nativo? O que NÃO fazer (key em arquivo de config em texto claro)
- Comportamento de erro: timeout, rate limit atingido, key inválida, sem rede — que erros o SDK levanta e como distingui-los
- Se dá pra usar o Groq para transcrição também (`whisper-large-v3`) — **não para adotar**, que já foi decidido contra, mas para registrar o que se está abrindo mão

Gravar achados em `.scratch/getthattext/research/api-do-groq.md`.

## Answer

Achados completos, com fontes e datas: [`research/api-do-groq.md`](../research/api-do-groq.md) (pesquisa de 2026-08-26).

**Decisões travadas:**

- **Modelo: `openai/gpt-oss-20b`**, com `reasoning_effort: "low"`, `reasoning_format: "hidden"`, `temperature` 0,3–0,5, `max_completion_tokens` ~800, `stream: true`. É o único do catálogo com dado primário **por idioma** de português (MMMLU `PT_BR` 80,5 em `high` — acima da própria média multilíngue), o mais rápido (~1000 t/s), o mais barato (~6.300 reescritas por dólar) e é Production, não Preview.
- **`openai/gpt-oss-120b` fica como fallback de qualidade atrás de flag** (2× o custo, ~2× mais lento, +4,8 pts em MMMLU-PT). O model ID vive em configuração, **nunca hardcoded** — o catálogo já rotacionou os Llama para fora do self-serve.
- **Chave: `safeStorage.encryptStringAsync`** + ciphertext em `userData/groq.key.enc` com `0o600`. Usa o Keychain do macOS **sem módulo nativo**. `keytar` está arquivado desde 2022 e não é opção viva. Chave só no main process; renderer fala por IPC e a chave nunca cruza o IPC; nunca `dangerouslyAllowBrowser`; se `isAsyncEncryptionAvailable()` for falso, **falha e avisa** — nunca degrada para texto claro.
- **Cliente: `timeout: 10_000, maxRetries: 1`.** Os defaults do SDK (60 s × 3 tentativas) são de servidor, não de UI — deixá-los prenderia o usuário por até ~3 minutos num 429 ou queda de rede.
- **`groq-sdk` 1.6.0** funciona no main process do Electron sem ajuste (a trava de browser checa `window`, falso no main). Zero dependências de runtime, Apache-2.0, manutenção ativa.

**Fatos que outros tickets dependem:**

- **Latência do passo Groq: ~0,9–1,4 s total, primeiro token < 1 s** para ~200 palavras. Estimativa derivada dos t/s publicados + exemplo oficial da API reference; o Groq não publica TTFT absoluto.
- **Free tier: 8.000 TPM é o gargalo, não os 30 RPM.** ≈ 8–9 reescritas/minuto e ≈ 220/dia. Rajadas **vão** bater em 429. Developer tier sobe TPM para 250.000.
- **Erros:** `APIError` expõe só `status`/`headers`/`error` — **não tem `.code`/`.param`** como o SDK da OpenAI. Headers de rate limit vêm em toda resposta; `retry-after` só em 429.
- **Assinatura do app no macOS é requisito funcional do Keychain** — sem assinatura consistente ele re-pergunta a cada atualização. Isso não é preocupação de distribuição; entra em Empacotamento e execução.

**Lacuna deliberada:** não existe benchmark público de **qualidade generativa** em pt-BR para nenhum modelo do Groq. MMMLU mede conhecimento, não fluência de escrita. Isso vira ticket próprio.

**O que se abriu mão ao manter o Whisper local:** `whisper-large-v3` no Groq custa $0,111/h de áudio, com speed factor 189× e WER 10,3%.
