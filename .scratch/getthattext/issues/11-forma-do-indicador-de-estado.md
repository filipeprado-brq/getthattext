# Forma do indicador de estado

Type: prototype
Status: resolved
Blocked by: 03, 05

## Question

Como o usuário sabe em que estado a ferramenta está?

A latência total agora é `whisper local` + `roundtrip Groq` somados — os tickets 03 e 05 dão os números. **Esses números decidem este ticket:** se o total for ~300ms, o ícone da Tray mudando basta; se for 3 segundos, o usuário precisa de sinal forte de "estou processando, não fale de novo, não mude de janela".

Estados a cobrir: ocioso · ouvindo · transcrevendo · reescrevendo · erro.

Prototipar e decidir:
- Ícone da Tray mudando vs HUD flutuante vs ambos
- Se há feedback **sonoro** (um blip ao começar e ao terminar) — importa porque em push-to-talk seu olhar está no input, não na barra de menu
- Se o estado "ouvindo" mostra nível de áudio, pra confirmar que o mic está de fato captando
- Como um erro se manifesta sem virar um diálogo modal que rouba foco

## Adendo (após [Captura de áudio no Electron](./04-captura-de-audio-no-electron.md))

Uma restrição deixou de ser opcional: **o estado "ouvindo" só pode acender quando o primeiro frame de áudio realmente chegar, nunca no key-down.** O Chromium adia o início de streams de input em até 5 segundos após o Mac acordar do sleep. Sem isso, o usuário abre a tampa, aperta o atalho, vê "gravando" e fala no vazio.

Isso também implica um estado que não estava na lista original: **"abrindo o microfone"** — entre o key-down e o primeiro frame. Decidir se ele é visível ou se some quando a espera é curta.

## Adendo 2 (após [Key-up global no macOS](./02-key-up-global-no-macos.md))

Mais um estado que não estava previsto: **"não posso gravar agora"**. Enquanto um campo de senha estiver focado, o macOS ativa *secure input* e o atalho global **não chega ao app** — em nenhuma das abordagens possíveis. É detectável com `IsSecureEventInputEnabled()`.

Decidir: o app avisa (e como, se o atalho nem chegou?), ou simplesmente não responde e deixa o usuário achar que quebrou?

**Reforço, após [Injeção de texto no input focado](./01-injecao-de-texto-no-input-focado.md):** isso deixou de ser só uma questão de feedback. Foi **medido** que a Accessibility API **não** é bloqueada por secure input e escreve num campo de senha normalmente. O app precisa detectar e **recusar ativamente**, não tentar e ver no que dá.

## Adendo 3 (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md)) — o ícone virou o centro de tudo

O ícone da barra deixou de ser só indicador: agora é **o gatilho principal** (clique esquerdo alterna, clique direito abre configurações). E o usuário já definiu que ele **pisca** enquanto grava.

**Cai deste ticket:** o estado "não posso gravar agora (secure input)" — não há mais injeção, então secure input não afeta nada.

**Sobra, e ficou mais importante:** os estados agora precisam ser legíveis num alvo de ~18×18 px que também é um botão.

- **Ocioso** · **abrindo o microfone** · **gravando (piscando)** · **transcrevendo** · **reescrevendo** · **pronto** · **erro**
- "Gravando" só acende quando o áudio realmente chegar — a restrição do deferral de 5 s do Chromium continua valendo
- **Estado novo, e é o que fecha o ciclo: "pronto, está no clipboard".** Antes o texto aparecia no input e o feedback era o próprio texto. Agora ele vai para um lugar invisível — se o app não disser que terminou, o usuário não tem como saber. Isso é o feedback mais importante do app agora, não o menos.
- Piscar quanto? Piscar rápido demais irrita numa barra de menu; devagar demais não lê como "ativo". Vale prototipar.
- Vale som? Com o texto indo para o clipboard e não para a tela, um blip de início e fim resolve o ciclo sem exigir olhar pra cima.

## Answer

Protótipo (atualizado para refletir as decisões): **https://claude.ai/code/artifact/07629e1d-58ec-4c1d-a5c7-191a3d45cf2f** — barra de menu simulada nos dois temas, estados clicáveis, e as três cadências de piscada rodando em tamanho real. Fonte em `scratchpad/icone.html`.

