# Key-up global no macOS (push-to-talk em Electron)

> Pesquisa para o ticket `02-key-up-global-no-macos.md`.
> Ambiente de teste: **macOS 15.7.3 (24G419), Apple Silicon**, Electron **44.0.0**, Node **20.20.0**, SDK **MacOSX26.2**.
> Trechos marcados com **[VERIFICADO]** foram executados nesta máquina; os artefatos de teste estão no apêndice.

---

## 0. TL;DR

1. **Confirmado**: `globalShortcut` do Electron só dispara no key-**down**. Não é limitação de documentação — é arquitetural: o Chromium usa `RegisterEventHotKey` do Carbon e instala handler **apenas** para `kEventHotKeyPressed`.
2. **A premissa do ticket ("preciso de um keylogger global") é falsa.** O macOS tem uma API de hotkey **escopada a uma combinação específica** que entrega **press E release**: `RegisterEventHotKey` + `kEventHotKeyReleased`. Não usa `CGEventTap`, **não exige permissão de Acessibilidade nem Input Monitoring**, e não vê nenhuma outra tecla. **[VERIFICADO]**
3. O pacote npm que expõe isso é o `hotcakey` — funciona, mas está **sem manutenção desde 2021** e sem prebuilds.
4. `uiohook-napi` é a melhor opção da família "listener global" (mantido, N-API, prebuild `darwin-arm64`), mas é um `CGEventTap` **ativo** sobre *todas* as teclas → é literalmente um keylogger, exige Acessibilidade, e **só funciona dentro do Electron** (em Node puro não entrega eventos de teclado). **[VERIFICADO]**
5. `node-global-key-listener` está **arquivado** e embarca um binário **x86_64-only e não assinado** → Rosetta + quebra de notarização. Descartar.
6. `iohook` está morto (último release 2021). `nut.js` não tem hook global de teclado.
7. **A tecla `fn` não é utilizável.** O Electron não a suporta (mantenedora: "não é suportada pelo Chrome") e o macOS já a reserva (Fn-D = Ditado nativo, Fn-H / Fn-F11 = mostrar Desktop, segurar fn = teclas de função, além do menu "Press 🌐 key to").

---

## 1. Confirmação: `globalShortcut` não tem key-up

### 1.1 Documentação oficial do Electron

A doc do módulo lista **7 métodos e zero eventos**. A descrição do callback é:

> "Registers a global shortcut of `accelerator`. The `callback` is called when the registered shortcut is **pressed** by the user."

— <https://www.electronjs.org/docs/latest/api/global-shortcut> / fonte: <https://github.com/electron/electron/blob/main/docs/api/global-shortcut.md>

Não existe `keyup`, `keydown`, `on(...)` nem qualquer objeto de evento passado ao callback.

### 1.2 Resposta oficial do mantenedor

Issue **electron/electron#7802 — "GlobalShortcut keyUp"** (aberta 2016-10-30, fechada 2016-10-31). Kevin Sawicki (Electron core):

> "This is not possible using the `globalShortcut` APIs. Electron wraps Chrome's `global_shortcut_listener.h` API which **only exposes a key press event**. You could write a native module that hooks into OS keyboard APIs and implement this that way for your app. Closing this out."

— <https://github.com/electron/electron/issues/7802>

Issue **electron/electron#26301** ("globalShortcut doesn't have keydown and keyup event", caso de uso literalmente idêntico ao nosso: "open a mic on key press and close it on key release") foi aberta em 2020-11-02 e fechada no dia seguinte redirecionando para o Discord, sem implementação.
— <https://github.com/electron/electron/issues/26301>

### 1.3 Prova no código do Chromium (raiz da limitação)

`ui/base/accelerators/global_accelerator_listener/global_accelerator_listener_mac.mm`:

```objc
void GlobalAcceleratorListenerMac::StartWatchingHotKeys() {
  EventHandlerUPP hot_key_function = NewEventHandlerUPP(HotKeyHandler);
  EventTypeSpec event_type;
  event_type.eventClass = kEventClassKeyboard;
  event_type.eventKind = kEventHotKeyPressed;      // <-- só "pressed"
  InstallApplicationEventHandler(hot_key_function, 1, &event_type, this, &event_handler_);
}
```

e o handler chama apenas `NotifyKeyPressed(accelerator)`.
— <https://chromium.googlesource.com/chromium/src/+/main/ui/base/accelerators/global_accelerator_listener/global_accelerator_listener_mac.mm>

**Ponto crucial**: o Chromium usa `RegisterEventHotKey`, que **suporta release** — o Chromium simplesmente não registra o handler para `kEventHotKeyReleased`. A limitação é do Chromium, não do macOS. Isso abre a opção descrita na seção 3.

---

## 2. As três APIs do macOS que podem entregar key-up global

| API | Escopo | Entrega key-up? | Permissão exigida | Pode consumir o evento? |
|---|---|---|---|---|
| `RegisterEventHotKey` (Carbon / HIToolbox) | **Uma combinação específica** | **Sim** (`kEventHotKeyReleased`) | **Nenhuma** | Sim (a hotkey é consumida) |
| `CGEventTapCreate` (CoreGraphics) | **Todas** as teclas (máscara por *tipo* de evento) | Sim (`kCGEventKeyUp`) | Acessibilidade (tap ativo) / Input Monitoring (listen-only) | Sim, se `kCGEventTapOptionDefault` |
| `NSEvent.addGlobalMonitorForEvents` (AppKit) | Por *tipo* de evento (todas as teclas) | Sim, mas ver ressalva | Acessibilidade | **Não** |

### 2.1 `RegisterEventHotKey` + `kEventHotKeyReleased` (Carbon)

Do header oficial do SDK (`HIToolbox/CarbonEvents.h`, MacOSX26.2.sdk):

```
/*
 *  kEventClassKeyboard / kEventHotKeyReleased
 *  Summary:  A registered hot key was released.
 *  Parameters:
 *    --> kEventParamDirectObject (in, typeEventHotKeyID)
 *          The ID of the hot key that was released.
 *  Availability: Mac OS X: in version 10.0 and later in Carbon.framework
 */
enum { kEventHotKeyReleased = 6 };
```

