# Cola direto ou revisa antes

Type: grilling
Status: resolved
Blocked by: 08

## Question

Com reescrita por LLM no caminho, o usuário vai colar no input um texto que **não leu**. Isso é aceitável, ou precisa de um passo de revisão?

O fork:
- **Cola direto** — mantém o fluxo rápido que é a razão de ser da ferramenta. Preço: você confia cego numa reescrita, e vai reler no input de destino de qualquer forma. Se o modelo distorceu, você já mandou a mensagem.
- **Janela de revisão** — mostra o texto antes de colar, com opção de aceitar/editar/rejeitar. Preço: mata boa parte do ganho de velocidade e adiciona uma janela que rouba foco — exatamente o problema que o push-to-talk foi escolhido para evitar.
- **Meio-termo** — cola direto mas mantém o texto cru acessível (atalho de desfazer que troca o reescrito pelo original, ou o cru no clipboard).

Depende do que o ticket 08 revelar sobre quão fiel a reescrita realmente é. Se ela for confiável, revisão é fricção desnecessária; se distorcer, colar direto é inaceitável.

## Reenquadrado (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md))

O mecanismo mudou, o problema não. Antes a pergunta era "cola no input sem você ler?". Agora é **"vai para o clipboard sem você ler?"** — e você cola em seguida, ainda sem ter lido.

O que **mudou a favor**: agora existe um intervalo natural entre o texto ficar pronto e você colá-lo. Você aperta `⌘V` quando quiser. Isso abre espaço para revisar que antes não existia — e sem roubar foco, porque você já vai olhar para algum lugar antes de colar.

O que **mudou contra**: o texto agora vive num lugar **invisível**. No modelo antigo, o texto aparecia no input e você via imediatamente se o Groq distorceu algo. Agora ele está no clipboard, e o primeiro momento em que você vê o resultado é **depois de já ter colado** — possivelmente já enviado.

As opções, atualizadas:

- **Direto pro clipboard, sem mostrar** — fluxo mais rápido. Preço: você cola e envia texto que nunca leu.
- **Mostrar numa janela/popover antes de ir pro clipboard** — você confirma, aí vai. Preço: uma janela por ditação, e o app volta a roubar foco.
- **Vai pro clipboard direto, e o texto fica visível em algum lugar consultável** — no menu do clique direito, por exemplo. Não bloqueia nada, e dá onde olhar quando desconfiar.
- **Clipboard recebe o reescrito, e o cru fica acessível** — um segundo item em algum lugar, para quando a reescrita distorcer.

Continua dependendo de [Prompt de reescrita](./08-prompt-de-reescrita.md): se a reescrita se provar fiel, mostrar é fricção; se distorcer, colar sem ver é inaceitável.

## Adendo (após [Prompt de reescrita](./08-prompt-de-reescrita.md))

A decisão de escalar a agressividade pelo tamanho **reduz o risco deste ticket, mas não o elimina.** Texto curto agora só recebe pontuação, então os modos de falha mais perigosos (inventar aprovação, completar frase cortada) foram atacados na raiz. O que sobra é texto longo sendo reformulado — onde o erro é mais sutil e mais fácil de não notar ao reler.

Isso muda o cálculo: mostrar todo texto antes de colar passou a ser fricção desproporcional. A pergunta mais fina agora é se o **texto cru** precisa ficar acessível em algum lugar para quando a reescrita longa distorcer algo.

## Answer

**Vai direto pro clipboard. Sem janela, sem confirmação. E o texto cru fica recuperável.**

- O **reescrito** vai para a área de transferência assim que estiver pronto.
- O **cru do Whisper** fica **em memória até a próxima ditação**, recuperável por **"Copiar transcrição crua"** no menu do clique direito — desabilitado quando não há nada guardado.
- **Nada vai para o disco.** Isso mantém "histórico de transcrições" fora de escopo: não acumula, não persiste, não sobrevive a um restart do app.

**O que decidiu isso:** a distorção vive no **texto longo** — [Prompt de reescrita](./08-prompt-de-reescrita.md) fez o texto curto receber apenas pontuação, matando na raiz os modos de falha perigosos (aprovação inventada, frase completada). Mas texto longo é justamente onde você **menos** pega o erro: um parágrafo de 300 palavras se bate o olho, não se revisa. "Eu percebo ao reler" é otimismo.

E o custo de descobrir é **assimétrico**: no momento em que você nota que o Groq mexeu em algo, o cru já não existe. Refazer significa ditar dois minutos de novo — exatamente o desfecho que a ferramenta existe para evitar. Guardar o cru em memória é seguro barato contra um evento raro e caro.

**Janela de revisão foi rejeitada** por dois motivos: rouba foco (o mesmo problema que descartou o clique-para-injetar na sessão de charting) e cobra fricção em toda ditação para proteger contra um caso minoritário. Com a agressividade escalada pelo tamanho, mostrar tudo antes de colar virou desproporcional.

**Segundo atalho global para o cru foi rejeitado** — seria mais rápido no momento do erro, mas é um atalho a mais para escolher, lembrar e não conflitar, e é invisível: você esqueceria que existe.

**Decisão de rotina, tomada sem consulta:** o menu não mostra prévia do texto reescrito. Item de menu com parágrafo truncado é feio e é estado a mais para manter, e o check mais o som já fecham o ciclo. Ver o texto é para quando se desconfia — e aí se cola.

**Isso viabiliza [Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md).** Guardar o cru ao lado do reescrito é precisamente o que permite ao app saber o que o Groq corrigiu e oferecer "quer fixar?". A janela de vida em memória dá o momento certo para essa oferta, e as regras fixadas iriam para o `dictionary.json` — que é dicionário, não histórico.
