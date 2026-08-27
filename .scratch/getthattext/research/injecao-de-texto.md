# Injeção de texto no input focado (macOS 15, Apple Silicon, app Electron)

> Pesquisa para o ticket `01-injecao-de-texto-no-input-focado.md`.
> Fontes: documentação oficial Apple, documentação oficial Electron, código-fonte do Chromium/Blink/WebKit/Electron/espanso/robotjs, registro npm — **mais medições próprias** feitas na máquina-alvo.

---

## 0. Metodologia e status das afirmações

Cada afirmação abaixo está marcada com uma destas etiquetas:

| Etiqueta | Significado |
|---|---|
| **[DOC]** | Está escrito na documentação/código-fonte oficial citado. |
| **[MEDIDO]** | Foi executado e medido nesta pesquisa, no ambiente descrito abaixo. |
| **[NÃO VERIFICADO]** | Não consegui confirmar em fonte primária nem medir. Tratar como hipótese. |

**Ambiente das medições:** macOS **15.7.3** (build 24G419), **arm64** (Apple Silicon), agosto/2026.
Programas de teste escritos em Swift chamando diretamente `ApplicationServices`/`CoreGraphics`/`AppKit`
(mesmas APIs C que qualquer addon nativo de Node usaria). O processo de teste **já tinha permissão de
Acessibilidade concedida** (`AXIsProcessTrusted() == true`, `CGPreflightPostEventAccess() == true`).

Alvos realmente testados: **TextEdit** (NSTextView nativo), **Notes**, **Terminal.app**, **Finder**,
**Google Chrome** (instância isolada com perfil temporário, página local com `<textarea>`,
`contenteditable` e `<input type=password>`), **Cursor** (Electron) e **Microsoft Teams**.
Não testei: Slack, Discord, VS Code, Safari, Mail, iTerm2 — para esses, o que digo vem de código-fonte
(Chromium/Blink/WebKit são os motores desses apps) e está marcado como **[DOC]**.

Códigos de erro `AXError` que aparecem no texto:
`-25204 kAXErrorCannotComplete`, `-25205 kAXErrorAttributeUnsupported`,
`-25208 kAXErrorNotImplemented`, `-25212 kAXErrorNoValue`.

---

## 1. Resumo executivo

| | **A. Accessibility API** (`AXUIElement`) | **B. Pasteboard + ⌘V** | **C. `CGEventKeyboardSetUnicodeString`** | **D. `osascript` / System Events** |
|---|---|---|---|---|
| Permissão | Acessibilidade | Acessibilidade (para postar o ⌘V) | Acessibilidade | Automação (Apple Events) **+** Acessibilidade |
| Apps nativos (TextEdit/Notes) | ✅ funciona, insere no cursor | ✅ | ✅ | ✅ |
| Chromium/Electron (Slack, VS Code, Discord, Chrome) | ⚠️ **só depois de ligar a árvore de a11y e esperar ~2 s**; `AXSelectedText` é *no-op silencioso*; `contenteditable` não dispara `input` | ✅ | ✅ | ✅ |
| Terminal.app | ❌ `AXValue`/`AXSelectedText` não graváveis | ✅ (se "Secure Keyboard Entry" desligado) | ✅ | ✅ |
| Campo de senha (Secure Event Input) | ✅ **funciona** (contorna o bloqueio) | ❌ bloqueado | ❌ bloqueado | ❌ bloqueado |
| Preserva acentuação pt-BR | ✅ | ✅ | ✅ | ⚠️ histórico ruim |
| Destrói o clipboard do usuário | não | **sim**, precisa salvar/restaurar | não | não |
| Texto longo | instantâneo | instantâneo | ~instantâneo (ver §5) | lento |
| Módulo npm mantido que faça isso | ❌ **não existe** | parcial | ✅ `robotjs` | ✅ `run-applescript` |

**Conclusão antecipada:** nenhum mecanismo isolado cobre todos os alvos. A combinação
**Pasteboard + ⌘V como caminho principal** e **`CGEventKeyboardSetUnicodeString` como fallback**
cobre praticamente tudo que interessa; a Accessibility API só vale a pena como *terceiro* caminho
para casos específicos. Detalhes e riscos em §11.

---

## 2. Permissões do macOS: o mapa

### 2.1 Acessibilidade (`kTCCServiceAccessibility`)

É a permissão de **Ajustes do Sistema → Privacidade e Segurança → Acessibilidade**. Ela cobre
**duas coisas ao mesmo tempo**:

1. Usar a Accessibility API (`AXUIElement*`) contra outros processos.
2. **Postar** eventos sintéticos (`CGEventPost`) — `CGRequestPostEventAccess()` é descrito pela Apple
   como associado a essa permissão. **[DOC]**

Como detectar, sem prompt:

