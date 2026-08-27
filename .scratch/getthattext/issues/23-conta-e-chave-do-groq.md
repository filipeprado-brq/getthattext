# Conta e chave do Groq

Type: task
Status: resolved

## Question

Nada a decidir — trabalho manual que destrava decisões.

Sem uma chave de API não dá para rodar [A/B de modelo em pt-BR](./16-ab-de-modelo-em-pt-br.md) nem para observar os erros reais que [Quando o Groq falha](./12-quando-o-groq-falha.md) precisa tratar.

**Checklist:**

1. Criar conta em `console.groq.com` e gerar uma API key
2. Confirmar em `console.groq.com/settings/limits` quais são os limites **reais** da conta — a research encontrou ambiguidade na documentação entre as abas Free e Developer, e o que vale é o painel
3. Confirmar com `GET https://api.groq.com/openai/v1/models` quais modelos a conta enxerga de fato — [API do Groq](./05-api-do-groq.md) achou os Llama marcados como "Enterprise / Contact Sales", e vale checar se `openai/gpt-oss-20b` e `openai/gpt-oss-120b` aparecem mesmo
4. Guardar a chave em lugar seguro **fora deste repositório** — nada de commitar, nada de colar em arquivo do `.scratch/`

**Registrar como resposta:** limites reais da conta (RPM/RPD/TPM/TPD), lista de modelos disponíveis, e onde a chave está guardada — **sem a chave em si**.

## Answer

**Feito.** Conta criada, chave gerada e guardada em `~/.config/groq/key` com permissão `600` — **fora do repositório**, 56 bytes, sem lixo de espaço ou quebra de linha.

**Modelos que esta conta enxerga de fato** (`GET /v1/models`, 14 no total):

- **`openai/gpt-oss-20b`** ✓ — o escolhido em [API do Groq](./05-api-do-groq.md)
- **`openai/gpt-oss-120b`** ✓ — o fallback de qualidade
- `openai/gpt-oss-safeguard-20b`, `qwen/qwen3.6-27b`, `qwen/qwen3.8-27b`, `groq/compound`, `groq/compound-mini`, `allam-2-7b`, mais os de áudio

**Nenhum modelo Llama aparece**, confirmando o achado da research de que eles saíram do self-serve para Enterprise.

**Limites REAIS desta conta**, lidos dos headers de uma chamada verdadeira:

| Header | Valor | Free tier (doc) |
|---|---|---|
| `x-ratelimit-limit-tokens` (TPM) | **250.000** | 8.000 |
| `x-ratelimit-limit-requests` (RPD) | **500.000** | 1.000 |

**São os limites de Developer tier, não de Free.** Isso é 31× mais TPM do que [API do Groq](./05-api-do-groq.md) assumiu ao calcular "~8 a 9 reescritas por minuto". Com 250.000 TPM e ~900 tokens por reescrita, o teto real é **~275 reescritas por minuto** — inalcançável em uso pessoal.

**Consequência direta para [Quando o Groq falha](./12-quando-o-groq-falha.md):** a sub-pergunta "free ou Developer?" está respondida por medição, e o tratamento de 429 deixa de ser cenário cotidiano para virar caso de borda. O ticket encolhe.

**Chamada de teste funcionou:** `gpt-oss-20b` respondeu, 72 tokens de entrada / 5 de saída, `total_time` de 8,5 ms para uma resposta trivial.

**Nota de segurança registrada:** a chave foi colada no chat durante a resolução deste ticket, antes de ser guardada corretamente. Ela funciona e o risco prático é baixo (sem cobrança atrelada; o pior caso é consumo de rate limit por terceiro), mas essa string está em log de conversa. Rotacionar quando conveniente. A chave em uso hoje **nunca foi impressa** por nenhuma ferramenta e é lida direto do arquivo.
