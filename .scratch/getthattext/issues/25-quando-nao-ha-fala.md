# Quando não há fala

Type: research
Status: resolved

## Question

O que o app entrega quando a gravação não contém fala — clique acidental, clique duplo rápido, microfone no device errado, ou desistência no meio?

## Answer

**Decisão: ligar o VAD do próprio `whisper-cli` (`--vad` com o modelo Silero). Medido, não suposto.**

**O problema, medido nesta máquina** (macOS 15.7.3, M4, `large-v3-turbo-q5_0`, flags `-l pt -nt -np -sns -bs 1 -nf`):

| Entrada | Saída do Whisper |
|---|---|
| 0,3 s e 0,5 s de silêncio digital | `Legenda por Sônia Ruberti` |
| 1 s e 2 s de silêncio digital | `Obrigado.` |
| 5 s e 10 s de silêncio digital | `E aí` |
| 1 s e 3 s de ruído branco baixo (sala silenciosa) | `Obrigado.` |

**8 de 8 alucinaram. Nunca devolveu vazio** — e a flag `-sns` (suppress non-speech) já estava ligada. `Legenda por Sônia Ruberti` é vazamento de dado de treino: crédito de legendador que ficou no modelo.

**Por que isso é grave neste app especificamente:**

- Você clica, se distrai, clica de novo sem falar → **"Obrigado." vai direto pro seu clipboard**
- O check no ícone e o blip de sucesso disparam normalmente — o app sinaliza êxito para lixo
- A regra de **<15 palavras = só pontuação** de [Prompt de reescrita](./08-prompt-de-reescrita.md) **não protege**: "Obrigado." já está limpo e passa reto pelo Groq
- Com [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) no caminho, o Groq ainda poderia "corrigir" a alucinação e sugerir um termo inventado para o dicionário

**A solução, também medida:**

| Entrada | Com `--vad -vm ggml-silero-v5.1.2.bin` |
|---|---|
| 0,5 s / 1 s / 2 s / 5 s de silêncio | `""` (vazio) |
| 3 s de ruído branco baixo | `""` (vazio) |

**5 de 5 corretos.** Custo: **885 KB** de modelo adicional — 0,15% do tamanho do modelo principal. Baixa da mesma origem (`huggingface.co/ggml-org/whisper-vad`).

**Consequência para o app:** transcrição vazia é um resultado legítimo e frequente, não um erro. O app deve **abortar silenciosamente** — não chamar o Groq (economiza TPM), não tocar o blip de sucesso, não pôr nada no clipboard, e **não destruir o que já estava no clipboard**. Voltar a ocioso sem drama.

**Risco residual, a validar com o corpus:** o `--vad-threshold` default é `0.50`. Fala muito baixa, sussurrada, ou longe do microfone poderia ser cortada junto com o silêncio. O [Corpus de transcrições reais](./24-corpus-de-transcricoes-reais.md) vai transcrever **as duas vias** — com e sem VAD — justamente para verificar se o VAD engole algo de fala real. Se engolir, o threshold é ajustável.

## Corrigido pelo corpus

**A decisão acima estava parcialmente errada.** Ligar `--vad` no `whisper-cli` suprime a alucinação, mas **danifica conteúdo real** — o [corpus de 30 ditações](../research/corpus/ANALISE.md) mostrou isso em dois casos graves:

- Amostra **16**: o VAD perdeu uma frase inteira, deixando `diferentes.` pendurado no fim
- Amostra **21**: o VAD **engoliu `modules/home/hooks/useMenu.ts`** — exatamente o tipo de conteúdo que este app existe para preservar

Ele também acertou duas vezes (removeu `E aí` de um silêncio real de RMS 0,0011, e um `Obrigado.` pendurado), mas o saldo é negativo: perder um nome de arquivo é pior que colar uma alucinação, porque a alucinação você percebe.

**Decisão corrigida: o VAD sai do caminho da transcrição e vira portão.**

1. Rodar `whisper-vad-speech-segments` no áudio, antes de transcrever
2. **Zero segmentos** → descarta em silêncio; não chama o whisper, não chama o Groq, não toca o blip, não mexe no clipboard
3. **Qualquer segmento** → transcreve o **áudio inteiro, sem `--vad`**

Verificação do portão, 6 de 6 corretos:

| Entrada | Segmentos |
|---|---|
| Amostra 02 (silêncio real, RMS 0,0011) | **0** |
| 2 s de silêncio digital · 3 s de ruído branco | **0** e **0** |
| Amostra 03 (a fala mais baixa do corpus, RMS 0,0351) | 1 |
| Amostras 01 · 29 · 16 · 21 | 2 · 6 · 8 · 13 |

Nenhum falso negativo na fala mais fraca, nenhum falso positivo no silêncio ou ruído.

**Alternativa considerada e descartada:** limiar de RMS calculado no próprio app, a partir das amostras Float32 que o AudioWorklet já tem. Separação de **31×** no corpus, custo zero, sem modelo extra, e é um número logável. Perde num caso: sala barulhenta sem ninguém falando passaria, e o Whisper alucinaria. O VAD pega esse caso por 885 KB e ~100 ms.
