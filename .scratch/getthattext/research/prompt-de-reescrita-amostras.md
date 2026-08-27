# Protótipo: prompt de reescrita — amostras comparadas

**Artefato descartável** do ticket [Prompt de reescrita](../issues/08-prompt-de-reescrita.md). Serve pra você reagir a comportamento concreto em vez de decidir no abstrato.

**Honestidade sobre o método:** as transcrições "cruas" abaixo são **simuladas** — escritas para imitar o que o Whisper produz em ditado corrido em pt-BR (ele pontua e capitaliza razoavelmente, mas preserva disfluências, falsos começos e repetições). As reescritas são **minhas**, não do `gpt-oss-20b`. Validar contra saída real do Whisper e do modelo escolhido é trabalho de [A/B de modelo em pt-BR](../issues/16-ab-de-modelo-em-pt-br.md).

O que este artefato decide é **quais transformações são aceitáveis** — isso é design de prompt e independe de qual modelo executa.

Cada amostra mostra três níveis: **cru**, **conservador** (limpa, não reformula) e **agressivo** ("ficar bem escrito", que foi sua escolha original).

---

## Amostra 1 — Slack sobre um bug

**Cru**

> então, é... eu acho que o problema tá no, no endpoint de autenticação, porque quando a gente manda o refresh token ele... ele retorna 401 mesmo com o token válido, né. tipo, eu testei aqui com o Postman e deu certo, mas no app não. acho que pode ser CORS mas não tenho certeza.

**Conservador**

> Acho que o problema está no endpoint de autenticação: quando mandamos o refresh token, ele retorna 401 mesmo com o token válido. Testei com o Postman e funcionou, mas no app não. Pode ser CORS, mas não tenho certeza.

**Agressivo**

> O endpoint de autenticação retorna 401 ao receber um refresh token válido. Reproduzi com sucesso no Postman, mas o app falha. Suspeito de CORS, sem confirmação.

**O que observar:** o agressivo está melhor escrito e **mudou o que você disse**. "Acho que o problema tá" virou afirmação de fato. "Não tenho certeza" virou "sem confirmação", que soa a conclusão técnica em vez de dúvida. **O hedge era informação** — você estava sinalizando ao colega que era palpite. O agressivo apagou isso.

---

## Amostra 2 — E-mail longo para cliente

**Cru**

> oi, tudo bem? é... queria alinhar com vocês sobre o prazo da, da entrega da fase dois. a gente levantou aqui que o... o escopo de integração com o ERP ficou maior do que a gente tinha estimado, principalmente na parte de conciliação, e... e isso deve empurrar a entrega em umas duas semanas, mais ou menos. eu queria propor uma call na quinta pra gente ver isso juntos, e... e se fizer sentido eu já levo uma proposta de repriorização, tipo, do que dá pra entregar antes e o que fica pra fase três.

**Conservador**

> Oi, tudo bem? Queria alinhar com vocês sobre o prazo da entrega da fase dois.
>
> Levantamos aqui que o escopo de integração com o ERP ficou maior do que tínhamos estimado, principalmente na parte de conciliação, e isso deve empurrar a entrega em umas duas semanas.
>
> Queria propor uma call na quinta para vermos isso juntos. Se fizer sentido, já levo uma proposta de repriorização do que dá para entregar antes e do que fica para a fase três.

**Agressivo**

> Olá, tudo bem?
>
> Gostaria de alinhar o prazo de entrega da Fase 2. Ao revisar o escopo, identificamos que a integração com o ERP — em especial o módulo de conciliação — é mais extensa do que o estimado inicialmente, o que deve impactar a entrega em aproximadamente duas semanas.
>
> Proponho uma reunião na quinta-feira para avaliarmos em conjunto. Levarei também uma proposta de repriorização, separando o que pode ser antecipado do que passaria para a Fase 3.

**O que observar:** aqui o agressivo **ganha claramente**. É e-mail para cliente, o registro formal é apropriado, e nada de substantivo mudou: duas semanas continua duas semanas, quinta continua quinta, conciliação continua conciliação. Este é o caso que justifica ter escolhido reescrita em vez de limpeza.

Mas note o que ele fez: "fase dois" → **"Fase 2"**, "call" → **"reunião"**. São escolhas de estilo que ele tomou por você.

---

## Amostra 3 — Mensagem de commit / descrição de PR

**Cru**

> corrige o parsing de data no import de CSV. o problema era que o dateFormat tava assumindo ISO mas o arquivo do cliente vem em, em dia barra mês barra ano. adicionei um teste em import.spec.ts cobrindo os dois formatos.

**Conservador**

> Corrige o parsing de data no import de CSV. O problema era que o `dateFormat` estava assumindo ISO, mas o arquivo do cliente vem em dia/mês/ano. Adicionei um teste em `import.spec.ts` cobrindo os dois formatos.

