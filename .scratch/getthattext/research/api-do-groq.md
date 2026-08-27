# API do Groq — reescrita de texto a partir de um app Electron

**Data da pesquisa: 2026-08-26.** Todos os números abaixo foram lidos das páginas oficiais nesta data.
O catálogo de modelos do Groq muda rápido — o próprio doc marca modelos "Preview" como sujeitos a
descontinuação sem aviso ([deprecations](https://console.groq.com/docs/deprecations)). **Reconfira
`console.groq.com/docs/models` antes de fixar um model ID no código.**

Fontes primárias usadas: docs oficiais do Groq (`console.groq.com/docs/*`, inclusive as versões
`.md` das páginas), o repositório oficial `groq/groq-typescript` no GitHub, o registry do npm, a
documentação oficial do Electron, e o model card do gpt-oss publicado pela OpenAI (arXiv 2508.10925).

---

## 1. `groq-sdk` (npm oficial)

| Item | Valor | Fonte |
|---|---|---|
| Pacote | `groq-sdk` | <https://www.npmjs.com/package/groq-sdk> |
| Versão mais recente | **1.6.0**, publicada em **2026-08-26** | <https://registry.npmjs.org/groq-sdk> (campos `dist-tags` e `time`) |
| Histórico recente | 1.0.0 (2026-03-11), 1.1.x (mar), 1.2.x (mai), 1.3.0 (jun), 1.4.x (jul), 1.5.0 (2026-07-31), 1.6.0 (2026-08-26) — 53 versões no total | idem |
| Licença | Apache-2.0 | idem |
| Dependências de runtime | **nenhuma** (`dependencies: {}`) | idem |
| Repositório | <https://github.com/groq/groq-typescript> | idem |
| Gerado por | Stainless (mesmo gerador do SDK da OpenAI) | <https://github.com/groq/groq-typescript#readme> |

**Manutenção:** ativa e frequente — houve release no próprio dia desta pesquisa e pelo menos um
release por mês desde março/2026. O SDK saiu de `0.x` para `1.0.0` em março/2026, então já está em
versionamento semântico estável (com as ressalvas de SemVer que o README lista).

### Runtimes suportados (README oficial)

> - Node.js 20 LTS ou posterior (versões não-EOL)
> - Deno v1.28.0+, Bun 1.0+, Cloudflare Workers, Vercel Edge Runtime, Nitro v2.6+
> - Jest 28+ com ambiente `"node"` (`"jsdom"` não é suportado)
> - **Web browsers: desabilitado por padrão para evitar expor suas credenciais secretas.**
>   Habilite com `dangerouslyAllowBrowser: true`.
> - React Native não é suportado.

Fonte: <https://github.com/groq/groq-typescript#requirements>

### Funciona no main process do Electron?

**Sim, sem nenhum ajuste.** A primeira linha do README é literal: *"This library provides convenient
access to the Groq REST API from **server-side** TypeScript or JavaScript."*

A trava de browser é implementada assim (`src/internal/detect-platform.ts`):

```ts
export const isRunningInBrowser = () => {
  return (
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof navigator !== 'undefined'
  );
};
```

<https://github.com/groq/groq-typescript/blob/main/src/internal/detect-platform.ts>

E no construtor (`src/client.ts`, ~linha 189):

```ts
if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
  throw new Errors.GroqError(
    "It looks like you're running in a browser-like environment. ..."
  );
}
```

No **main process** do Electron não existem `window`, `window.document` nem `navigator`, então
`isRunningInBrowser()` retorna `false` e o cliente instancia normalmente. O SDK usa `fetch` global
(Node 20+ tem), sem dependências nativas — nada de `rebuild`/`electron-rebuild`.

No **renderer**, `window`/`document`/`navigator` existem: o construtor **lança erro** a menos que
você passe `dangerouslyAllowBrowser: true`. **Não faça isso.** Passar a chave para o renderer
significa colocá-la no bundle/memória do processo web — qualquer XSS, extensão, ou DevTools aberto
expõe a chave. O próprio doc de segurança do Groq é explícito:

> "**Warning:** Never embed keys in frontend code or expose them in browser bundles. If you need
> client-side usage, route through a trusted backend proxy."

<https://console.groq.com/docs/production-readiness/security-onboarding>

**Arquitetura correta no Electron:** o cliente Groq vive **só no main process**; o renderer manda
o texto por `ipcRenderer.invoke('rewrite', texto)` via `contextBridge` no preload, e recebe o
resultado (ou os deltas do stream). A chave nunca cruza o IPC.

### Uso mínimo

```ts
import Groq from 'groq-sdk';

const client = new Groq({ apiKey /* lido do Keychain, ver §6 */ });

const completion = await client.chat.completions.create({
  model: 'openai/gpt-oss-20b',
  messages: [
    { role: 'system', content: 'Reescreva o texto do usuário em pt-BR ... (regras)' },
    { role: 'user', content: texto },
  ],
});
```

Streaming (recomendado para reescrita, ver §4):

```ts
const stream = await client.chat.completions.create({
  model: 'openai/gpt-oss-20b',
  messages: [...],
  stream: true,
});
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) enviaParaRenderer(delta);
}
```

Exemplo oficial em JS: <https://console.groq.com/docs/production-readiness/optimizing-latency>

---

## 2. Modelos de chat disponíveis hoje (2026-08-26)

### Modelos de produção

| Model ID | Velocidade (t/s, doc Groq) | Preço /1M tokens | Contexto | Máx. saída | Observação |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | ~500 | $0,15 in / $0,60 out (cache in $0,075) | 131.072 | 65.536 | MoE 120B (5,1B ativos). Raciocínio, tool use, JSON schema |
| `openai/gpt-oss-20b` | ~1000 | $0,075 in / $0,30 out (cache in $0,037) | 131.072 | 65.536 | MoE 20B (3,6B ativos). O mais rápido do catálogo |
| `llama-3.1-8b-instant` | 560 | **Contact Sales (Enterprise)** | 131.072 | 131.072 | Não está no self-serve |
| `llama-3.3-70b-versatile` | 280 | **Contact Sales (Enterprise)** | 131.072 | 32.768 | Não está no self-serve |

### Sistemas de produção (agentic)

| Model ID | Velocidade | Contexto | Máx. saída |
|---|---|---|---|
| `groq/compound` | ~450 t/s | 131.072 | 8.192 |
| `groq/compound-mini` | ~450 t/s | 131.072 | 8.192 |

### Preview (evitar em produção)

| Model ID | Velocidade | Preço /1M | Contexto | Máx. saída |
|---|---|---|---|---|
| `qwen/qwen3.6-27b` | ~500 t/s | $0,60 in / $3,00 out | 131.072 | 16.384 |
| `qwen/qwen3.8-27b` | n/d | **n/d** (página do modelo não renderiza os preços em HTML estático) | 131.072 | n/d |
| `openai/gpt-oss-safeguard-20b` | ~1000 t/s | $0,075 / $0,30 | 131.072 | 65.536 | (moderação, não reescrita) |
| `minimaxai/minimax-m2.7` | 260 t/s | Contact Sales | 196.608 | 131.072 |
| `meta-llama/llama-prompt-guard-2-{22m,86m}` | — | $0,03–0,04 | 512 | 512 | (guardrail, não chat) |

Fonte da tabela toda: <https://console.groq.com/docs/models> (versão markdown: `…/docs/models.md`),
mais as fichas individuais <https://console.groq.com/docs/model/openai/gpt-oss-120b>,
<https://console.groq.com/docs/model/openai/gpt-oss-20b>,
<https://console.groq.com/docs/model/qwen/qwen3.6-27b>.

> ⚠️ **Achado importante e contra-intuitivo:** os Llama (3.1-8B e 3.3-70B), que historicamente eram
> "o" modelo padrão do Groq, hoje aparecem marcados como **Enterprise / Contact Sales** na tabela de
> modelos e **não aparecem em nenhuma das tabelas de rate limit (nem Free, nem Developer)**. Na
> prática, para uma conta self-serve (free ou paga por cartão) os modelos de chat disponíveis são:
> `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`, `qwen/qwen3.6-27b`,
> `qwen/qwen3.8-27b` e os `groq/compound*`. Não verifiquei isso com uma chave real — verifique
> chamando `GET https://api.groq.com/openai/v1/models` com a sua chave antes de decidir.

### Qualidade em pt-BR — dados de avaliação multilíngue

O único dado **primário e por idioma** que encontrei é o MMMLU do model card oficial do gpt-oss.
MMMLU é o MMLU traduzido **por tradutores humanos profissionais** para 14 idiomas, e
**`PT_BR` (português brasileiro) é um deles** — não é português europeu nem tradução automática.
Fonte do dataset: <https://huggingface.co/datasets/openai/MMMLU>.

Resultados MMMLU, linha "Portuguese" (Tabela 2 do model card):

| Modelo / esforço de raciocínio | low | medium | high |
|---|---|---|---|
| **gpt-oss-120b — Português** | 80,0 | 83,3 | **85,3** |
| **gpt-oss-20b — Português** | 73,3 | 79,2 | **80,5** |
| gpt-oss-120b — média 14 idiomas | 74,1 | 79,3 | 81,3 |
| gpt-oss-20b — média 14 idiomas | 67,0 | 73,5 | 75,7 |
| (referência) OpenAI o4-mini high — Português | — | — | 87,8 |

Fonte: *gpt-oss-120b & gpt-oss-20b Model Card*, OpenAI, Tabela 2 — <https://arxiv.org/html/2508.10925v1>
(também em <https://openai.com/index/gpt-oss-model-card/>).

**Leitura desses números:** o português é, junto com o espanhol e o italiano, um dos **idiomas mais
fortes** de ambos os modelos — fica consistentemente **acima da média das 14 línguas** (+4,0 pts para
o 120b em `high`, +4,8 pts para o 20b). Isso é o oposto do swahili (72,3) e do iorubá (62,4), onde os
modelos claramente degradam. Ou seja: pt-BR **não** é um idioma de cauda longa para a família gpt-oss.

**Ressalvas honestas que preciso registrar:**

1. **MMMLU mede conhecimento/raciocínio em português, não qualidade de escrita em português.**
   Reescrita de texto curto depende de naturalidade, registro, concordância, colocação pronominal e
   de não escorregar para português europeu — nada disso é medido por MMMLU. **Não achei nenhuma
   avaliação primária de qualidade generativa em pt-BR** para nenhum modelo hospedado no Groq.
   Para essa decisão, o único caminho honesto é um teste A/B próprio com ~30 amostras reais do app.
2. **Não encontrei nenhum dado de avaliação multilíngue publicado para o `qwen/qwen3.6-27b` nem para
   o `qwen/qwen3.8-27b`.** As fichas do Groq só listam GPQA, AIME, LiveCodeBench, SWE-bench,
   Terminal-Bench e IFBench — todos benchmarks de raciocínio/código, nenhum multilíngue. A ficha
   afirma "strong multilingual support" sem número. **Isso é marketing, não evidência.**
3. Os números MMMLU acima foram medidos pela OpenAI nos pesos originais. O Groq roda os modelos com
   quantização própria ("TruePoint Numerics"), que a Groq afirma preservar a qualidade
   (<https://groq.com/blog/inside-the-lpu-deconstructing-groq-speed>). **Não há avaliação de terceiros
   confirmando que a versão quantizada no Groq bate os números do model card.** Trate os valores como
   teto, não como garantia.

### Adequação para reescrita de texto curto em pt-BR

- **`openai/gpt-oss-20b`** — melhor custo/latência. 80,5 em MMMLU-Português em `high`. Para reescrita
  (tarefa de baixa dificuldade cognitiva, alta exigência de fluência), o gap de ~5 pts para o 120b
  provavelmente não aparece. É o mais rápido do catálogo (~1000 t/s).
- **`openai/gpt-oss-120b`** — 85,3 em MMMLU-Português, 4× mais caro na saída, ~metade da velocidade.
  Vale como *fallback* de qualidade se o A/B mostrar que o 20b erra registro/naturalidade.
- **`qwen/qwen3.6-27b` / `qwen3.8-27b`** — são *Preview* (podem sumir sem aviso) e $3,00/1M na saída
  do 3.6 (**10× o gpt-oss-20b**), sem nenhum dado público de qualidade em pt-BR. Não compensam para
  esse caso de uso.
- **`groq/compound*`** — sistemas agênticos com web search embutido. Overhead desnecessário e errado
  para reescrita.

**Detalhe operacional crítico:** gpt-oss e Qwen são **modelos de raciocínio**
(<https://console.groq.com/docs/reasoning>). Por padrão eles gastam tokens de *chain-of-thought*
antes da resposta — o que custa dinheiro, latência e polui a saída. Para reescrita você quer:

- `reasoning_effort: "low"` (gpt-oss aceita `low`/`medium`/`high`);
  no Qwen 3.6/3.8 existe `reasoning_effort: "none"`, que desliga o raciocínio de vez.
- `reasoning_format: "hidden"` (ou `include_reasoning: false`) para o campo de conteúdo vir só com a
  resposta final. Os dois parâmetros são **mutuamente exclusivos** — usar os dois dá erro.

Fonte: <https://console.groq.com/docs/reasoning>

---

## 3. Custo por reescrita

Premissas (declaradas para você poder recalcular): 200 palavras em pt-BR ≈ **320–400 tokens**
(português tokeniza pior que inglês, ~1,6–2,0 tokens/palavra em tokenizers tipo o200k). System prompt
de reescrita ≈ 150 tokens. Logo: **entrada ≈ 500 tokens, saída ≈ 400 tokens** (mais eventuais tokens
de raciocínio, que são cobrados como saída).

| Modelo | Entrada (500 tok) | Saída (400 tok) | **Total/reescrita** | Reescritas por US$ 1 |
|---|---|---|---|---|
| `openai/gpt-oss-20b` | $0,0000375 | $0,000120 | **≈ $0,00016** | **≈ 6.300** |
| `openai/gpt-oss-120b` | $0,000075 | $0,000240 | **≈ $0,00032** | **≈ 3.100** |
| `qwen/qwen3.6-27b` | $0,000300 | $0,001200 | **≈ $0,0015** | ≈ 670 |

Preços de <https://console.groq.com/docs/models>. Os totais são cálculo meu a partir desses preços,
não números publicados pelo Groq.

Nota: o Groq tem **prompt caching** e tokens em cache **não contam para o rate limit**
(<https://console.groq.com/docs/rate-limits>). Como o system prompt de reescrita é fixo, ele tende a
cair no cache (input cacheado sai pela metade: $0,037/1M no 20b), o que ajuda tanto no custo quanto
no TPM.

---

## 4. Latência real

### O que o Groq publica

**Velocidade de geração por modelo** (<https://console.groq.com/docs/models>):
`gpt-oss-20b` ~1000 t/s · `gpt-oss-120b` ~500 t/s · `qwen3.6-27b` ~500 t/s · `compound` ~450 t/s.

**Fórmula oficial** (<https://console.groq.com/docs/production-readiness/optimizing-latency>):

```
Total Latency = TTFT + Decoding Time + Network Round Trip
onde  TTFT = Queueing Time + Prompt Prefill Time
      Decoding Time = Output Tokens / Generation Speed
```

O mesmo doc diz que TTFT escala **linearmente** com o número de tokens de entrada, e que para
entradas pequenas (~100 tokens) e contextos padrão (~1K tokens) o TTFT é "consistentemente rápido" /
"altamente responsivo" — mas **não publica um número de TTFT**. Também avisa: as métricas do console
são **só do lado servidor**; a latência que o usuário sente inclui a rede.

**Exemplo real da própria doc do Groq** (bloco "Example Response" do
<https://console.groq.com/docs/api-reference>), rodando `openai/gpt-oss-20b`:

```json
"usage": {
  "queue_time": 0.037493756,
  "prompt_tokens": 18,
  "prompt_time": 0.000680594,
  "completion_tokens": 556,
  "completion_time": 0.463333333,
  "total_tokens": 574,
  "total_time": 0.464013927
}
```

Ou seja: **556 tokens gerados em 0,463 s ≈ 1.200 t/s**, com fila de 37 ms e prefill de 0,7 ms —
tempo de servidor total de **0,46 s**. Todo response do Groq traz esse objeto `usage`; use-o para
medir a latência de servidor em produção e subtrair da medição do cliente para isolar a rede.

### Benchmark de terceiros (recomendado pela própria doc do Groq)

A doc do Groq diz textualmente: *"We recommend visiting Artificial Analysis for third-party
performance benchmarks across all models hosted on GroqCloud"*. Números lidos em
<https://artificialanalysis.ai/providers/groq> nesta data (a página **não** informa a data da coleta,
o que é uma limitação real desses valores):

| Modelo (no Groq) | Output speed medido | TTFT medido |
|---|---|---|
| `gpt-oss-20b` (high) | 943 t/s | 0,82 s |
| `gpt-oss-120b` (high) | 474 t/s | 0,74 s |
| `qwen3.6-27b` | 449 t/s | n/d na leitura |
| Llama 3.1 8B | 665 t/s | n/d na leitura |

Os valores medidos batem bem com os ~1000 / ~500 t/s publicados pelo Groq.

### Estimativa para o workload (reescrever ~200 palavras)

Aplicando a fórmula oficial com saída ≈ 400 tokens e entrada ≈ 500 tokens. **Isto é cálculo meu, não
número publicado.** Rede: adicionei 0,15–0,35 s para um RTT Brasil → `us-east-1` com conexão keep-alive
(o header `x-groq-region` da resposta diz qual datacenter atendeu — meça no seu ambiente).

| Cenário | Decode (400 tok) | TTFT | Rede | **Total estimado** |
|---|---|---|---|---|
| `gpt-oss-20b`, `reasoning_effort: low` | ~0,40 s | ~0,3–0,8 s | ~0,2 s | **≈ 0,9 – 1,4 s** |
| `gpt-oss-20b`, com raciocínio (+200 tok CoT) | ~0,60 s | ~0,3–0,8 s | ~0,2 s | ≈ 1,1 – 1,6 s |
| `gpt-oss-120b`, `reasoning_effort: low` | ~0,80 s | ~0,3–0,8 s | ~0,2 s | **≈ 1,3 – 1,8 s** |
| `qwen3.6-27b`, `reasoning_effort: none` | ~0,90 s | ~0,3–0,8 s | ~0,2 s | ≈ 1,4 – 1,9 s |

**Tempo até o primeiro token, do ponto de vista do usuário:** TTFT + rede ≈ **0,5 – 1,0 s**.

**Consequência de produto:** com `stream: true`, o texto **começa a aparecer em menos de 1 segundo**
e termina em ~1,5 s. Sem streaming, o usuário encara uma tela parada por 1–1,5 s. Para uma ação de
reescrita disparada por atalho, streaming é o que separa "instantâneo" de "travadinho" — use.

**O maior risco de latência não é o Groq, é o `reasoning_effort`.** Deixar o default do gpt-oss
(`medium`) pode triplicar os tokens gerados numa tarefa que não precisa de raciocínio nenhum. Fixe
`low` (ou `none` no Qwen) e meça `usage.completion_tokens`.

---

## 5. Rate limits e custo por tier

O Groq tem **Free**, **Developer** (pay-as-you-go, exige cartão / conta bancária US / SEPA) e
Enterprise. Fonte: <https://console.groq.com/docs/billing-faqs>.

Os limites abaixo foram extraídos das duas abas ("Free Plan Limits" / "Developer Plan Limits") da
página <https://console.groq.com/docs/rate-limits>. **Atenção:** a versão markdown/estática dessa
página renderiza apenas a aba Free, embaixo de um texto que diz "os limites abaixo são os limites
base do plano Developer" — isso é um bug/ambiguidade da doc. Confirmei os dois conjuntos lendo o
payload da página. Os limites reais da sua organização estão em
<https://console.groq.com/settings/limits>.

### Free tier

| Model ID | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | **30** | **1.000** | **8.000** | 200.000 |
| `openai/gpt-oss-20b` | **30** | **1.000** | **8.000** | 200.000 |
| `openai/gpt-oss-safeguard-20b` | 30 | 1.000 | 8.000 | 200.000 |
| `qwen/qwen3.6-27b` | 30 | 1.000 | 8.000 | 200.000 |
| `qwen/qwen3.8-27b` | 30 | 1.000 | 8.000 | 2.000.000 |
| `groq/compound` / `compound-mini` | 30 | 250 | 70.000 | — |
| `whisper-large-v3` / `-turbo` | 20 | 2.000 | — (ASH 7.200 / ASD 28.800) | — |

### Developer tier

| Model ID | RPM | RPD | TPM |
|---|---|---|---|
| `openai/gpt-oss-120b` | **1.000** | 500.000 | **250.000** |
| `openai/gpt-oss-20b` | **1.000** | 500.000 | **250.000** |
| `openai/gpt-oss-safeguard-20b` | 1.000 | 500.000 | 150.000 |
| `qwen/qwen3.6-27b` | 1.000 | 500.000 | 250.000 |
| `groq/compound` / `compound-mini` | 200 | 20.000 | 200.000 |
| `whisper-large-v3` | 300 | 200.000 | — (ASH 200.000 / ASD 4.000.000) |
| `whisper-large-v3-turbo` | 400 | 200.000 | — (ASH 400.000 / ASD 4.000.000) |

(`qwen/qwen3.8-27b` ainda não aparece na tabela Developer — é o modelo mais novo do catálogo.)

### O que isso significa na prática para este app

Com ~900 tokens por reescrita (500 in + 400 out):

- **No free tier o gargalo é o TPM, não o RPM.** 8.000 TPM ÷ ~900 tokens ≈ **8–9 reescritas por
  minuto**, muito antes dos 30 RPM. Um usuário que dispare o atalho em sequência **vai** bater em 429.
- **O teto diário é 1.000 requests/dia ou 200.000 tokens/dia** — o que vier primeiro. 200.000 ÷ 900
  ≈ **220 reescritas/dia**. Para um app pessoal isso é suficiente; para um app distribuído com a
  chave do desenvolvedor, não é (e distribuir a chave do desenvolvedor é um erro de qualquer forma).
- **No Developer tier o TPM sobe para 250.000** (≈ 275 reescritas/minuto) — o gargalo passa a ser
  irrelevante para uso individual.
- Tokens em cache **não contam** para o rate limit — cachear o system prompt alivia o TPM do free tier.

Outras características do plano Developer: suporte por chat, **Flex tier** (10× o rate limit, com
falhas ocasionais), **Batch** (50% de desconto, janela de 24h a 7 dias) e **spend limits** (alertas e
corte automático de gasto — indisponível no free tier). Faturamento é em arrears mensal, com
"progressive billing" nos limiares de $1, $10, $100, $500 e $1.000 de uso acumulado, e não há cobrança
abaixo de $0,50.
Fontes: <https://console.groq.com/docs/billing-faqs>, <https://console.groq.com/docs/flex-processing>,
<https://console.groq.com/docs/batch>, <https://console.groq.com/docs/spend-limits>.

### Headers de rate limit

Toda resposta traz (<https://console.groq.com/docs/rate-limits>):

| Header | Significa |
|---|---|
| `x-ratelimit-limit-requests` | sempre **RPD** |
| `x-ratelimit-remaining-requests` | sempre **RPD** |
| `x-ratelimit-reset-requests` | sempre **RPD** (ex.: `2m59.56s`) |
| `x-ratelimit-limit-tokens` | sempre **TPM** |
| `x-ratelimit-remaining-tokens` | sempre **TPM** |
| `x-ratelimit-reset-tokens` | sempre **TPM** (ex.: `7.66s`) |
| `retry-after` | **só** em 429; valor em segundos |

Esses headers estão sempre presentes (exceto `retry-after`). No SDK, leia-os com
`.withResponse()` / `.asResponse()`, ou de `err.headers` num `RateLimitError`. Dá para mostrar na UI
"você tem N reescritas restantes hoje" lendo `x-ratelimit-remaining-requests`.

---

## 6. Onde guardar a API key num app Electron (macOS)

### `safeStorage` — como funciona

Módulo do Electron, **disponível apenas no main process**.
Doc: <https://www.electronjs.org/docs/latest/api/safe-storage>
(fonte markdown: <https://github.com/electron/electron/blob/main/docs/api/safe-storage.md>)

API:

| Método | Retorno | Nota |
|---|---|---|
| `safeStorage.isEncryptionAvailable()` | `boolean` | no macOS: true se o Keychain está disponível |
| `safeStorage.encryptString(plainText)` | `Buffer` | lança erro se a criptografia falhar |
| `safeStorage.decryptString(encrypted)` | `string` | |
| `safeStorage.isAsyncEncryptionAvailable()` | `Promise<boolean>` | inicializa o encryptor async |
| `safeStorage.encryptStringAsync(plainText)` | `Promise<Buffer>` | |
| `safeStorage.decryptStringAsync(encrypted)` | `Promise<{ result: string, shouldReEncrypt: boolean }>` | |
| `safeStorage.setUsePlainTextEncryption(bool)` | — | no-op no macOS/Windows |
| `safeStorage.getSelectedStorageBackend()` | `string` | **só Linux** |

**A doc oficial recomenda explicitamente a API assíncrona:**

> "We recommend using the asynchronous API (`encryptStringAsync`/`decryptStringAsync`) over the
> synchronous API. The async API is non-blocking, supports key rotation, and handles temporary
> unavailability gracefully. **The synchronous API may be deprecated in a future version of Electron.**"

**No macOS**, a doc diz: *"Encryption keys are stored for your app in Keychain Access in a way that
prevents other applications from loading them without user override. Therefore, content is protected
from other users and other apps running in the same userspace."*

### Limitações — o que `safeStorage` NÃO faz

1. **Ele criptografa; ele não persiste.** `encryptString()` devolve um `Buffer` e pronto. **Onde
   gravar o ciphertext é problema seu** — o padrão é um arquivo em `app.getPath('userData')`
   (<https://www.electronjs.org/docs/latest/api/app#appgetpathname>). Não existe "safeStorage.set/get".
2. **Exige código assinado no macOS.** A doc marca isso como IMPORTANT:
   > "On macOS, your app should be code signed for `safeStorage` to behave consistently. Without a
   > valid, consistent signature, macOS may not recognize different builds of your app as the same
   > application, which can cause the Keychain to re-prompt the user for permission on every update."

   Ou seja: **em build de desenvolvimento não assinado, espere prompts de Keychain repetidos** —
   e isso não é bug do seu código.
3. **Pode bloquear a thread.** *"Note that on macOS, access to the system Keychain is required and
   these calls can block the current thread to collect user input."* Mais um motivo para a API async.
4. **Só depois do `ready`.** No Windows e no Linux, `isEncryptionAvailable()` só retorna `true` depois
   que o app emitiu `ready`. Chame após `app.whenReady()`.
5. **Não protege contra outro processo rodando como o mesmo usuário no Windows** (DPAPI). No Linux,
   pode cair em `basic_text` — que é criptografia com senha hardcoded, ou seja, **sem proteção
   nenhuma** — detectável via `getSelectedStorageBackend() === 'basic_text'`.
6. **Não protege contra o próprio app comprometido.** Se um atacante roda código no seu main process,
   ele descriptografa a chave igual você faz. `safeStorage` protege a chave *em repouso no disco*,
   não *em uso*.
7. **`shouldReEncrypt`**: quando a API async devolve `shouldReEncrypt: true`, a chave do OS rodou —
   você deve re-criptografar e regravar o ciphertext, senão eventualmente perde acesso.

### O que NÃO fazer

- ❌ **Chave em texto claro** em `config.json`, `.env` empacotado, `localStorage`, `electron-store`
  sem criptografia, ou `userData/settings.json`. É o cenário que o ticket já suspeitava e é o pior
  de todos: qualquer script, backup do Time Machine, ou sync de pasta expõe a chave.
- ❌ **Chave hardcoded no bundle.** Um `.asar` **não é criptografia** — é um tar. `npx asar extract`
  e a chave está lá. Vale para a chave do desenvolvedor distribuída junto com o app.
- ❌ **Chave no renderer** / `dangerouslyAllowBrowser: true` (ver §1).
- ❌ **Chave em variável de ambiente do processo** como armazenamento persistente. `process.env` é
  legível por qualquer processo do mesmo usuário via `ps`/`/proc`, e o SDK lê `GROQ_API_KEY`
  automaticamente — o que é conveniente em servidor e errado em desktop.
- ❌ **`keytar`.** É o "módulo nativo" que o ticket cogita, mas o repositório oficial
  `atom/node-keytar` está **arquivado desde 2022** (último push 2022-12-12, campo `archived: true` na
  API do GitHub: <https://api.github.com/repos/atom/node-keytar>). Além de ser abandonado, é módulo
  nativo — exige `electron-rebuild`, ABI matching, e complica code signing/notarização. O
  `safeStorage` foi adicionado ao Electron justamente para substituí-lo.
- ❌ **Logar a chave.** O `groq-sdk` em `logLevel: 'debug'` loga todas as requests e responses; o
  README avisa que *"Some authentication-related headers are redacted, but sensitive data in request
  and response bodies may still be visible."* Não deixe `GROQ_LOG=debug` em produção.

### Padrão recomendado

```ts
// main.ts — só no main process
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const keyFile = () => path.join(app.getPath('userData'), 'groq.key.enc');

export async function saveApiKey(plain: string) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Keychain indisponível — não vou gravar a chave em texto claro.');
  }
  await fs.writeFile(keyFile(), await safeStorage.encryptStringAsync(plain), { mode: 0o600 });
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const buf = await fs.readFile(keyFile());
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf);
    if (shouldReEncrypt) await saveApiKey(result); // rotação de chave do OS
    return result;
  } catch {
    return null; // arquivo ausente ou ciphertext de outra máquina/instalação
  }
}
```

Pontos: chamar depois de `app.whenReady()`; **falhar em vez de degradar** para texto claro;
`mode: 0o600`; tratar o decrypt que falha (usuário restaurou backup de outra máquina) como "chave não
configurada" e pedir de novo — o ciphertext não é portável entre máquinas.

**Modelo de ameaça deste app:** a chave é **do usuário**, não sua. Ele a cola uma vez nas
preferências. O objetivo é que ela não fique legível no disco e que o app não a exponha para o
renderer. `safeStorage` + arquivo em `userData` cobre exatamente isso, sem dependência nativa.

---

## 7. Comportamento de erro do SDK

Fontes: <https://github.com/groq/groq-typescript#handling-errors>,
<https://github.com/groq/groq-typescript/blob/main/src/core/error.ts>,
<https://console.groq.com/docs/errors>.

### Hierarquia de classes (todas exportadas do pacote)

```
Error
└── GroqError
    └── APIError                    { status, headers, error }
        ├── BadRequestError          (400)
        ├── AuthenticationError      (401)   ← chave inválida
        ├── PermissionDeniedError    (403)
        ├── NotFoundError            (404)   ← model ID errado/descontinuado
        ├── ConflictError            (409)
        ├── UnprocessableEntityError (422)
        ├── RateLimitError           (429)   ← rate limit
        ├── InternalServerError      (>=500)
        ├── APIUserAbortError        (abort do chamador)
        └── APIConnectionError       (sem rede / DNS / TLS)
            └── APIConnectionTimeoutError   ← timeout
```

Propriedades de `APIError` (do source, `src/core/error.ts`):

```ts
readonly status: TStatus;   // status HTTP
readonly headers: THeaders; // Headers da resposta (inclui x-ratelimit-*, retry-after)
readonly error: TError;     // corpo JSON da resposta
```

⚠️ **Diferença em relação ao SDK da OpenAI:** esta versão do `groq-sdk` **não** expõe `.code`,
`.param` ou `.type` no topo do erro. O `type` do Groq (`"invalid_request_error"` etc.) vem dentro de
`err.error`, no formato documentado em <https://console.groq.com/docs/errors>:

```json
{ "error": { "message": "...", "type": "invalid_request_error" } }
```

`APIUserAbortError`, `APIConnectionError` e `APIConnectionTimeoutError` têm `status`, `headers` e
`error` todos `undefined` — é por isso que testar `err.status` sozinho não distingue "sem rede" de
"timeout".

### Como distinguir programaticamente

```ts
import Groq, {
  APIConnectionTimeoutError, APIConnectionError, RateLimitError,
  AuthenticationError, PermissionDeniedError, NotFoundError,
  BadRequestError, InternalServerError, APIUserAbortError, APIError,
} from 'groq-sdk';

try {
  return await client.chat.completions.create({ /* ... */ });
} catch (err) {
  // ORDEM IMPORTA: Timeout é subclasse de APIConnectionError.
  if (err instanceof APIConnectionTimeoutError) {
    // estourou o `timeout` (default 60s). Já foi retentado 2× antes de chegar aqui.
    return { erro: 'timeout' };
  }
  if (err instanceof APIConnectionError) {
    // sem rede, DNS falhou, TLS falhou, host inalcançável.
    // A causa original está em err.cause.
    return { erro: 'sem_rede', causa: (err as any).cause };
  }
  if (err instanceof RateLimitError) {                       // 429
    const retryAfter = Number(err.headers?.get('retry-after') ?? 0);
    const resetTokens = err.headers?.get('x-ratelimit-reset-tokens'); // ex. "7.66s"
    return { erro: 'rate_limit', retryAfter, resetTokens };
  }
  if (err instanceof AuthenticationError) {                   // 401
    return { erro: 'chave_invalida' };  // → limpar a chave e reabrir as preferências
  }
  if (err instanceof PermissionDeniedError) return { erro: 'sem_permissao' };      // 403
  if (err instanceof NotFoundError)        return { erro: 'modelo_inexistente' };  // 404
  if (err instanceof BadRequestError)      return { erro: 'request_invalido', detalhe: err.error }; // 400
  if (err instanceof InternalServerError)  return { erro: 'groq_indisponivel' };   // >=500
  if (err instanceof APIUserAbortError)    return { erro: 'cancelado' };
  if (err instanceof APIError)             return { erro: 'api', status: err.status };
  throw err; // não é erro do SDK
}
```

### Retry automático — sim, e é preciso saber disso

> "Certain errors will be automatically retried **2 times by default**, with a short exponential
> backoff. **Connection errors** (for example, due to a network connectivity problem), **408** Request
> Timeout, **409** Conflict, **429** Rate Limit, and **>=500** Internal errors will all be retried by
> default."

Configurável por cliente ou por request:

```ts
const client = new Groq({ maxRetries: 0 });                       // desliga
await client.chat.completions.create(params, { maxRetries: 5 });  // por request
```

O backoff respeita os headers `retry-after` / `retry-after-ms` da resposta quando presentes; se não,
usa exponencial calculado internamente (`src/client.ts`, `calculateDefaultRetryTimeoutMillis`).

**Consequência importante:** um 429 numa conta free tier vira **três** tentativas com espera —
o usuário pode encarar vários segundos de "carregando" achando que travou. Para uma ação interativa
de reescrita, o melhor é `maxRetries: 0` ou `1` e mostrar o erro na hora, com o `retry-after` legível.

### Timeout — sim, é configurável

> "Requests time out after **1 minute by default**. You can configure this with a `timeout` option."
> "On timeout, an `APIConnectionTimeoutError` is thrown."
> "Note that requests which time out will be **retried twice by default**."

```ts
const client = new Groq({ timeout: 15_000 });                      // 15s global
await client.chat.completions.create(params, { timeout: 8_000 });  // 8s neste request
```

Confirmado no source: `static DEFAULT_TIMEOUT = 60000;` (`src/client.ts`).

⚠️ **Pegadinha:** `timeout` × `maxRetries` se multiplicam. O próprio JSDoc avisa: *"Note that request
timeouts are retried by default, so in a worst-case scenario you may wait much longer than this
timeout before the promise succeeds or fails."* Com o default (60s × 3 tentativas) o pior caso é
**~3 minutos**. Para reescrita, algo como `timeout: 10_000, maxRetries: 1` dá um teto de ~20s.

**Cancelamento:** todo método aceita `{ signal }` (AbortSignal); abortar lança `APIUserAbortError`.
Útil para cancelar a reescrita se o usuário mudar de janela.

### Códigos do lado do Groq que valem conhecer

<https://console.groq.com/docs/errors> — além dos usuais: **413** (corpo grande demais), **422**
(semanticamente inválido / alucinação do modelo — o doc sugere retry), **424** (falha de dependência,
em Remote MCP), **498** (custom: Flex tier sem capacidade), **499** (custom: request cancelado).
E: *"You will not be charged for requests that return server error codes."*

---

## 8. Transcrição no Groq — o que se está abrindo mão

Registro apenas, já que a decisão de não adotar está tomada.
Fonte: <https://console.groq.com/docs/speech-to-text> e <https://console.groq.com/docs/models>.

| Modelo | Custo/hora de áudio | Idiomas | Transcrição | Tradução | **Real-time speed factor** | **WER** |
|---|---|---|---|---|---|---|
| `whisper-large-v3` | **$0,111** | Multilíngue | Sim | Sim (→ inglês) | **189×** | **10,3%** |
| `whisper-large-v3-turbo` | **$0,04** | Multilíngue | Sim | Não | **216×** | **12%** |

Traduzindo o "speed factor": **1 hora de áudio é transcrita em ~19 s** (v3) ou **~17 s** (turbo).
Uma nota de voz de 2 minutos sai em **menos de 1 segundo**.

Outros limites: arquivo de até **25 MB no free tier / 100 MB no Developer** (ou via parâmetro `url`
para arquivos maiores); mínimo de 0,01 s; **mínimo faturado de 10 s por request** (mandar 2 s custa
como 10 s); só a primeira faixa de áudio é transcrita; formatos `flac, mp3, mp4, mpeg, mpga, m4a,
ogg, wav, webm`; resposta em `json`, `verbose_json` ou `text`; timestamps por `segment` ou `word`.
O áudio é reamostrado para 16 kHz mono no servidor — converter para `wav` antes reduz latência, e
FLAC 16 kHz mono reduz o tamanho sem perda.

Rate limits de áudio: **free tier 20 RPM / 2.000 RPD / 7.200 ASH** (= 2 horas de áudio por hora);
Developer 300–400 RPM e 200.000–400.000 ASH.

O SDK expõe isso em `client.audio.transcriptions.create({ model, file })`, aceitando
`fs.createReadStream`, `File`, um `Response` do `fetch`, ou o helper `toFile()`.

**Resumo do que se abre mão:** transcrição multilíngue com WER de ~10–12% a $0,04/hora e
praticamente instantânea, na mesma API, com a mesma chave e o mesmo SDK que já estaria no projeto —
sem nenhum binário extra, download de modelo ou uso de CPU local. Em troca, ganha-se privacidade
(áudio não sai da máquina), funcionamento offline e custo zero por hora.

---

## 9. Lacunas — o que não consegui verificar

Registrando explicitamente em vez de chutar:

1. **Qualidade generativa em pt-BR.** Não existe benchmark primário público de *escrita* em português
   para nenhum dos modelos do Groq. MMMLU-Português (§2) é o melhor proxy disponível e mede outra
   coisa. **Só um A/B próprio resolve.**
2. **Qwen 3.6 / 3.8 em pt-BR.** Zero dado de avaliação multilíngue publicado. As fichas do Groq só
   trazem benchmarks de código e raciocínio.
3. **Preço do `qwen/qwen3.8-27b`.** A página do modelo renderiza "Loading model information…" no HTML
   estático e o modelo ainda não está na tabela principal de `/docs/models`.
4. **Disponibilidade real dos Llama para contas self-serve.** Aparecem como "Enterprise / Contact
   Sales" e não constam de nenhuma tabela de rate limit. Confirme com
   `GET https://api.groq.com/openai/v1/models` usando a sua chave.
5. **Data das medições do Artificial Analysis.** A página não informa quando os números de TTFT e t/s
   foram coletados.
6. **TTFT publicado pelo Groq.** A doc de latência descreve o comportamento (linear com tokens de
   entrada) mas **não publica nenhum valor absoluto de TTFT**. Os números de TTFT da §4 são de
   terceiros (recomendados pela própria doc do Groq) ou estimativa minha.
7. **Efeito da quantização "TruePoint Numerics" na qualidade.** Alegação do fornecedor, sem avaliação
   independente que eu tenha encontrado.
8. **Latência de rede Brasil → Groq.** Estimei 0,15–0,35 s de RTT. Não medi. Meça comparando o
   `usage.total_time` do response com o tempo medido no cliente, e cheque o header `x-groq-region`.

---

## Recomendação

### Modelo: `openai/gpt-oss-20b`

Com `reasoning_effort: "low"` e `reasoning_format: "hidden"`, `temperature` baixa (0,3–0,5),
`max_completion_tokens` limitado (~800) e `stream: true`.

**Por quê:**

- É o **único modelo do catálogo com dado primário e por idioma de qualidade em português**: 80,5 em
  MMMLU-PT_BR (`high`) / 73,3 (`low`), **acima da sua própria média multilíngue** — pt-BR é ponto
  forte da família gpt-oss, não fraqueza.
- É o **mais rápido do catálogo** (~1000 t/s pelo Groq, 943 t/s medidos, 1.200 t/s no exemplo oficial
  da doc). Reescrita de 200 palavras estimada em **~0,9–1,4 s no total**, com primeiro token em
  **menos de 1 s** — que é o que torna a ação percebida como instantânea.
- É o **mais barato** dos que servem: ~$0,00016 por reescrita, **~6.300 reescritas por dólar**. Ordem
  de grandeza melhor que o Qwen 3.6 ($0,0015).
- É **Production**, não Preview — não some sem aviso, ao contrário dos Qwen.
- Não depende de tier Enterprise, ao contrário dos Llama.

**Fallback de qualidade:** manter `openai/gpt-oss-120b` atrás de uma flag de configuração. Custa 2×
e é ~2× mais lento, mas ganha 4,8 pts em MMMLU-Português. **Rode um A/B com ~30 textos reais do app
antes de fixar** — MMMLU não mede fluência de escrita, e essa é a métrica que realmente importa aqui.
Mantenha o model ID em configuração, não hardcoded: este catálogo já rotacionou os Llama para fora do
self-serve.

### Armazenamento da chave: `safeStorage` async + arquivo em `userData`

**`safeStorage.encryptStringAsync` / `decryptStringAsync`**, com o ciphertext gravado em
`path.join(app.getPath('userData'), 'groq.key.enc')` com `mode: 0o600` — como no código da §6.

**Por quê:**

- É a API que o próprio Electron recomenda; a síncrona *"may be deprecated in a future version"*.
- No macOS usa o **Keychain**, que é exatamente o que o ticket cogitava, **sem módulo nativo**: nada
  de `electron-rebuild`, ABI matching ou complicação na notarização.
- A alternativa "módulo nativo" (`keytar`) está **arquivada desde 2022**. Não é uma opção viva.
- A API async trata rotação de chave (`shouldReEncrypt`) e indisponibilidade temporária — dois casos
  que a síncrona simplesmente estoura.

**Regras não-negociáveis que vêm junto:**

1. Chave **só no main process**. Renderer fala por IPC (`contextBridge` + `ipcRenderer.invoke`), e a
   chave nunca cruza o IPC.
2. Nunca `dangerouslyAllowBrowser: true`.
3. Se `isAsyncEncryptionAvailable()` for `false`, **falhe e avise o usuário** — jamais degrade para
   gravar em texto claro.
4. **Assine o app no macOS.** Sem assinatura consistente, o Keychain re-pergunta a cada atualização —
   e isso vai parecer bug do app.
5. Chamar tudo depois de `app.whenReady()`.
6. Decrypt que falha = "chave não configurada": peça de novo. O ciphertext não é portável entre
   máquinas (backup restaurado, máquina nova).
7. Nunca `GROQ_LOG=debug` em produção — o SDK loga corpos de request/response.

### Configuração do cliente

```ts
const client = new Groq({
  apiKey,            // do Keychain
  timeout: 10_000,   // 10s (default é 60s)
  maxRetries: 1,     // default é 2; pior caso vira ~20s em vez de ~3min
});
```

Motivo: a reescrita é uma ação **interativa**. Os defaults do SDK (60 s × 3 tentativas) são de
servidor, não de UI — deixá-los como estão pode prender o usuário por até 3 minutos num 429 ou numa
queda de rede. Trate `RateLimitError` mostrando o `retry-after`, e `AuthenticationError` limpando a
chave e reabrindo as preferências.

### Tier

Começar no **free** é viável para uso pessoal (~220 reescritas/dia, ~8–9 por minuto), mas o teto de
**8.000 TPM** vai ser sentido em rajadas. Se o app for para outras pessoas, cada usuário traz a
própria chave — e vale exibir `x-ratelimit-remaining-requests` na UI para que o limite seja visível
antes de virar erro.