E sobre a própria API:

> "Registers a global hot key based on the virtual key code and modifiers you pass in. Only one such combination can exist for the current application... The same hot key can, however, be registered by multiple applications... In Mac OS X 10.5 and later, you can request exclusive registration for your process only by passing `kEventHotKeyExclusive` for the `inOptions` parameter."

O bloco da Global HotKey API está **fora** do `#if !__LP64__`, ou seja, é disponível em 64-bit.

Implementação de referência em produção: o crate `global-hotkey` do Tauri usa exatamente isso e expõe `HotKeyState::Pressed` / `HotKeyState::Released`:
— <https://github.com/tauri-apps/global-hotkey/blob/dev/src/platform_impl/macos/mod.rs> (linhas com `kEventHotKeyPressed` / `kEventHotKeyReleased`)
— <https://github.com/tauri-apps/global-hotkey/blob/dev/src/lib.rs> (`enum HotKeyState { Pressed, Released }`)

### 2.2 `CGEventTapCreate` (CoreGraphics)

Documentação da Apple:

> "Event taps receive key up and key down events if one of the following conditions is true: The current process is running as the **root** user. **Access for assistive devices is enabled**."

— <https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>

Localizações (`CGEventTapLocation`):
- `kCGHIDEventTap` — "the point where HID system events enter the window server"
- `kCGSessionEventTap` — "the point where HID system and remote control events enter **a login session**"
- `kCGAnnotatedSessionEventTap` — "session events have been annotated to flow to an application"

— <https://developer.apple.com/documentation/coregraphics/cgeventtaplocation>

Opções (`CGEventTapOptions`):
- `kCGEventTapOptionListenOnly` — "a passive listener"
- `kCGEventTapOptionDefault` — "an active filter" ("A passive listener receives events but cannot modify or divert them. An active filter may pass an event through unmodified, modify an event, or discard an event.")

— <https://developer.apple.com/documentation/coregraphics/cgeventtapoptions>

### 2.3 `NSEvent.addGlobalMonitorForEvents`

> "Events are delivered asynchronously to your app and **you can only observe the event; you cannot modify or otherwise prevent the event from being delivered** to its original target application."
> "**Key-related events may only be monitored if accessibility is enabled** or if your application is trusted for accessibility access."
> "Note that your handler will not be called for events that are sent to your own application."

— <https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:)>

⚠️ A seção "Special Considerations" dessa página lista os tipos monitoráveis "In OS X v10.6" e **`NSKeyUp` não aparece na lista** (só `NSKeyDown` e `NSFlagsChanged`). A nota é histórica (10.6) e a Apple não a atualizou; **não consegui verificar empiricamente** se `keyUp` é entregue hoje. Como essa API além disso não permite consumir o evento nem dispensa a permissão de Acessibilidade, ela não traz vantagem sobre as outras duas — está fora da recomendação.

---

## 3. A pergunta central: dá para restringir ao atalho escolhido?

**Sim — e essa é a descoberta mais importante desta pesquisa.**

### 3.1 Um `CGEventTap` NÃO pode ser escopado a um atalho

O parâmetro `eventsOfInterest` é uma máscara sobre **tipos de evento**, não sobre teclas:

```c
/* A mask that identifies the set of Quartz events to be observed in an
   event tap. */
typedef uint64_t CGEventMask;
```
— `CoreGraphics/CGEventTypes.h` (SDK MacOSX26.2)

Os bits disponíveis são `kCGEventKeyDown`, `kCGEventKeyUp`, `kCGEventFlagsChanged`, etc. Não existe filtro por keycode no kernel/WindowServer. **Se você quer key-up de UMA tecla via tap, o seu processo recebe TODAS as teclas de TODOS os apps** — inclusive senhas digitadas fora de campos seguros. O filtro por keycode acontece no seu callback, em user-space. É, por construção, um keylogger. É exatamente o que `libuiohook` faz:

```c
CGEventMask event_mask = CGEventMaskBit(kCGEventKeyDown) |
        CGEventMaskBit(kCGEventKeyUp) |
        CGEventMaskBit(kCGEventFlagsChanged) | /* ... todos os de mouse ... */
        CGEventMaskBit(NX_SYSDEFINED);

(*hook)->port = CGEventTapCreate(
        kCGSessionEventTap, kCGHeadInsertEventTap,
        kCGEventTapOptionDefault,   /* tap ATIVO, não listen-only */
        event_mask, hook_event_proc, NULL);
```
— <https://github.com/kwhat/libuiohook/blob/1.2/src/darwin/input_hook.c>

### 3.2 Uma hotkey Carbon É escopada — comprovado

**[VERIFICADO]** Teste em Electron 44 / macOS 15.7.3 / arm64, com `hotcakey` registrando **apenas** `F20`:

```
--- event taps ativos enquanto o app roda:
active taps: 5
  (universalaccessd x3, NotificationCenter, ViewBridgeAuxiliary)
  ... e NENHUM tap do processo Electron
RESULT total=6000 kinds={"keydown":3000,"keyup":3000} cpu=0.7379s/11.0s -> 6.71% CPU
```

Durante o teste foram injetados **500 pares down/up de F18** (tecla *não* registrada) e **3000 pares de F20** (registrada). O app recebeu **exatamente 3000 keydown + 3000 keyup**, e **zero** eventos de F18.

Conclusões diretas:
- A hotkey Carbon **não cria nenhum event tap** → o app não aparece em `CGGetEventTapList`, não pede Acessibilidade, e não pode ver mais nada.
- Ela entrega **key-up de verdade**, escopado a uma combinação.
- Um auditor de segurança (ou o próprio usuário no painel de Privacidade) consegue verificar que o app não monitora o teclado.

### 3.3 Consequências para o produto

