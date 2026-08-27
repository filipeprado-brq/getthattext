# Onde entra o dicionário customizado

Pesquisa para o ticket `10-onde-entra-o-dicionario-customizado`.
Fontes: código-fonte do `ggml-org/whisper.cpp`, código-fonte e discussões do `openai/whisper`,
o paper do Whisper, o OpenAI Cookbook e a documentação oficial do Groq. Sem blogs.

Data da coleta: 2026-08-26. Código do whisper.cpp lido do branch `master` nessa data.

---

## Resumo executivo

| | `--prompt` do whisper.cpp | Prompt do Groq | Substituição pós-transcrição |
|---|---|---|---|
| Capacidade | **~68 termos** (223 tokens) | 500+ termos sem esforço | ilimitada |
| Confiabilidade | baixa e **documentadamente instável** | alta | 100% determinística |
| Modos de falha | vaza o prompt na saída, come os primeiros ~30 s de áudio, loop de repetição | "corrige" o que estava certo | não pega variações de grafia |
| Custo em TPM | zero (é local) | 0 se cacheado, 141–1.377 tok se não | zero |
| Offline | sim | **não** | sim |
| Aplica-se a todas as janelas? | **só à primeira**, salvo `--carry-initial-prompt` | n/a | n/a |

Recomendação (detalhada no final): **Groq como mecanismo primário + substituição determinística
como rede de segurança para um punhado de termos de alta frequência.** Não usar `--prompt`.

---

## 1. `--prompt` do whisper.cpp (initial prompt / prompt conditioning)

### 1.1 O que ele é de fato — e por que isso importa

O initial prompt **não é uma instrução**. Ele é uma reutilização do canal de "texto anterior" que o
modelo aprendeu durante o treino. O paper diz explicitamente:

> "Since our decoder is an audio-conditional language model, we also train it to condition on the
> history of text of the transcript in the hope that it will learn to use longer-range text context
> to resolve ambiguous audio. Specifically, **with some probability** we add the transcript text
> preceding the current audio segment to the decoder's context."
> — *Robust Speech Recognition via Large-Scale Weak Supervision*, seção 2.3
> <https://cdn.openai.com/papers/whisper.pdf>

A "some probability" está quantificada na Tabela 17 (hiperparâmetros de treino):

> `Condition on prior text rate` — **50%**

Ou seja: metade das amostras de treino tinha contexto anterior, metade não. O modelo aprendeu que
o texto no slot `<|startofprev|>` **pode ou não** ter relação com o áudio. Isso é a raiz estrutural
de toda a instabilidade descrita adiante — não é bug de implementação.

A própria OpenAI reforça na doc da API:

> "Whisper doesn't follow instructions like a general-purpose text model and accepts prompts of up to
> 224 tokens."
> — <https://developers.openai.com/api/docs/guides/speech-to-text>

### 1.2 O limite de tokens — número exato, verificado no código

**O contexto do decoder é 448 tokens; o prompt é limitado a metade menos um, ou seja 223.**

Verificação em três fontes independentes:

**(a) `openai/whisper`, `whisper/decoding.py` linhas 601-611:**

```python
if prompt := self.options.prompt:
    prompt_tokens = (...)
    tokens = (
        [self.tokenizer.sot_prev]
        + prompt_tokens[-(self.n_ctx // 2 - 1) :]
        + tokens
    )
```

Com `self.n_ctx = model.dims.n_text_ctx` (linha 528). Note o **slice à direita** `[-(...):]`: se o
prompt estourar, o Whisper **descarta o começo e mantém o fim**. Ordem do dicionário importa.
<https://github.com/openai/whisper/blob/main/whisper/decoding.py>

**(b) `ggml-org/whisper.cpp`, `src/whisper.cpp`:**

```cpp
int32_t n_text_ctx = 448;                                                   // linha 600
const int max_prompt_ctx = std::min(params.n_max_text_ctx, whisper_n_text_ctx(ctx)/2);  // 7032
const int max_tokens = std::max(1, max_prompt_ctx - 1);                     // 7054
if (params.prompt_n_tokens > max_tokens) {
    WHISPER_LOG_WARN("%s: initial prompt is too long (%d tokens), will use only the last %d tokens\n", ...);
}
```

`n_max_text_ctx` tem default `16384` (linha 6039), então o `min` sempre resolve para `448/2 = 224`,
e o cap efetivo do initial prompt é **223**. O whisper.cpp **não falha** quando o prompt estoura —
ele emite um `WARN` e trunca silenciosamente pelo fim.
<https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp>

O header documenta o mesmo:

```c
// maximum of whisper_n_text_ctx()/2 tokens are used (typically 224)
const char * initial_prompt;
```
<https://github.com/ggml-org/whisper.cpp/blob/master/include/whisper.h> (linhas 523-527)

