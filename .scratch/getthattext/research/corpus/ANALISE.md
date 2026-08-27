# Análise do corpus — 30 ditações reais em pt-BR

**Data:** 2026-08-27 · **Máquina:** MacBook Pro M4, macOS 15.7.3 · **Mic:** Logi USB Headset
**Modelo:** `large-v3-turbo-q5_0` · **Flags:** `-l pt -nt -np -sns -bs 1 -nf`
**Áudio:** 30 gravações, 630 s no total (10 min 30 s)

Transcrições em `cru/` (sem VAD) e `cru-vad/` (com VAD no caminho da transcrição).

---

## 1. Latência medida

Transcrição das 30 nas duas vias: **1 min 35 s de parede**. Por arquivo, entre **1,3 s e 2,6 s**, incluindo o load do modelo a cada spawn.

Isso **confirma a estimativa** que o mapa carregava: [whisper.cpp via child process](../../issues/03-whisper-cli-via-child-process.md) previa ~0,6 s para 10 s de fala e ~1,8 s para 60 s. Medido: 1,32 s para um áudio de 14 s e 2,59 s para um de 39 s. A curva bate.

---

## 2. VAD: a decisão anterior estava errada

[Quando não há fala](../../issues/25-quando-nao-ha-fala.md) decidiu ligar `--vad` no `whisper-cli`. **O corpus mostrou que isso danifica o conteúdo.**

Comparando as 30 nas duas vias, o VAD **encurtou 6 transcrições**. Dois acertos e dois estragos sérios:

| Amostra | O que o VAD fez | Veredito |
|---|---|---|
| 02 | Removeu `E aí` — o áudio era silêncio real (RMS 0,0011) | **Acerto** — era alucinação |
| 14 | Removeu um `Obrigado.` pendurado no fim | **Acerto** — era alucinação |
| 04, 06 | Cortou interjeições de início e fim (`Ah, aqui`, `né?`) | Perda leve |
| 16 | **Perdeu uma frase inteira**, deixando `diferentes.` solto no fim | **Estrago** |
| 21 | **Engoliu `modules/home/hooks/useMenu.ts`** | **Estrago grave** — é exatamente o tipo de conteúdo que o app existe para preservar |

**Correção: o VAD sai do caminho da transcrição e vira portão.**

`whisper-vad-speech-segments` roda antes; se retornar zero segmentos, descarta sem transcrever. Se retornar qualquer coisa, transcreve o **áudio inteiro, sem `--vad`**.

Verificação do portão:

| Entrada | Segmentos |
|---|---|
| 02 (silêncio real, RMS 0,0011) | **0** |
| 2 s de silêncio digital · 3 s de ruído branco | **0** e **0** |
| 03 (a fala mais baixa do corpus, RMS 0,0351) | 1 |
| 01 · 29 · 16 · 21 | 2 · 6 · 8 · 13 |

**6 de 6 corretos.** Nenhum falso negativo na fala mais fraca, nenhum falso positivo no silêncio ou no ruído.

**Alternativa considerada e descartada:** limiar de RMS calculado no próprio app. A separação no corpus é de **31×** (0,0011 contra 0,0351 da fala mais baixa), custo zero, sem modelo extra. Perde para o VAD num caso: sala barulhenta sem ninguém falando passaria pelo RMS e o Whisper alucinaria.

---

## 3. Baseline de jargão — o número que dimensiona o dicionário

### Acertou

- **`import.spec.ts`** e **`fixtures.json`** (amostra 25) — nomes de arquivo com extensão, ditos naturalmente, transcritos **perfeitamente**
- **`npm run test`** e `dois traços watch` (23) — comando correto, embora `--watch` tenha ficado por extenso
- **`<design-system-interno>`** (design system interno — confirmado pelo autor, não é erro)
- **`<sigla-de-domínio>`**, **`Quality Gate`**, **`capacity`**, **`squad`**, **`deploy`**, **`merge`**, **`code review`**, **`undefined`** — jargão de dev e de domínio aéreo, todos corretos
- `modules/home/hooks/useMenu.ts` (21) — acertou na segunda tentativa, depois da auto-correção

### Errou