| | Hotkey Carbon escopada | `CGEventTap` global |
|---|---|---|
| Prompt de permissão no primeiro uso | Nenhum | "…quer controlar este computador usando recursos de acessibilidade" |
| Aparece em Ajustes > Privacidade > Acessibilidade / Monitoramento de Entrada | Não | Sim |
| Vê o que o usuário digita em outros apps | Não | **Sim, tudo** |
| Falso-positivo de antivírus | Improvável | Documentado (`uiohook-napi#58`, "Windows keeps thinking that my electron app installer exe is a malware whenever I add these global listener libraries") |
| Permite PTT em tecla modificadora sozinha (ex.: ⌥ direito) | **Não** | Sim |
| Permite ler a tecla `fn` | Não (ver §8) | Teoricamente sim (ver §8) |

---

## 4. Levantamento dos pacotes npm

Dados de `registry.npmjs.org` e da API do GitHub, coletados em 2026-08-26.

| Pacote | Último release | Repositório | Issues abertas | API macOS | Key-up | arm64 / Electron |
|---|---|---|---|---|---|---|
| **`uiohook-napi`** `1.5.5` | 2026-03-21 | ativo (push 2026-03-21), MIT, 240★ | 17 | `CGEventTap` **ativo**, `kCGSessionEventTap` | **Sim** | **prebuild `darwin-arm64`, N-API — sem rebuild** |
| **`hotcakey`** `0.8.0` | **2021-10-23** | `daylilyfield/hotcakey`, sem prebuilds | — | **Carbon `RegisterEventHotKey`** | **Sim** | compila limpo (node-gyp + `@electron/rebuild`) |
| `node-global-key-listener` `0.3.0` | 2024-05-18 | **ARQUIVADO** | 15 | `CGEvent.tapCreate` via binário Swift externo | Sim | **binário x86_64-only e não assinado** |
| `iohook` `0.9.3` | **2021-06-14** | 108 issues abertas | 108 | libuiohook (`CGEventTap`) | Sim | prebuilds por ABI, sem suporte a Electron moderno |
| `@nut-tree-fork/nut-js` `4.2.6` | 2025-03-13 | fork comunitário | — | — | **Não tem hook global de teclado** | n/a |
| `robotjs` `0.9.1` | 2026-08-07 | automação de entrada | — | — | Não expõe listener global | n/a |

### 4.1 `uiohook-napi` — o melhor da família "tap global"

- **Manutenção**: release 1.5.5 em 2026-03-21; repo com push no mesmo dia. É o único da categoria com sinal de vida recente.
- **arm64**: o tarball publicado contém `prebuilds/darwin-arm64/uiohook-napi.node` (84 KB). Build via `node-gyp-build` + `prebuildify --napi` → **binário N-API**, ABI-estável, o mesmo `.node` serve Node e qualquer versão de Electron sem `electron-rebuild`.
  — <https://unpkg.com/uiohook-napi@1.5.5/?meta>, <https://github.com/SnosMe/uiohook-napi/blob/master/package.json>
- **API**: `on('keydown')` e `on('keyup')` explicitamente na doc — <https://github.com/SnosMe/uiohook-napi#readme>
- **[VERIFICADO] Funciona no Electron 44/arm64**: carrega sem rebuild (`process.versions.modules = 149`), recebeu **3002 keydown + 3002 keyup** de 3000 pares injetados.
- **[VERIFICADO] ⚠️ NÃO funciona em Node puro no macOS**: em Node 20.20.0, com o tap criado e habilitado (confirmado via `CGGetEventTapList`: `ACTIVE enabled=1 mask=0xe405cfe`, latência média **4730 µs**), o processo recebeu **0 eventos de teclado** — testado em 1.5.4 e 1.5.5.
  Causa provável, no código do libuiohook: no caminho de key-pressed ele faz um **`dispatch_sync_f` para a main queue** de dentro do callback do tap, para traduzir keycode→caractere. O Electron roda um `CFRunLoop`/main queue na main thread (Chromium message pump); o Node puro não. O callback bloqueia, o macOS derruba o tap por timeout, e nada é entregue.
  — <https://github.com/kwhat/libuiohook/blob/1.2/src/darwin/input_hook.c#L275-L320>
  **Isso significa: só dá para usar no processo main do Electron. Nunca em um worker/utility process Node.** Existe issue aberta compatível: `uiohook-napi#57 "Listeners stop working after worker termination"`.
- **⚠️ Latência conhecida**: `uiohook-napi#47` ("Mac OS issues with keyboard lags", aberta 2024-04-03, ainda aberta) reporta lag de teclado e mouse no sistema inteiro com `hook_event_proc [991]: CGEventTap timeout!` no console — sintoma direto do tap **ativo** ficando lento. — <https://github.com/SnosMe/uiohook-napi/issues/47>
- Outras issues abertas relevantes: `#50` "random crash at launch time with latest electron macos" (2024-05-31), `#36` "MacOS 14.1 don't work" (2023-11-17), `#58` "False positive malware" (2026-03-14).

### 4.2 `hotcakey` — a abordagem escopada, mas abandonada

- Motivação declarada no README: *"i need to detect global shortcut `keydown` and `keyup` events on electron platform. i found a few solution such as iohook. iohook is the excellent module but **too powerfull for me**. i want to know only key events which has the predetermined combination."*
- Implementação: `src/hotcakey/hotcakey.mac.cc` usa `RegisterEventHotKey` e registra `EventTypeSpec` para `kEventHotKeyPressed` **e** `kEventHotKeyReleased`. Nenhuma menção a `CGEventTap`, `AXIsProcessTrusted` ou `NSEvent`.
  — <https://unpkg.com/hotcakey@0.8.0/src/hotcakey/hotcakey.mac.cc>
- **Risco**: último release **2021-10-23** (4 versões no total), sem prebuilds, dependências antigas (`node-addon-api ^4`, `node-gyp ^8`), README diz "actively under development" (não está).
- **[VERIFICADO] Compila e funciona hoje**: `node-gyp rebuild` limpo em arm64 para Node 20; `npx @electron/rebuild -f -o hotcakey` limpo para Electron 44; recebeu 3000 keydown + 3000 keyup escopados.
- ~16 KB de C++ para a implementação macOS — **é perfeitamente viável fazer vendor/fork do arquivo ou reescrever o addon**, em vez de depender do pacote.

### 4.3 `node-global-key-listener` — descartar

