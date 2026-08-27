# Prompt de reescrita

Type: prototype
Status: resolved
Blocked by: 05

## Question

O que exatamente o LLM do Groq pode e não pode mudar no texto transcrito?

A decisão foi "reescrita pra ficar bem escrito" — não só limpeza. Isso é poderoso e perigoso: num ditado, alterar o que a pessoa disse é um bug. Prototipar o prompt com transcrições reais em pt-BR e fixar as regras:

- O que **deve** mudar: disfluências, falsos começos, repetições, pontuação, capitalização, concordância, quebra de parágrafos, ordem de frases mal construídas
- O que **nunca** pode mudar: números, valores, nomes próprios, nomes de variáveis/arquivos/comandos, siglas, citações literais, termos técnicos em inglês
- Como o prompt sinaliza que a saída é **só o texto**, sem preâmbulo ("Aqui está o texto revisado:") — isso colaria junto no input
- O que acontece com fala muito curta ("ok", "sim") — o modelo inventa conteúdo?
- O que acontece com fala ambígua ou cortada no meio
- Temperatura, e se vale `response_format` estruturado
- Como o prompt sabe que o texto é português (evitar tradução acidental)

Guardar as transcrições de teste e as saídas comparadas como asset em `.scratch/getthattext/research/`.

## Answer

Protótipo com as amostras comparadas: [`research/prompt-de-reescrita-amostras.md`](../research/prompt-de-reescrita-amostras.md) — cinco transcrições em pt-BR, cada uma em cru / conservador / agressivo, com o rascunho de prompt no fim.

**O agressivo puro ganhou 1 das 5 amostras.** Perdeu apagando hedge ("acho que" virou afirmação), generalizando `import.spec.ts` em prosa, inventando "está aprovado, pode prosseguir com o deploy" a partir de "ok, pode subir", e completando uma frase que o usuário não terminou. O padrão: **quanto menos texto, mais o modelo inventa** — e os erros são silenciosos, num texto que vai ser colado sem leitura.

**Decisão: agressividade escalada pelo tamanho do texto.**

- **Menos de ~15 palavras:** corrige apenas pontuação, capitalização e acentuação. Não reformula, não expande, não muda registro.
- **15 palavras ou mais:** reescreve para ficar bem escrito, respeitando as travas.

Isso acerta as cinco amostras sem exigir que o usuário escolha um modo antes de cada ditação. O limiar é heurística, não regra — um commit longo ainda seria reescrito demais — e deve ser configurável.

**Travas duras no prompt:**

- **Nunca muda:** números, datas, valores, prazos · nomes próprios, de pessoas, empresas e produtos · nomes de arquivos, variáveis, funções, comandos, endpoints · siglas · termos técnicos em inglês (mantém em inglês) · **o grau de certeza** — se a pessoa disse "acho que", não afirma
- **Nunca acrescenta:** informação ausente · conclusões, aprovações ou decisões não ditas · o final de uma frase incompleta — deixa incompleta

Cada uma dessas regras existe porque uma amostra específica falhou sem ela.

**Saída: texto puro + limpeza defensiva no cliente.** Instrução explícita de que a resposta vai direto para a área de transferência, mais um passo que remove preâmbulos conhecidos (`Aqui está...`, `Texto revisado:`) e aspas envolventes. `response_format` com JSON schema foi considerado e rejeitado: daria garantia dura, mas custa tokens, pode degradar a escrita, tem interação não verificada com `reasoning_format: hidden`, e adiciona um caminho de falha (parse) do qual seria preciso degradar. A garantia mole basta porque a falha é visível e a lista de preâmbulos cresce sozinha.

**Configuração:** `reasoning_effort: "low"`, `reasoning_format: "hidden"`, `temperature` 0,3, `max_completion_tokens` ~800, `stream: true`.

**Idioma:** o prompt declara que entrada e saída são português do Brasil e proíbe tradução explicitamente — sem isso o modelo pode escorregar para português europeu ou traduzir.

**Ressalva de método:** as transcrições cruas do artefato são simuladas e as reescritas são minhas, não do `gpt-oss-20b`. Isto fixa **quais transformações são aceitáveis**, que é design de prompt. Validar o comportamento real do modelo é [A/B de modelo em pt-BR](./16-ab-de-modelo-em-pt-br.md).

## Superado em parte

**A decisão de saída mudou.** [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) precisa que o modelo reporte o que corrigiu, então a saída passou a ser **estruturada** (texto + lista de correções escopadas a termos) em vez de texto puro com limpeza defensiva. A degradação no parse é: usar o texto cru do Whisper e não sugerir nada.

Todo o resto deste ticket continua valendo: as travas de `NUNCA MUDE` e `NUNCA ACRESCENTE`, o escalonamento de agressividade por tamanho (<15 palavras = só pontuação), e a configuração do modelo.

## Limiar corrigido pelo corpus

**De 15 para ~40 palavras.**

O [corpus](../research/corpus/ANALISE.md) mediu a distribuição real: pedindo brevidade explícita em oito amostras, a fala natural saiu com **9, 14, 19, 27, 33, 35 e 37 palavras**. Só duas ficaram abaixo de 15.

Ou seja, o limiar de 15 **quase nunca dispararia**, e a proteção contra invenção ficaria inativa justamente na faixa onde ela foi desenhada para agir. A amostra 01 é a prova: *"Ok, pode subir Não tem problema não A gente consegue dar um jeito aqui"* — 14 palavras, conteúdo de aprovação, e a uma palavra de escapar da proteção.

Continuam duas faixas, não três: até ~40 palavras só pontuação e capitalização; acima disso, reescrita completa. Três faixas foram consideradas e descartadas por complexidade.

**Preço aceito:** um recado de 35 palavras que você gostaria de ver bem escrito sai apenas pontuado.

## Saída volta a ser texto puro

A estruturação decidida em [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) **foi revertida** — o A/B mostrou que o relato de correções pelo modelo rende 1 em 29, porque a própria trava de nomes de arquivo impede a detecção.

**Vale novamente a decisão original deste ticket:** saída em **texto puro**, com limpeza defensiva no cliente removendo preâmbulos conhecidos e aspas envolventes. Sem JSON, sem parse, sem caminho de degradação extra.