**Seis estados, não sete.** "Transcrevendo" e "reescrevendo" viraram um só, **Processando**: somam ~2 s e o usuário não faz nada diferente sabendo em qual está. Se um dia importar, a distinção volta só na mensagem de erro.

| Estado | Forma | Motivo |
|---|---|---|
| **Ocioso** | contorno de microfone, monocromático | é o que fica na barra o dia inteiro — o mais discreto dos seis |
| **Abrindo o microfone** | mesmo contorno, esmaecido, respirando | o Chromium adia a captura em até 5 s depois que o Mac acorda; sem este estado o usuário fala no vazio |
| **Gravando** | microfone preenchido, **vermelho**, respirando a **1,7 s** | o único estado onde não perceber custa algo |
| **Processando** | três pontos, monocromático | whisper local + Groq, ~2 s somados |
| **Pronto, está no clipboard** | check por ~2 s **+ som curto**, volta a ocioso | o feedback mais importante do app |
| **Erro** | círculo com exclamação, persiste até clicar | o texto pode ter sido perdido; não pode passar despercebido |

**Cor: monocromático (`template image`) exceto vermelho ao gravar.** Cinco dos seis estados usam o template padrão do macOS, que o sistema tinge sozinho e que funciona em qualquer barra sem código. Todo o orçamento de cor vai para **gravando** — o único estado com custo real se passar despercebido. Isso é consistente com a plataforma, não contra ela: o próprio indicador de privacidade do macOS é um ponto laranja, não um símbolo cinza.

**Cadência: respiração de 1,7 s.** Lê como "ativo", não como "alerta". Com o vermelho carregando o sinal, o movimento só precisa confirmar que está vivo — e é a única das três que se aguenta ver pelos dois minutos que a gravação pode durar. As de 0,6 s e 1,0 s foram descartadas por cansarem na periferia da visão.

**Fim do ciclo: check no ícone + som curto, desligável.** Esta foi a decisão mais consequente. O texto vai para a área de transferência, que é invisível — antes ele aparecia no input e o feedback era o próprio texto. **O som é o que resolve de verdade:** no momento em que fica pronto, o olhar do usuário está no input onde vai colar, não no topo da tela. Sem áudio, o único sinal fica num lugar onde ninguém está olhando, e na prática o usuário coleria no escuro e descobriria pelo resultado.

Precisa ser desligável — quem trabalha de fone o dia inteiro não quer um blip por ditação.

**Menu do clique direito** (esboçado no protótipo): Ditar · Último texto · Copiar transcrição crua · Preferências · Dicionário · Sair. Os dois itens de texto são provisórios — [Cola direto ou revisa antes](./09-cola-direto-ou-revisa-antes.md) decide se o texto cru fica acessível e onde.

**Não decidido de propósito:** som de *início*. Foi levantado que ele resolveria também o atraso de 5 s pós-sleep, mas dois sons por ditação numa ferramenta usada dezenas de vezes ao dia é ruído. Fica como ajuste, se o estado "abrindo o microfone" não bastar na prática.

## Pendência resolvida

Os dois itens de texto do menu, que ficaram provisórios acima, foram fechados em [Cola direto ou revisa antes](./09-cola-direto-ou-revisa-antes.md): fica **só "Copiar transcrição crua"**, desabilitado quando não há nada guardado. O item "Último texto" com prévia do reescrito foi descartado — item de menu com parágrafo truncado é feio, e o check mais o som já fecham o ciclo.

## Item novo no menu

[Aprender correções automaticamente](./19-aprender-correcoes-automaticamente.md) acrescentou **"Sugestões do dicionário (n)"** ao menu do clique direito, com contador. Sem badge no ícone — foi explicitamente rejeitado por carga visual, dado que o ícone já carrega seis estados e o vermelho de gravação em 18×18 pt.

## Sétimo estado

[Quando o Groq falha](./12-quando-o-groq-falha.md) acrescentou uma variante de "pronto": **check vazado** em vez de preenchido, sinalizando que o clipboard tem o **texto cru**, não o reescrito. Mesmo som do sucesso normal — sem blip distinto.