- **Repositório arquivado.** O README começa com "# ARCHIVE NOTICE / This project is looking for maintainers": *"it's been many years since this project has been actively maintained, and the previous stability of this project has been deteriorating"*.
  — <https://github.com/LaunchMenu/node-global-key-listener>
- **[VERIFICADO] O binário macOS embarcado é x86_64-only e não assinado**:
  ```
  $ file MacKeyServer
  MacKeyServer: Mach-O 64-bit executable x86_64
  $ codesign -dv MacKeyServer
  MacKeyServer: code object is not signed at all
  ```
  Consequências: exige Rosetta 2 no Apple Silicon, e um executável não assinado aninhado dentro de um `.app` **quebra a assinatura/notarização** do app Electron.
- Implementação: `CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, ...)` — tap ativo global. E no timeout: `else if (type == CGEventType.tapDisabledByTimeout) { logErr(...); return nil }` — **não reabilita o tap**. Depois do primeiro timeout, o listener morre em silêncio.
- Arquitetura out-of-process (stdio com um "key server"), o que o próprio README lista como desvantagem.

### 4.4 `iohook` e `nut.js` — fora

- `iohook`: último release **0.9.3 em 2021-06-14**, 108 issues abertas. Não é N-API — depende de prebuilds por versão de ABI de Node/Electron declarados em `iohook.targets`. Não há builds para Electron moderno.
- `nut.js`: o escopo é **simulação** de teclado/mouse e automação de tela, não escuta global. O pacote `@nut-tree/nut-js` **não existe mais no npm público** (retorna 404); pré-builds são pagos ("Pre-built packages are available for subscription plans"). O fork comunitário é `@nut-tree-fork/nut-js` (4.2.6, 2025-03-13). Nenhum dos dois resolve o problema.
- `robotjs`: automação de desktop (simulação de entrada). Não expõe hook global de teclado.

---

## 5. Permissões do macOS

### 5.1 Quem exige o quê

| Abordagem | Permissão TCC | Como pedir |
|---|---|---|
| `RegisterEventHotKey` | **Nenhuma** | — |
| `CGEventTap` com `kCGEventTapOptionDefault` (ativo — o que `uiohook-napi` usa) | **Acessibilidade** | `AXIsProcessTrustedWithOptions` / no Electron: `systemPreferences.isTrustedAccessibilityClient(true)` |
| `CGEventTap` com `kCGEventTapOptionListenOnly` | **Monitoramento de Entrada** (Input Monitoring) | `CGRequestListenEventAccess()` (macOS 10.15+) |
| `NSEvent` global monitor (teclas) | **Acessibilidade** | idem |

Base:
- `CGEvent.tapCreate` Discussion: *"Event taps receive key up and key down events if... Access for assistive devices is enabled."* — <https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>
- Header `CoreGraphics/CGEvent.h` (SDK MacOSX26.2):
  ```c
  /* Checks whether the current process already has event listening access */
  CG_EXTERN bool CGPreflightListenEventAccess(void) API_AVAILABLE(macos(10.15));
  /* Requests event listening access if absent, potentially prompting */
  CG_EXTERN bool CGRequestListenEventAccess(void) API_AVAILABLE(macos(10.15));
  ```
- Apple sobre Input Monitoring: *"Some apps can monitor your keyboard, mouse, or trackpad even when you're using other apps."* (Ajustes do Sistema > Privacidade e Segurança > Monitoramento de Entrada)
  — <https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac>
- Electron: `systemPreferences.isTrustedAccessibilityClient(prompt)` — <https://github.com/electron/electron/blob/main/docs/api/system-preferences.md>
- Para checar/solicitar as duas permissões de forma programática existe `node-mac-permissions` (2.5.0, 2025-03-15, do Shelley Vohr / Electron): `getAuthStatus('accessibility' | 'input-monitoring')`, `askForAccessibilityAccess()`, `askForInputMonitoringAccess('listen' | 'post')`.
  — <https://github.com/codebytere/node-mac-permissions>

### 5.2 Nota prática

Não existe API para *conceder* Acessibilidade programaticamente — a Apple só permite abrir o painel de Ajustes. Ou seja, a rota `CGEventTap` implica um passo de onboarding manual do usuário (abrir Ajustes, destravar o cadeado, marcar o app) e **reiniciar o app** depois. A rota Carbon não tem esse passo.

---

## 6. Robustez: timeout, sleep/wake, troca de usuário, entrada segura

### 6.1 `kCGEventTapDisabledByTimeout`

Header `CGEventTypes.h`:

```c
/* Out of band event types. These are delivered to the event tap callback
   to notify it of unusual conditions that disable the event tap. */
kCGEventTapDisabledByTimeout = 0xFFFFFFFE,
kCGEventTapDisabledByUserInput = 0xFFFFFFFF
```

Header `CGEvent.h`:

> "Taps are normally enabled when created. If a tap becomes unresponsive or a user requests taps be disabled, an appropriate `kCGEventTapDisabled...` event is passed to the registered `CGEventTapCallBack` function. **An event tap may be re-enabled by calling this function** [`CGEventTapEnable`]."

Como cada biblioteca lida:

- **`libuiohook` / `uiohook-napi`** — reabilita corretamente:
  ```c
  if (type == (CGEventType) kCGEventTapDisabledByTimeout) {
      logger(LOG_LEVEL_WARN, "%s [%u]: CGEventTap timeout!\n", __FUNCTION__, __LINE__);
      if (hook->port) { CGEventTapEnable(hook->port, true); }
  }
  ```
- **`node-global-key-listener`** — **não reabilita** (`logErr(...); return nil`). Defeito real.
- **Hotkey Carbon** — não se aplica: não há tap.

⚠️ Reabilitar não é grátis: cada timeout significa eventos perdidos e latência para o sistema inteiro. É exatamente o sintoma reportado em `uiohook-napi#47`.

### 6.2 Sleep/wake e troca rápida de usuário

**Não encontrei documentação da Apple que garanta o comportamento de um `CGEventTap` através de sleep/wake ou fast user switching.** O que dá para afirmar com base primária:

