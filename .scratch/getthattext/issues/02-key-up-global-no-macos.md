# Key-up global no macOS

Type: research
Status: resolved

## Question

O `globalShortcut` do Electron dispara apenas no key-**down** — não existe key-up. Push-to-talk exige detectar o **soltar** da tecla. A partir de Node/Electron no macOS 15, quais opções existem?

Cobrir:
- **`uiohook-napi`** e alternativas (`node-global-key-listener`, `iohook`, outros): qual está de fato mantido, qual compila em arm64 sem dor, qual expõe key-up de verdade
- Qual API do macOS cada um usa por baixo (`CGEventTap`? `NSEvent` global monitor?) e qual permissão isso exige
- Se um `CGEventTap` que observa todas as teclas é aceitável ou se dá pra restringir ao atalho escolhido — importa porque um listener global é, por construção, um keylogger e isso precisa ser uma escolha consciente
- Se o listener sobrevive a sleep/wake e a troca de usuário
- Custo de CPU de manter o tap ativo o tempo todo
- Quais teclas e combinações o sistema já captura e portanto não estão disponíveis (`fn` para o ditado nativo, Spotlight, etc.)

Gravar achados em `.scratch/getthattext/research/key-up-global.md`.

## Answer

Achados completos, com verificação empírica em Electron 44 / macOS 15.7.3 / arm64: [`research/key-up-global.md`](../research/key-up-global.md) (580 linhas, com apêndice de reprodução).

**A premissa do ticket estava errada. Não é preciso um keylogger.**

O ticket assumia que key-up global exigiria um `CGEventTap` — que, por construção, vê todas as teclas e exige permissão de Acessibilidade. Isso é verdade para taps, mas **existe outro caminho**: `RegisterEventHotKey` + `kEventHotKeyReleased` (Carbon, header oficial do SDK).

- É **escopado a uma combinação** — teclas não registradas nunca chegam ao processo
- Entrega **press e release**
- **Não exige nenhuma permissão TCC** — zero prompt, zero ida a Ajustes do Sistema, zero restart
- O Chromium simplesmente não registra o handler de release; por isso o `globalShortcut` do Electron não tem key-up (confirmado em `global_accelerator_listener_mac.mm`, e Kevin Sawicki fechou o issue #7802 dizendo isso)

Verificado nesta máquina: 3.000 keydown + 3.000 keyup da tecla registrada, **zero** eventos de tecla não registrada, e **nenhum event tap criado** (`CGGetEventTapList`).

**Consequências para o produto, não só para o código:**

- O app **não aparece** em Privacidade > Acessibilidade por causa do atalho. Num app que grava áudio, isso é uma diferença auditável pelo usuário — não uma economia técnica.
- Sem tap ativo: sem `kCGEventTapDisabledByTimeout`, sem lag de teclado global, sem o bug de `uiohook-napi#47` (4.730 µs de latência média medidos no tap).
- Menos superfície de falso-positivo em antivírus.

**Decisões travadas:**

- **Abordagem: hotkey Carbon escopada.** `uiohook-napi` vira **plano B**, usado só se o produto exigir algo que a hotkey escopada não entrega (PTT numa modificadora sozinha, leitura de `fn`, duplo-toque de modificador).
- **`fn` está descartada.** Electron não suporta ("not supported by Chrome"), e a Apple já reserva Fn-D (**o ditado nativo — nosso concorrente direto**), Fn-H, Fn-F11 e o menu "Press 🌐 key to".
- **Nenhum pacote npm serve como está.** `hotcakey@0.8.0` é a única implementação da rota Carbon e **funciona**, mas está sem manutenção desde 2021 e sem prebuilds. `node-global-key-listener` está arquivado e embarca binário x86_64 **não assinado** (quebraria a assinatura). `iohook` morto desde 2021. `nut.js`/`robotjs` não fazem escuta global.

**Cinco riscos em aberto, que a research não pôde fechar sozinha:**

1. **Release sem o press.** Comportamento clássico de hotkey Carbon: soltar os modificadores antes da tecla base pode fazer o `Released` não chegar — deixando o push-to-talk **preso no ar, gravando**. Precisa de teste com teclado físico.
2. **Secure input.** O atalho **não funciona enquanto um campo de senha estiver focado** — em nenhuma das abordagens. Detectável com `IsSecureEventInputEnabled()`.
3. Entrega de hotkey foi **intermitente** em binários CLI não empacotados (1 em ~6). Precisa de teste num build real do app.
4. Sleep/wake e fast user switching: sem documentação da Apple; assumir que precisa re-registrar.
5. Não registrar o mesmo acelerador via `globalShortcut` **e** via o addon — a Apple diz "only one such combination can exist for the current application".

## Superado em parte

O key-up **não é mais necessário**: [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md) trocou push-to-talk por **toggle**, que precisa só de key-down e portanto usa o `globalShortcut` do Electron puro. O addon nativo Carbon, o risco de "release engolido" e o escape hatch caem todos junto.

O que **sobrevive** desta pesquisa: a shortlist de teclas realmente disponíveis (validada contra as 229 hotkeys simbólicas desta máquina), o descarte de `fn`, e a confirmação de que `RegisterEventHotKey` com `kEventHotKeyExclusive` sinaliza conflito de atalho — útil para avisar o usuário no ato.
