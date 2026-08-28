# Aprender correções automaticamente

Type: grilling
Status: resolved
Blocked by: 09

## Question

[Onde entra o dicionário customizado](./10-onde-entra-o-dicionario-customizado.md) expôs um problema de usabilidade que não estava no escopo original: **o usuário não sabe de antemão como o Whisper vai errar um termo.** Ele não consegue escrever `heard: ["chad cê ene"]` para "shadcn" — ele descobre isso errando, no meio do trabalho, quando já está com pressa.

Existe uma saída que cai naturalmente do pipeline: guardando a transcrição bruta ao lado do texto reescrito, o app **sabe** o que o Groq corrigiu. Ele poderia oferecer "o Groq trocou X por Y — quer fixar?", e cada regra fixada vira substituição determinística de custo zero em TPM. Isso torna o dicionário auto-populável em vez de um arquivo que ninguém edita.

**A decisão:** isso entra no MVP ou é escopo além do destino?

- Argumento pra dentro: sem isso, o dicionário customizado — que você marcou como parte do MVP — provavelmente fica vazio e não entrega valor nenhum.
- Argumento pra fora: exige persistir transcrições brutas (o mapa colocou "histórico de transcrições" **fora de escopo**), uma UI de confirmação, e um diff entre cru e reescrito. É produto, não núcleo.

**Se entrar, decidir também:** onde a sugestão aparece sem roubar foco; se guarda a transcrição bruta em disco ou só em memória até a próxima ditação; e como isso se concilia com "histórico de transcrições está fora de escopo".

Depende de [Cola direto ou revisa antes](./09-cola-direto-ou-revisa-antes.md) — se houver passo de revisão, a sugestão tem um lugar natural para morar; se não houver, ela precisa inventar um.

## Answer

**Entra no MVP.** O Groq devolve, numa única chamada, o texto reescrito **e** a lista do que corrigiu. As sugestões acumulam em silêncio no menu, e você as revisa em lote.

**Isso reabre — e reverte — um ponto de [Prompt de reescrita](./08-prompt-de-reescrita.md):** a saída deixa de ser texto puro e passa a ser estruturada. O resto daquele ticket (travas de `NUNCA MUDE`/`NUNCA ACRESCENTE`, escalonamento de agressividade por tamanho, configuração do modelo) continua valendo integralmente.

**Decisões de engenharia, tomadas sem consulta:**

- **O schema separa texto de correções**, e as correções são **escopadas a termos**: nomes próprios, termos técnicos, nomes de arquivo/variável/comando, siglas. Sem esse escopo a lista viria cheia de "removi o 'né'", que não é correção de dicionário e afogaria as sugestões úteis em ruído.
- **Degradação no parse:** se a resposta não validar, o app usa o **texto cru do Whisper** e não sugere nada. Nunca descarta a transcrição — mesma regra que vale em todo o resto do app.
- **O escalonamento por tamanho continua valendo**, e as correções são reportadas nas duas faixas. Texto curto recebe só pontuação, mas um termo mal transcrito num texto curto é exatamente o que se quer pegar.
- Saída estruturada custa alguns tokens a mais por chamada. Marginal contra os 8.000 TPM do free tier, especialmente com o system prompt cacheado.

**Onde a sugestão aparece: acumula em silêncio no menu do clique direito** — um item "Sugestões do dicionário (n)" que você abre quando quiser. Nada de notificação, nada de badge, nada de adicionar sozinho.

Os três descartados, e por quê:

- **Adicionar automaticamente** foi rejeitado porque uma correção errada do modelo viraria **regra determinística permanente**, aplicada em toda ditação futura — e substituição determinística é mais difícil de notar que erro de LLM.
- **Notificação do sistema** seria ruído pesado numa ferramenta usada dezenas de vezes ao dia.
- **Badge no ícone** foi rejeitado por carga visual: o ícone já carrega seis estados e o vermelho de gravação num alvo de 18×18 pt.

**Sobre "histórico de transcrições está fora de escopo":** não há conflito. O que persiste são **pares de termos** (`ouvido → correto`), que são dados de dicionário. Nenhuma transcrição vai para o disco — o cru continua vivendo apenas em memória até a próxima ditação, como [Cola direto ou revisa antes](./09-cola-direto-ou-revisa-antes.md) decidiu.

**O que isso resolve:** o furo que motivou o ticket. `heard[]` era opcional em [Onde entra o dicionário customizado](./10-onde-entra-o-dicionario-customizado.md) porque você não sabe de antemão como o Whisper vai errar "shadcn". Agora o app descobre por você, e cada regra fixada vira substituição determinística de **custo zero em TPM**.

## Corrigido pelo A/B — o mecanismo mudou

**O relato de correções pelo Groq não funciona.** [A/B de modelo em pt-BR](./16-ab-de-modelo-em-pt-br.md) rodou as 29 amostras reais nos dois modelos: **1 de 29 em cada** produziu alguma correção (`parcer → parser` no 20b, `amplitude → Amplitude` no 120b).

E a razão é **estrutural, não de prompt**: a trava `NUNCA MUDE nomes de arquivos, variáveis, comandos` impede exatamente a correção que este ticket precisava detectar. O modelo vê `services/alf.ts`, não tem como saber que era `services/auth.ts`, e — corretamente — deixa como está. **As duas decisões se anulavam.**

### Mecanismo novo: aprender do que o usuário corrige

O editor de dicionário, que já existe no menu do clique direito, ganha **"adicionar do último ditado"**: mostra a transcrição crua (que já está em memória, por [Cola direto ou revisa antes](./09-cola-direto-ou-revisa-antes.md)), o usuário clica na palavra que saiu errada e digita a correta. O par vira entrada de `heard[]` no `dictionary.json` e, na ditação seguinte, substituição determinística de custo zero em TPM.

**A fonte da verdade passa a ser o usuário**, que sabe que era `auth`, em vez do modelo, que não tem como saber.

**Por que isso resolve o furo original:** o problema nunca foi digitar a entrada — foi *lembrar de cabeça* como o Whisper escreveu errado. Com o cru na tela, isso desaparece.

**Escopo:** é um campo no editor de dicionário, não um editor de texto. A alternativa de "janela de correção do texto inteiro" foi considerada e descartada por ser um editor dentro do app.

### Consequência: a saída volta a ser texto puro

A estruturação da resposta existia **exclusivamente** para o Groq reportar correções. Sem isso, **[Prompt de reescrita](./08-prompt-de-reescrita.md) volta à decisão original**: texto puro com limpeza defensiva no cliente. Some o custo de tokens do JSON, some o caminho de parse, some a degradação que ele exigia.