- `kCGSessionEventTap` é definido como *"the point where HID system and remote control events enter **a login session**"* — <https://developer.apple.com/documentation/coregraphics/cgeventtaplocation>. Ou seja, o tap é **por sessão de login**: quando outro usuário está ativo, os eventos dele não passam pela sua sessão. Isso é uma propriedade de segurança, não um bug.
- Uma hotkey Carbon é registrada no `GetApplicationEventTarget()` do processo, que pertence à sessão do usuário — mesma consequência.

**Recomendação (não verificada empiricamente — precisa de teste manual):** tratar re-armamento como obrigatório e usar o `powerMonitor` do Electron, que já expõe todos os ganchos necessários:

| Evento | Uso |
|---|---|
| `'suspend'` / `'resume'` | sleep/wake do sistema |
| `'lock-screen'` / `'unlock-screen'` | bloqueio de tela |
| `'user-did-resign-active'` / `'user-did-become-active'` _macOS_ | **fast user switching** (mapeiam para `NSWorkspaceSessionDidResignActiveNotification` / `...DidBecomeActive...`) |

— <https://github.com/electron/electron/blob/main/docs/api/power-monitor.md>

No `'resume'` / `'user-did-become-active'`: para tap, checar `CGEventTapIsEnabled()` e chamar `CGEventTapEnable(tap, true)`; para hotkey, `UnregisterEventHotKey` + `RegisterEventHotKey` (é o que o próprio Chromium faz em `ReregisterAllHotKeys()` quando o layout de teclado muda).

### 6.3 Entrada segura (Secure Event Input) — vale para AMBAS as abordagens

Este é um caso que precisa estar no design do PTT. Apple TN2150, "Using Secure Event Input Fairly":

> "The fix for this problem is to **stop passing keyboard events to any intercept process whenever any process has enabled secure event input**, whether that process is in the foreground or background."

> "Use `EnableSecureEventInput` only when needed, that is when the keyboard focus moves to a private data entry field."

— <https://developer.apple.com/library/archive/technotes/tn2150/_index.html>

Ou seja: **enquanto o foco estiver num campo de senha (ou qualquer app tiver ligado secure input), o atalho de push-to-talk simplesmente não vai disparar.** Não é bug do nosso app. O sistema também bloqueia troca de app durante secure input. `IsSecureEventInputEnabled()` permite detectar o estado e explicar isso ao usuário em vez de parecer quebrado.

---

## 7. Custo de CPU

**[VERIFICADO]** Medições nesta máquina (Apple Silicon, macOS 15.7.3), CPU% relativo a **um core**, via `getrusage`/`process.cpuUsage()`.

### 7.1 Custo por evento (processo C dedicado, eventos injetados de outro processo)

| Configuração | Eventos | CPU | µs de CPU por evento |
|---|---|---|---|
| `CGEventTap` **listen-only** | 6000 em ~6 s (~1000 ev/s) | **1,31 %** | **16,0 µs** |
| `CGEventTap` **ativo** (`kCGEventTapOptionDefault`) | 6000 em ~6 s | **3,09 %** | **37,9 µs** |

Ou seja, o tap ativo (que é o que `uiohook-napi` e `node-global-key-listener` usam) custa **~2,4×** o listen-only, porque insere o processo no caminho de entrega de cada evento.

### 7.2 Custo dentro do Electron (com a ponte N-API + callback JS)

| Configuração | Eventos | CPU | µs por evento |
|---|---|---|---|
| `uiohook-napi` (Electron 44) | 6004 em 9 s (~667 ev/s) | **3,02 %** | **45,2 µs** |
| `hotcakey` (Electron 44) | 6000 em 11 s (~545 ev/s) | **6,71 %** | **~123 µs** |

⚠️ Interpretar com cuidado: esses são regimes de **centenas de eventos por segundo**, artificiais. `hotcakey` parece "pior" por evento só porque o custo fixo do addon domina; mas em uso real ele recebe **2 eventos por acionamento do PTT** enquanto o `uiohook` recebe **todas as teclas de todos os apps**.

### 7.3 Custo em repouso — o número que realmente importa

| Configuração | CPU em 8 s ocioso |
|---|---|
| Electron main sem nada (baseline) | 0,124 % |
| Electron + `uiohook-napi` iniciado | 0,128 % |
| Electron + `hotcakey` registrado | 0,232 % |

**Conclusão: manter o tap ativo custa essencialmente nada quando ninguém digita.** É arquitetura orientada a evento (Mach port + `CFRunLoop`), não polling. Extrapolando para digitação humana real (~10 eventos/s), o tap ativo custa da ordem de **0,04 % de um core**.

O custo do `CGEventTap` **não é CPU — é latência do sistema inteiro**. No teste com Node puro, `CGGetEventTapList` reportou latência média de **4730 µs** para o tap do `uiohook`, e é isso que gera o "keyboard lag" da issue #47. A Apple expõe `CGGetEventTapList` / `CGEventTapInformation` (`minUsecLatency`, `avgUsecLatency`, `maxUsecLatency`) exatamente para monitorar isso — vale instrumentar em produção se formos por esse caminho.

---

## 8. Teclas que o macOS já reserva

### 8.1 Levantamento empírico nesta máquina

**[VERIFICADO]** Usei `CopySymbolicHotKeys()` (Carbon/HIToolbox) — a API oficial que *"returns an array of CFDictionaryRefs containing information about the system-wide symbolic hotkeys that are defined in the Keyboard preferences pane"*. Resultado: **229 hotkeys simbólicas**, sendo ~170 habilitadas.

Combinações **habilitadas** (portanto indisponíveis) que apareceram, decodificadas:

| Combinação | Uso conhecido |
|---|---|
| ⌘Space, ⌥⌘Space | Spotlight / busca no Finder |
| ⌃⌘Space | Emoji & Símbolos |
| ⌃Space, ⌃⌥Space | trocar fonte de entrada (**desabilitadas nesta máquina**, mas ligam sozinhas quando o usuário adiciona um 2º idioma) |
| ⌘Tab, ⇧⌘Tab | trocar de app |
| ⌘`, ⇧⌘`, ⌥⌘`, ⌘⇧` | trocar de janela |
| ⇧⌘3, ⇧⌘4, ⇧⌘5, ⇧⌘6 + variantes com ⌃ | captura de tela |
| ⌥⎋, ⌘⎋, ⌥⌘⎋, ⇧⌥⌘⎋ | Force Quit / Assistente |
| ⌃F1…⌃F9 | navegação por teclado, Mission Control, etc. |
| ⌃↑ ⌃↓ ⌃← ⌃→ (+ ⇧, +⌥⌃⇧) | Mission Control / Spaces |
| F11, ⇧F11, F12, ⇧F12 | mostrar Desktop / Dashboard |
| F14, F15, ⌥F14/F15, ⌃F14/F15, ⌥⇧F14/F15 | brilho |
| ⌘F1, ⌘F5, ⌥⌘F5 | espelhar tela, VoiceOver, Acessibilidade |
| ⌥⌘D, ⌃⌘D | ocultar Dock / consultar dicionário |
| ⌃⌘S | — (reservado) |
| ⇧⌘/ | busca no menu Ajuda |
| ⇧⌘F, ⌘M, ⌥⌘M, ⌃↩ | Finder / minimizar / etc. |
| ⌥⌃⌘⇧Q | encerrar sessão |

Combinações **desabilitadas por padrão** (mas reservadas — podem ligar): ⌥⌘8, ⌥⌘=, ⌥⌘- e ⌥⌃⌘8 (zoom), ⌃1…⌃0 e ⌥⌃1…⌥⌃6 (Spaces), F7/F8, ⌃Space e ⌥⌃Space (fontes de entrada).

Referência cruzada com a lista oficial da Apple ("Mac keyboard shortcuts"): ⌘Space (Spotlight), ⌃↑ (Mission Control), ⌘Tab, ⌘` , ⇧⌘5/4/3, ⌥⌘⎋ (Force Quit), ⌃⌘Q (bloquear tela), ⌃Space / ⌃⌥Space (fonte de entrada), **Fn-D (ditado)**, **Fn-H / Fn-F11 (mostrar Desktop)**.
— <https://support.apple.com/en-us/102650>

⚠️ Ressalva metodológica: os valores de modificador retornados por `CopySymbolicHotKeys` incluem um bit `0x20000` em muitas entradas que **não consegui mapear para nenhuma constante documentada** — decodifiquei apenas `cmdKey 0x100`, `shiftKey 0x200`, `optionKey 0x800`, `controlKey 0x1000`. A lista acima é conservadora (o que está listado está tomado; o que não está pode ainda assim ser usado por apps de terceiros do usuário).

### 8.2 A tecla `fn` / 🌐 — resposta direta

**Um app de terceiros consegue observar a tecla `fn`?**

- **Via Electron `globalShortcut`: não, definitivamente.** A lista oficial de key codes de Accelerator não inclui `fn`/`Function`/`Globe` (inclui `F1`–`F24`, `Capslock`, `Numlock`, etc.). — <https://github.com/electron/electron/blob/main/docs/tutorial/keyboard-shortcuts.md#available-key-codes>
  A issue `electron/electron#16714` ("Add 2 more keys for globalshortcuts: capslock & fn") foi resolvida adicionando **só CapsLock**; sobre `fn`, a mantenedora codebytere respondeu em 2019-02-05:
  > "Sadly no, as it's not supported by Chrome :("
  — <https://github.com/electron/electron/issues/16714>

- **Via `CGEventTap`: em princípio sim.** O macOS representa `fn` como um **modificador**, não como uma tecla comum:
  - `kVK_Function = 0x3F` (`HIToolbox/Events.h`, SDK MacOSX26.2)
  - `kCGEventFlagMaskSecondaryFn = NX_SECONDARYFNMASK` (`CoreGraphics/CGEventTypes.h`)
  - `NSEvent.ModifierFlags.function` (AppKit)
  Ou seja, pressionar/soltar `fn` gera um `kCGEventFlagsChanged` com keycode `0x3F` e o flag `SecondaryFn`. Um tap com `CGEventMaskBit(kCGEventFlagsChanged)` (que `libuiohook` já inclui) vê esse evento.
  ⚠️ **Não consegui verificar isso empiricamente** neste ambiente — não há como pressionar `fn` fisicamente a partir de um agente, e injetar um `flagsChanged` sintético só provaria o encanamento do tap, não o comportamento do hardware. Tratar como "documentado, mas a confirmar em máquina real".

- **Via hotkey Carbon: praticamente não.** `RegisterEventHotKey(0x3F, 0, ...)` **retornou `noErr`** no meu teste, mas registrar não é receber — e como `fn` não gera `kEventRawKeyDown` (só `flagsChanged`), a expectativa é que a hotkey nunca dispare. **Não verificado.**

**Mesmo que fosse observável, `fn` está tomada.** O macOS reserva:
- **Segurar `fn`/🌐 = usar as teclas de função** (comportamento padrão de todo Mac) — <https://support.apple.com/en-us/guide/mac-help/mchlp2596/mac>
- **Fn-D = iniciar/parar Ditado** e **Fn-H / Fn-F11 = mostrar a Mesa** — <https://support.apple.com/en-us/102650>
- Um menu inteiro em Ajustes > Teclado: *"Press fn key to" / "Press 🌐 key to"* com opções como **Change Input Source**, Show Emoji & Symbols, Start Dictation, Do Nothing — <https://support.apple.com/en-us/guide/mac-help/mchlp2596/mac>, <https://support.apple.com/en-gw/guide/mac-help/mchl84525d76/mac>

Nesta máquina a chave `AppleFnUsageType` (com.apple.HIToolbox) **não está definida**, ou seja, vale o padrão do sistema — e não há API pública para lê-la de forma suportada nem para alterá-la.

**Conclusão sobre `fn`: descartar como hotkey de push-to-talk.** Colide com o Ditado nativo (exatamente o concorrente do nosso produto), com "mostrar Desktop", e com o próprio uso de teclas de função. Um usuário que segurar `fn` por 2 segundos pode disparar o Ditado da Apple no meio da nossa gravação.