| Falado (provável) | Transcrito | Categoria |
|---|---|---|
| `services/auth.ts` | `services/alf.ts` | **palavra curta em inglês** — `auth` virou `alf` |
| `/me` (endpoint) | `barra MI` | **endpoint** |
| `useEffect` | `useffect` / `usefet` | **identificador** |
| `dateFormat` | `date format` | **camelCase perdido**, virou duas palavras |
| `useMenu` | `use menu` | idem |
| `Danger` (ferramenta de CI) | `dungeon` | **nome de ferramenta** |
| ? | `CM` | não confirmado |
| `Amplitude` | `amplitude` | capitalização de produto |
| `parser` | `parcer` | grafia |

### Leitura

Verdade de campo confirmada com o autor: `<design-system-interno>` é o nome real do design system (acerto, não erro); `dungeon` era **`Danger`**; e em `services/alf.ts` ele falou "ponto", não "barra" — então **não há padrão de caminho-com-barra se perdendo**. O único erro ali é `auth` → `alf`.

O padrão real é mais estreito, e por isso mais acionável:

1. **Palavras curtas em inglês quebram** — `auth` → `alf`, `me` → `MI`. São monossílabos e dissílabos sem contexto suficiente em volta.
2. **Nomes de ferramenta pouco comuns quebram** — `Danger` → `dungeon`.
3. **camelCase quebra sempre** — `dateFormat` → `date format`, `useMenu` → `use menu`, `useEffect` → `useffect`. Isso é sistemático, 3 de 3.
4. **Jargão de dev comum passa limpo** — `deploy`, `merge`, `squad`, `code review`, `undefined`, `capacity`, `endpoint`, `hooks`, e o jargão de domínio `<sigla-de-domínio>`.
5. **Nome de arquivo com extensão dita por extenso passa limpo** — `import.spec.ts` e `fixtures.json`, ambos perfeitos.

**Consequência para o dimensionamento: o dicionário precisa de 10 a 30 entradas, não 500.** São nomes de ferramenta interna e algumas palavras curtas em inglês que você usa muito. E a **recomposição de camelCase é regra, não dicionário** — vale tratar separado, porque uma regra cobre infinitos identificadores que uma lista nunca cobriria.

Isso também confirma que o **prompt caching do Groq provavelmente não vai acionar**: [API do Groq](../../issues/05-api-do-groq.md) registrou que o mínimo cacheável é de 128 a 1024 tokens dependendo do modelo, e 30 termos ficam bem abaixo disso.

---

## 4. As "curtas" não saíram curtas — e isso reabre o limiar

[Prompt de reescrita](../../issues/08-prompt-de-reescrita.md) definiu **menos de 15 palavras = só pontuação**, para proteger contra invenção em fala curta.

Contagem real das oito amostras pedidas como curtas:

| Amostra | Palavras |
|---|---|
| 03 | 9 |
| 01 | 14 |
| 04 | 19 |
| 07 | 27 |
| 08 | 33 |
| 05 | 35 |
| 06 | 37 |
| 02 | (silêncio) |

**Só duas das sete ficaram abaixo de 15.** Mesmo pedindo brevidade explicitamente, a fala natural saiu com 19 a 37 palavras.

Isso significa que **o limiar de 15 quase nunca dispararia na prática** — e a proteção contra "ok, pode subir" virar "está aprovado, pode prosseguir com o deploy" ficaria inativa justamente onde ela foi desenhada para agir.

A amostra **01** é a evidência mais direta: *"Ok, pode subir Não tem problema não A gente consegue dar um jeito aqui"* — 14 palavras, conteúdo de aprovação, **e sem pontuação entre as frases**. Está a uma palavra de escapar da proteção.

**Consequência:** o limiar precisa subir, ou o critério precisa deixar de ser contagem de palavras.

---

## 5. Outras observações

- **Pontuação entre frases falha em fala corrida** (amostra 01). É exatamente o que a etapa de reescrita conserta — confirma o valor dela.
- **Auto-correção aparece naturalmente** (amostra 21: *"modules/home/useffect. Desculpa. modules/home/hooks/useMenu.ts"*). A reescrita precisa resolver isso mantendo só a versão corrigida — está nas travas, mas é caso real, não hipotético.
- **`-nf` (sem temperature fallback) não causou problema visível** em nenhuma das 30.
- **Nenhuma alucinação** nas 29 gravações com fala real. As duas observadas (`E aí`, `Obrigado.`) foram em silêncio ou no fim de um trecho sem fala.
