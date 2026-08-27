# Janela de microfone aberto

Type: prototype
Status: resolved

## Question

Por quanto tempo o app mantém o device de microfone aberto? A plataforma não deixa você ter as duas coisas ao mesmo tempo — é um trade-off de privacidade **visível**, e por isso é decisão do dono do app, não da research.

O que [Captura de áudio no Electron](./04-captura-de-audio-no-electron.md) estabeleceu:

- **Stream sempre aberto** mata ~100% da latência e habilita um ring buffer de pré-roll (~300 ms), que resolve o "cortou as primeiras palavras" de um jeito que abrir-no-key-down nunca resolve. Preço: o **ponto laranja fica aceso o dia inteiro**, e o app aparece permanentemente na lista do Control Center. Um app de ditado nessa condição é, para quem olha, indistinguível de um app que grava tudo.
- **`track.enabled = false`** parece a saída — mas a spec de Media Capture diz que o UA **SHOULD liberar o device em 3 segundos** quando todas as tracks ficam disabled, o que apagaria o ponto **e** traria a latência de volta. Se o Chromium implementa isso para áudio no macOS 15 **não foi verificado** — MDN só documenta o caso de câmera.
- **Janela de inatividade de ~20–30 s** é o meio-termo que a research recomendou: primeiro ditado da sessão paga a latência, os seguintes são instantâneos, e o ponto laranja fica aceso exatamente enquanto você está ditando — que é o que ele significa.

**Dois experimentos decidem isso.** Montar um harness Electron descartável e medir:

- **E1 — latência real.** `performance.now()` do key-down até o primeiro frame não-nulo, ~50 repetições, em três condições: device frio, device recém-usado, e logo após abrir a tampa do MacBook (que é onde o deferral de 5 s do Chromium deve aparecer).
- **E2 — o ponto laranja.** Com stream ativo e `track.enabled = false`, cronometrar se e quando o ponto apaga. Se ele apagar, "stream sempre aberto com mute lógico" passa a ser possível e é estritamente melhor que a janela de inatividade.

**Decisões a fechar depois dos números:** qual estratégia adotar, e — se for janela de inatividade — quanto tempo ela dura.

Guardar o harness e as medições em `.scratch/getthattext/research/` como asset.

## Perdeu urgência (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md))

O gatilho virou **clique no ícone** (ou atalho de toggle), não push-to-talk. Isso enfraquece os dois lados do trade-off:

- **A latência de abrir o device fica mascarada.** Você clica, move a atenção, e só então começa a falar — há centenas de milissegundos de folga humana que o push-to-talk não tinha. O experimento **E1** continua valendo, mas o número que ele produzir importa menos.
- **O argumento do pré-roll quase desaparece.** Ele existia para resolver "cortou as primeiras palavras", que era um problema de apertar-e-falar-imediatamente. Com clique-e-depois-falar, isso praticamente não acontece.

**O que sobrevive intacto:** a decisão sobre o **ponto laranja**. Manter o device aberto ainda acende o indicador permanentemente, e o experimento **E2** (se `track.enabled = false` apaga o ponto) ainda é o que decide se dá para ter as duas coisas.

Com a urgência menor, o default razoável passou a ser **abrir no clique e fechar ao parar** — o mais simples e o mais honesto com o indicador. Este ticket agora decide se há motivo para não fazer isso.

## Answer

**Abre o device no clique, fecha ao parar.** Nenhuma janela de inatividade, nenhum stream permanente.

**O argumento que decidiu não foi latência, foi honestidade do indicador.** O ponto laranja do macOS vale precisamente porque é verdadeiro: ele diz "o microfone está em uso agora". Manter o device aberto por 20–30 s após você parar deixa o ponto aceso quando você **não** está sendo gravado — e um indicador que mente é pior que um indicador lento. Num app que pede pra ficar na sua barra o dia inteiro gravando áudio, isso corrói exatamente a confiança que o resto do desenho vinha protegendo (a mesma razão de o app não precisar de Acessibilidade e nunca aparecer nessa lista).

**O custo praticamente desapareceu** com a mudança de push-to-talk para clique:

- A latência de abrir fica mascarada pela folga humana entre clicar e começar a falar
- O **pré-aquecimento no boot** (criar o `AudioContext` e rodar `audioWorklet.addModule()`) come a maior parte do resto, e **não acende o ponto laranja** — criar um `AudioContext` abre device de saída, não de entrada
- O argumento do **pré-roll** morreu junto com o push-to-talk: ele existia pra resolver "cortou as primeiras palavras", que era problema de apertar-e-falar-imediatamente

**Isso encerra os dois experimentos que o ticket previa.** E1 (medir latência real de abertura) e E2 (se `track.enabled = false` apaga o ponto laranja) deixam de ser necessários — E2 só importava para viabilizar "sempre aberto com mute lógico", que foi descartado por motivo independente dos números. **Com isso, não resta nenhum trabalho de "construir para medir" no mapa.**

Continua valendo de [Captura de áudio no Electron](./04-captura-de-audio-no-electron.md): o estado "gravando" só acende quando o primeiro frame de áudio chega, nunca no clique — o Chromium adia o início da captura em até 5 s depois que o Mac acorda.
