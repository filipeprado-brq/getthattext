# Quando o Groq falha

Type: grilling
Status: resolved
Blocked by: 05, 23

## Question

Já foi decidido que sem rede a ferramenta degrada para colar o texto cru do Whisper. Falta definir o comportamento completo de falha.

- **Quais falhas** existem de fato (o ticket 05 lista): timeout, rate limit, key inválida, key ausente, sem rede, erro do modelo. Cada uma degrada igual, ou algumas merecem tratamento diferente?
- **Timeout**: quanto tempo esperar antes de desistir e colar o cru? Um Groq lento é pior que um Groq fora do ar, porque o usuário fica travado
- O usuário **fica sabendo** que colou o cru em vez do reescrito? Como, sem um diálogo que rouba foco?
- **Key ausente na primeira execução** — a ferramenta funciona em modo cru até a key ser configurada, ou bloqueia até então?
- Vale ter um **modo cru explícito** nas preferências, para desligar a reescrita de propósito quando ditar algo que não pode ser alterado?

## Adendo (após [API do Groq](./05-api-do-groq.md))

As falhas agora são conhecidas, e uma delas domina: **o free tier tem 8.000 TPM, o que dá ~8–9 reescritas por minuto e ~220 por dia.** Rajadas vão bater em 429 — não é hipótese, é aritmética. O Developer tier sobe o TPM para 250.000 e torna o gargalo irrelevante.

Então este ticket também decide:

- **Free ou Developer?** É uma decisão de gasto, não técnica — mas ela determina se 429 é caso raro ou cotidiano, e portanto quanto esforço o tratamento merece.
- Ao bater 429, a ferramenta espera o `retry-after` ou degrada direto para o texto cru? Esperar trava o usuário; degradar entrega algo pior sem avisar.
- Vale mostrar `x-ratelimit-remaining-requests` em algum lugar, para o limite ser visível antes de virar erro?

Fatos que vêm da research: `APIError` expõe só `status`/`headers`/`error` (sem `.code`/`.param`); os headers de rate limit vêm em toda resposta; `retry-after` só em 429; cliente configurado com `timeout: 10_000, maxRetries: 1`.

## Adendo 2 (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md))

O destino do texto virou o **clipboard**, então "degrada para o texto cru" agora significa **põe o texto cru do Whisper no clipboard**. Fica mais simples de implementar e mais fácil de comunicar — mas cria uma pergunta nova: como o usuário sabe que o que está no clipboard é o cru e não o reescrito? Ele não vê o texto antes de colar.

## Adendo 3 — o gargalo de TPM não existe nesta conta

[Conta e chave do Groq](./23-conta-e-chave-do-groq.md) mediu os limites reais nos headers: **250.000 TPM e 500.000 RPD** — limites de Developer tier, não de Free. Isso é 31× mais do que a documentação de Free tier indicava.

**A sub-pergunta "free ou Developer?" está respondida por medição** e sai deste ticket. E o 429, que eu havia calculado como cenário cotidiano ("rajadas vão bater, é aritmética"), volta a ser **caso de borda**: com ~900 tokens por reescrita, o teto é de ~275 reescritas por minuto.

O ticket encolhe para as falhas que continuam reais: timeout, chave inválida, chave ausente na primeira execução, sem rede, e erro do modelo. Mais a pergunta de UX que não mudou: como o usuário sabe que o que está no clipboard é o cru e não o reescrito, se ele não vê o texto antes de colar?

## Answer

**Toda falha do Groq degrada pelo mesmo caminho: o texto cru do Whisper vai para o clipboard.** Nunca se perde a transcrição, nunca se fica sem nada.

**Como o usuário sabe que recebeu o cru: pelo ícone.** O estado "pronto" ganha uma variante visual — check **vazado** em vez de preenchido. **Sem som distinto** — o blip é o mesmo do sucesso normal.

Isso importa porque o cru é visivelmente pior. Do corpus real: *"Ok, pode subir Não tem problema não A gente consegue dar um jeito aqui"* — sem pontuação entre as frases. Colar isso achando que passou pela reescrita é constrangedor, e o clipboard não avisa nada por si.

*Ressalva registrada:* o ícone exige olhar para a barra de menu, e o som existe justamente porque o olhar está no input. Se na prática passar despercebido, a variante sonora é a correção óbvia.

**Timeout: 10 s**, mantendo o que [API do Groq](./05-api-do-groq.md) fixou. Medição real do [A/B](./16-ab-de-modelo-em-pt-br.md): **0,67 s de média, 1,27 s de pico** em 29 amostras. Dez segundos é 8× o pior caso — folgado de propósito, para tolerar hotspot, wi-fi de hotel e VPN corporativa sem perder a reescrita. O preço aceito é que uma falha real custa 10 s de espera.

**Cliente:** `timeout: 10_000, maxRetries: 1`. Os defaults do SDK (60 s × 3 tentativas) prenderiam o usuário por até 3 minutos.

### Decisões de rotina, tomadas sem consulta

- **Todas as falhas degradam igual** — timeout, `RateLimitError`, `AuthenticationError`, sem rede, erro do modelo, resposta inválida. Mesmo caminho: cru no clipboard, check vazado. Distinguir causas na UI seria ruído; o que muda é só o que o app faz **depois**.
- **Chave inválida:** além de degradar, limpa a chave guardada e abre as preferências. É a única falha que exige ação do usuário, e ela não se resolve sozinha.
- **Chave ausente na primeira execução: o app funciona em modo cru.** Não bloqueia. Você dita, recebe a transcrição do Whisper no clipboard, e vê o check vazado toda vez — o que é o próprio lembrete de que falta configurar. Bloquear seria pior: a parte local funciona perfeitamente sem o Groq.
- **Preferência explícita "reescrever com IA", ligada por padrão.** Um checkbox para desligar deliberadamente quando o texto não pode ser alterado — uma citação literal, um trecho contratual, um nome que precisa sair exato. É coerente com o cuidado que motivou as travas do prompt, e custa uma linha na tela de preferências.

**O que saiu deste ticket ao longo do caminho:** a escolha de tier e o tratamento de 429, ambos resolvidos por medição em [Conta e chave do Groq](./23-conta-e-chave-do-groq.md) — 250.000 TPM tornam o rate limit inalcançável em uso pessoal.
