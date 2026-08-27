# Onde entra o dicionário customizado

Type: research
Status: resolved
Blocked by: 05

## Question

O dicionário customizado (nomes próprios, jargão técnico, siglas que o Whisper erra sempre) entra em qual ponto do pipeline?

Três candidatos, e agora que há um LLM no caminho o segundo ficou mais forte:
- **`--prompt` do whisper.cpp** — o initial prompt condiciona a transcrição. Tem limite de tokens (verificar qual) e é notoriamente pouco confiável: o modelo pode ignorar ou, pior, vazar o prompt na saída
- **Prompt do LLM de reescrita** — passar a lista de termos como contexto e deixar o Groq corrigir. Mais espaço, mais confiável, e o modelo entende a intenção. Preço: só funciona online
- **Substituição determinística pós-transcrição** — busca e troca literal. Totalmente previsível, funciona offline, mas quebra com variações de grafia que o Whisper produz

Responder também:
- Qual é o formato do dicionário que o usuário edita (lista simples? pares "ouvido → correto"?)
- Onde ele fica armazenado
- Se vale combinar mais de uma abordagem

Gravar achados em `.scratch/getthattext/research/dicionario.md`.

## Answer

Achados completos, com o custo em tokens medido nos tokenizers reais: [`research/dicionario.md`](../research/dicionario.md) (650 linhas).

**Decisão: `--prompt` do whisper está descartado. O dicionário entra em dois pontos — substituição determinística *antes* do Groq, e a lista de termos no prompt do Groq.**

**Por que o `--prompt` caiu** — três razões, todas verificadas no código, nenhuma documentada:

1. **Com o default `carry_initial_prompt=false`, o prompt vai para o buffer dinâmico e é apagado após a primeira janela de 30 s.** Num ditado de 60 s ele só afeta a primeira metade.
2. **`WHISPER_HISTORY_CONDITIONING_TEMP_CUTOFF = 0.5f` descarta o prompt inteiro quando o fallback de temperatura passa de 0,4** — ele some exatamente no áudio difícil, que é onde faria falta. Isso é fiel ao paper, não é bug.
3. **Os modos de falha são destrutivos, não degradativos.** Issues documentadas: prompt substituindo a transcrição dos primeiros 30 s (#1150), 24 s de áudio simplesmente sumindo (#1594), saída totalmente alucinada em loop (#117), e whisper.cpp #2140 falhando **exatamente na classe de termo deste projeto** (`AtomOS` → "Atom OS", `P3-65` → "P365"). Ganho medido no paper: 0,2 ponto de WER, em inglês, com **piora em 2 dos 7 datasets**.

**Ordem importa:** substituição determinística roda **antes** do Groq. Ao contrário, ela desfaria escolhas boas do LLM.

**Formato:** `dicionario.json` em `~/Library/Application Support/<App>/`, arranjo ordenado de `{ term, heard?[], context? }`. **`heard[]` é opcional de propósito** — o usuário não sabe de antemão como o Whisper vai errar "shadcn"; ele descobre errando.

**Números que importam:**

- **O limite do `--prompt` é 223 tokens, não 224** — confirmado em `decoding.py:609`, `whisper.cpp:7054` e o PR #2343. O OpenAI Cookbook diz 244 e está errado; esse erro se propagou por toda a internet secundária. (Corrige o que ficou registrado em [whisper.cpp via child process](./03-whisper-cli-via-child-process.md).)
- Cabem **68 termos** em 223 tokens. Irrelevante agora que o `--prompt` caiu, mas registra a ordem de grandeza.
- No Groq, **500 termos = 1.377 tokens ≈ 17% do orçamento de 8.000 TPM** por request, se não cachear.
- **Prompt caching do Groq confirmado** para `gpt-oss-20b`: automático, prefix match exato, TTL 2 h, e tokens cacheados **não contam para o rate limit**. Mas o mínimo cacheável ("128 to 1024 tokens depending on the model") não é publicado por modelo — **um dicionário pequeno pode nunca cachear.**
- **Não existe biblioteca de fonética pt-BR mantida em JS.** Talisman só tem francês e alemão; o `metaphonebr` é pacote R. Fica Levenshtein com threshold conservador.

## Complemento

O `heard[]` opcional deixou de depender de você adivinhar. [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) faz o Groq reportar os termos que corrigiu, e cada sugestão que você aceitar popula `heard[]` sozinha — virando substituição determinística de custo zero em TPM na ditação seguinte.
