# Qual é o atalho

Type: prototype
Status: resolved
Blocked by: 02

## Question

Qual combinação de teclas é o gatilho de push-to-talk?

Não é uma escolha de gosto — tem restrições duras que o ticket 02 vai delimitar. Decidir com um protótipo mínimo que registre o listener e mostre o que ele captura, testando na prática:

- A tecla escolhida está livre, ou o sistema/outro app já a rouba?
- É confortável **segurar** por 10, 30, 60 segundos de fala? Teclas modificadoras isoladas cansam menos que combinações
- Dispara sem querer durante uso normal do teclado?
- Funciona igual com o teclado do MacBook e com teclado externo?
- O atalho deve ser configurável nas preferências (já está no escopo) — mas qual é o **padrão**?

Registrar a decisão, as alternativas testadas, e por que as descartadas foram descartadas.

## Adendo (após [Key-up global no macOS](./02-key-up-global-no-macos.md))

A restrição mudou: com hotkey Carbon escopada, **o atalho precisa ser uma combinação registrável, não uma modificadora sozinha.** Segurar `fn` está fora — a Apple reserva Fn-D justamente para o ditado nativo dela.

Shortlist validada contra `CopySymbolicHotKeys()` rodado nesta máquina (229 hotkeys, ~170 habilitadas) **e** contra a lista oficial da Apple:

- **`⌃⌥⌘G` — recomendado como default.** ⌃⌥⌘ + letra é praticamente livre no sistema. Alternativas equivalentes: `⌃⌥⌘K`, `⌃⌥⌘T`.
- **F18 / F19** (também F13, F16, F17, F20) — completamente livres, mas **só existem em teclado completo, não em MacBook**. Ótimas como opção avançada, ruins como default.
- **Ressalva a testar:** com **VoiceOver ligado**, ⌃⌥ é a "tecla VO". Acrescentar ⌘ deve evitar a colisão, mas confirmar com VoiceOver ativo.
- **Evitar:** qualquer coisa com `fn`/🌐 · ⌘Space e variantes · ⌃Space e ⌃⌥Space (ligam sozinhas quando se adiciona um 2º idioma) · ⇧⌘Space (muito disputado por Alfred/Raycast) · F11/F12/F14/F15.

**Além de escolher a tecla, este ticket agora precisa testar dois riscos com teclado físico:**

- **Release sem o press** — soltar os modificadores antes da tecla base pode engolir o `Released` e deixar a gravação presa. Se reproduzir, a mitigação (watchdog de duração) vira requisito, não precaução.
- **Entrega intermitente** — a verificação da research falhou 5 em 6 vezes em binário não empacotado. Confirmar num build real.

Validação em runtime disponível: `RegisterEventHotKey` com `kEventHotKeyExclusive` retorna `eventHotKeyExistsErr` se outro processo já tomou a combinação — dá para avisar o usuário no ato em vez de falhar em silêncio.

## Adendo 2 (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md)) — o ticket encolheu

O modelo virou **toggle**, e o gatilho principal passou a ser o **clique no ícone da barra**. O atalho global é o caminho rápido alternativo, não o único.

**Cai deste ticket:** o teste de "release sem o press" (não há release no caminho), o teste de entrega intermitente do addon Carbon (não há addon), e a preocupação com conforto de segurar (não se segura mais nada).

**Sobra:** escolher uma combinação que o sistema não roube. Toggle precisa só de key-down, então isso é `globalShortcut` do Electron puro. A shortlist de [Key-up global no macOS](./02-key-up-global-no-macos.md) continua válida — `⌃⌥⌘G` como default, `⌃⌥⌘K`/`⌃⌥⌘T` como alternativas — com a ressalva de testar com VoiceOver ligado, porque `⌃⌥` é a tecla VO.

**Uma pergunta nova:** o `globalShortcut.register` do Electron retorna `false` quando a combinação já está tomada por outro app. Isso precisa virar aviso visível na tela de preferências, não falha silenciosa — senão o usuário configura um atalho que nunca funciona e não entende por quê.

## Answer

**Padrão: `⌃⌥⌘G`**, configurável nas preferências. É toggle — um toque inicia, outro para.

**Fatos levantados nesta máquina (só leitura, nada tocado):**

- **MacBook Pro M4.** Isso **elimina F13–F20**, que eram a primeira escolha da shortlist de [Key-up global no macOS](./02-key-up-global-no-macos.md) — elas só existem em teclado completo.
- **Nenhum app sequestrador de atalho instalado** — sem Raycast, Alfred, Rectangle, Hammerspoon, Karabiner, CleanShot, Magnet. O campo está limpo hoje.
- **VoiceOver desligado.** A colisão do `⌃⌥` com a tecla VO é teórica para este usuário. Fica como ressalva documentada, porque VoiceOver liga com `⌘F5`: com ele ativo, `⌃⌥` + letra é capturado; acrescentar `⌘` deve evitar, mas isso não foi testado.

**`⇧⌘Space` foi considerado e rejeitado.** Seria mais confortável — uma mão, impossível de esquecer, e a research confirmou que não é hotkey do sistema. Estava livre justamente porque a máquina não tem os lançadores que costumam tomá-la. Foi descartado por ser **a primeira tecla que qualquer lançador novo vai querer**: instalar um Raycast no futuro quebraria o atalho. `⌃⌥⌘` + letra é à prova disso — quase nada usa essa combinação.

O custo aceito é ergonômico: quatro teclas para tocar dezenas de vezes ao dia. Toleráveis porque é **toque**, não segurada — se ainda fosse push-to-talk, essa escolha seria inviável.

**Detecção de conflito é requisito, não cortesia.** O `globalShortcut.register` do Electron retorna `false` quando a combinação já está tomada. Isso **tem** que virar aviso visível na tela de preferências — sem ele, o usuário configura um atalho que nunca funciona e não tem como descobrir por quê. Falha silenciosa é inaceitável aqui pelo mesmo motivo que em todo o resto do app.

**Alternativas registradas** para quando `⌃⌥⌘G` colidir com algo: `⌃⌥⌘K` e `⌃⌥⌘T`, validadas contra o mesmo dump de 229 hotkeys simbólicas.

**O que este ticket deixou de precisar fazer:** os testes de "release sem o press" e de entrega intermitente do addon Carbon caíram junto com o push-to-talk — não há release no caminho e não há addon.