---

## 9. Recomendação

### 9.1 Abordagem

**Ir de hotkey Carbon escopada (`RegisterEventHotKey` + `kEventHotKeyReleased`), não de listener global.**

Justificativa:

1. **Resolve o problema exato do ticket** — key-down e key-up globais, com o app sem foco. Verificado nesta máquina, no Electron 44/arm64.
2. **Não é um keylogger.** Verificado: nenhum event tap é criado, e teclas não registradas não chegam ao processo. Isso é auditável pelo usuário (o app não aparece em Privacidade > Acessibilidade) e é uma diferença de produto real num app que grava áudio.
3. **Zero atrito de onboarding.** Nenhum prompt de permissão, nenhuma ida a Ajustes do Sistema, nenhum restart do app.
4. **Zero risco de degradar o sistema.** Sem tap ativo → sem `kCGEventTapDisabledByTimeout`, sem lag de teclado global, sem o bug de `uiohook-napi#47`.
5. **Menos superfície de falso-positivo** em antivírus e revisão de loja.

**Pacote**: `hotcakey@0.8.0` é a única implementação npm dessa abordagem, e ela **funciona** (verificado). Mas está sem manutenção desde 2021 e sem prebuilds.

**Proposta concreta**: **fazer vendor do addon**, não depender do pacote. São ~16 KB de C++ (`hotcakey.mac.cc` + `addon.cc`), licença permissiva, e o `binding.gyp` já compila limpo com `node-gyp` moderno e `@electron/rebuild` para Electron 44 em arm64. Alternativas de implementação, se preferirmos escrever do zero: o `platform_impl/macos` do crate `global-hotkey` do Tauri é a referência mais limpa e ativa da mesma técnica.

Se o time preferir **não** manter código nativo próprio agora: usar `hotcakey` como dependência direta e prebuildar o `.node` no CI (é o único jeito de evitar `node-gyp` na máquina do usuário). Aceitar que é uma dependência abandonada e que teremos que forkar cedo ou tarde.

### 9.2 Plano B

**`uiohook-napi@1.5.5`** — se e somente se o produto exigir algo que a hotkey escopada não entrega (PTT numa tecla modificadora sozinha, leitura de `fn`, detecção de duplo-toque de modificador). Nesse caso:

- Só no **processo main** do Electron (verificado: não funciona em Node puro/worker).
- Pedir Acessibilidade explicitamente, com uma tela explicando *por que*, usando `systemPreferences.isTrustedAccessibilityClient(true)` ou `node-mac-permissions`.
- Filtrar por keycode **imediatamente** no callback nativo/JS e **nunca** logar, bufferizar ou serializar eventos de tecla.
- Re-armar em `powerMonitor` `'resume'` / `'unlock-screen'` / `'user-did-become-active'`.
- Instrumentar `CGGetEventTapList` (latência média do próprio tap) para detectar regressão de lag.
- Documentar na política de privacidade que o app usa monitoramento global de teclado — é o que a permissão diz ao usuário de qualquer forma.

### 9.3 O que **não** usar

`node-global-key-listener` (arquivado + binário x86_64 não assinado), `iohook` (morto), `nut.js`/`robotjs` (não fazem escuta global).

### 9.4 Shortlist de hotkeys realmente disponíveis

Todas verificadas contra o dump de `CopySymbolicHotKeys` desta máquina **e** contra a lista oficial da Apple. Nenhuma delas aparece como reservada pelo sistema.

**Primeira escolha — teclas F dedicadas (quando existem fisicamente):**

| Atalho | Observação |
|---|---|
| **F18** (`kVK_F18` = `0x4F`) | livre; não aparece em nenhuma hotkey simbólica |
| **F19** (`0x50`) | livre |
| **F13** (`0x69`), **F16** (`0x6A`), **F17** (`0x40`), **F20** (`0x5A`) | livres |

⚠️ Só existem no Magic Keyboard/teclado completo. **Não estão em MacBooks.** Ótimas como opção avançada, ruins como padrão.
⚠️ Evitar **F14/F15** (brilho, reservadas) e **F11/F12** (mostrar Desktop / Dashboard, reservadas).

**Primeira escolha para o padrão — combinações "hyper" com uma letra:**

| Atalho | Por quê |
|---|---|
| **⌃⌥⌘G** | ⌃⌥⌘ + letra praticamente não é usado pelo sistema (só ⌥⌃⌘⇧Q, ⌥⌃⌘8, ⌥⌃⌘. e ⌥⌃⌘, aparecem no dump); "G" não colide com nada do sistema |
| **⌃⌥⌘K** | idem |
| **⌃⌥⌘T** | idem |
| **⌥⌘V** | livre no dump; menos ergonômico segurar, mas mais fácil de lembrar |

⚠️ Ressalva sobre ⌃⌥: com o **VoiceOver ligado**, ⌃⌥ é a "tecla VO" e captura ⌃⌥ + letra. Acrescentar ⌘ (⌃⌥⌘) evita a colisão, mas vale testar com VoiceOver ativo antes de fechar o default.

**Aceitáveis com ressalva:**

| Atalho | Ressalva |
|---|---|
| ⇧⌘Space | não aparece como hotkey do sistema, mas é muito disputado por apps de terceiros (Alfred, Raycast, etc.) |
| ⌃⌥⌘Space | ⌘Space, ⌥⌘Space e ⌃⌘Space são do sistema; ⌃⌥⌘Space não é — mas é uma vizinhança perigosa |