**(c) O autor do PR `carry_initial_prompt` no `openai/whisper`** afirma diretamente
"the maximum prompt length is `223`" (`n_text_ctx // 2 - 1`), e o PR foi merged pelo mantenedor
jongwook em 26/10/2024. <https://github.com/openai/whisper/pull/2343>

⚠️ **Divergência que vale registrar:** o OpenAI Cookbook (`Whisper_correct_misspelling.ipynb`) diz
"Whisper's prompt parameter has a token limit of **244**". Isso está errado / é typo — o código, o
header do whisper.cpp e a doc oficial da API dizem 224. Vários posts secundários repetem o 244 do
Cookbook. Use **223**. <https://github.com/openai/openai-cookbook/blob/main/examples/Whisper_correct_misspelling.ipynb>

### 1.3 Quantos termos cabem em 223 tokens — medição real

Medi com o **tokenizer real do Whisper** (`whisper/assets/multilingual.tiktoken`, 50.257 entradas,
reconstruído via `tiktoken.Encoding` com o mesmo `pat_str` de `whisper/tokenizer.py`), usando uma
lista realista de 247 termos de dev brasileiro (Kubernetes, Terraform, gRPC, shadcn, LGPD, <empresa>,
"merge request", "idempotência", "deployar", …):

| | tokens/termo (média) | 50 termos | 200 termos | 500 termos |
|---|---|---|---|---|
| Lista plana separada por vírgula | 2,11 (isolado) / 3,28 (com separador) | 164 | 614 | 1.557 |
| Pares `ouvido -> correto` | — | 329 | 1.314 | 3.285 |

**Cabem exatamente 68 termos** numa lista separada por vírgula dentro dos 223 tokens.
Uma frase-molde tipo *"Transcrição de um desenvolvedor brasileiro falando sobre programação.
Termos usados: "* custa mais **21 tokens**, derrubando para **~62 termos**.

Para pares "ouvido → correto" cabem ~34 pares. Na prática o initial prompt **não é o lugar** para
pares — ele é um viés de vocabulário, não um mapa de substituição.

### 1.4 Aplica-se a todas as janelas? Não, por padrão

Este é o ponto mais subestimado. O whisper.cpp separa o contexto em dois buffers
(`src/whisper.cpp` linhas 894-896):

```cpp
std::vector<whisper_token> prompt_past0; // static carried initial prompt (if enabled)
std::vector<whisper_token> prompt_past1; // dynamic context from decoded output
```

- Com `carry_initial_prompt == false` (**o default**, linha 6067), o initial prompt é empurrado para
  `prompt_past1` (linhas 7063-7067) — o buffer **dinâmico**.
- Ao final de cada janela de 30 s, `prompt_past1` é **limpo e reconstruído a partir do texto
  decodificado** (linhas 7716-7726).

Consequência: **o initial prompt só condiciona a primeira janela de 30 segundos.** A partir da
segunda, ele sumiu. Isso bate com o relato em `openai/whisper` #117 de que o prompt "doesn't persist
all the way through the transcription" além de ~90 s.

Com `--carry-initial-prompt` (whisper.cpp) / `carry_initial_prompt=True` (openai/whisper), o prompt
vai para `prompt_past0` e é reinjetado em toda janela (linhas 7217-7233). O preço está no próprio
comentário do header:

> `carry_initial_prompt; // if true, always prepend initial_prompt to every decode window (may reduce conditioning on previous text)`

Isto é: o dicionário come do mesmo orçamento de 224 tokens que o contexto rolante da fala anterior.
Flags: `--prompt PROMPT` e `--carry-initial-prompt` no `whisper-cli`
(<https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp>, linhas 199-200).

**Para este projeto (push-to-talk), a maioria dos ditados provavelmente cabe numa janela de 30 s** —
então esse ponto é menos crítico do que parece. Mas ditados longos existem, e nesses o prompt evapora
silenciosamente na metade.

### 1.5 O prompt é descartado no fallback de temperatura

Detalhe que quase ninguém menciona. `src/whisper.cpp`:

```cpp
static constexpr float WHISPER_HISTORY_CONDITIONING_TEMP_CUTOFF = 0.5f;   // linha 149
...
if (params.n_max_text_ctx > 0 && t_cur < WHISPER_HISTORY_CONDITIONING_TEMP_CUTOFF) {  // linha 7216
```

Todo o bloco de prompt (incluindo `prompt_past0`, o initial prompt carregado) só é montado quando a
temperatura corrente é **< 0,5**. O default é `temperature = 0.0` com `temperature_inc = 0.2`
(linhas 6077-6081), e o fallback sobe até 1.0 (linha 6981). Logo, assim que o decoder cai no
fallback para 0,6 — exatamente quando o áudio é difícil e você **mais** precisa do dicionário —
**o dicionário é jogado fora**.

Isso é fiel ao paper, que descreve o comportamento como intencional:

> "We start with temperature 0 … and increase the temperature by 0.2 up to 1.0 when either the
> average log probability over the generated tokens is lower than −1 or the generated text has a
> gzip compression rate higher than 2.4. Providing the transcribed text from the preceding window as
> previous-text conditioning **when the applied temperature is below 0.5** further improves the
> performance."
> — seção 4.5, *Strategies for Reliable Long-form Transcription*

### 1.6 Modos de falha documentados

Todos com fonte primária.

**(a) O prompt vaza para dentro da transcrição, substituindo o áudio real.**
`openai/whisper` Discussion #1150, "Prompt sometimes appearing in the transcript":

> "occasionally this prompt will appear at the start of the transcript, I think always replacing what
> should be the transcript of the first 30 seconds."

O mesmo thread tem um caso em russo em que o `initial_prompt='Добрый день.'` aparece **no lugar** da
transcrição real. <https://github.com/openai/whisper/discussions/1150>

**(b) Alucinação e loop de repetição.**
`openai/whisper` Discussion #117 (o thread canônico sobre prompt vs prefix, respondido pelo
mantenedor jongwook):

> **@mosnicholas:** "80% of the time I use the prompt, I get fully hallucinated output. It ends up on
> a loop, repeating the same thing"
> **@chemeris:** "The Whisper very frequently hallucinates when provided with a prompt"
> **@LeeHaha314:** "most of transcribe results contains hallucinations text and fall into a repetition loop"

<https://github.com/openai/whisper/discussions/117>

O paper reconhece o loop de repetição como falha estrutural do modelo:

> "problems such as **getting stuck in repeat loops**, not transcribing the first or last few words of
> an audio segment, or complete hallucination where the model will output a transcript entirely
> unrelated to the actual audio." — seção 5

**(c) Perda de áudio inteiro na primeira janela.**
`openai/whisper` Discussion #1594: com `--initial_prompt " Hello, welcome to my lecture."` o primeiro
texto transcrito começa em **00:24.740**; sem o prompt, em **00:01.600**. ~24 s de fala
desapareceram. Vários usuários confirmam "whole chunks of audio, 10-15 seconds from the first window"
sumindo. Thread sem solução até julho/2025.
<https://github.com/openai/whisper/discussions/1594>

**(d) Termos no prompt simplesmente ignorados.**
`ggml-org/whisper.cpp` issue **#2140**, "Some 'Initial prompt' tokens don't seem to have an effect"
(aberta, sem resposta de mantenedor). O reporter passou
`"Rec.709, Rec.2020, 4:2:2, P3, 4:2:0, Ninja, AtomOS, OM-Log400, gamma, gamma 2.2. P3-65, Sail in Finland"`
e obteve: `AtomOS` → "Atom OS", `P3-65` → "P365", capitalização de `Ninja` instável, formatos
`Rec.709`/`4:2:2` inconsistentes. **É exatamente a classe de termo deste projeto** (jargão técnico,
acrônimos, nomes de produto com pontuação/dígitos) e é exatamente onde falha.
<https://github.com/ggml-org/whisper.cpp/issues/2140>

**(e) Crash.** `ggml-org/whisper.cpp` issue **#3720** — "Initial prompt (-p) crashes" (aberta).
Historicamente também #705 (segfault) e #1961 (exception quando o prompt tem tokens demais). Não
verifiquei se #3720 afeta a versão que este projeto vai embarcar.
<https://github.com/ggml-org/whisper.cpp/issues/3720>

### 1.7 Ajuda ou atrapalha em línguas não-inglesas?

**Não encontrei nenhum experimento controlado, de fonte primária, sobre initial prompt em português.**
Isto é uma lacuna real (ver seção 8).

O que existe:

