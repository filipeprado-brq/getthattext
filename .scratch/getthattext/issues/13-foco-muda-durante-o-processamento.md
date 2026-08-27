# Foco muda durante o processamento

Type: grilling
Status: closed-out-of-scope
Blocked by: 01, 03, 05

## Question

Entre soltar a tecla e o texto estar pronto passam N segundos (03 + 05 dão o N). Nesse intervalo o usuário pode ter clicado em outro campo, trocado de app, ou fechado a janela. Onde o texto vai parar?

- O app **captura o alvo** no momento em que a gravação começa e cola lá, mesmo que o foco tenha mudado? Ou cola em **onde quer que esteja focado** no momento de colar?
- Se captura o alvo: o mecanismo escolhido no ticket 01 permite endereçar um elemento específico, ou só "o focado agora"?
- Se o app alvo foi fechado ou a janela sumiu, o que acontece com o texto? Vai pro clipboard? Notificação? Some?
- O usuário pode **cancelar** durante o processamento? Como?
- O que acontece se o usuário disparar uma **segunda ditação** enquanto a primeira ainda processa — fila, ignora, ou cancela a anterior?

## Fechado — fora de escopo

Ficou além do destino após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md): o texto vai para o **clipboard**, não para um input focado. Não existe alvo de foco a perder, então não existe pergunta.