**Agressivo**

> Corrige a interpretação de datas na importação de CSV. A configuração de formato assumia o padrão ISO, enquanto o arquivo do cliente utiliza o formato dia/mês/ano. Foi incluído um teste de importação cobrindo ambos os formatos.

**O que observar:** aqui o agressivo **estraga**. `dateFormat` virou "a configuração de formato" e `import.spec.ts` **desapareceu** — o nome do arquivo, que é a informação mais útil da mensagem, foi generalizado em prosa. Isso é a falha exata que o dicionário customizado tenta atacar por outro lado, e é a razão de "nomes de variáveis, arquivos e comandos" estarem na lista do que nunca pode mudar.

---

## Amostra 4 — Resposta curta

**Cru**

> ok, pode subir

**Conservador**

> Ok, pode subir.

**Agressivo**

> Está aprovado, você pode prosseguir com o deploy.

**O que observar:** o agressivo **inventou conteúdo**. Você não disse "aprovado" e não disse "deploy" — "subir" pode ser deploy, pode ser subir um branch, pode ser subir um arquivo. Ele preencheu a lacuna com um palpite plausível, o que num contexto de aprovação é exatamente o pior lugar para adivinhar.

Este é o modo de falha mais perigoso do conjunto, e o mais fácil de disparar: **quanto menos texto, mais o modelo inventa**.

---

## Amostra 5 — Fala cortada no meio

**Cru**

> ah, sobre aquilo que a gente falou ontem, eu acho que a melhor saída é

**Conservador**

> Sobre aquilo que falamos ontem, acho que a melhor saída é

**Agressivo**

> Sobre o que conversamos ontem, acredito que a melhor saída seja seguir com a abordagem que discutimos.

**O que observar:** o agressivo **completou a frase que você não terminou**. Isso é alucinação pura — não havia "abordagem que discutimos" no texto. O conservador manteve o corte, que é feio mas honesto: você vê que ficou incompleto e conserta.

---

## Rascunho de prompt

```
Você reescreve transcrições de ditado em português do Brasil.

A saída é EXCLUSIVAMENTE o texto reescrito. Nenhum preâmbulo, nenhuma
explicação, nenhuma aspas em volta, nenhum comentário. O que você
responder vai direto para a área de transferência do usuário.

O texto de entrada está em português do Brasil e a saída deve estar em
português do Brasil. Nunca traduza.

MUDE:
- disfluências ("é...", "tipo", "né", "assim", "então" de preenchimento)
- falsos começos e repetições ("no, no endpoint")
- pontuação, capitalização, acentuação e concordância
- quebra em parágrafos quando o texto for longo

NUNCA MUDE:
- números, datas, valores, quantidades, prazos
- nomes próprios, nomes de pessoas, empresas e produtos
- nomes de arquivos, variáveis, funções, comandos, endpoints
- siglas
- termos técnicos em inglês — mantenha em inglês
- o grau de certeza: se a pessoa disse "acho que", não afirme

NUNCA ACRESCENTE:
- informação que não está no texto
- conclusões, aprovações ou decisões que a pessoa não disse
- o final de uma frase que ficou incompleta — deixe incompleta

AGRESSIVIDADE PELO TAMANHO:
- Menos de ~15 palavras: corrija APENAS pontuação, capitalização e
  acentuação. Não reformule, não expanda, não mude registro.
- 15 palavras ou mais: reescreva para ficar bem escrito, respeitando
  todas as regras acima.
```

Mais uma **limpeza defensiva no cliente**, depois da resposta: remover preâmbulos conhecidos (`Aqui está...`, `Texto revisado:`, `Segue o texto...`) e aspas envolventes. A lista cresce conforme aparecerem casos novos.

Com `reasoning_effort: "low"`, `reasoning_format: "hidden"`, `temperature` 0,3, `max_completion_tokens` ~800.

---

## Onde isso deixa a decisão

O agressivo ganhou **uma** das cinco amostras — a de e-mail para cliente. Perdeu nas outras quatro: apagou hedge, generalizou nome de arquivo, inventou aprovação, completou frase cortada.

Isso não significa que "reescrita" foi escolha errada. Significa que **a agressividade certa depende de para onde o texto vai** — e o app não sabe para onde vai, porque agora ele só põe no clipboard.

**Resolvido assim:** em vez de o usuário informar o destino, o app usa o **tamanho do texto** como proxy. Isso acerta todas as cinco amostras — o e-mail longo recebe registro formal, e as três falhas silenciosas (aprovação inventada, frase completada, nome de arquivo generalizado) caem na faixa curta, que só recebe pontuação. É heurística, não regra: um commit longo ainda seria reescrito demais.