- Evidência **anedótica negativa** em russo (#1150, o prompt substituiu a transcrição) e a observação
  de que trocar `'Добрый день.'` por `'Итак,'` fez voltar a funcionar — ou seja, sensibilidade
  arbitrária à formulação exata.
- O paper mede o ganho de "previous text conditioning" apenas em datasets **em inglês** (Tabela 7:
  WER médio 10,2 → 10,0). O ganho agregado é de 0,2 ponto de WER, e **piora** em 2 dos 7 datasets
  (Meanwhile: 4,61 → 6,16). Ou seja: mesmo em inglês, mesmo com contexto *genuíno* (não um dicionário
  artificial), o efeito é pequeno e não é uniformemente positivo.
- Nota do mantenedor jongwook sobre qualidade de dados em línguas não-inglesas (Discussion #266,
  citada na seção 3.1) sugere que o modelo é **mais** frágil fora do inglês, não menos.

Extrapolando com honestidade: não há razão para esperar que o initial prompt seja *mais* confiável em
pt-BR do que em inglês, e uma lista de termos técnicos em inglês injetada num contexto de fala em
português é justamente o tipo de prompt "não-natural" que os relatos associam a alucinação.

---

## 2. Prompt do LLM de reescrita (Groq)

### 2.1 Precedente oficial: a própria OpenAI recomenda isso

O OpenAI Cookbook tem um notebook dedicado exatamente a este problema
(`Whisper_correct_misspelling.ipynb`) e compara as duas abordagens:

> "We input a list of correct spellings directly into Whisper's prompt parameter to guide the initial
> transcription." … "We utilized GPT-4 to fix misspellings post transcription, again using the same
> list of correct spellings in the prompt."

Conclusão do notebook: o pós-processamento com LLM é **mais confiável** que o prompt do Whisper e
**mais escalável**, porque o limite do prompt do Whisper obriga a "list of SKUs [to be] relatively
small". Ressalvas declaradas: é limitado pela janela de contexto do modelo, "can increase costs and
can result in higher latency".
<https://github.com/openai/openai-cookbook/blob/main/examples/Whisper_correct_misspelling.ipynb>

Confirmação independente do mesmo padrão na doc oficial da API, que hoje aponta o `prompt` do
`whisper-1` como técnica legada e recomenda `keywords`/`languages` do `gpt-transcribe` no lugar —
isto é, a OpenAI mesma migrou o problema de vocabulário para **fora** do canal `prompt`.
<https://developers.openai.com/api/docs/guides/speech-to-text>

### 2.2 Custo em tokens do dicionário contra os 8.000 TPM

Medido com `o200k_base` (o tokenizer base do harmony usado pelos modelos gpt-oss), mesma lista de
247 termos:

| Formato | 50 termos | 200 termos | 500 termos |
|---|---|---|---|
| Lista plana `Termo1, Termo2, …` | **141 tok** | **536 tok** | **1.377 tok** |
| Pares `ouvido -> correto` (1/linha) | 274 tok | 1.098 tok | 2.745 tok |

Média isolada: **1,75 token/termo** em `o200k_base` (contra 2,11 no tokenizer do Whisper — o o200k é
mais eficiente).

Contra o orçamento do free tier (`openai/gpt-oss-20b`: **30 RPM · 1K RPD · 8K TPM · 200K TPD**,
<https://console.groq.com/docs/rate-limits>) e a baseline de ~900 tokens/reescrita já estabelecida
em `api-do-groq.md` (500 in + 400 out):

| Dicionário | Tokens/request | Reescritas/min antes do 429 |
|---|---|---|
| nenhum | ~900 | ~8–9 |
| 50 termos, lista plana, **não cacheado** | ~1.041 | ~7 |
| 200 termos, lista plana, **não cacheado** | ~1.436 | ~5 |
| 500 termos, lista plana, **não cacheado** | ~2.277 | ~3 |
| 500 termos em **pares**, não cacheado | ~3.645 | ~2 |
| qualquer tamanho, **cacheado** | ~900 efetivos | ~8–9 |

Leitura: **sem cache, um dicionário de 500 termos corta a vazão do free tier em ~2,5×.** Com cache,
o custo em TPM some.

### 2.3 Prompt caching no Groq — verificado

Da doc oficial <https://console.groq.com/docs/prompt-caching>:

- **Automático:** "works automatically on all your API requests with no code changes required and no
  additional fees."
- **Modelos suportados:** GPT-OSS 20B, GPT-OSS 120B, GPT-OSS-Safeguard 20B. → **`openai/gpt-oss-20b`,
  o modelo já escolhido, está coberto.**
- **Mínimo:** "The minimum cacheable prompt length varies by model, ranging from 128 to 1024 tokens
  depending on the specific model used." (o número exato para o 20b **não** é publicado — ver lacunas)
- **TTL:** "All cached data automatically expires after **2 hours** without use."
- **Desconto:** "There is a **50% discount** for cached input tokens".
- **Rate limits:** "**Cached tokens do not count towards your rate limits.**" — confirmado também em
  <https://console.groq.com/docs/rate-limits>.
  ⚠️ Com uma ressalva literal na doc: *"cached tokens are subtracted from your limits after
  processing, so it's still possible to hit your limits if you are sending a large number of input
  tokens in parallel requests."*
- **Mecânica do hit:** exige **prefix match exato**. "Changes to cached sections, including
  `tool_choice` and image usage, will invalidate the cache."
- **Observabilidade:** o `usage` da resposta traz `prompt_tokens_details.cached_tokens` — dá para
  instrumentar e medir a taxa de acerto de verdade.

Implicações de engenharia:

1. O dicionário **tem** que ficar no prefixo estável — system message, antes de qualquer coisa
   variável. A transcrição vai como user message.
2. **Toda edição do dicionário invalida o cache.** A primeira reescrita depois de cada edição paga o
   dicionário inteiro em TPM. Com 500 termos isso é ~1.377 tokens de uma vez — perceptível no free
   tier, irrelevante no Developer.
3. Ordenar o dicionário deterministicamente (alfabético) evita invalidações acidentais por
   reordenação de um `Set`/`Map`.
4. Depois de 2 h ocioso, o cache expira e a próxima reescrita paga cheio. Para um app de push-to-talk
   isso acontece **todo dia de manhã** e depois de cada pausa longa. Não é fatal (é 1 request), mas
   dimensione o dicionário sabendo disso.
5. Um dicionário pequeno (50 termos ≈ 141 tok) pode ficar **abaixo do mínimo cacheável** do modelo
   (128–1024). Contra-intuitivamente, o prompt precisa ser grande o bastante para ser cacheável.
   Somando as instruções de reescrita (~150 tok) provavelmente passa dos 128, mas se o mínimo do 20b
   for 1024, só dicionários grandes cacheiam. **Não é possível confirmar sem medir** — meça
   `cached_tokens` em produção.

### 2.4 Risco: o LLM "corrigir" o que já estava certo

Este é o risco real desta abordagem, e não achei mitigação documentada em fonte primária — é
julgamento de engenharia. O que dá para afirmar:

- O `gpt-oss-20b` já vai reescrever o texto de qualquer forma (é o propósito da etapa). Adicionar um
  dicionário aumenta a superfície de mudança, não cria uma categoria nova de risco.
- O modo de falha específico é **over-correction**: o usuário diz "gol" (o esporte) e o dicionário
  tem `GOL` (a companhia), e o modelo troca. Ou diz "vault" genérico e vira `Vault` (HashiCorp).
- Mitigação prática: instruir explicitamente no system prompt que a lista é de **grafias
  preferidas quando o termo for reconhecido**, não uma ordem de substituição, e que na dúvida
  preserve o texto do usuário. Com `temperature 0.3–0.5` e `reasoning_effort: "low"` já definidos,
  o modelo tem pouca margem de improviso — mas também menos margem de raciocinar sobre ambiguidade.
- Siglas curtas e ambíguas (2–3 letras) são o pior caso. Uma regra de higiene: siglas com menos de
  4 caracteres merecem um campo de contexto no dicionário ou não entram.

---

## 3. Substituição determinística pós-transcrição

### 3.1 Os erros do Whisper são estáveis e mapeáveis?

**Parcialmente sim — e a parte estável tem explicação do mantenedor.**

Em `openai/whisper` Discussion #266 ("Misspelled output"), um usuário relata que o Whisper escreve
consistentemente `κόδικας` no lugar de `κώδικας` em grego. Resposta do mantenedor **jongwook**:

> "I suspect **incorrectly spelled transcripts in the training data** have probably caused this
> phenomenon. I've seen similar spelling errors in Korean as well."

e que a filtragem "may not have been very effective at excluding ASR-generated transcripts for
non-English languages". <https://github.com/openai/whisper/discussions/266>

Isso caracteriza uma classe de erro **sistemática e determinística**: o modelo aprendeu a grafia
errada. A ressalva do jongwook é sobre línguas **não-inglesas** em geral, e o português está nessa
categoria: pela Figura 11 do paper, o dataset tem **8.573 h de português** contra **438.218 h de
inglês** — ~51× menos. Português é a 6ª maior língua não-inglesa do corpus (atrás de chinês, alemão,
espanhol, russo e francês), então não é o pior caso; mas está longe do regime de dados do inglês, e
é exatamente onde o filtro anti-ASR "may not have been very effective".

Duas ressalvas, e são grandes:

1. **Determinismo do decoder ≠ estabilidade do erro.** Em `temperature = 0` (o default do
   whisper.cpp, linha 6077) a decodificação é greedy e portanto determinística *para o mesmo áudio*.
   Mas o áudio de um push-to-talk nunca é o mesmo duas vezes: prosódia, ruído e as palavras vizinhas
   mudam. E o fallback de temperatura (`temperature_inc = 0.2`, linha 6081) introduz amostragem
   estocástica assim que um segmento é difícil.
2. **Erros perceptuais variam.** O issue #2140 do whisper.cpp mostra o mesmo termo (`AtomOS`) saindo
   ora certo ora como "Atom OS", e capitalização de `Ninja` "unreliable" — variação **dentro do mesmo
   arquivo**. Um mapa literal não cobre isso.

Conclusão: substituição literal cobre a cauda estável (grafias aprendidas erradas, capitalização,
espaçamento) e **não** cobre a cauda perceptual (termo ouvido como outra palavra qualquer).

### 3.2 Matching fuzzy / fonético — é abordagem conhecida?

Sim, e é sugerida dentro do próprio repo do Whisper. Em Discussion #2169 ("Transcribing uncommon
words with whisper"), onde um usuário tentou prompt (limite de tokens insuficiente para nomes de
estações ferroviárias) e fine-tuning (2 h de áudio, resultado insuficiente), a resposta foi:

> "Post-processing with **soundex or metaphone or some other form of fuzzy matching**"

<https://github.com/openai/whisper/discussions/2169>

### 3.3 Bibliotecas JS — o que existe de fato

Verifiquei no registry do npm (`registry.npmjs.org`) e nos repos:

| Pacote | Versão | Licença | O que serve |
|---|---|---|---|
| `fastest-levenshtein` | 1.0.16 | MIT | distância de edição pura, a mais rápida em JS <https://github.com/ka-weihe/fastest-levenshtein> |
| `leven` | 4.1.0 | MIT | Levenshtein, sindresorhus <https://github.com/sindresorhus/leven> |
| `didyoumean2` | 7.0.4 | MIT | casa entrada humana contra lista de candidatos via Levenshtein — **é literalmente a forma do problema** <https://github.com/foray1010/didyoumean2> |
| `fuse.js` | 7.5.0 | Apache-2.0 | busca fuzzy com scoring e threshold <https://github.com/krisk/Fuse> |
| `fast-fuzzy` | 1.12.0 | ISC | fuzzy search pequeno e rápido <https://github.com/EthanRutherford/fast-fuzzy> |
| `double-metaphone` | 2.0.1 | MIT | Double Metaphone — **regras fonéticas do inglês** <https://github.com/words/double-metaphone> |
| `talisman` | 1.1.4 | MIT | 16 algoritmos fonéticos + módulos por idioma <https://github.com/Yomguithereal/talisman> |
| `natural` | 8.1.1 | MIT | NLP geral; fonética e stemming em inglês/russo/espanhol |

**Achado importante: não existe Metaphone/Soundex para português brasileiro em JS mantido.**

- O Talisman tem módulos fonéticos específicos só para **francês** e **alemão**
  (<https://yomguithereal.github.io/talisman/phonetics>). Não há `phonetics/portuguese`.
- Uma busca no npm por "metaphone portuguese" retorna zero implementações — os únicos resultados
  pt-BR são dicionários ortográficos (`@cspell/dict-pt-br`, `dictionary-pt`), não fonética.
- Existe `metaphonebr` no CRAN (pacote **R**, "Custom 'MetaphoneBR' Phonetic Encoding for Brazilian
  Names"), sem porte para JS. Portar é trabalho não trivial e não justificado aqui.

Além disso, Metaphone/Soundex codificam **fonética do inglês**. Aplicá-los a um texto pt-BR onde os
termos-alvo são majoritariamente **palavras inglesas faladas com sotaque brasileiro** é território
sem nenhuma validação — e a métrica de sucesso seria empírica, não teórica.

**Recomendação prática:** se for fazer fuzzy, use **distância de edição normalizada
(`fastest-levenshtein` ou `didyoumean2`) com threshold conservador**, não fonética. É previsível,
auditável e não depende de um modelo fonético que não existe para pt-BR.

⚠️ Risco do fuzzy que precisa ser dito: com threshold frouxo ele corrompe texto correto. `"gol"` vs
`"GOL"` tem distância 0 case-insensitive; `"vaults"` vs `"Vault"` tem distância 1. Fuzzy sobre
palavras curtas em português é uma fábrica de falsos positivos. Se usar, restrinja a tokens com
≥ 5 caracteres e exija distância ≤ 1 (ou ≤ 15% do comprimento).

---

## 4. Formato do dicionário

Cada mecanismo consome um formato diferente:

| Mecanismo | Precisa de |
|---|---|
| `--prompt` do Whisper | **lista plana** de termos corretos. Pares são desperdício — o modelo não entende "→", ele só absorve viés de vocabulário |
| Prompt do Groq | **funciona com os dois**; pares são mais precisos, lista plana é 2× mais barata em tokens |
| Substituição determinística | **exige pares** `ouvido → correto`; sem o lado esquerdo não há o que buscar |

**Proposta: um só arquivo, com o par opcional.**

```jsonc
// dicionario.json
{
  "version": 1,
  "terms": [
    { "term": "Kubernetes" },                                  // só grafia canônica
    { "term": "gRPC", "heard": ["G RPC", "gerpc", "GRPC"] },    // com variantes conhecidas
    { "term": "<empresa>",  "heard": ["berque", "B R Q"],
      "context": "empresa onde trabalho" },                    // desambiguação p/ o LLM
    { "term": "shadcn", "heard": ["chadcn", "shad CN"] }
  ]
}
```

Por que este shape:

- `term` sozinho já alimenta o prompt do Groq (lista plana) — **é o caminho de menor atrito para o
  usuário**: ele só digita o termo certo.
- `heard[]` é **opcional** e só aparece quando o usuário nota um erro recorrente. É o que habilita a
  substituição determinística — e é preenchido incrementalmente, na hora da dor.
- `context` é opcional e serve para siglas ambíguas; entra no prompt do Groq só para os termos que
  têm, custando quase nada.
- Um arranjo (não um objeto/mapa) preserva **ordem determinística** — importante para o prefix match
  do cache do Groq. Normalize com sort estável antes de serializar para o prompt.

Erro a evitar: **não** exigir pares desde o começo. O usuário não sabe de antemão como o Whisper vai
errar "shadcn". Ele descobre errando. Dicionário que exige o lado esquerdo preenchido não é adotado.

**Feature que fecha o loop:** guardar a transcrição bruta junto do texto reescrito e oferecer
"o Groq corrigiu X → Y, quer fixar essa regra?" — isso popula `heard[]` automaticamente a partir dos
acertos do LLM, e cada regra fixada vira uma substituição determinística que não custa mais nada em
TPM. Essa é a razão mais forte para combinar os mecanismos 2 e 3.

---

## 5. Onde armazenar num app Electron no macOS

`app.getPath('userData')` — a doc do Electron define `userData` como "the directory for storing your
app's configuration files, which by default is the `appData` directory appended with your app's
name", e `appData` no macOS é `~/Library/Application Support`.
<https://www.electronjs.org/docs/latest/api/app#appgetpathname>

Ou seja, na prática:

```
~/Library/Application Support/GetThatText/dicionario.json
```

Notas:

- Escreva pelo **main process** (`fs/promises`), não pelo renderer. O renderer pede via IPC.
- Escrita atômica (arquivo temporário + `rename`) — o app pode ser morto no meio de um salvamento e
  perder o dicionário do usuário.
- `userData` **não** é sincronizado por iCloud e **não** é limpo por atualização do app. É o lugar
  certo. `~/Library/Caches` seria errado (pode ser apagado pelo sistema).
- JSON puro é editável à mão pelo usuário avançado (`open ~/Library/Application\ Support/...`), o que
  é um bom escape hatch. Mantenha o campo `version` para migração futura.
- Se um dia o app for para a Mac App Store (sandbox), o caminho vira o container do app — o
  `app.getPath('userData')` resolve isso sozinho, não hardcode o caminho.

---

## 6. Vale combinar mecanismos?

**2 + 3 sim, e se reforçam. 1 não entra.**

Não há conflito técnico entre o prompt do Groq e a substituição determinística **desde que a ordem
seja: transcrição → substituição determinística → Groq**. Nessa ordem:

- A substituição literal conserta o que é 100% conhecido antes do LLM ver o texto, e o LLM recebe um
  input mais limpo.
- O LLM cobre a cauda que o mapa não pega.
- Se a ordem for invertida (Groq → substituição), a substituição pode desfazer uma escolha correta do
  LLM, e você perde a capacidade do LLM de raciocinar sobre o contexto.

O `--prompt` do Whisper **conflita** com ambos por um motivo prático: quando ele falha, ele falha
**destruindo dados** (vaza texto na saída, come 24 s de áudio, entra em loop). Um erro de
transcrição é recuperável a jusante; áudio que nunca foi transcrito não é. Combinar um mecanismo de
risco alto e ganho marginal com dois mecanismos de risco baixo e ganho alto não compra nada.

Contra-argumento honesto: o `--prompt` é o **único** mecanismo que atua *antes* do erro acontecer.
Os outros dois só consertam depois, e nenhum conserta um termo que o Whisper ouviu como algo
completamente diferente e plausível. Se, na medição, houver termos que o Groq não recupera de jeito
nenhum, um prompt **minúsculo** (10–15 termos, os piores ofensores, sem `--carry-initial-prompt`)
pode ser reavaliado — como experimento medido, não como default.

---

## 7. Lacunas — o que NÃO foi possível verificar

1. **Nenhum experimento controlado de initial prompt em pt-BR** existe em fonte primária. Todas as
   evidências de modo de falha são em inglês, russo, grego e coreano. Extrapolei; não medi.
2. **O mínimo cacheável exato do `openai/gpt-oss-20b` no Groq.** A doc só diz "128 to 1024 tokens
   depending on the specific model" e não publica a tabela por modelo. Só medindo
   `usage.prompt_tokens_details.cached_tokens` em produção.
3. **Se tokens cacheados também são excluídos do TPD** (200K/dia), ou só do TPM. A doc diz "rate
   limits" genericamente. Assumi que cobre ambos, mas não é afirmado explicitamente.
4. **Taxa real de erro do Whisper em jargão de dev em pt-BR.** Nenhum benchmark primário mede
   "inglês falado dentro de frase em português". Sem isso, não dá para dizer quantos termos o
   dicionário precisa ter de verdade.
5. **Se o issue #3720 do whisper.cpp ("Initial prompt (-p) crashes") afeta o build que o projeto vai
   embarcar.** A issue está aberta e sem diagnóstico público.
6. **Se `carry_initial_prompt` degrada a qualidade na prática.** O header do whisper.cpp diz "may
   reduce conditioning on previous text", mas não achei nenhuma medição — nem no PR #2343 do
   openai/whisper (merged sem discussão de regressão), nem no #3395 do whisper.cpp.
7. **Estabilidade dos erros do Whisper medida.** Tenho a explicação do mantenedor para a classe
   sistemática (#266) e evidência anedótica de variação (#2140), mas **nenhum estudo** que diga
   "X% dos erros em termos técnicos são repetíveis". Isso decide o quanto a substituição
   determinística vale, e só se descobre logando as transcrições brutas deste app por algumas semanas.
8. **Não existe implementação JS mantida de fonética para pt-BR** — verifiquei npm e Talisman. Se
   alguém quiser fonética, terá que portar de R/PL-pgSQL.
9. **O comportamento do prompt em `whisper-server`** (o binário de servidor do whisper.cpp) não foi
   verificado — só o `whisper-cli`. O PR #3781 sugere que `carry_initial_prompt` só chegou ao server
   recentemente.

---

## 8. Recomendação

### Mecanismo

**Primário: o prompt de reescrita do Groq. Secundário: substituição determinística pré-Groq.
Descartar o `--prompt` do whisper.cpp.**

Pipeline:

```
áudio → whisper.cpp (SEM --prompt)
      → substituição determinística dos pares heard→term conhecidos
      → Groq (dicionário de termos canônicos no system prompt, cacheado)
      → injeção no input
```

Justificativa em uma linha por candidato:

- **`--prompt` fora:** cabem só ~62 termos, evapora depois da primeira janela de 30 s, é descartado
  justamente no fallback de temperatura (quando mais precisaria), e seus modos de falha documentados
  (#1150 vaza o prompt, #1594 come 24 s de áudio, #117 loop de repetição, #2140 ignora exatamente
  a classe de termo deste projeto) são **destrutivos**, não degradativos. Ganho marginal medido no
  paper: 0,2 ponto de WER, em inglês, com contexto genuíno.
- **Groq primário:** é o que a própria OpenAI recomenda no Cookbook em vez do prompt do Whisper;
  500 termos custam 1.377 tokens e **zero TPM quando cacheados** (confirmado na doc do Groq, e o
  `gpt-oss-20b` está na lista de modelos com caching); o modelo já está no caminho de qualquer jeito,
  então a latência marginal é ~0.
- **Determinística secundária:** custo zero, funciona offline, e cobre a classe de erro que o
  mantenedor do Whisper confirmou ser sistemática (grafias erradas aprendidas do dado de treino, em
  línguas não-inglesas — #266). É também o que transforma correções do LLM em regras permanentes.

### Formato

Um `dicionario.json` em `~/Library/Application Support/<App>/`, arranjo ordenado de
`{ term, heard?[], context? }`.

- `term` obrigatório → alimenta a lista plana no system prompt do Groq (1,75 tok/termo).
- `heard[]` opcional → alimenta a substituição determinística. Preenchido incrementalmente,
  idealmente sugerido pelo próprio app a partir dos diffs transcrição-bruta vs. reescrita.
- `context` opcional → só para siglas ambíguas, entra no prompt do Groq apenas para quem tem.

Ordenação alfabética estável na serialização, para não invalidar o cache do Groq à toa.

### Riscos residuais

1. **Over-correction do LLM.** Siglas curtas (`GOL`, `SLA`, `S3`) vão ser aplicadas onde não deviam.
   Mitigação: campo `context`, instrução explícita de "grafias preferidas, não substituição
   obrigatória", e uma regra de higiene de não aceitar termos com < 4 caracteres sem contexto.
2. **Invalidação de cache a cada edição do dicionário.** Uma reescrita paga o dicionário inteiro em
   TPM depois de cada edição e depois de 2 h ocioso. Com 500 termos são ~1.377 tokens de uma vez —
   ~17% do orçamento de 8.000 TPM num único request. Não quebra, mas se o usuário editar e ditar em
   sequência pode tomar 429.
3. **Dicionário pequeno pode não cachear.** Se o mínimo cacheável do `gpt-oss-20b` for 1024 tokens,
   um dicionário de 50 termos (141 tok) nunca cacheia e o custo em TPM é permanente. Instrumente
   `usage.prompt_tokens_details.cached_tokens` desde o primeiro dia — sem esse número você está
   projetando no escuro.
4. **Nenhum dos dois mecanismos escolhidos funciona offline com qualidade.** A substituição
   determinística funciona, mas só cobre o que já está mapeado. Sem rede, termos novos vão sair
   errados e não há fallback. Isso é uma consequência aceita da decisão já travada de ter o Groq no
   caminho — mas convém que a UI deixe explícito quando está em modo degradado.
5. **Termos que o Whisper ouve como outra palavra plausível são irrecuperáveis.** Se "shadcn" sair
   como "chá de canela", nem o mapa nem o LLM (que recebe só o texto, não o áudio) têm como saber.
   Esta é a limitação estrutural de corrigir a jusante, e o único mecanismo que atacaria isso é
   justamente o que foi descartado. Se aparecerem muitos casos assim na medição, reabrir o
   `--prompt` como experimento **restrito** (10–15 termos, sem `--carry-initial-prompt`,
   com A/B medido) — nunca como default.
6. **Sem baseline medida.** Não há número primário sobre quão mal o Whisper vai em jargão de dev em
   pt-BR. Logue as transcrições brutas desde o começo: é o único caminho para saber se o dicionário
   precisa de 20 ou de 500 termos, e para saber se a substituição determinística vale o código.
