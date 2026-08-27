# Corpus de transcrições reais

Type: task
Status: resolved

## Question

Nada a decidir — trabalho manual que destrava decisões.

[A/B de modelo em pt-BR](./16-ab-de-modelo-em-pt-br.md) precisa de saída **real** do Whisper, não de texto simulado. As amostras usadas em [Prompt de reescrita](./08-prompt-de-reescrita.md) foram escritas por mim para imitar o Whisper; elas serviram para fixar quais transformações são aceitáveis, mas não servem para medir o que o Whisper de fato erra.

**Não é construir o app.** É rodar o `whisper.cpp` de forma avulsa só para gerar o corpus.

**Checklist:**

1. Obter o `whisper-cli` (build do fonte na tag fixada, ou qualquer via avulsa) e o modelo `large-v3-turbo-q5_0`
2. Gravar ~30 amostras de ditado seu, em pt-BR, cobrindo de propósito:
   - **fala curta** ("ok, pode subir") e **fala longa** (parágrafo de e-mail) — o limiar de 15 palavras precisa ser testado nos dois lados
   - **jargão de dev em inglês dentro de frases em português** — `refresh token`, `endpoint`, `deploy`, `merge`
   - **nomes de arquivos e variáveis falados** — `import.spec.ts`, `dateFormat`
   - **siglas e nomes de ferramentas** que você usa e o Whisper provavelmente erra
   - **fala com hesitação e frase cortada no meio**
3. Rodar com `-l pt -nt -np -sns -bs 1 -nf` e guardar a saída crua, **sem editar**
4. Anotar o que o Whisper errou em cada amostra

**Registrar como resposta:** onde o corpus ficou, e o baseline — **quão mal o Whisper vai em jargão de dev em português**. Esse número decide se o dicionário customizado precisa de 20 ou 500 termos, o que por sua vez decide se o cache de prompt do Groq chega a acionar.

Guardar em `.scratch/getthattext/research/corpus/`.

## Answer

**Feito.** 30 ditações reais, 630 s de áudio (10 min 30 s), gravadas com Logi USB Headset em MacBook Pro M4 / macOS 15.7.3. Transcritas nas duas vias, com e sem VAD.

Análise completa: [`research/corpus/ANALISE.md`](../research/corpus/ANALISE.md). Áudio em `corpus/wav/`, transcrições em `corpus/cru/` e `corpus/cru-vad/`.

**Baseline de jargão — o número que o ticket existia para produzir: 10 a 30 entradas, não 500.**

O Whisper erra de forma **sistemática e estreita**:

1. **Palavras curtas em inglês quebram** — `auth` → `alf`, `me` → `MI`
2. **Nomes de ferramenta pouco comuns quebram** — `Danger` → `dungeon`
3. **camelCase quebra sempre** — `dateFormat` → `date format`, `useMenu` → `use menu`, `useEffect` → `useffect`. Sistemático, 3 de 3.

E acerta o que se temia que errasse: **`import.spec.ts` e `fixtures.json` saíram perfeitos**, ditos naturalmente. `<sigla-de-domínio>`, `<design-system-interno>`, `deploy`, `merge`, `squad`, `code review`, `undefined`, `capacity`, `endpoint`, `hooks` — todos limpos.

**Duas consequências que vão além do dimensionamento:**

- **camelCase é regra, não dicionário.** Uma regra de recomposição cobre infinitos identificadores; uma lista nunca cobriria. Vale tratar separado em [Onde entra o dicionário customizado](./10-onde-entra-o-dicionario-customizado.md).
- **O prompt caching do Groq provavelmente não vai acionar.** [API do Groq](./05-api-do-groq.md) registrou mínimo cacheável de 128 a 1024 tokens; 30 termos ficam bem abaixo.

**Três decisões do mapa foram corrigidas por este corpus:**

- **[Quando não há fala](./25-quando-nao-ha-fala.md)** — `--vad` no caminho da transcrição **engoliu `modules/home/hooks/useMenu.ts`** e perdeu uma frase inteira noutra amostra. Corrigido para VAD **como portão**, fora do caminho da transcrição.
- **[Prompt de reescrita](./08-prompt-de-reescrita.md)** — o limiar de 15 palavras quase nunca dispararia: pedindo brevidade explícita, a fala saiu com 9, 14, 19, 27, 33, 35 e 37 palavras. Corrigido para ~40.
- **[whisper.cpp via child process](./03-whisper-cli-via-child-process.md)** — a estimativa de latência foi **confirmada**: 1,3 s a 2,6 s por arquivo, incluindo load do modelo a cada spawn. Os ~2 s aceitos em [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md) são reais.

**O que este corpus NÃO resolveu:** validar o comportamento do `gpt-oss-20b` contra as travas do prompt. Isso é [A/B de modelo em pt-BR](./16-ab-de-modelo-em-pt-br.md), que ainda espera a chave em [Conta e chave do Groq](./23-conta-e-chave-do-groq.md). O corpus está pronto e é o insumo dele.

**Amostras extras não usadas:** `corpus/prompts-extra.tsv` guarda as 30 situações originais em formato de instrução, caso alguma categoria precise de mais volume.