**Explicitamente evitar:** qualquer coisa com `fn`/🌐; ⌘Space / ⌥⌘Space / ⌃⌘Space; ⌃Space e ⌃⌥Space (ligam sozinhas quando o usuário adiciona um 2º idioma); ⌘Tab; ⌘\`; ⇧⌘3/4/5/6; ⌃ + setas; ⌃F1–⌃F9; F11/F12/F14/F15; ⌥⎋ / ⌘⎋ / ⌥⌘⎋; ⌘M; ⌃↩; ⇧⌘/; ⇧⌘F; ⌥⌘D / ⌃⌘D; ⌃⌘S; ⌃⌘Q.

**Recomendação final de default: `⌃⌥⌘G` (Control+Option+Command+G)**, com F18/F19 oferecidas como alternativa para quem tem teclado completo, e o atalho **configurável** — com validação em runtime: `RegisterEventHotKey` com `kEventHotKeyExclusive` retorna `eventHotKeyExistsErr` se outro processo já tomou a combinação de forma exclusiva, o que dá um sinal utilizável para avisar o usuário no ato.

### 9.5 Riscos ainda em aberto (validar antes de fechar o design)

1. **Reprodutibilidade da entrega de hotkey.** Consegui provar a entrega de `Pressed`+`Released` no Electron com eventos sintéticos. Em binários CLI não empacotados o comportamento foi **intermitente** (funcionou 1 vez em ~6). Precisa de um teste manual com teclado físico num build real do app.
2. **Release sem o press.** Comportamento clássico de hotkeys Carbon: soltar os modificadores antes da tecla base pode fazer o `Released` não chegar (deixando o PTT "preso" no ar). **Precisa de teste manual.** Mitigação: watchdog de duração máxima de gravação + fechar a gravação em `blur`/`powerMonitor`.
3. **Sleep/wake e fast user switching.** Sem documentação da Apple; assumir que precisa re-registrar e testar manualmente.
4. **Secure input.** O PTT não vai funcionar enquanto um campo de senha estiver focado — em nenhuma das abordagens. Detectar com `IsSecureEventInputEnabled()` e dar feedback ao usuário.
5. **Conflito com o próprio `globalShortcut`.** Header da Apple: *"Only one such combination can exist for the current application."* Não registrar o mesmo acelerador via `globalShortcut` e via o addon.

---

## Apêndice A — Como reproduzir os testes

Artefatos criados durante esta pesquisa (diretório temporário de sessão, não versionado):
`/private/tmp/claude-502/-Users-user-work-github-getthattext/8dfcce92-d44e-4664-928f-e036e2108b6c/scratchpad/`

| Arquivo | O que faz |
|---|---|
| `symkeys.c` | roda `CopySymbolicHotKeys()` e imprime todas as hotkeys reservadas (habilitadas/desabilitadas) |
| `hk4.m` / `hk5.m` | `CGEventTap` listen-only + `RegisterEventHotKey` com handlers de `Pressed`/`Released` no mesmo processo |
| `taps.m` | `CGGetEventTapList()` — lista todos os taps ativos do sistema, com processo, opções e latência min/avg/max |
| `recv.m` / `recv2.m` | medição de CPU por evento de tap listen-only vs tap ativo |
| `flood.m` / `flood18.m` | injeta pares keydown/keyup sintéticos (F20 / F18) via `CGEventPost` |
| `uio/main.js`, `uio/idle.js` | app Electron 44 de teste para `uiohook-napi` e `hotcakey` (contagem de eventos + CPU) |

Compilação: `clang -o X X.m -framework Cocoa -framework Carbon -Wno-deprecated-declarations`.

---

## Apêndice B — Fontes

**Electron**
- globalShortcut: <https://www.electronjs.org/docs/latest/api/global-shortcut> · <https://github.com/electron/electron/blob/main/docs/api/global-shortcut.md>
- Accelerators: <https://github.com/electron/electron/blob/main/docs/tutorial/keyboard-shortcuts.md>
- systemPreferences: <https://github.com/electron/electron/blob/main/docs/api/system-preferences.md>
- powerMonitor: <https://github.com/electron/electron/blob/main/docs/api/power-monitor.md>
- Issues #7802, #26301, #16714: <https://github.com/electron/electron/issues/7802> · <https://github.com/electron/electron/issues/26301> · <https://github.com/electron/electron/issues/16714>

**Chromium**
- <https://chromium.googlesource.com/chromium/src/+/main/ui/base/accelerators/global_accelerator_listener/global_accelerator_listener_mac.mm>

**Apple**
- `CGEvent.tapCreate`: <https://developer.apple.com/documentation/coregraphics/cgevent/tapcreate(tap:place:options:eventsofinterest:callback:userinfo:)>
- `CGEventTapLocation`: <https://developer.apple.com/documentation/coregraphics/cgeventtaplocation>
- `CGEventTapOptions`: <https://developer.apple.com/documentation/coregraphics/cgeventtapoptions>
- `CGEventType.tapDisabledByTimeout`: <https://developer.apple.com/documentation/coregraphics/cgeventtype/tapdisabledbytimeout>
- `NSEvent.addGlobalMonitorForEvents`: <https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:)>
- TN2150 "Using Secure Event Input Fairly": <https://developer.apple.com/library/archive/technotes/tn2150/_index.html>
- Input Monitoring: <https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac>
- Mac keyboard shortcuts: <https://support.apple.com/en-us/102650>
- Teclas de função / fn / 🌐: <https://support.apple.com/en-us/guide/mac-help/mchlp2596/mac>
- Fontes de entrada (fn = Change Input Source): <https://support.apple.com/en-gw/guide/mac-help/mchl84525d76/mac>
- Headers do SDK MacOSX26.2 (fonte primária local): `CoreGraphics/CGEvent.h`, `CoreGraphics/CGEventTypes.h`, `HIToolbox/CarbonEvents.h`, `HIToolbox/Events.h`

**Pacotes**
- uiohook-napi: <https://github.com/SnosMe/uiohook-napi> · <https://www.npmjs.com/package/uiohook-napi>
- libuiohook (darwin): <https://github.com/kwhat/libuiohook/blob/1.2/src/darwin/input_hook.c>
- hotcakey: <https://github.com/daylilyfield/hotcakey> · <https://unpkg.com/hotcakey@0.8.0/src/hotcakey/hotcakey.mac.cc>
- node-global-key-listener: <https://github.com/LaunchMenu/node-global-key-listener>
- iohook: <https://github.com/wilix-team/iohook>
- nut.js: <https://github.com/nut-tree/nut.js>
- tauri global-hotkey: <https://github.com/tauri-apps/global-hotkey>
- node-mac-permissions: <https://github.com/codebytere/node-mac-permissions>
