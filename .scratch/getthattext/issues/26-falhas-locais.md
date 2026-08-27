# Falhas locais

Type: grilling
Status: resolved

## Question

Graduado da névoa: a mancha "tratamento de erro local" dizia que viraria decisão "quando os tickets de injeção e permissões fecharem". Os dois fecharam, e a injeção nem existe mais — então as falhas que sobram agora são conhecidas e nomeáveis.

Todas são do lado **local**. As do lado do Groq estão em [Quando o Groq falha](./12-quando-o-groq-falha.md).

**O que decidir, caso a caso:**

- **Binário do `whisper-cli` ausente ou não executável.** É embarcado no bundle, então isso significa instalação corrompida. O app abre e avisa, ou se recusa a abrir?
- **Modelo não baixado no primeiro uso.** São 547 MB mais 885 KB do VAD. O app baixa quando? No onboarding, ou na primeira ditação — que travaria a primeira ditação por minutos? E o que o ícone mostra enquanto baixa?
- **Download interrompido ou corrompido.** [Empacotamento e execução](./14-empacotamento-e-execucao.md) estabeleceu que o Hugging Face publica SHA-256 e que o download é resumível, e que o script do whisper.cpp **não verifica nada**. Verificar quando — a cada início, ou só depois de baixar? O que fazer com um arquivo que falha o checksum?
- **Device de áudio trocando no meio da gravação.** Fone Bluetooth conectando, ou o usuário trocando de saída. [Captura de áudio no Electron](./04-captura-de-audio-no-electron.md) registrou que isso dispara `mute`/`ended` na track. Aborta e avisa, ou tenta continuar com o que já gravou?
- **Re-registro do atalho após sleep/wake e fast user switching.** A Apple não documenta o comportamento. O app re-registra por precaução em `powerMonitor`, ou só quando detectar que parou de funcionar — o que ele não tem como detectar?
- **Disco cheio ao baixar o modelo.**

**A regra que já vale em todo o resto do app e deve guiar isto:** nunca descartar uma transcrição, e nunca falhar em silêncio. E há uma regra nova de [Quando não há fala](./25-quando-nao-ha-fala.md): transcrição vazia é resultado **legítimo**, não erro — o que significa que "vazio" e "falhou" precisam ser distinguíveis no ícone.

## Answer

**Download do modelo: no onboarding, junto com a permissão de microfone.**

Primeira abertura pede o microfone, baixa os 548 MB do `large-v3-turbo-q5_0` mais os 885 KB do VAD Silero com barra de progresso, e só então libera o uso. O usuário espera uma vez, sabendo por quê, e a primeira ditação funciona de primeira.

As alternativas foram descartadas pelo mesmo motivo: todas criam um estado em que o app **parece pronto mas não está**. Baixar na primeira ditação é o pior — trava por minutos exatamente no momento em que a ferramenta está sendo julgada.

### Decisões de rotina, aplicando princípios já estabelecidos

**Integridade do download.** Verificar SHA-256 depois de baixar — o Hugging Face publica (`394221709cd5ad1f...`, 574.041.195 bytes, confirmado independentemente ao montar o corpus) e o `download-ggml-model.sh` do whisper.cpp **não verifica nada**. Se não bater: apaga, tenta uma vez, e falha com mensagem clara. Download interrompido retoma — o HF responde `206 Partial Content`, verificado em [Empacotamento e execução](./14-empacotamento-e-execucao.md).

**Disco cheio.** Checar espaço livre antes de começar (precisa de ~600 MB) e recusar com mensagem específica, em vez de falhar no meio com um arquivo pela metade.

**Binário do `whisper-cli` ausente ou não executável.** Ele é embarcado no bundle, então isso significa instalação corrompida. O app **não abre** e diz para reinstalar. É a única falha em que se recusar a funcionar é melhor que degradar — sem o whisper não há produto.

**Device de áudio trocando no meio da gravação** (fone Bluetooth conectando, troca de saída): **transcreve o que já foi capturado**, mostra a variante de erro no ícone, e **nunca descarta**. Isso aplica o princípio que vale em todo o app — nunca perder uma transcrição — e a variante de erro é o que avisa que o áudio foi cortado antes do fim.

**Re-registro do atalho após sleep/wake e troca de usuário.** A Apple não documenta o comportamento, então a decisão é defensiva: re-registrar em `powerMonitor` nos eventos `resume`, `unlock-screen` e `user-did-become-active`. É barato e a alternativa — detectar que o atalho parou de funcionar — é impossível: um atalho que não chega é indistinguível de um atalho que não foi apertado.

**"Vazio" e "falhou" precisam ser estados distintos.** [Quando não há fala](./25-quando-nao-ha-fala.md) estabeleceu que transcrição vazia é resultado **legítimo** — o portão VAD detectou que ninguém falou, e o app volta a ocioso em silêncio. Isso não pode usar o mesmo sinal de uma falha real, ou o usuário aprende a ignorar os dois.
