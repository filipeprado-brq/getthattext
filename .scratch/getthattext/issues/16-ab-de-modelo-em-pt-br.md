# A/B de modelo em pt-BR

Type: prototype
Status: resolved
Blocked by: 08, 23, 24

## Question

`openai/gpt-oss-20b` foi escolhido como padrão em [API do Groq](./05-api-do-groq.md), mas a escolha se apoia em MMMLU-`PT_BR`, que mede **conhecimento e raciocínio** em português — não fluência de escrita. A research declarou isso como lacuna explícita: não existe benchmark público de qualidade **generativa** em pt-BR para nenhum modelo do Groq.

Reescrita depende exatamente do que MMMLU não mede: naturalidade, registro, concordância, colocação pronominal, e não escorregar para português europeu.

Com o prompt já fixado pelo ticket [Prompt de reescrita](./08-prompt-de-reescrita.md), rodar um A/B com **~30 transcrições reais** do app e decidir:

- `gpt-oss-20b` é bom o bastante, ou os +4,8 pts do `gpt-oss-120b` aparecem como escrita visivelmente melhor?
- O ganho do 120b justifica 2× o custo e ~2× a latência? (o passo Groq passaria de ~0,9–1,4 s para ~2–3 s, somado ao whisper local)
- Algum dos dois escorrega para português europeu, ou erra registro (formal demais / informal demais)?
- Vale manter a troca de modelo exposta nas preferências, ou fixar um e pronto?

Registrar as 30 amostras e as saídas comparadas em `.scratch/getthattext/research/` como asset.

## Adendo (após [Onde entra o dicionário customizado](./10-onde-entra-o-dicionario-customizado.md))

A research do dicionário travou numa lacuna que este ticket pode preencher de graça: **não existe nenhum baseline de quão mal o Whisper vai em jargão de dev falado em português.** Sem isso não dá pra saber se o dicionário precisa de 20 ou 500 termos — e esse número decide se o prompt caching do Groq chega a acionar (o mínimo cacheável não é publicado por modelo; um dicionário pequeno pode nunca cachear).

O corpus de ~30 transcrições reais que este ticket já vai produzir responde isso. Ao montá-lo, incluir de propósito fala com nomes de ferramentas, siglas e termos em inglês dentro de frases em português, e **anotar o que o Whisper errou** — não só comparar os dois modelos do Groq.

## Answer

Rodado sobre as 29 transcrições reais do [corpus](../research/corpus/ANALISE.md), nos dois modelos, com o prompt exato que os tickets decidiram. Script em `corpus/ab.py`, resultado bruto em `corpus/ab-resultado.json`.

**Veredito: `openai/gpt-oss-20b` confirmado como padrão. O `120b` como fallback ficou em dúvida — ele perdeu no caso mais difícil.**

### O limiar de 40 palavras funciona

Medido por similaridade com o texto cru:

- **9 amostras curtas (<40 palavras): similaridade 0,94 a 1,00.** Só pontuação mudou, como desenhado.
- **21 amostras longas (≥40): similaridade 0,02 a 0,91.** Reescritas.

Uma exceção: o 20b **não reescreveu** a amostra 09 (77 palavras, similaridade 1,00), e reescreveu de leve a 22 e a 26. O 120b reescreveu todas. O 20b é mais conservador na faixa longa.

### As travas seguraram

- **Invenção em texto curto: 0 de 9.** Nenhum dos dois transformou *"Ok, pode subir"* em aprovação formal. Este era o maior medo, e ele não se materializou.
- **Nomes de arquivo: preservados perfeitamente.** `import.spec.ts`, `fixtures.json`, `services/alf.ts` e `modules/home/hooks/useMenu.ts` saíram intactos nos dois modelos, inclusive dentro de texto longo reescrito.
- **Grau de certeza: preservado.** O 20b manteve "acho que"; o 120b trocou por "acredito que" — mais formal, mas ainda hedge.

**Evidência de contraste:** numa chamada de teste **sem as travas**, com prompt mínimo, `"ok pode subir"` virou **`"Upload concluído com sucesso!"`** — invenção total. As travas são o que separa os dois resultados.

### 20b venceu no caso mais difícil

Amostra 21 tem auto-correção no meio — a pessoa fala um caminho de arquivo errado, diz "Desculpa" e fala o correto: *"…modules/home/**useffect**. Desculpa. modules/home/**hooks/useMenu.ts**…"*

- **20b:** manteve **apenas a versão corrigida**, descartou a errada e o "Desculpa". Cumpriu a regra à risca.
- **120b:** manteve **as duas** e narrou — *"conferir a pasta modules/home/useffect. Desculpe, o arquivo correto é modules/home/hooks/useMenu.ts"*. **Quebrou a regra.**

### 20b escorregou uma vez

Amostra 01: o 20b transformou `pode subir` em **`pode subir?`** — afirmação virou pergunta, o que muda o sentido. O 120b acertou. É erro de pontuação com consequência semântica, não de conteúdo.

### Latência

| | média | mínimo | máximo |
|---|---|---|---|
| **20b** | **0,67 s** | 0,37 s | **1,27 s** |
| 120b | 1,03 s | 0,41 s | **3,69 s** |

O 20b é ~1,5× mais rápido na média e tem cauda muito melhor. O pico de 3,69 s do 120b sozinho já estoura o orçamento de latência do app.

### A falha: o relato de correções quase não funciona

**1 de 29 amostras em cada modelo.** O 20b reportou `parcer → parser`; o 120b reportou `amplitude → Amplitude`. Só isso.

E há uma razão **estrutural**, não de prompt: a trava **`NUNCA MUDE nomes de arquivos, variáveis, comandos`** impede exatamente a correção que [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) precisa detectar. O modelo vê `services/alf.ts`, não tem como saber que era `services/auth.ts`, e — corretamente, seguindo a trava — deixa como está.

**As duas decisões estão em conflito direto.** A trava que protege nomes de arquivo é a mesma que impede o aprendizado de correções. Isso precisa de decisão nova.

### Armadilha de implementação, para a spec

A API do Groq responde **HTTP 403** para requisições com `User-Agent: Python-urllib`. Não é erro de chave nem de payload — é bloqueio de user-agent. Definir um `User-Agent` próprio resolve. O `groq-sdk` oficial provavelmente já define o dele, mas vale saber, porque o 403 não diz nada sobre a causa.
