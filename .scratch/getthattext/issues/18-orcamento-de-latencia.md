# Orçamento de latência e duração do ditado

Type: grilling
Status: resolved

## Question

As três parcelas de latência agora têm número. Um ditado típico de 10 s leva **~1,8–2,3 s** entre soltar a tecla e o texto aparecer; um de 60 s leva **~3,0–3,5 s**. Isso é tempo de espera parado, depois de você já ter terminado de falar.

Este ticket gradua duas manchas de névoa que os números dissiparam: *latência percebida* e *áudio longo*.

**A pergunta de fundo é sua, não da research:** quanto você tolera esperar? A resposta define quais alavancas valem ser puxadas — e várias delas custam qualidade ou escopo.

**Alavancas disponíveis, com o custo de cada:**

| Alavanca | Ganho | Custo |
|---|---|---|
| `-ac` (encoder context reduzido) | O encoder sempre paga 30 s; um ditado de 5 s desperdiça a maior parte disso | Trade-off qualidade/velocidade **não medido** em lugar nenhum — precisa de teste |
| `@fugood/whisper.node` in-process | Elimina os ~320 ms de load por ditado | Dependência nova, addon nativo a mais, precisa confirmar que carrega no Electron sem rebuild |
| Mostrar o texto cru primeiro, substituir pelo reescrito | Percepção cai para só a parcela do whisper (~0,6–1,8 s) | O texto muda debaixo do usuário depois de colado — pode ser pior que esperar |
| Começar a transcrever antes de soltar a tecla | Sobrepõe transcrição com fala | `whisper-cli` não é streaming (lê stdin até EOF); exigiria fatiar e costurar |
| Desligar a reescrita do Groq | Corta 0,9–1,4 s | Perde a feature que motivou o Groq |

**Decisões a fechar:**

- Qual é o teto aceitável de espera, em segundos?
- Alguma alavanca vale ser puxada agora, ou o número já está bom?
- Existe **duração máxima** de ditado? Não há limite técnico duro — o custo é linear em janelas de 30 s e o WAV de 5 minutos são ~9,6 MB em RAM — mas há um ponto em que a espera fica absurda. O app corta, avisa, ou deixa?
- O que acontece se o usuário segurar a tecla por engano por 10 minutos?

## Answer

**Latência:** ~2 s é aceitável. **Nenhuma alavanca puxada agora.** `-ac`, o binding in-process e "mostrar cru primeiro" ficam como otimizações futuras — nenhuma é arquitetural, exceto a última, que tem custo de UX próprio (texto mutando depois de entregue).

**Duração máxima: ~2 minutos** (~340 palavras). Ao bater o limite, **para e processa normalmente** — nunca descarta. Isso deixou de ser otimização e virou requisito: uma gravação esquecida precisa de teto.

---

## O modelo de ativação mudou nesta sessão

A pergunta "vai ser preciso ficar segurando as teclas?" expôs que três decisões tomadas em momentos diferentes não fechavam juntas: **push-to-talk** (charting) + **`⌃⌥⌘G`** (research do key-up) + **duração de 2 minutos** (aqui). Segurar um acorde de quatro teclas por dois minutos não é viável.

**Levantamento dos concorrentes** ([Wispr Flow](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free), [superwhisper](https://superwhisper.com/docs/get-started/settings-shortcuts)): os dois fazem **híbrido** (toque alterna, segurada grava), e **nenhum usa acorde de quatro teclas** — usam `fn` ou um par de modificadores puros. Wispr usa `Esc` para descartar; superwhisper tem Cancel Recording com confirmação acima de 30 s.

Mas as teclas confortáveis custam caro no Electron: `fn` é ilegível ("not supported by Chrome") e modificador puro não é hotkey registrável — exigiria event tap, ou seja, o keylogger.

**Decisão final do usuário, que redesenhou o fluxo:**

- **Clique esquerdo no ícone da barra** inicia; **clique de novo** para. O ícone **pisca** enquanto grava.
- **Clique direito** abre o menu de configurações (a construir depois).
- **Além do ícone, um atalho global de toggle** (ex.: `⌃⌥⌘G`) faz o mesmo sem sair do teclado. Toggle precisa só de key-down, então usa o **`globalShortcut` do Electron puro** — sem addon nativo, sem key-up, sem permissão nova.
- **Ao parar: transcreve, reescreve no Groq, e coloca o resultado no clipboard.** O usuário cola onde quiser com `⌘V`.

**Por que isso é uma simplificação grande, e não só uma troca de gosto:** o clique no ícone roubar o foco do input só era problema porque o app ia *colar* no input. Com o clipboard como destino, não existe foco a preservar — a objeção que matou o modelo de clique na sessão de charting desapareceu junto com a feature de injeção.

**Consequência principal: o app cai de duas permissões TCC para uma — só Microfone.** A Acessibilidade era exigida exclusivamente pelo `CGEventPost`. O onboarding de 5 passos manuais nos Ajustes do Sistema desaparece inteiro, e o app **nunca aparece em Privacidade > Acessibilidade**. Num app que grava áudio, essa é a diferença entre "pode ver tudo que eu digito" e "só usa o microfone".

O raio de alcance também encolhe: **o app nunca toca outro aplicativo.**

**Custo aceito:** um `⌘V` manual por ditação. Colar automaticamente fica fora de escopo — dá pra adicionar depois, mas o preço é a Acessibilidade voltar e com ela toda a complexidade de injeção.