| API | Onde | Observação |
|---|---|---|
| `AXIsProcessTrusted()` | ApplicationServices | Retorna `TRUE` se o processo é um cliente de acessibilidade confiável. **[DOC]** ([Apple](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted)) |
| `AXIsProcessTrustedWithOptions(_:)` | ApplicationServices | Mesma coisa; com `kAXTrustedCheckOptionPrompt = true` exibe o alerta. A Apple diz explicitamente: *"Prompting occurs asynchronously and does not affect the return value."* **[DOC]** ([Apple](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)) |
| `CGPreflightPostEventAccess()` | CoreGraphics | Existe desde macOS 10.15 mas **está sem descrição na documentação da Apple** — símbolo público, doc vazia. **[DOC/MEDIDO]** ([Apple](https://developer.apple.com/documentation/coregraphics/cgpreflightposteventaccess())) |
| `CGRequestPostEventAccess()` | CoreGraphics | Idem, também sem descrição. ([Apple](https://developer.apple.com/documentation/coregraphics/cgrequestposteventaccess())) |
| `systemPreferences.isTrustedAccessibilityClient(prompt)` | **Electron** | *"Returns boolean - true if the current process is a trusted accessibility client and false if it is not."* macOS-only. **[DOC]** ([Electron](https://www.electronjs.org/docs/latest/api/system-preferences)) |

**[MEDIDO]** Nesta máquina, com a permissão concedida, `AXIsProcessTrusted()`, `CGPreflightPostEventAccess()`
e `CGPreflightListenEventAccess()` retornaram todos `true`.

> **Armadilha operacional:** a permissão de Acessibilidade é atrelada à **assinatura de código do bundle**.
> Rebuilds não assinados / assinados ad-hoc invalidam a concessão e o app "some" da lista ou passa a
> aparecer duplicado. Isso é a maior fonte de suporte em apps desse tipo. **[NÃO VERIFICADO]** em fonte
> primária Apple, mas é consistente com o modelo TCC.

### 2.2 Automação / Apple Events (`kTCCServiceAppleEvents`)

Necessária apenas para o caminho **D** (`osascript`/System Events).

- `NSAppleEventsUsageDescription` no `Info.plist` é **obrigatório**: *"This key is required if your app
  uses APIs that send Apple events."* **[DOC]**
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription))
- Detecção: `AEDeterminePermissionToAutomateTarget(_:_:_:_:)`
  ([Apple](https://developer.apple.com/documentation/coreservices/3025784-aedeterminepermissiontoautomatet))
  ou, no Electron/Node, `permissions.askForAppleEventsAccess(bundleId)` do `node-mac-permissions`.
- Além disso, o *UI scripting* via System Events **também** depende de Acessibilidade: o
  *Mac Automation Scripting Guide* diz que UI scripting *"relies upon OS X accessibility frameworks"* e
  *"by default, accessibility control of apps is disabled. For security and privacy reasons, the user must
  manually enable it on an app-by-app (including script apps) basis"*. **[DOC]**
  ([Apple](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html))
- **[NÃO VERIFICADO]:** não achei um único documento da Apple afirmando, com todas as letras, que o app
  *emissor* precisa das **duas** permissões para `tell application "System Events" to keystroke`. O que
  existem são as duas afirmações acima, que juntas implicam isso.

### 2.3 Secure Event Input (campos de senha)

- `EnableSecureEventInput()` existe desde o Mac OS X 10.3 para *"protect keyboard input to a custom data
  entry field"*. Bloqueia processos interceptadores que usem **event taps (CGEvent)**, `kIOHIDOptionsTypeSeizeDevice`
  e `GetKeys`. **`NSSecureTextField` (Cocoa) o ativa automaticamente.** **[DOC]**
  ([Apple TN2150](https://developer.apple.com/library/archive/technotes/tn2150/_index.html))
- **Chromium/Electron ligam Secure Event Input sempre que um campo de senha ganha foco** —
  `RenderWidgetHostViewMac::SetTextInputActive()` cria um `ScopedPasswordInputEnabler` quando
  `state->type == ui::TEXT_INPUT_TYPE_PASSWORD` (ou o campo já foi um campo de senha).
  `SetPasswordInputEnabled()` chama `EnableSecureEventInput()`. **[DOC]**
  ([render_widget_host_view_mac.mm](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/render_widget_host_view_mac.mm),
  [secure_password_input.mm](https://github.com/chromium/chromium/blob/main/ui/base/cocoa/secure_password_input.mm))
- Detecção: `IsSecureEventInputEnabled()` (Carbon/HIToolbox). **[MEDIDO]** funciona e retorna `true` com um
  `<input type=password>` focado no Chrome.

**[MEDIDO] — resultado que mais importa desta seção.** Com `<input type=password>` focado no Chrome
(`IsSecureEventInputEnabled() == true`, `CGPreflightPostEventAccess() == true`):

```
apos CGEvent unicode  -> campo continua vazio   (len=0)   ❌ bloqueado
apos Cmd+V            -> campo continua vazio   (len=0)   ❌ bloqueado
set kAXValueAttribute -> err=0, campo passa a valer "ax-senha" (len=8)  ✅ FUNCIONOU
```

Ou seja: **Secure Event Input bloqueia o caminho de eventos (B e C), mas não bloqueia a Accessibility API (A).**
Isso é ótimo para gerenciadores de senha e péssimo do ponto de vista de "posso confiar que não vou escrever
num campo de senha por acidente" — o produto **precisa** checar `IsSecureEventInputEnabled()` e/ou o
`AXSubrole == AXSecureTextField` e **abortar** por decisão de produto.

---

## 3. Mecanismo A — Accessibility API (`AXUIElement`)

### 3.1 Como é

```
AXUIElementCreateSystemWide()
  → kAXFocusedUIElementAttribute        (elemento focado, qualquer app)
      → AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute, texto)   // insere no cursor
      → AXUIElementSetAttributeValue(el, kAXValueAttribute, texto)          // substitui tudo
```

- `AXUIElementCreateSystemWide()` — *"useful for things like finding the focused accessibility object
  regardless of which application is currently active"*. **[DOC]**
  ([Apple](https://developer.apple.com/documentation/applicationservices/1462095-axuielementcreatesystemwide))
- `AXUIElementSetAttributeValue(_:_:_:)` — erros documentados incluem `kAXErrorAttributeUnsupported`,
  `kAXErrorIllegalArgument`, `kAXErrorNotImplemented`. **[DOC]**
  ([Apple](https://developer.apple.com/documentation/applicationservices/1460434-axuielementsetattributevalue))
- Antes de escrever, use `AXUIElementIsAttributeSettable` para saber se dá.

### 3.2 O que medi, app por app

**[MEDIDO]** Sondagem de `kAXFocusedUIElement` de cada app em execução + `AXUIElementIsAttributeSettable`:

| App | Papel do elemento focado | `AXValue` gravável | `AXSelectedText` gravável | `AXSelectedTextRange` gravável |
|---|---|---|---|---|
| **Notes** (nativo) | `AXTextArea` | ✅ | ✅ | ✅ |
| **TextEdit** (nativo, NSTextView) | `AXTextArea` | ✅ | ✅ | ✅ |
| **Terminal.app** | `AXTextArea` | ❌ | ❌ | ✅ |
| **Finder** | `AXGroup` | ❌ | ❌ | ❌ |
| **Ajustes do Sistema** | `AXOutline` | ❌ | ❌ | ❌ |
| **Google Chrome** (padrão) | — | **`kAXFocusedUIElement` → erro −25212 (`kAXErrorNoValue`)** | | |
| **Cursor** (Electron) | — | idem −25212 | | |
| **Microsoft Teams** | — | idem −25212 | | |

Ou seja: **em apps nativos funciona bem; em Terminal.app não dá para escrever; em tudo que é
Chromium/Electron simplesmente não existe elemento focado** — porque a árvore de acessibilidade
do Chromium está desligada por padrão.

### 3.3 O bloqueio do Chromium/Electron: acessibilidade sob demanda

> *"Accessibility features in Chrome are off by default and enabled automatically on-demand."* **[DOC]**
> ([Chromium docs/accessibility/overview.md](https://github.com/chromium/chromium/blob/main/docs/accessibility/overview.md))

Como ligar de fora:

- **Electron** documenta o atributo `AXManualAccessibility`: *"On macOS, third-party assistive technology
  can toggle accessibility features inside Electron applications by setting the `AXManualAccessibility`
  attribute programmatically"*. **[DOC]**
  ([Electron accessibility tutorial](https://github.com/electron/electron/blob/main/docs/tutorial/accessibility.md))
- No código do Electron, tanto `AXManualAccessibility` quanto o atributo não documentado
  `AXEnhancedUserInterface` caem em `enableScreenReaderCompleteModeAfterDelay:`, que **espera
  `kTwoSecondDelay = 2.0` segundos** antes de efetivamente ligar o modo completo (debounce contra o
  liga-desliga espúrio do macOS Sonoma). **[DOC]**
  ([electron_application.mm](https://github.com/electron/electron/blob/main/shell/browser/mac/electron_application.mm))
- O Electron teve um bug em que `AXManualAccessibility` **parecia** falhar (`kAXErrorAttributeUnsupported`),
  corrigido em abril/2023 e portado para as linhas 23/24/25.
  ([issue #37465](https://github.com/electron/electron/issues/37465), [PR #38102](https://github.com/electron/electron/pull/38102))

**[MEDIDO]** No Google Chrome:

```
A11Y-OFF (padrão)                 : SEM foco (kAXFocusedUIElement = −25212)
set AXEnhancedUserInterface=true  -> retorna −25208 (kAXErrorNotImplemented)  ← MAS FUNCIONA
set AXManualAccessibility=true    -> retorna −25205 (não suportado no Chrome; é só do Electron)
apos +1.0s : SEM foco
apos +3.0s : role=AXTextArea | AXValue settable=true | AXSelectedText settable=true | AXSelectedTextRange settable=true
```

Três coisas para gravar:
1. O código de retorno de `AXEnhancedUserInterface` é **mentiroso** (−25208 e mesmo assim surte efeito).
2. Existe uma **latência de ~2–3 s** entre ligar e a árvore aparecer. Inaceitável para um atalho de teclado
   que precisa responder na hora, a menos que você ligue a árvore *antecipadamente*.
3. `AXManualAccessibility` é exclusivo do Electron; para navegadores é `AXEnhancedUserInterface`.

**Efeito colateral:** ligar a árvore completa de acessibilidade de um app alheio custa desempenho para ele.
A própria doc do Electron avisa sobre `app.setAccessibilitySupportEnabled`: *"Rendering accessibility tree
can significantly affect the performance of your app. It should not be enabled by default."* **[DOC]**
([Electron app.md](https://github.com/electron/electron/blob/main/docs/api/app.md))

### 3.4 O que acontece quando você escreve (Chromium/Blink)

Código de referência: `AXNodeObject::OnNativeSetValueAction` no Blink. **[DOC]**
([ax_node_object.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/accessibility/ax_node_object.cc))

```cpp
if (html_input_element && layout_object->IsTextField()) {
    html_input_element->SetValue(string, TextFieldEventBehavior::kDispatchInputAndChangeEvent);
    return true;
}
if (auto* text_area_element = DynamicTo<HTMLTextAreaElement>(*GetNode())) {
    text_area_element->SetValue(string, TextFieldEventBehavior::kDispatchInputAndChangeEvent);
    return true;
}
if (HasContentEditableAttributeSet()) {
    To<HTMLElement>(GetNode())->setInnerText(string);   // <-- sem evento nenhum
    return true;
}
return false;
```

Consequências (todas **[MEDIDO]** no Chrome, e coerentes com o código):

| Alvo | `set kAXValue` | Dispara `input`? | `set kAXSelectedText` |
|---|---|---|---|
| `<textarea>` | ✅ substitui **todo** o conteúdo | ✅ **sim** (`ta_input` foi de 0 → 1) | retorna `err=0` e **não faz nada** |
| `<input type=text>` | ✅ substitui tudo | ✅ sim **[DOC]** | idem |
| `contenteditable` | ✅ troca o conteúdo via `setInnerText` | ❌ **não** (`ce_input` ficou em 0) | retorna `err=0` e **não faz nada** |
| campo de senha | ✅ funciona (§2.3) | **[NÃO VERIFICADO]** | — |

Três armadilhas graves:

1. **`kAXSelectedTextAttribute` é um no-op silencioso no Chromium.** O `BrowserAccessibilityCocoa` só
   implementa o *getter* `accessibilitySelectedText` e o *setter* de `SelectedTextRange` — não existe
   `setAccessibilitySelectedText:`. **[DOC]**
   ([browser_accessibility_cocoa.mm](https://github.com/chromium/chromium/blob/main/ui/accessibility/platform/browser_accessibility_cocoa.mm))
   Mas `AXUIElementIsAttributeSettable` **responde `true`** e o `set` **retorna `err=0`**. Você acha que
   inseriu e não inseriu nada. **[MEDIDO]**
2. **`AXValue` substitui tudo**, não insere no cursor. Para "inserir no ponto de inserção" você teria que ler
   o valor atual + `AXSelectedTextRange`, concatenar na mão e reescrever — o que apaga *undo* e atropela
   qualquer estado do editor.
3. **Em `contenteditable` nenhum evento é disparado.** Slack, Discord, Teams, Notion e a maioria dos
   compositores modernos usam `contenteditable` com um modelo interno (Quill/Slate/ProseMirror/Lexical).
   Trocar o `innerText` por fora deixa o modelo do editor **dessincronizado**: visualmente o texto aparece,
   mas ao enviar a mensagem o app manda o estado antigo, ou o editor sobrescreve na próxima tecla.
   Isso torna o mecanismo A **inadequado** para o caso de uso mais óbvio do produto.

### 3.5 O que acontece no WebKit/Safari

**[DOC], [NÃO VERIFICADO empiricamente]:** no WebKit atual (`main`), `NSAccessibilitySelectedTextAttribute`
é anunciado como gravável para *text controls* (`canSetTextRangeAttributes() { return isTextControl(); }`),
e `accessibilitySetValue:forAttribute:` chama `backingObject->setSelectedText(string)`. **Porém**
`AccessibilityObject::setSelectedText(const String&) override { }` tem **corpo vazio** e não achei nenhum
override em `AccessibilityNodeObject` / `AccessibilityRenderObject` — só `setSelectedTextRange` é
implementado de fato. Ou seja, no WebKit de hoje setar `AXSelectedText` provavelmente também é um no-op.
([WebAccessibilityObjectWrapperMac.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/accessibility/mac/WebAccessibilityObjectWrapperMac.mm),
[AccessibilityObject.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/accessibility/AccessibilityObject.h))
Não consegui validar contra o build real do Safari do macOS 15 — trate como forte indício, não como fato.

### 3.6 Existe módulo npm que exponha isso?

**Não. Não existe hoje um pacote npm mantido que exponha `AXUIElementSetAttributeValue`.**

| Pacote | Última versão | O que faz | Serve? |
|---|---|---|---|
| `macos_accessibility_client` | 0.0.3 — **2023-06-05** | Só `applicationIsTrusted()` / `applicationIsTrustedWithPrompt()`. Rust + napi-rs. | ❌ só permissão |
| `@superbased/macos-ax` | 0.1.0 — **2026-04-28** | Inspector **somente leitura**: `getTreeForPid`, `getFocusedElement`, `isTrusted`, `promptForTrust`. O próprio README diz *"not intended as a standalone consumer surface"*. | ❌ sem setter |
| `node-mac-permissions` | 2.5.0 — **2025-03-15** | `getAuthStatus('accessibility')`, `askForAccessibilityAccess()`, `askForAppleEventsAccess(bundleId)`. | ❌ só permissão (mas útil) |
| `axuielement` (npm) | 1.0.0 — 2019 | Pacote-fantasma sem relação com a API da Apple. | ❌ |
| `nodobjc` | 2.1.0 — **2015** | Ponte ObjC via FFI. Morto. | ❌ |
| `objc` (lukaskollmer) | 0.23.0 — **2022-01-21** | Ponte ObjC. Sem release há 4 anos. | ⚠️ arriscado |

**Portanto: mecanismo A exige addon nativo próprio, ou FFI.**
A alternativa mais barata hoje é **`koffi`** (FFI dinâmico, MIT, v3.1.6 de **2026-08-20**, 279 versões
publicadas, **binário pré-compilado para `darwin-arm64`** entre as `optionalDependencies`, Node ≥ 16 —
*"a prebuilt binary is included in the NPM package which means you can install Koffi without a C++ compiler"*
**[DOC]** [koffi.dev](https://koffi.dev/)). Com koffi dá para chamar `AXUIElementCreateSystemWide`,
`AXUIElementCopyAttributeValue` e `AXUIElementSetAttributeValue` direto do processo main do Electron sem
escrever C++. **Ressalva: a documentação do koffi não menciona Electron nem versão de N-API — compatibilidade
com Electron é [NÃO VERIFICADO].**

---

## 4. Mecanismo B — Pasteboard + ⌘V simulado

### 4.1 As duas variantes

**B1 — via `osascript`/System Events.** Escreve no pasteboard e roda
`tell application "System Events" to keystroke "v" using command down`.
Exige as **duas** permissões (§2.2), inclui o custo de spawn de um processo (`osascript`) e adiciona
dezenas a centenas de ms de latência. **[NÃO VERIFICADO]** o custo exato; não medi.

**B2 — via `CGEvent` em módulo nativo.** Escreve no `NSPasteboard`/`clipboard` do Electron e posta
keyDown/keyUp de `kVK_ANSI_V` (`0x09`) com `CGEventFlags.maskCommand` em `kCGHIDEventTap`.
Exige **só** Acessibilidade. É o que o `robotjs` faz com `robot.keyTap('v', 'command')`.

`CGEvent.post(tap:)` — *"posts the specified event immediately before any event taps instantiated for
that location, and the event passes through any such taps"*. **[DOC]**
([Apple](https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:)))
Existe também `CGEvent.postToPid(_:)` (macOS 10.11+) para mandar o evento a um PID específico, mas
**a Apple não documenta essa função** (página sem descrição). **[DOC]**
([Apple](https://developer.apple.com/documentation/coregraphics/cgevent/postToPid(_:)))

### 4.2 A corrida escrever-pasteboard → ⌘V

**O que a experiência de outros projetos diz.** O espanso — a implementação open-source mais madura desse
problema — expõe estes parâmetros com estes defaults **[DOC]**
([config/mod.rs](https://github.com/espanso/espanso/blob/dev/espanso-config/src/config/mod.rs),
[default.rs](https://github.com/espanso/espanso/blob/dev/espanso-config/src/config/default.rs)):

| Opção | Default | Comentário no código-fonte |
|---|---|---|
| `clipboard_threshold` | **100** chars | *"Number of chars after which a match is injected with the clipboard backend instead of the default one... injecting a long match through separate events becomes slow for long strings."* |
| `pre_paste_delay` | **100 ms** | *"Delay that espanso should wait to trigger the paste shortcut after copying the content in the clipboard. This is needed because if we trigger a 'paste' shortcut before the content is actually copied in the clipboard, the operation will fail."* |
| `paste_shortcut_event_delay` | **10 ms** | *"...sometimes (for example on macOS), without a delay some keystrokes were not registered correctly"* |
| `restore_clipboard_delay` | **300 ms** | *"...without this delay, sometimes the target application detects the previous clipboard content instead of the expansion content."* |

**[MEDIDO] — a corrida medida nesta máquina, no TextEdit:**

Lado A, atraso *antes* do ⌘V (escrita síncrona via `NSPasteboard.setString` no mesmo processo):

```
preDelay=0ms   -> colado="TOKEN-0-Ação"    ok
preDelay=5ms   -> ok        preDelay=10ms  -> ok
preDelay=25ms  -> ok        preDelay=50ms  -> ok        preDelay=100ms -> ok
```

Lado B, atraso *depois* do ⌘V, antes de **restaurar** o clipboard:

```
restoreDelay=0ms   -> colado=".scratch/getthattext/map.md"   ❌ colou o conteúdo ANTIGO
restoreDelay=5ms   -> ok
restoreDelay=20ms  -> ok        restoreDelay=50ms -> ok      restoreDelay=150ms -> ok
```

Leitura desses números:

- **O lado perigoso é a restauração, não a escrita.** Com escrita síncrona no mesmo processo, 0 ms de
  `pre_paste_delay` já bastou. Restaurar em 0 ms, porém, ganhou a corrida do app-alvo e o usuário levou
  o conteúdo *anterior* do clipboard colado — exatamente o sintoma que o espanso descreve.
- Esses valores são de **um** app nativo, **uma** máquina, **sem carga**. Não generalize: 5 ms passar aqui
  não significa que 5 ms passa no Slack numa máquina carregada. Os 100/300 ms do espanso são folga
  deliberada, e é sensato copiá-los.
- **Atenção especial no Electron:** o `clipboard` do Electron 44 é **assíncrono**
  (`clipboard.writeText()` retorna `Promise<void>` que resolve *"once the text has been written"*) — dá
  para `await` e eliminar a corrida do lado da escrita. **[DOC]**
  ([Electron clipboard.md](https://github.com/electron/electron/blob/main/docs/api/clipboard.md))
  Se você usar `clipboardy` (que faz `spawn('pbcopy')`), a escrita é um processo externo e a corrida volta.

### 4.3 Salvar e restaurar o clipboard sem corromper o conteúdo anterior

Este é o ponto onde quase todo mundo entrega uma solução ruim.

**Como o espanso faz (e por que é insuficiente):** ele só lê e reescreve o *texto*:
`[pasteboard stringForType:NSPasteboardTypeString]` na leitura e
`declareTypes:@[NSPasteboardTypeString]` na escrita. **[DOC]**
([espanso-clipboard/src/cocoa/native.mm](https://github.com/espanso/espanso/blob/dev/espanso-clipboard/src/cocoa/native.mm))
Resultado: se você tinha uma imagem, um arquivo, uma célula de planilha ou HTML formatado no clipboard,
o "restore" devolve texto puro e o resto some.

**O jeito correto (e seus limites), com base na doc da Apple:**

```objc
// SALVAR
NSPasteboard *pb = NSPasteboard.generalPasteboard;
NSInteger savedChangeCount = pb.changeCount;
NSMutableArray *snapshot = [NSMutableArray array];
for (NSPasteboardItem *item in pb.pasteboardItems) {
    NSMutableDictionary *reps = [NSMutableDictionary dictionary];
    for (NSPasteboardType t in item.types) {
        NSData *d = [item dataForType:t];       // materializa promessas
        if (d) reps[t] = d;
    }
    [snapshot addObject:reps];
}

// RESTAURAR
[pb clearContents];
NSMutableArray *items = [NSMutableArray array];
for (NSDictionary *reps in snapshot) {
    NSPasteboardItem *it = [NSPasteboardItem new];
    [reps enumerateKeysAndObjectsUsingBlock:^(NSPasteboardType t, NSData *d, BOOL *s) {
        [it setData:d forType:t];
    }];
    [items addObject:it];
}
[pb writeObjects:items];
```

**[MEDIDO]** Essa rotina foi usada em todos os testes deste documento e restaurou corretamente o clipboard
do usuário (item único `public.utf8-plain-text`) — mas o cenário testado era o caso fácil.

Fundamentos e limites, todos **[DOC]**:

- `pasteboardItems` — *"An array that contains all the items held by the pasteboard"*.
  ([Apple](https://developer.apple.com/documentation/appkit/nspasteboard/pasteboarditems))
- `types` — *"the union of the types of data declared for all the pasteboard items"*, **na ordem em que
  foram declarados** (a ordem importa: o app-alvo escolhe a representação mais rica primeiro).
  ([Apple](https://developer.apple.com/documentation/appkit/nspasteboard/types))
- `changeCount` — *"You can therefore record the value of `changeCount` at the time that you take ownership
  of the pasteboard and compare it with a later value to determine whether you still have ownership"*.
  **Use isso**: se o `changeCount` mudou entre o seu `clearContents` e a hora de restaurar, **alguém mais
  escreveu no clipboard** e você deve **abortar a restauração** em vez de sobrescrever o dado novo.
  ([Apple](https://developer.apple.com/documentation/appkit/nspasteboard/changecount))
- `clearContents()` retorna o novo `changeCount`.
  ([Apple](https://developer.apple.com/documentation/appkit/nspasteboard/clearcontents()))

**Os três limites intransponíveis:**

1. **Dados prometidos (lazy).** Com `NSPasteboardItemDataProvider` / `declareTypes:owner:`, o app dono
   promete tipos e só materializa quando alguém pede. A doc da Apple sobre `declareTypes:owner:` é
   explícita: o *owner* *"must remain alive for as long as the data is promised on the pasteboard"*.
   ([Apple](https://developer.apple.com/documentation/appkit/nspasteboard/declaretypes(_:owner:)))
   Quando você faz o snapshot chamando `dataForType:`, você **força a materialização** — o que pode ser
   caro (renderizar um PDF, exportar uma imagem grande) e muda a semântica. E ao restaurar, você devolve
   **dados congelados**, não a promessa: a "cópia" deixa de ser dinâmica.
2. **Promessas de arquivo** (`NSFilePromiseProvider`, `com.apple.pasteboard.promised-file-content-type`)
   dependem do processo dono e de um destino de escrita. Restaurar isso fielmente é, na prática,
   impossível. **[NÃO VERIFICADO]** se existe algum caminho que funcione.
3. **Ownership.** O clipboard restaurado passa a pertencer ao **seu** app, não ao original. Efeitos
   colaterais: histórico de clipboard de terceiros (Maccy, Paste, Raycast) vai registrar 2 entradas
   espúrias; o "Copiar" original deixa de aparecer como vindo do app de origem.

**Convenções para não poluir históricos de clipboard:** existe um padrão de facto — os tipos
`org.nspasteboard.TransientType` e `org.nspasteboard.ConcealedType` — que gerenciadores de clipboard
respeitam para ignorar entradas. É uma **convenção da comunidade** publicada em
[nspasteboard.org](http://nspasteboard.org/), **não** uma API da Apple. Vale marcar o item temporário com
`TransientType` para não sujar o histórico do usuário.

### 4.4 A API de clipboard do Electron mudou (importante)

O Electron **44** (estável desde 2026-08-25) reescreveu o módulo `clipboard` para o formato W3C.
**[DOC]** ([breaking-changes.md](https://github.com/electron/electron/blob/main/docs/breaking-changes.md))

- `read()` → `Promise<ClipboardItem[]>`, `write(items)` → `Promise<void>`, `readText()`/`writeText()` também
  viraram Promises; `has(mimetype)` → `Promise<boolean>`.
- **Foram removidos**: `availableFormats`, `readBuffer`, `writeBuffer`, `readHTML`, `writeHTML`,
  `readImage`, `writeImage`, `readRTF`, `writeRTF`, `readBookmark`, `writeBookmark`,
  `readFindText`, `writeFindText`.
- **O módulo `clipboard` deixou de existir no renderer** (só main process).
- Para formatos crus do macOS existe o custom format
  `electron application/osclipboard;format="public.utf8-plain-text"` — e a doc afirma que
  *"`clipboard.read()` also surfaces any platform clipboard format that has no standard MIME mapping under
  this custom format, so a raw OS format round-trips through the same string on write and read"*.
- *"All entries supplied in a single `write()` call are committed to the system clipboard atomically."*

Isso é uma **boa notícia** para o save/restore: dá para fazer snapshot razoavelmente fiel sem addon nativo,
usando `clipboard.read()` + `osclipboard` custom formats. **Mas [NÃO VERIFICADO]**: não testei se o
round-trip por essa API preserva *todos* os flavours, a ordem de declaração e itens múltiplos com a mesma
fidelidade da rotina `NSPasteboardItem` acima. Se a fidelidade importar, o addon nativo é mais seguro.

### 4.5 Comportamento por tipo de app

| Alvo | Cola? | Observações |
|---|---|---|
| Nativos (TextEdit, Notes, Mail) | ✅ **[MEDIDO]** TextEdit; **[DOC/NÃO VERIFICADO]** Mail | ⌘V é o caminho normal do app. |
| Chromium/Electron (Chrome, Slack, VS Code, Discord) | ✅ **[MEDIDO]** Chrome, em `<textarea>` e `contenteditable` | Passa pelo pipeline normal de paste do editor → **o modelo interno do Quill/Slate fica correto**. É justamente onde o mecanismo A falha. |
| Safari | **[NÃO VERIFICADO]** | Sem razão para falhar. |
| Terminal.app / iTerm2 | ✅ com ressalvas | Colar multi-linha em shell **executa** as linhas; ambos têm proteção de "paste bracketing"/aviso, mas o comportamento depende da config. Se "Secure Keyboard Entry" estiver ligado, ⌘V sintético é **bloqueado** (§2.3). **[NÃO VERIFICADO]** empiricamente. |
| Campo de senha | ❌ | Secure Event Input bloqueia. **[MEDIDO]** |
| Apps que remapeiam ⌘V | ⚠️ | Emacs, apps com atalhos customizados. O espanso expõe `paste_shortcut` configurável exatamente por isso. **[DOC]** |

### 4.6 Acentuação pt-BR

✅ **[MEDIDO]** — `TOKEN-0-Ação`, `TK5-Ação-çãõ`, `colado-ção` chegaram intactos no TextEdit e no Chrome.
O pasteboard carrega UTF-8/UTF-16 nativamente; não há transliteração de teclado envolvida. **Este é o
mecanismo mais seguro para acentuação.**

---

## 5. Mecanismo C — `CGEventKeyboardSetUnicodeString`

### 5.1 Como é

```swift
let e = CGEvent(keyboardEventSource: src, virtualKey: 0x31 /* espaço, portador */, keyDown: true)!
e.keyboardSetUnicodeString(stringLength: n, unicodeString: ptrUTF16)
e.post(tap: .cghidEventTap)
// + o keyUp correspondente
```

Documentação da Apple, na íntegra: *"By default, the system translates the virtual key code in a keyboard
event into a Unicode string based on the keyboard ID in the event source. This function allows you to
manually override this string. **Note that application frameworks may ignore the Unicode string in a
keyboard event and do their own translation based on the virtual keycode and perceived event state.**"*
**[DOC]** ([Apple](https://developer.apple.com/documentation/coregraphics/cgevent/keyboardsetunicodestring(stringlength:unicodestring:)))

Essa última frase é o risco teórico do mecanismo: **um app pode ignorar a string e usar o keycode**
(no meu caso, o `0x31` = espaço). Na prática isso não aconteceu em nenhum dos alvos testados, mas é a
razão pela qual o espanso solta explicitamente o keyUp do espaço
(*"Some applications require an explicit release of the space key"*, [espanso#159](https://github.com/espanso/espanso/issues/159)).

### 5.2 É viável para texto longo? Qual o custo?

**[MEDIDO]** — no TextEdit, string pt-BR com acentos + travessão + aspas francesas + emoji:

| Tamanho do chunk (UTF-16 por evento) | 732 unidades enviadas | Recebidas | Idêntico? | Tempo só de `post` |
|---|---|---|---|---|
| 20 | 732 | 732 | ✅ | 0,093 s |
| 50 | 732 | 732 | ✅ | 0,038 s |
| 100 | 732 | 732 | ✅ | 0,020 s |
| 200 | 732 | 732 | ✅ | 0,010 s |
| **500** | 732 | 732 | ✅ | **0,005 s** |

Texto longo:

```
5124 unidades UTF-16, chunk=20, usleep(2ms)  -> post=0,644s  recebidas=5124  idêntico=true
5124 unidades UTF-16, chunk=20, sem sleep    -> post=0,001s  recebidas=5124  idêntico=true
528  unidades UTF-16, chunk=1,  usleep(1ms)  -> post=0,679s  (≈1,29 ms/caractere)
```

Conclusões:

1. **Não existe mais o limite de 20 caracteres.** O espanso carrega no código o comentário
   *"Because of a bug (or undocumented limit) of the `CGEventKeyboardSetUnicodeString` method the string
   gets truncated after 20 characters, so we need to send multiple events"* **[DOC]**
   ([native.mm](https://github.com/espanso/espanso/blob/dev/espanso-inject/src/mac/native.mm)).
   **[MEDIDO]** No macOS 15.7.3 arm64 isso **não se reproduz**: chunks de 500 unidades chegaram inteiros.
   Ainda assim eu manteria um chunk conservador (~50–100) por segurança em apps que não testei.
2. **O custo de postar é desprezível.** 5124 caracteres num burst custaram ~1 ms de CPU do lado emissor.
   O que custa tempo é o *delay artificial* entre eventos.
3. **O modelo "1 caractere por evento" é que é lento** (~1,3 ms/char só de post + o delay). Um texto de
   2000 caracteres com o default do `robotjs` (10 ms/char) leva **20 segundos**. Com chunk de 100 e sem
   delay, o mesmo texto vai em milissegundos.
4. **`robotjs.typeString` usa exatamente 1 caractere por evento** e, desde a 0.9.0, respeita o
   `keyboardDelay` (default **10 ms**): `cpm = keyboardDelay > 0 ? 60000 / keyboardDelay : 0`. **[DOC]**
   ([robotjs.cc](https://github.com/octalmage/robotjs/blob/master/src/robotjs.cc),
   [keypress.c](https://github.com/octalmage/robotjs/blob/master/src/keypress.c))
   → **Chame `robot.setKeyboardDelay(0)` antes de `typeString`**, ou o produto vai parecer travado.

### 5.3 Acentuação pt-BR

✅ **[MEDIDO]** — `"Olá! Ação, coração, você não vê? — ç ã õ é ê í ú â «aspas» ✅"` repetido 84 vezes
(5124 unidades UTF-16) chegou **byte a byte idêntico** no TextEdit, e igualmente correto no Chrome.
O `robotjs` decodifica UTF-8 → UTF-16 (inclusive surrogate pairs para emoji) antes de chamar
`CGEventKeyboardSetUnicodeString`, então acentuação pt-BR está coberta. **[DOC]** (`keypress.c`)

**Nota importante:** este mecanismo **não** depende do layout de teclado do usuário (ABNT2, US
International, Dvorak...), porque a string Unicode sobrepõe a tradução do keycode. É por isso que ele é
superior a "simular a tecla física do caractere".

### 5.4 Comportamento por tipo de app

| Alvo | Funciona? |
|---|---|
| TextEdit (nativo) | ✅ **[MEDIDO]**, 5124 chars perfeitos |
| Google Chrome, `<textarea>` | ✅ **[MEDIDO]** |
| Google Chrome, `contenteditable` | ✅ **[MEDIDO]** — e **passa pelo pipeline de input do editor**, então o modelo interno fica correto |
| Chrome omnibox (Views) | ✅ **[MEDIDO]** |
| Terminal.app | **[NÃO VERIFICADO]** — mas eventos de teclado é o único jeito de escrever nele (mecanismo A é bloqueado) |
| Campo de senha | ❌ **[MEDIDO]** bloqueado por Secure Event Input |
| Slack / Discord / VS Code | **[NÃO VERIFICADO]** — mesmo motor do Chrome, expectativa alta de funcionar |

### 5.5 Riscos conhecidos do caminho de eventos

- **Modificadores presos.** Se o usuário estiver com Shift/⌘ pressionado (por exemplo porque o gatilho é um
  atalho), os eventos injetados herdam o estado. O espanso solta explicitamente o Shift antes de injetar
  (`CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, 0x38)`), por causa do
  [issue #279](https://github.com/espanso/espanso/issues/279). **[DOC]** Você vai precisar do mesmo cuidado.
- **Auto-repeat/perda de eventos em rajada.** O `robotjs` 0.7.1 traz o fix
  *"Send a complete Unicode key press so repeated characters do not get dropped"*. **[DOC]**
  ([release v0.7.1](https://github.com/octalmage/robotjs/releases))
- **Marcar os eventos como próprios.** O espanso seta uma `CGEventSetLocation` sentinela
  (`CGPointMake(-27469, 0)`) para conseguir ignorar os próprios eventos no detector. Se o produto tiver
  qualquer *event tap* próprio, precisa de um truque equivalente. **[DOC]**

---

## 6. Mecanismo D — `osascript` / System Events (para completude)

```applescript
tell application "System Events" to keystroke "texto"
tell application "System Events" to keystroke "v" using command down
```

- **Permissões:** Automação (Apple Events) **+** Acessibilidade. Ver §2.2. Em app com Hardened Runtime
  ainda é preciso `NSAppleEventsUsageDescription` e, tipicamente, a entitlement
  `com.apple.security.automation.apple-events`. **[NÃO VERIFICADO]** — não consegui abrir a página da
  Apple para essa entitlement (404 na doc atual).
- **Latência:** spawn de processo + IPC de Apple Events. Ordem de dezenas a centenas de ms. **[NÃO VERIFICADO]**.
- **Acentuação:** o comando `keystroke` do System Events tem histórico ruim com caracteres fora do ASCII e
  depende do layout de teclado ativo. **[NÃO VERIFICADO]** em fonte primária — mas dado que existe uma
  alternativa (mecanismo C) que comprovadamente não depende de layout, **não vejo motivo para usar `keystroke`
  para digitar texto**. Já o `keystroke "v" using command down` (só o atalho) é aceitável.
- **Pacotes:** `run-applescript` 7.1.0 (2025-09-09, Sindre Sorhus) está vivo. `node-osascript` (2018) e
  `applescript` (2015) estão mortos.

**Veredicto:** só faz sentido como plano C, quando você quer evitar a permissão de Acessibilidade — e nem
isso funciona, porque UI scripting também a exige.

---

## 7. Matriz consolidada de comportamento

Legenda: ✅ funciona · ⚠️ funciona com ressalva séria · ❌ não funciona · ❔ não verificado

| Alvo | A. `AXSelectedText` | A. `AXValue` | B. Pasteboard + ⌘V | C. CGEvent Unicode |
|---|---|---|---|---|
| **TextEdit** (nativo) | ✅ insere no cursor **[MEDIDO]** | ✅ substitui tudo **[MEDIDO]** | ✅ **[MEDIDO]** | ✅ **[MEDIDO]** |
| **Notes** | ✅ gravável **[MEDIDO]** | ✅ gravável **[MEDIDO]** | ❔ | ❔ |
| **Mail** | ❔ | ❔ | ❔ | ❔ |
| **Google Chrome** `<textarea>` | ⚠️ **no-op silencioso** **[MEDIDO]** | ⚠️ substitui tudo, dispara `input` **[MEDIDO]**; exige a11y ligada (~2 s) | ✅ **[MEDIDO]** | ✅ **[MEDIDO]** |
| **Google Chrome** `contenteditable` | ⚠️ no-op silencioso **[MEDIDO]** | ⚠️ troca conteúdo, **não dispara `input`** **[MEDIDO]** | ✅ **[MEDIDO]** | ✅ **[MEDIDO]** |
| **Slack / Discord** (contenteditable) | ⚠️ **[DOC]** mesmo motor | ⚠️ **[DOC]** quebra o modelo do editor | ✅ ❔ | ✅ ❔ |
| **VS Code** | ❔ (usa textarea oculto + modo screen-reader próprio) | ❔ | ✅ ❔ | ✅ ❔ |
| **Cursor** (Electron) | ❌ sem elemento focado com a11y off **[MEDIDO]** | idem | ✅ ❔ | ✅ ❔ |
| **Safari** | ⚠️ provável no-op **[DOC WebKit]** | ❔ | ❔ | ❔ |
| **Terminal.app** | ❌ não gravável **[MEDIDO]** | ❌ não gravável **[MEDIDO]** | ⚠️ multi-linha executa comandos | ✅ ❔ |
| **iTerm2** | ❔ | ❔ | ⚠️ idem | ❔ |
| **Campo de senha** | ✅ **funciona** **[MEDIDO]** | ✅ **[MEDIDO]** | ❌ **[MEDIDO]** | ❌ **[MEDIDO]** |

---

## 8. Pacotes npm — avaliação

### 8.1 `robotjs` — **ressuscitado em 2026, é a aposta principal**

| | |
|---|---|
| Versão | **0.9.1**, publicada **2026-08-07** |
| Histórico | 0.6.0 em 2019-12-08 → **6 anos parado** → 0.7.0 em 2026-03-11, 0.7.1, 0.8.0, 0.9.0, 0.9.1 |
| Repo | [octalmage/robotjs](https://github.com/octalmage/robotjs), MIT, 12,7k ★, `pushed_at` 2026-08-07, **5 issues abertas**, não arquivado |
| Build | **Node-API** (`node-addon-api` ^4.2.0 + `node-gyp-build` + `prebuildify`) |
| Prebuilds no tarball | **`prebuilds/darwin-arm64/node.napi.node`**, `darwin-x64`, `linux-{x64,arm64}`, `win32-{x64,arm64}` — verificado abrindo o tarball da 0.9.1 |
| Rebuild para Electron | **Não é necessário** — Node-API é ABI-estável entre versões de Node/Electron. O README ainda linka o [wiki de Electron](https://github.com/octalmage/robotjs/wiki/Electron) para builds de fonte. |
| Permissões macOS | 0.9.0 adicionou `getAccessibilityPermission()` (= `AXIsProcessTrusted()`) e `requestAccessibilityPermission()` (= `AXIsProcessTrustedWithOptions` com prompt). **[DOC]** README + `robotjs.cc` |
| API relevante | `typeString(s)`, `typeStringDelayed(s, cpm)`, `setKeyboardDelay(ms)`, `keyTap('v','command')`, `unicodeTap(codepoint)` |
| Implementação macOS | `CGEventKeyboardSetUnicodeString`, 1 caractere por evento, `CGEventPost(kCGSessionEventTap, ...)`. Decodifica UTF-8 e faz surrogate pairs. **[DOC]** `keypress.c` |
| **Não faz** | não tem clipboard (nada de save/restore); não expõe `AXUIElement`; posta em `kCGSessionEventTap` (o espanso prefere `kCGHIDEventTap`) |

**Ressalvas:** (a) o default `keyboardDelay = 10 ms` torna `typeString` lento demais — chame
`setKeyboardDelay(0)`; (b) 1 caractere por evento desperdiça a capacidade de chunk que medi em §5.2;
(c) a ressurreição é recente — 5 releases em 5 meses depois de 6 anos parado é sinal bom, mas o track
record ainda é curto.

### 8.2 Os demais

| Pacote | Última publicação | Veredicto |
|---|---|---|
| `@jitsi/robotjs` | 0.6.24 — 2026-07-02 | Fork do Jitsi, ainda na base 0.6.x. Menos features que o upstream ressuscitado. Só se você já depender dele. |
| `@hurdlegroup/robotjs` | 0.12.3 — 2025-02-11 | Fork mantido durante o hiato. Perdeu a corrida para o upstream. |
| `@nut-tree/nut-js` | **removido do npm** | O autor removeu os pacotes públicos ([blog "I give up"](https://nutjs.dev/blog/i-give-up), texto reproduzido no README). ❌ **não use** |
| `@nut-tree-fork/nut-js` | 4.2.6 — **2025-03-13** | Fork comunitário, Apache-2.0. Repo original `nut-tree/nut.js` com `pushed_at` **2024-05-01** e 43 issues abertas. Risco de manutenção alto. ⚠️ |
| `keysender` | 2.4.0 — 2025-09-25 | Descrição própria: *"...for **Windows**"*. ❌ irrelevante no macOS |
| `node-mac-permissions` | 2.5.0 — **2025-03-15** | Da Shelley Vohr (mantenedora do Electron). `getAuthStatus('accessibility')` retorna `not determined`/`denied`/`authorized`/`restricted`; tem `askForAccessibilityAccess()` e `askForAppleEventsAccess(bundleId)`. ✅ **útil**, é o melhor jeito de dar UX de permissões |
| `macos_accessibility_client` | 0.0.3 — **2023-06-05** | Só trust/prompt; o `systemPreferences.isTrustedAccessibilityClient` do Electron já faz isso sem dependência. ❌ redundante |
| `@superbased/macos-ax` | 0.1.0 — 2026-04-28 | AX **somente leitura** (`getTreeForPid`, `getFocusedElement`). Uma única versão publicada, autor declara que não é superfície pública. ⚠️ útil só como referência de `binding.gyp` |
| `clipboardy` | 5.3.2 — **2026-07-23** | `spawn('pbcopy')`/`spawn('pbpaste')`. **Só texto**, custo de processo, destrói flavours. ❌ para save/restore |
| `run-applescript` | 7.1.0 — 2025-09-09 | Vivo. Só se você for pelo caminho D. |
| `node-osascript` / `applescript` | 2018 / 2015 | ❌ mortos |
| `koffi` | 3.1.6 — **2026-08-20** | FFI com prebuilds `darwin-arm64`, MIT, muito ativo. Caminho para chamar `AXUIElement*`/`CGEvent*` sem escrever addon. **Compatibilidade com Electron não documentada** ⚠️ |
| `active-win` | 9.0.0 — 2024-04-30, **deprecated** | Sucessor: `get-windows` 9.3.0 (2026-03-08). Útil para saber qual app/janela está na frente. |
| `nodobjc`, `objc`, `ffi-napi` | 2015 / 2022 / 2021 | ❌ abandonados |

**Resumo:** para os mecanismos B e C existem pacotes utilizáveis. Para o mecanismo A **não existe pacote —
é addon próprio ou koffi.**

---

## 9. Detecção de permissões dentro do Electron (receita)

```js
const { systemPreferences, app } = require('electron')

// 1) checagem silenciosa, sem prompt — pode rodar no boot e a cada foco
const ok = systemPreferences.isTrustedAccessibilityClient(false)

// 2) só quando o usuário pedir explicitamente para conceder
systemPreferences.isTrustedAccessibilityClient(true)  // mostra o alerta do sistema

// 3) o alerta é assíncrono e NÃO altera o retorno — precisa fazer polling
//    (a Apple documenta isso em AXIsProcessTrustedWithOptions)
```

**[DOC]** ([Electron system-preferences](https://www.electronjs.org/docs/latest/api/system-preferences),
[Apple `AXIsProcessTrustedWithOptions`](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions))

Alternativa com mais granularidade (`not determined` vs `denied`), útil para decidir se abre os Ajustes:
`require('node-mac-permissions').getAuthStatus('accessibility')`.

**Não esqueça:** o app precisa **não roubar o foco** na hora de injetar, senão o "elemento focado" passa a ser
o seu. Ferramentas do Electron para isso:
`win.showInactive()` (*"Shows the window but doesn't focus on it"*), `focusable: false` na criação da janela
(*"On macOS it does not remove the focus from the window"*), `app.hide()` para devolver o foco ao app
anterior, e `setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })` se o app for
`UIElementApplication` (LSUIElement). **[DOC]**
([browser-window.md](https://github.com/electron/electron/blob/main/docs/api/browser-window.md),
[app.md](https://github.com/electron/electron/blob/main/docs/api/app.md))

---

## 10. Acentuação pt-BR — veredicto por mecanismo

| Mecanismo | Preserva `ç ã õ é ê í ú â` e travessão/emoji? | Evidência |
|---|---|---|
| A. AX (`AXValue`/`AXSelectedText`) | ✅ perfeito | **[MEDIDO]** `"Olá! Ação, coração, você não vê? — ç ã õ é ê í ú â «aspas» 100% ✅"` inserido e lido de volta idêntico em TextEdit e Chrome. É `CFString`/UTF-16 puro. |
| B. Pasteboard + ⌘V | ✅ perfeito | **[MEDIDO]** `TOKEN-0-Ação`, `TK5-Ação-çãõ`. UTF-8/UTF-16 no pasteboard, sem tradução de teclado. |
| C. `CGEventKeyboardSetUnicodeString` | ✅ perfeito, **independe do layout do teclado** | **[MEDIDO]** 5124 unidades UTF-16 idênticas. `robotjs` faz UTF-8→UTF-16 com surrogate pairs. |
| D. System Events `keystroke` | ⚠️ histórico ruim, depende do layout | **[NÃO VERIFICADO]** |

---

## 11. Recomendação

### 11.1 A escolha

**Arquitetura em duas camadas, sem depender da Accessibility API para escrever:**

1. **Caminho principal — Pasteboard + ⌘V via `CGEvent` (mecanismo B2).**
   - Cobre nativo, Chromium/Electron (inclusive `contenteditable` do Slack/Discord, que é onde o
     mecanismo A quebra), navegadores e terminais.
   - Exige **só** a permissão de Acessibilidade — uma permissão, um diálogo, uma explicação para o usuário.
   - Preserva acentuação perfeitamente e é instantâneo para qualquer tamanho de texto.
   - Passa pelo pipeline real de paste do app-alvo, então editores ricos ficam consistentes e o **undo do
     usuário funciona**.

2. **Fallback — `CGEventKeyboardSetUnicodeString` em chunks (mecanismo C).**
   - Para quando o alvo não responde a ⌘V (atalho remapeado), para textos curtos onde você quer evitar
     tocar no clipboard, e para terminais.
   - Use **chunks de ~50–100 unidades UTF-16** e **sem delay artificial** — medi 5124 caracteres em ~1 ms
     de post. **Não** use `robotjs.typeString` com o `keyboardDelay` default de 10 ms.

3. **Mecanismo A (AX): não como caminho de escrita.** Use a Accessibility API apenas para **ler contexto**
   (`kAXFocusedUIElement`, `kAXRole`, `kAXSubrole`, `kAXSelectedText` como *getter*) e para **decidir** se
   deve ou não injetar — em especial para detectar `AXSecureTextField`.

### 11.2 Implementação, ponto a ponto

- **Bibliotecas:** `robotjs@0.9.1` para `keyTap('v','command')` e como fallback de digitação
  (Node-API + prebuild `darwin-arm64`, sem rebuild para Electron);
  `clipboard` nativo do Electron (main process) para escrita/leitura do pasteboard;
  `node-mac-permissions` para a UX de permissão. **Não** use `clipboardy`.
  Se precisar de fidelidade total no snapshot do pasteboard, um addon nativo pequeno com
  `NSPasteboardItem` é mais seguro que a API do Electron.
- **Sequência de injeção:**
  1. Capturar o app/elemento focado **antes** de mostrar qualquer janela (`showInactive`/`focusable:false`).
  2. Abortar se `IsSecureEventInputEnabled()` ou se o `AXSubrole` for `AXSecureTextField`.
  3. Snapshot completo do pasteboard (todos os itens, todos os tipos) + guardar `changeCount`.
  4. Escrever o texto (marcando com `org.nspasteboard.TransientType`) e **aguardar a confirmação**
     (`await clipboard.writeText(...)` no Electron 44 já resolve isso).
  5. `pre_paste_delay` de **~100 ms** (medi que 0 ms bastou no TextEdit, mas copie a folga do espanso).
  6. Soltar modificadores presos (checar `CGEventSourceKeyState` do Shift/⌘) e postar ⌘V em
     `kCGHIDEventTap` com ~10 ms entre keyDown/keyUp.
  7. `restore_clipboard_delay` de **~300 ms** — este é o lado onde a corrida realmente acontece
     (**[MEDIDO]**: 0 ms falhou e colou o conteúdo antigo).
  8. **Antes de restaurar, comparar `changeCount`**: se mudou, não restaure — outro app escreveu.
- **Chunk do fallback C:** 50–100 unidades UTF-16, delay 0. Reservar o modo caractere-a-caractere
  (com delay) só para apps que se comprovarem problemáticos.

### 11.3 Riscos residuais

| Risco | Gravidade | Mitigação / status |
|---|---|---|
| **Não testei Slack, Discord, VS Code, Safari, Mail, iTerm2.** Toda a leitura sobre eles vem do motor (Chromium/WebKit). | **Alta** | Antes de fechar arquitetura, rodar uma matriz de teste manual nesses 6 apps. É meio dia de trabalho e elimina o maior desconhecido. |
| **Corrupção do clipboard do usuário.** Promessas lazy e file promises não têm restauração fiel possível. Ownership muda. Históricos de clipboard de terceiros ganham entradas espúrias. | **Alta** | Snapshot completo + `changeCount` guard + `org.nspasteboard.TransientType`. Aceitar que "colei um arquivo do Finder" não sobrevive perfeitamente. **Documentar para o usuário.** |
| **Os delays são heurísticos.** Medi numa máquina ociosa. Sob carga (build rodando, Slack sincronizando) a janela muda. | Média | Copiar as folgas do espanso (100/300 ms) e tornar configuráveis. Considerar verificar o resultado via AX depois de colar, quando a árvore estiver disponível. |
| **Campos de senha.** ⌘V e CGEvent são bloqueados; AX **não** é. | Média | Detectar e **abortar** explicitamente. Não usar AX para contornar — é exatamente o comportamento que faz um app parecer malware. |
| **Terminais.** Colar multi-linha executa comandos. | Média | Detectar bundle id de Terminal/iTerm2/Ghostty e, no mínimo, avisar ou sanitizar `\n`. |
| **Permissão de Acessibilidade some após update.** A concessão é atrelada à assinatura do bundle. | Média | Assinatura estável (Developer ID, mesmo Team ID), verificação a cada boot e onboarding claro. **[NÃO VERIFICADO]** em doc Apple. |
| **`robotjs` acabou de voltar do túmulo.** 6 anos parado, 5 releases em 5 meses. | Média | Vendorizar ou estar pronto para forkar. A superfície usada é pequena (`keyTap`, `typeString`) — dá para substituir por ~150 linhas de addon próprio se precisar. |
| **`CGEventKeyboardSetUnicodeString` pode ser ignorado**, segundo a própria Apple. | Baixa | Não aconteceu em nenhum alvo testado; é fallback, não caminho principal. |
| **Roubo de foco.** Se a janela do produto ativar, o elemento focado deixa de ser o alvo. | Baixa | `showInactive()` / `focusable:false` / LSUIElement. |
| **`AXEnhancedUserInterface` degrada a performance de apps alheios** e leva ~2 s para valer. | Baixa (se seguir a recomendação) | Só relevante se você insistir no mecanismo A. Mais uma razão para não insistir. |

### 11.4 O que eu **não** faria

- **Não** construir o produto sobre `kAXValueAttribute`/`kAXSelectedTextAttribute`. Em Chromium (que é
  onde estão Slack, Discord, VS Code, Teams e todo navegador) o setter de `AXSelectedText` **retorna
  sucesso e não faz nada**, e o setter de `AXValue` **substitui tudo** e, em `contenteditable`, **não
  dispara `input`**. É o pior tipo de falha: silenciosa e dependente do app.
- **Não** usar `System Events keystroke` para digitar texto — duas permissões, mais lento, e acentuação
  duvidosa, sem nenhuma vantagem sobre o mecanismo C.
- **Não** usar `clipboardy` — só texto, mata todos os outros flavours do usuário.
- **Não** usar `@nut-tree/nut-js` (não existe mais no npm) nem `keysender` (Windows).

### 11.5 Resposta à pergunta do ticket

> *"Este é o maior risco do projeto — se não houver um mecanismo confiável, o produto inteiro muda de forma."*

**Existe mecanismo confiável.** Pasteboard + ⌘V via `CGEvent` funciona em app nativo, em Chromium/Electron
(inclusive em `contenteditable`, que é o caso difícil) e no navegador, preserva acentuação pt-BR
perfeitamente, é instantâneo para texto de qualquer tamanho, exige uma única permissão e tem pacote npm
mantido e com prebuild arm64. **O produto não precisa mudar de forma.**

O que muda de forma é a *expectativa* em dois pontos:
1. **Campos de senha estão fora** — por desenho do macOS, e é assim que deve ser.
2. **O clipboard do usuário é tocado**, e a restauração é boa mas não perfeita para conteúdo não-texto.
   Isso precisa ser uma decisão de produto consciente, não um detalhe de implementação.
