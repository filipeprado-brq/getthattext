# Permissões do macOS: conjunto definitivo, ordem de pedido e comportamento na negação

**Ticket:** `06-permissoes-e-ordem-de-pedido.md`
**Contexto travado:** app Electron, macOS 15 (Sequoia), Apple Silicon, uso pessoal (sem App Store, sem notarização, **mas assinado**). Hotkey via Carbon `RegisterEventHotKey` + `kEventHotKeyReleased` (addon nativo, sem TCC, sem event tap). Injeção de texto via Pasteboard + Cmd+V sintetizado com `CGEvent`. API de Acessibilidade usada **somente para leitura** de contexto. Áudio via `getUserMedia` no renderer. Chave da Groq via `safeStorage`.
**Data da pesquisa:** 2026-08-26.

> **Método e limites.** Só fontes primárias: documentação oficial Apple (developer.apple.com, support.apple.com), vídeos/transcrições WWDC da Apple, threads do Apple Developer Forums com resposta de engenheiro do Apple DTS, documentação oficial do Electron, código-fonte do Chromium e do Electron. Nenhum experimento foi executado nesta máquina — nada de sintetizar eventos, escrever no pasteboard, chamar APIs de Acessibilidade contra outros apps, abrir Ajustes do Sistema ou disparar prompts. Tudo que só se resolve empiricamente está marcado **[NÃO VERIFICADO]** com o experimento que resolveria.

---

## 1. A lista definitiva

Com os mecanismos travados, o app toca **exatamente dois** buckets de TCC, mais um item de Keychain que não é TCC, mais um risco futuro de pasteboard:

| # | Permissão | Bucket TCC | Necessária? | Capacidade que morre sem ela | Pode ser pedida por prompt? | Detecção em runtime |
|---|---|---|---|---|---|---|
| 1 | **Microfone** | `kTCCServiceMicrophone` | **Sim, obrigatória** | Captura de áudio → transcrição. O app fica inútil. | **Sim** — prompt real do sistema que concede na hora | `systemPreferences.getMediaAccessStatus('microphone')` / `askForMediaAccess('microphone')` |
| 2 | **Acessibilidade** | `kTCCServiceAccessibility` | **Sim, obrigatória** | (a) injeção de Cmd+V via `CGEventPost`; (b) leitura de contexto via API de Acessibilidade | **Não** — o prompt é apenas *informativo*; a concessão só acontece manualmente em Ajustes do Sistema | `systemPreferences.isTrustedAccessibilityClient(false)` (→ `AXIsProcessTrustedWithOptions`), ou `IOHIDCheckAccess(kIOHIDRequestTypePostEvent)` |
| 3 | **Automação / Apple Events** | `kTCCServiceAppleEvents` | **Não** | Nada. Não usamos Apple Events. | — | — |
| 4 | **Input Monitoring** | `kTCCServiceListenEvent` | **Não** | Nada. Bucket separado da Acessibilidade em macOS 15; nenhum mecanismo travado o dispara. | — | `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)` (só se algum dia precisarmos) |
| 5 | **Keychain (safeStorage)** | não é TCC | n/a | Leitura da chave da Groq | Não é uma permissão de TCC; é um prompt de ACL do Keychain | `safeStorage.isEncryptionAvailable()` |
| 6 | **Colar de Outros Apps** ("Paste from Other Apps") | `kTCCServicePasteboard` | **Não em 15.0–15.3; risco a partir de 15.4** | Leitura do pasteboard (backup/restauração do clipboard) | Alerta do sistema por acesso | `NSPasteboard.accessBehavior` (macOS 15.4+) |

### 1.1 Microfone — obrigatória, concedível por prompt

Apple: *"In iOS and macOS 10.14 and later, the user must explicitly grant permission for each app to access the camera and microphone."*
— [Requesting authorization to capture and save media](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)

- **Prompt do sistema:** sim. É o único caso do nosso app em que o alerta do sistema realmente **concede** a permissão, sem o usuário sair do app.
- **Detecção:** `systemPreferences.getMediaAccessStatus('microphone')` retorna `not-determined | granted | denied | restricted | unknown` ([Electron docs](https://www.electronjs.org/docs/latest/api/system-preferences)). No código do Electron isso desce para `system_permission_settings::CheckSystemAudioCapturePermission()`, que no Chromium é `[AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]` — ver [`electron_api_system_preferences_mac.mm`](https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_system_preferences_mac.mm) e [`remoting/host/mac/permission_utils.mm`](https://chromium.googlesource.com/chromium/src/+/main/remoting/host/mac/permission_utils.mm) (`CanCaptureAudio()`).
- **Pedido:** `systemPreferences.askForMediaAccess('microphone')` → `[AVCaptureDevice requestAccessForMediaType:...]` (mesmo arquivo do Electron, linha ~618).
- **Negação:** a doc do Electron é explícita: *"If access has already been requested and denied, it **must** be changed through the preference pane; an alert will not pop up and the promise will resolve with the existing access status."* E: *"If an access request was denied and later is changed through the System Preferences pane, a **restart of the app** will be required for the new permissions to take effect."* — [systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences). Ou seja: **negou uma vez → nunca mais há prompt, e depois de conceder manualmente é preciso reiniciar o app.**

### 1.2 Acessibilidade — obrigatória, NÃO concedível por prompt

Esta é a resposta à pergunta central do ticket. Confirmada em três fontes primárias independentes:

**(a) WWDC 2019, sessão 701 "Advances in macOS Security"** ([vídeo/transcrição oficial Apple](https://developer.apple.com/videos/play/wwdc2019/701/)):

> "Here's an example of code that simulates a key press and key release. The first time this code runs and tries to post these events as if they were actually typed by the user, **the events are discarded**. And a dialog like this one is displayed alerting the user that they will need to go to the security and privacy preference pane to **authorize the app for accessibility features**."

> "Now, apps can test whether the user has approved the app to synthesize input events using the `IOHIDCheckAccess` function. And this is the same API for checking authorization for keyboard input monitoring. But here you can see that we're passing the **`kIOHIDRequestTypePostEvent`** instead."

E a distinção explícita entre os dois buckets:

> "…where a **listen-only event** requires authorization for **input monitoring**, a **modifying event tap** requires authorization for **accessibility features**."

**(b) Código-fonte do Chromium** — o Chrome Remote Desktop injeta input com `CGEventPost` e documenta o requisito no comentário:

> `// macOS requires an additional runtime permission for injecting input using CGEventPost (we use this in our input injector for Mac).`
> `bool CanInjectInput() { return AXIsProcessTrusted(); }`
> — [`remoting/host/mac/permission_utils.mm`](https://chromium.googlesource.com/chromium/src/+/main/remoting/host/mac/permission_utils.mm)

Isso responde diretamente a duas perguntas do ticket: **sim, `CGEventPost` exige Acessibilidade**, e **sim, `AXIsProcessTrusted`/`AXIsProcessTrustedWithOptions` é o check correto** — é exatamente o que o Chromium usa como gate do seu injetor de `CGEventPost`.

**(c) Documentação da Apple sobre `CGEvent.post(tap:)`** — nota importante: a página de referência da API [`post(tap:)`](https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:)) **não menciona nenhuma permissão**. Ela só diz *"Posts a Quartz event into the event stream at a specified location"* e *"This function posts the specified event immediately before any event taps instantiated for that location"*. Idem [`CGEventTapLocation`](https://developer.apple.com/documentation/coregraphics/cgeventtaplocation). O requisito de TCC **não está na referência da API** — está apenas na sessão WWDC e no comportamento observável. Isso é relevante para o design: não existe código de erro; o `CGEventPost` **retorna void e os eventos são simplesmente descartados**. Não há como detectar falha pelo retorno da chamada.

**Detecção em runtime.** Duas opções, ambas primárias:

1. `systemPreferences.isTrustedAccessibilityClient(prompt)` — no Electron isso é literalmente:
   ```objc
   NSDictionary* options = @{(__bridge id)kAXTrustedCheckOptionPrompt : @(prompt)};
   return AXIsProcessTrustedWithOptions((CFDictionaryRef)options);
   ```
   ([`electron_api_system_preferences_mac.mm:510-514`](https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_system_preferences_mac.mm))
2. `IOHIDCheckAccess(kIOHIDRequestTypePostEvent)` — o caminho que a Apple recomendou no WWDC 701 especificamente para "posso sintetizar eventos?".

**Recomendação:** usar `isTrustedAccessibilityClient(false)` como check principal (é o que o Chromium faz, está exposto no Electron sem addon nativo, e cobre *ambos* os usos — injeção e leitura AX). `IOHIDCheckAccess(kIOHIDRequestTypePostEvent)` seria um segundo sinal, mas exige addon nativo e na prática não acrescenta informação.

**Sobre o prompt.** A doc da Apple para [`AXIsProcessTrustedWithOptions`](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions) descreve `kAXTrustedCheckOptionPrompt` como *"a CFBooleanRef indicating whether the user will be **informed** if the current process is untrusted"* e avisa: *"Prompting occurs asynchronously and **does not affect the return value**."*

Traduzindo para o nosso caso: **o prompt de Acessibilidade não concede nada.** Ele apenas informa o usuário e oferece um botão que abre os Ajustes do Sistema. A Apple confirma isso no fluxo do usuário: *"Navigate to Apple menu > System Settings, then select Privacy & Security in the sidebar and click Accessibility (you may need to scroll down). Toggle permission on or off for apps in the list, or click the Add button to search for and authorize additional applications."* — [Allow accessibility apps to access your Mac](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac).

**Consequência de design:** Microfone tem fluxo de *uma* interação (prompt → Permitir). Acessibilidade tem fluxo de *cinco* (nosso aviso → abrir Ajustes → achar o app → ligar o toggle → voltar). São UXs radicalmente diferentes e não devem ser tratadas pelo mesmo componente de onboarding.

**Leitura de contexto via API AX.** A mesma permissão cobre. Quando não confiado, as chamadas AX falham com `kAXErrorAPIDisabled` (`-25211`), documentado pela Apple como *"Assistive applications are not enabled in System Preferences"* — [`AXError.apiDisabled`](https://developer.apple.com/documentation/applicationservices/axerror/apidisabled). Isso dá um segundo canal de detecção: se a leitura AX começar a retornar `-25211`, a confiança caiu.

### 1.3 Automação / Apple Events — NÃO é necessária. Confirmado.

A Apple define o gatilho de forma inequívoca:

- [`NSAppleEventsUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription): *"This key is required if your app uses APIs that **send Apple events**."*
- [Apple Events Entitlement (`com.apple.security.automation.apple-events`)](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.automation.apple-events): *"A Boolean value that indicates whether the app may prompt the user for permission to **send Apple events** to other apps. Your app doesn't need the Apple Events entitlement if it only sends Apple events to itself or to other processes signed with the same team ID."*

`CGEventPost` não é um Apple event. Ele injeta no stream de eventos HID/sessão do CoreGraphics — mecanismo completamente diferente do IPC de Apple Events. Nossa decisão travada de usar `CGEvent` em vez de `osascript`/`NSAppleScript` **elimina** o bucket de Automação por construção.

**Corolário prático importante:** isso é a principal vantagem escondida da decisão `CGEvent` vs `osascript`. Com `osascript keystroke "v" using command down`, o app precisaria de *Automação para System Events* — uma permissão **por app-alvo** (`kTCCServiceAppleEvents` é indexado pelo par requerente→alvo), o que multiplicaria prompts. Com `CGEvent`, uma única concessão de Acessibilidade cobre injeção em qualquer app. Não reabrir essa decisão.

### 1.4 Input Monitoring — bucket separado, e nada nosso o dispara

**É um bucket separado?** Sim. A Apple tem página de suporte própria para ele: *"Input Monitoring: Allow apps to monitor your keyboard, mouse, or trackpad even when you're using other apps"*, com caminho `System Settings > Privacy & Security > Input Monitoring` — [Control access to input monitoring on Mac](https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac). E o WWDC 701 estabelece a separação semântica: listen-only → Input Monitoring; modifying tap / post → Acessibilidade.

**Algo nosso dispara?** Não:

- `RegisterEventHotKey` (Carbon) **não é um event tap**. Ele registra um hotkey no Carbon Event Manager e o sistema entrega `kEventHotKeyPressed`/`kEventHotKeyReleased` ao processo. Não há `CGEventTapCreate`, não há leitura do stream global. (Já verificado no ticket 02 — não reaberto aqui.)
- `CGEventPost` cai em Acessibilidade, não em Input Monitoring.
- `getUserMedia` cai em Microfone.

**Onde isso mudaria:** se algum dia precisarmos de detecção de key-up/key-down que o Carbon não dá, ou de "hold to talk" implementado via `CGEventTapCreate`, aí sim entra Input Monitoring (se `kCGEventTapOptionListenOnly`) ou Acessibilidade (se `kCGEventTapOptionDefault`), conforme a citação do WWDC 701 acima. Manter o Carbon evita esse bucket inteiro.

### 1.5 Keychain — não é TCC, mas há prompt visível ao usuário

`safeStorage` guarda a chave de criptografia no Keychain. Não existe bucket de TCC para isso e não existe prompt de privacidade; existe o **prompt de ACL do Keychain** ("*'App' wants to use your confidential information stored in ... in your keychain*").

**O que faz re-perguntar.** A Apple documenta que o ACL do item de Keychain é rastreado pelo *designated requirement* (DR) do app criador:

> **Keychain Access Controls** — "Controls what applications can do with specific keychain items. Initial Policy: The creating application is automatically trusted with its item, and determines the access policy using code signing requirements. **Tracking Policy: Free access to the keychain item by the creating application and tracked with its DR**."
> — [TN2206: macOS Code Signing In Depth, Table 1](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)

O Electron diz a mesma coisa em linguagem operacional:

> "On macOS, your app **should be code signed** for `safeStorage` to behave consistently. Without a valid, consistent signature, macOS may not recognize different builds of your app as the same application, which can cause the **Keychain to re-prompt the user for permission on every update**."
> — [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) e [Code Signing § macOS APIs that require code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing)

Isso valida exatamente a razão pela qual o app é assinado (decisão travada). Nada a mudar. Dois pontos operacionais:

- `safeStorage.isEncryptionAvailable()` — "On macOS, returns true if Keychain is available" ([docs](https://www.electronjs.org/docs/latest/api/safe-storage)).
- As chamadas síncronas **bloqueiam a thread** para coletar input do usuário: *"access to the system Keychain is required and these calls can block the current thread to collect user input"*. Em um app de menu bar acionado por hotkey, uma leitura síncrona da chave no caminho crítico pode travar a UI. A doc do Electron recomenda `encryptStringAsync`/`decryptStringAsync` e avisa que a API síncrona pode ser depreciada. **Ler a chave uma vez no boot e manter em memória** resolve isso e evita qualquer prompt no meio de um ditado.

### 1.6 Pasteboard — não é problema em macOS 15.0–15.3, mas é um risco datado

A partir de **macOS 15.4** a Apple introduziu API de privacidade de pasteboard: [`NSPasteboard.accessBehavior`](https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-86972) (macOS 15.4+) e o enum [`NSPasteboard.AccessBehavior`](https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-swift.enum) com os casos:

- `.ask` — *"The system will notify the user and ask for permission before granting pasteboard access. However, access that is both **user originated and paste related** will always be allowed, and will not result in a notification. The app is listed in the corresponding System Settings pane."*
- `.alwaysAllow` — *"The system will automatically allow all pasteboard access, without notifying the user."*

O Chromium confirma que o bucket de Ajustes existe em macOS 15: o enum `SystemSettingsPane` tem `kPrivacySecurity_PasteFromOtherApps` com o comentário `// Pasteboard permissions were added in macOS 15.` — [`base/mac/mac_util.mm`](https://chromium.googlesource.com/chromium/src/+/main/base/mac/mac_util.mm).

**Por que isso importa para nós.** Nosso fluxo de injeção provavelmente faz: ler o pasteboard atual (backup) → escrever o texto → Cmd+V → restaurar o backup. **Escrever** não é gated. **Ler programaticamente** é exatamente o que o alerta cobre — e a leitura do backup **não** é "user originated and paste related", então cai no caso que gera notificação.

Status atual: em macOS 15 o comportamento de alerta é **opt-in por developer preview** (via user default `EnablePasteboardPrivacyDeveloperPreview`), não ligado por padrão. **[NÃO VERIFICADO]** — não achei uma página da Apple que declare o default de `accessBehavior` em 15.4 sem o preview ligado; a referência da API não diz. As release notes de macOS 15.4 não mencionam pasteboard. Experimento que resolveria: em uma máquina 15.4+, chamar `NSPasteboard.general.accessBehavior` e conferir se retorna `.alwaysAllow` (default aberto) ou `.ask`.

**Mitigação de design, independente do default:** não fazer backup/restauração do pasteboard por padrão, ou torná-la opcional. Se a restauração for requisito, ela é a única parte do app que fica exposta a esse alerta — e vale isolá-la atrás de uma flag para poder desligá-la quando o comportamento virar default em uma versão futura do macOS.

---

## 2. Info.plist e entitlements — e as combinações que causam crash

### 2.1 Tabela

| Capacidade | Info.plist | Entitlement (Hardened Runtime, fora da App Store) | Ausência causa… |
|---|---|---|---|
| Microfone | `NSMicrophoneUsageDescription` (string) | `com.apple.security.device.audio-input` = `true` | **Terminação do processo pelo sistema** |
| Acessibilidade (`CGEventPost` + leitura AX) | **nenhuma chave** | **nenhum entitlement** | Eventos descartados silenciosamente / `kAXErrorAPIDisabled` |
| Apple Events | `NSAppleEventsUsageDescription` | `com.apple.security.automation.apple-events` | n/a — não usamos |
| Keychain / safeStorage | nenhuma | nenhum (mas **assinatura estável obrigatória**) | Re-prompt do Keychain a cada build |
| App de menu bar sem janela | `LSUIElement` = `true` | — | (não é permissão; só some do Dock) |

### 2.2 O crash duro: microfone

Esta é a combinação que **mata o processo em vez de mostrar prompt**, e a Apple é explícita:

> "Your app needs to contain the appropriate key in its `Info.plist` file, **and** the appropriate entitlement enabled in macOS, **before it requests authorization or attempts to use a capture device. Otherwise, the system terminates your app.**"
> — [Requesting authorization to capture and save media](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)

Note o "**and**": são **duas** condições, e cada uma isolada já é suficiente para matar o processo.

- `NSMicrophoneUsageDescription`: *"This key is required if your app uses APIs that access the device's microphone."* — [doc](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)
- `com.apple.security.device.audio-input`: *"A Boolean value that indicates whether the app may record audio using the built-in microphone and access audio input using Core Audio."* — [Audio Input Entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.device.audio-input). É um entitlement de Hardened Runtime (*"first enable the Hardened Runtime capability in Xcode, and then under Resource Access, select Audio Input"*).

Isto confirma o contexto travado ("a ausência causa crash em vez de prompt") **com fonte primária da Apple**.

Matriz explícita para o nosso caso (Hardened Runtime ligado, não sandboxed, não App Store):

| `NSMicrophoneUsageDescription` | `com.apple.security.device.audio-input` | Resultado ao chamar `getUserMedia`/`askForMediaAccess` |
|---|---|---|
| presente | presente | Prompt normal → concede/nega |
| **ausente** | presente | **Processo terminado pelo sistema** |
| presente | **ausente** | **Processo terminado / acesso negado** (Hardened Runtime bloqueia o recurso) |
| ausente | ausente | **Processo terminado** |

Convenção de valor da Apple para entitlements booleanos: *"The default value of these Boolean entitlements is false. When Xcode signs your code, it includes an entitlement only if the value is true. If you're **manually signing code**, follow this convention to ensure maximum compatibility. **Don't include an entitlement if the value is false.**"* — [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime). Relevante porque estamos assinando manualmente (electron-builder / `codesign`): não incluir chaves com `false` no `entitlements.plist`.

> **Nota Electron/Chromium — herança de entitlements.** *"You add entitlements only to executables. Shared libraries, frameworks, and in-process plug-ins **inherit the entitlements of their host executable**."* — Hardened Runtime, idem. Na prática, em app Electron a captura de áudio acontece no processo de GPU/utility (`Electron Helper (Renderer).app` etc.), e o `entitlements.plist` do helper precisa carregar as mesmas chaves de acesso a recurso, além do `entitlements.inherit.plist`. Isso é padrão nas ferramentas de empacotamento do Electron (electron-builder aplica `entitlementsInherit` aos helpers), mas é o ponto onde erros de assinatura viram "microfone silenciosamente morto". **[NÃO VERIFICADO]** para o nosso build concreto — resolver inspecionando `codesign -d --entitlements :- <cada .app/helper>` depois do empacotamento.

### 2.3 A ausência de crash: Acessibilidade

Acessibilidade **não tem** chave de `Info.plist` nem entitlement. A doc do Electron confirma para `isTrustedAccessibilityClient`: nenhuma configuração de `Info.plist` é necessária. Isso significa:

- Não existe string de propósito que possamos escrever para explicar o pedido — o texto do alerta do sistema é fixo e escrito pela Apple.
- Toda a comunicação com o usuário sobre *por que* precisamos disso tem que vir de UI nossa, **antes** de mandá-lo para os Ajustes.
- A falha é **silenciosa**: `CGEventPost` retorna void, os eventos são descartados. Único jeito de saber é checar `AXIsProcessTrusted*` antes.

---

## 3. Ordem de pedido na primeira execução

### 3.1 O que a HIG diz

Da [Human Interface Guidelines § Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy):

> "**Request permission only when your app clearly needs access to the data or resource.** It's natural for people to be suspicious of a request for personal information or access to a device capability, especially if there's no obvious need for it. **Ideally, wait to request permission until people actually use an app feature that requires access.**"

> "**Avoid requesting permission at launch unless the data or resource is required for your app to function.** People are less likely to be bothered by a launch-time request when it's obvious why you're making it. For example, people understand that a navigation app needs access to their location before they can benefit from it."

> "**Request access only to data that you actually need.** Asking for more data than a feature needs — or asking for data before a person shows interest in the feature — can make it hard for people to trust your app."

E sobre telas pré-alerta (que é exatamente o que precisamos para Acessibilidade):

> "Ideally, the current context helps people understand why you're requesting their permission. If it's essential to provide additional details, **you can display a custom screen or window before the system alert appears.**"
> "**Include only one button and make it clear that it opens the system alert.** … Use a term like '**Continue**' or '**Next**' to title the single button in your custom screen or window, clarifying that its action is to open the system alert."
> "**Don't include additional actions in your custom screen or window.** … don't provide a way for people to leave the screen or window without viewing the system alert."

E sobre a purpose string (aplicável ao microfone), com o exemplo *literalmente* de um app de áudio:

| Purpose string | Avaliação da Apple |
|---|---|
| "The app records during the night to detect snoring sounds." | *"An active sentence that clearly describes how and why the app collects the data."* |
| "Microphone access is needed for a better experience." | *"A passive sentence that provides a vague, undefined justification."* |
| "Turn on microphone access." | *"An imperative sentence that doesn't provide any justification."* |

Ou seja, `NSMicrophoneUsageDescription` deve ser algo como: **"O app grava o áudio do seu microfone para transcrever sua fala em texto."** — ativa, específica, primeira pessoa do app, com ponto final.

Nota: a HIG cobre o padrão iOS/App Store de recursos com prompt real (câmera, mic, localização). Ela **não** trata do caso macOS "permissão que só pode ser concedida navegando nos Ajustes do Sistema". Para Acessibilidade a HIG dá o princípio (contexto, tela pré-alerta, um botão) mas não o fluxo.

### 3.2 Os dois lados, para um app de menu bar sem janela principal

**A favor de pedir tudo no onboarding (up front):**

1. O app **não funciona parcialmente**. Microfone sem Acessibilidade = transcreve e não cola. Acessibilidade sem microfone = não tem nada para colar. As duas capacidades não são features independentes; são metades de um único fluxo. A própria HIG abre exceção: *"unless the data or resource is required for your app to function"*.
2. **Não há janela para hospedar o pedido lazy.** O fluxo em uso é: usuário aperta hotkey em outro app, fala, solta. Nesse instante o app está em background, sem foco, sem janela. Descobrir ali que falta Acessibilidade significa: roubar o foco do app do usuário, abrir uma janela, explicar, mandar para os Ajustes — no meio de uma tarefa dele. Isso é pior que qualquer onboarding.
3. **A negação de Acessibilidade é caríssima de recuperar.** Cinco passos manuais, mais uma volta ao app. Não é algo para descobrir sob pressão.
4. **A negação de microfone é irreversível dentro do app.** Documentado pelo Electron: negou → nunca mais aparece prompt, só via painel de Ajustes + restart do app. Se isso acontece durante o onboarding, temos uma tela para explicar. Se acontece no primeiro ditado, o usuário fica com um app quebrado sem entender.
5. **Confiança/hotkey.** No momento do primeiro ditado, o timing importa: o prompt de microfone aparecendo *durante* a fala do usuário significa que os primeiros segundos são perdidos.

**A favor de pedir sob demanda (lazy):**

1. É a recomendação literal da HIG.
2. Onboarding com dois pedidos de permissão em sequência (um deles exigindo passeio pelos Ajustes) é uma parede logo na primeira execução.
3. Se o usuário só quiser experimentar a transcrição (ver o texto no app, copiar à mão), Acessibilidade é dispensável — argumento válido **só se** existir um modo "transcrever para o clipboard/janela" sem injeção.
4. Um app de menu bar não tem convenção de "primeira execução"; o usuário pode nem perceber que abriu.

**Resolução.** Os argumentos 1–5 do lado "up front" são específicos e concretos; o lado lazy é um princípio geral desenhado para um cenário diferente (app iOS com features independentes). A HIG já tem a exceção que se aplica ("required for your app to function"). Vai up front — mas com o formato de onboarding certo, não com dois alertas do sistema em sequência. Ver § 7.

### 3.3 Ordem interna

Microfone **antes** de Acessibilidade. Razões:

1. Microfone é um único clique dentro do app, com prompt real do sistema. É a vitória fácil — ganha momentum antes do passo difícil.
2. Acessibilidade tira o usuário do app (Ajustes do Sistema). Se acontecer primeiro, o onboarding é interrompido e é preciso reconstruir o estado ao voltar.
3. Erro de configuração de microfone (`Info.plist`/entitlement faltando) **mata o processo**. Melhor descobrir isso no primeiro passo do onboarding que no meio dele.

Ordem completa recomendada em § 7.

---

## 4. Revogação com o app rodando

### 4.1 O app é notificado?

**Não existe API pública documentada pela Apple para ser notificado de mudança de TCC.** Não achei nenhuma notificação, callback ou observador documentado para Microfone ou Acessibilidade.

Evidência de como quem faz isso de verdade resolve: o Chrome Remote Desktop **faz polling**. O wizard de permissões do Chromium define `constexpr base::TimeDelta kPollingInterval = base::Seconds(1);` com o comentário *"Interval between permission checks, used to update the UI when the user grants permission."* — [`remoting/host/mac/permission_wizard.mm`](https://chromium.googlesource.com/chromium/src/+/main/remoting/host/mac/permission_wizard.mm). Ou seja: o maior consumidor conhecido de `CGEventPost` + Acessibilidade em macOS **não** usa notificação; consulta `AXIsProcessTrusted()` a cada segundo.

Existe uma notificação `com.apple.accessibility.api` no `NSDistributedNotificationCenter` amplamente usada pela comunidade, **mas ela não aparece em nenhuma documentação da Apple** que eu encontrei. **[NÃO VERIFICADO]** — tratar como implementation detail não suportada. Se usada, deve ser apenas otimização em cima do polling, nunca a única fonte de verdade. Experimento que resolveria: registrar um observador em `DistributedNotificationCenter` para esse nome e alternar o toggle de Acessibilidade em Ajustes do Sistema (envolve mexer nos Ajustes reais do usuário — não executado).

### 4.2 O app crasha?

**Em macOS, na revogação, a regra documentada é: a API falha, o processo não morre.** O engenheiro do Apple DTS (Quinn "The Eskimo!") testou exatamente isso:

> "When I ran the app after revoking the app's access to Documents, I saw this: `Error Domain=NSCocoaErrorDomain Code=257 "The file "Documents" couldn't be opened because you don't have permission to view it."` … **This is what I expected: The app isn't killed, but rather the file system API fails with an error.**"
> — [Apple Developer Forums, thread 649163](https://developer.apple.com/forums/thread/649163)

Contraste importante: no **iOS** o comportamento é diferente — mudar uma configuração de privacidade faz o SpringBoard reiniciar o app via `SIGKILL`. Em macOS não há esse mecanismo. Portanto **a premissa do ticket ("Apple é conhecida por matar/reiniciar processos em algumas mudanças de TCC") vale para iOS, não para macOS**. O crash em macOS acontece por *falta de usage description / entitlement* (§ 2.2), não por revogação.

### 4.3 O que acontece concretamente, por permissão

| Permissão | Ao revogar com o app rodando |
|---|---|
| **Acessibilidade** | `AXIsProcessTrustedWithOptions` passa a retornar `false`. `CGEventPost` passa a **descartar os eventos silenciosamente** (sem erro, sem retorno). Leituras AX passam a retornar `kAXErrorAPIDisabled` (`-25211`). O processo **não** é morto. |
| **Microfone** | `getMediaAccessStatus` passa a retornar `denied`. O que acontece com um `MediaStream` **já ativo** no momento da revogação é **[NÃO VERIFICADO]** — as três possibilidades são: stream continua até parar, tracks emitem `ended`, ou o áudio vira silêncio. Experimento que resolveria: iniciar `getUserMedia`, revogar o Microfone em Ajustes do Sistema com a captura ativa, e observar eventos `ended`/`mute` na track e o conteúdo do buffer. Não executado (exige mexer nos Ajustes do usuário). |
| **Keychain** | Se o ACL deixar de casar (ex.: binário resignado por baixo do app rodando), a próxima leitura dispara o prompt do Keychain, **bloqueando a thread** (§ 1.5). |

### 4.4 Consequência de design

Como (a) não há notificação suportada, (b) `CGEventPost` falha em silêncio, e (c) o processo sobrevive à revogação, o app **tem obrigatoriamente** que checar `isTrustedAccessibilityClient(false)` **imediatamente antes de cada injeção**, e não uma vez no boot. O custo é trivial (uma chamada síncrona a `AXIsProcessTrustedWithOptions`); a alternativa é o modo de falha pior possível: o usuário fala, o app transcreve, nada aparece, nenhum erro.

O mesmo raciocínio, mais fraco, vale para o microfone: checar `getMediaAccessStatus('microphone')` antes de abrir a captura, em vez de confiar em estado cacheado do boot.

---

## 5. Desenvolvimento: app não assinado / ad-hoc e a entrada obsoleta

**Sim, o app aparece na lista de Acessibilidade dos Ajustes do Sistema mesmo não assinado** (o usuário pode adicioná-lo manualmente pelo botão `+`, ou ele é adicionado quando o alerta do sistema é disparado). O problema não é aparecer — é a concessão **não sobreviver ao próximo build**. A Apple documenta a mecânica com precisão em [TN3127: Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements):

> "Most code has a **designated requirement** (DR) which is how the code identifies itself: It's the code's way of saying '**If you see me again, here's how you tell it's really me.**' The DR is critical on macOS, an open platform where code impersonation is a cause for concern."

> "Imagine you have an app that accesses the microphone. At that point macOS prompts the user to authorize that. A few days later your app's software update mechanism runs and replaces version 1.2 with version 1.3. … **macOS solves this problem by recording your app's DR in its database of apps authorized to access the microphone.** Each time your app tries to access the microphone, macOS checks that this version of the app satisfies the original DR. In short, **the DR is all about code identity**."

E o parágrafo decisivo:

> "**Unsigned code has no DR. Ad hoc signed code, called Sign to Run Locally by Xcode, has a DR but it's tied to that specific version of the code. In both cases macOS can't reliably track the identity of the code.** You often see this problem when you create a simple test project in Xcode and don't bother to enable code signing. If the app accesses the microphone, macOS prompts you to authorize that. **If you tweak the code and run it again, macOS repeats that prompt. Without a DR, macOS can't track this authorization across versions of your app.**"

O mesmo Quinn, em [thread 707177](https://developer.apple.com/forums/thread/707177), sobre permissões que se perdem a cada recompilação:

> "**99 times out of a 100 this is caused by the program not having a stable signing identity.** The signing identity is used as a component of the designated requirement (DR), and **TCC uses the DR to track whether build N+1 of your program is the same as build N**."

E a doc da Apple sobre DRs default:

> "When you sign code with `codesign`, it applies a **default designated requirement** based on the code signing identity you supply. … These default DRs strike a balance between generality and specificity. They ensure that: **A privilege, like microphone access, acquired by an existing version of your app is still available to a new version.** Other teams can't sign an app that impersonates your app."

### O problema da entrada obsoleta

Consequência direta: em builds unsigned/ad-hoc, a entrada que está ligada na lista de Acessibilidade **refere-se ao binário antigo**. O novo build não satisfaz o DR gravado, então:

- O toggle aparece **ligado** em Ajustes do Sistema, mas `AXIsProcessTrusted()` retorna `false` → o sintoma mais confuso possível.
- Ligar/desligar o toggle não resolve, porque a entrada aponta para uma identidade que o binário atual não satisfaz.
- **Remédio:** selecionar a entrada em `Ajustes do Sistema > Privacidade e Segurança > Acessibilidade`, removê-la com `−`, re-adicionar o app com `+`, e **encerrar e reabrir o app**. A Apple documenta o `+`/`−` na página de suporte ([mh43185](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac)); a necessidade de fazer isso a cada mudança de binário decorre de TN3127.
- Alternativa em massa: `tccutil reset Accessibility <bundle-id>` (ver `man tccutil`).

**Recomendação (já alinhada com a decisão travada de assinar):** assinar os builds de desenvolvimento com uma identidade **Apple Development** estável, nunca `--sign -` (ad-hoc) nem unsigned. É a recomendação explícita de Quinn na thread 707177, é o que estabiliza o DR, e é o que faz Acessibilidade **e** Keychain pararem de re-perguntar entre builds. Isto reforça — não contradiz — a decisão já travada de assinar o app.

**Corolário:** manter o **mesmo** `CFBundleIdentifier` e a **mesma** identidade de assinatura entre dev e "produção pessoal". Se dev e release usarem identidades diferentes (Apple Development vs Developer ID), TN3127 avisa que os DRs default **não** são mutuamente compatíveis — cada variante terá sua própria entrada em Acessibilidade e sua própria chave no Keychain.

---

## 6. Deep-link para os Ajustes do Sistema em macOS 15

### 6.1 URLs exatas

O `enum SystemSettingsPane` do Chromium é a melhor fonte primária disponível: é código de produção, com um comentário dizendo em quais versões do macOS os valores foram testados. De [`base/mac/mac_util.mm`](https://chromium.googlesource.com/chromium/src/+/main/base/mac/mac_util.mm):

```
Microfone:
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone

Acessibilidade:
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility
```

Bônus, do mesmo arquivo, se precisarmos:

```
Privacidade e Segurança (raiz):
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy

Colar de Outros Apps (macOS 15+):
x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Pasteboard

Input Monitoring: não está no enum do Chromium.
Por analogia seria ...extension?Privacy_ListenEvent — [NÃO VERIFICADO], e não precisamos.
```

O comentário do Chromium explica a mecânica e o grau de confiança:

> "System Settings are implemented with app extensions found at `/System/Library/ExtensionKit/Extensions/`. URLs to open them are constructed with a scheme of `x-apple.systempreferences` and a body of the bundle ID of the app extension. … **It is not yet known how to definitively identify the query string used to open sub-panes**; the ones used below were determined from historical usage, disassembly of related code, and guessing. **Clarity was requested from Apple in FB11753405.** … **These values have been tested on macOS 13, 14, 15, and 26. Be sure to verify them on new releases of macOS.**"

E o comportamento de fallback, documentado em [`base/mac/mac_util.h`](https://chromium.googlesource.com/chromium/src/+/main/base/mac/mac_util.h):

> "Opens the specified System Settings pane. **If the specified subpane does not exist on the release of macOS that is running, the parent pane will open instead.**"

Isso é o que torna a técnica segura de usar: se o anchor quebrar, o usuário cai em Privacidade e Segurança, não em erro.

### 6.2 Atenção: forma antiga vs. nova

A forma **antiga**, que aparece em quase todos os exemplos que circulam (inclusive em posts de developers nos fóruns da Apple, ex. [thread 738986](https://developer.apple.com/forums/thread/738986)):

```
x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
```

Ela usa o bundle ID do **prefPane legado** (`com.apple.preference.security`), pré-Ventura. O Chromium migrou deliberadamente para o bundle ID da **app extension** (`com.apple.settings.PrivacySecurity.extension`), explicando: *"In the Info.plist there is an `EXAppExtensionAttributes` dictionary with **legacy** identifiers, but given that those are explicitly named 'legacy', this code prefers to use the bundle IDs for the URLs it uses."*

**Usar a forma nova.** Ela é a testada em macOS 13/14/15/26 por código de produção do Chromium.

### 6.3 Status de suporte

`x-apple.systempreferences:` **não é documentado nem suportado pela Apple.** Quinn, em [thread 761314 "Supported URL Schemes"](https://developer.apple.com/forums/thread/761314): alguns URL schemes da Apple são documentados para uso de terceiros e podem ser usados; outros **não são documentados e seu uso é unsupported** — se você depende de detalhes de implementação não documentados, *"things might work, or they might not, and that state might change over time"*. O único caminho documentado para abrir Ajustes é `UIApplication.openSettingsURLString`, que **é iOS-only** — não existe equivalente documentado em macOS.

**Consequência de design:** tratar o deep-link como *conveniência*, nunca como o único caminho. Sempre mostrar, ao lado do botão, o caminho textual completo — "Ajustes do Sistema > Privacidade e Segurança > Acessibilidade" — que é o caminho oficial na página de suporte da Apple. Se o `NSWorkspace.open` falhar ou abrir o pane errado, o usuário ainda consegue chegar lá.

No Electron: `shell.openExternal('x-apple.systempreferences:...')`.

**[NÃO VERIFICADO] nesta máquina:** não executei `open "x-apple.systempreferences:..."` porque isso abriria os Ajustes do Sistema do usuário (proibido pela restrição desta pesquisa). A verificação é: rodar `open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"` em um macOS 15 e conferir se cai direto no pane de Acessibilidade e não na raiz de Privacidade e Segurança.

---

## 7. Recomendação

### 7.1 Configuração de build (fazer primeiro — errar aqui mata o processo)

`Info.plist` do app principal:

| Chave | Valor |
|---|---|
| `NSMicrophoneUsageDescription` | `"O <App> grava o áudio do seu microfone para transcrever sua fala em texto."` (frase ativa, específica, com ponto — conforme HIG) |
| `LSUIElement` | `true` (menu bar, sem Dock) |

`entitlements.plist` (Hardened Runtime, sem sandbox):

| Entitlement | Valor |
|---|---|
| `com.apple.security.device.audio-input` | `true` |

**Não** incluir: `NSAppleEventsUsageDescription`, `com.apple.security.automation.apple-events`, `com.apple.security.device.camera`, nem qualquer entitlement com valor `false` (a Apple pede para omitir os `false`).

**Assinatura:** identidade estável (Apple Development ou Developer ID), a mesma em dev e release, com `CFBundleIdentifier` fixo. Nunca ad-hoc (`--sign -`), nunca unsigned. Verificar após empacotar que os helpers do Electron herdam/carregam os entitlements: `codesign -d --entitlements :- <path>` em cada `.app` e helper.

### 7.2 Onboarding na primeira execução — 3 passos, sequencial, up front

Uma janela de onboarding (o único momento em que o app de menu bar mostra janela), com uma explicação de uma linha por passo e progresso visível. Cada passo faz polling de 1s (padrão do Chromium) e avança sozinho quando concedido.

**Passo 0 — Contexto (tela nossa, um botão "Continuar").**
Uma frase sobre o que o app faz e as duas permissões que virão. Conforme HIG: um único botão, sem opção de cancelar/fechar, botão rotulado "Continuar" (não "Permitir").

**Passo 1 — Microfone.**
1. `getMediaAccessStatus('microphone')`.
2. Se `not-determined` → `askForMediaAccess('microphone')` (prompt real do sistema; concede na hora).
3. Se `granted` → avança.
4. Se `denied` ou `restricted` → **não** chamar `askForMediaAccess` de novo (documentado: não abre alerta, resolve com o status existente). Mostrar: botão "Abrir Ajustes do Sistema" (`Privacy_Microphone`), o caminho textual, e o aviso de que **é necessário reiniciar o app** depois de conceder (documentado no Electron). Oferecer botão "Reiniciar o app" que faça `app.relaunch()` + `app.quit()`.

**Passo 2 — Acessibilidade.**
1. `isTrustedAccessibilityClient(false)`.
2. Se `true` → avança.
3. Se `false` → tela nossa explicando em uma frase *por que* (colar o texto transcrito no app em que você está trabalhando), com:
   - botão primário "Abrir Ajustes do Sistema" → `shell.openExternal('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility')`;
   - o caminho textual "Ajustes do Sistema > Privacidade e Segurança > Acessibilidade" visível ao lado (o deep-link é unsupported);
   - o nome exato do app como ele aparece na lista, para o usuário achar;
   - polling de 1s em `isTrustedAccessibilityClient(false)`, avançando automaticamente quando ligar.
4. Chamar `isTrustedAccessibilityClient(true)` (com prompt) é **opcional e provavelmente contraproducente**: o alerta do sistema não concede nada e some rápido; a tela própria é melhor. Se usado, usar *no lugar* da nossa tela, nunca somado a ela (HIG proíbe empilhar tela custom + alerta redundante).

**Passo 3 — Pronto.** Mostrar a hotkey configurada e como acionar. Encerrar o onboarding; o app vira ícone de menu bar.

**Por que up front e não lazy:** as duas permissões são as duas metades de um único fluxo — sem qualquer uma delas o app não faz nada. A HIG abre exceção exatamente para isso (*"unless the data or resource is required for your app to function"*). E o momento de uso é o pior momento possível para pedir: o app está em background, sem janela, com o usuário no meio de uma tarefa em outro app.

### 7.3 Verificação em runtime (todo acionamento, não só no boot)

Como não há notificação suportada de mudança de TCC e `CGEventPost` falha em silêncio:

**Ao acionar a hotkey, antes de abrir o microfone:**
- `getMediaAccessStatus('microphone') === 'granted'`? Se não → notificação/HUD "Acesso ao microfone revogado" + abrir a tela do Passo 1. Não gravar.

**Depois da transcrição, antes de escrever no pasteboard e injetar Cmd+V:**
- `isTrustedAccessibilityClient(false) === true`? Se não → **não perder o texto**. Deixá-lo disponível (colocar no pasteboard e avisar "texto copiado — cole com Cmd+V", ou mostrá-lo em uma janelinha) e oferecer o botão para os Ajustes. Este é o modo de degradação mais importante do app inteiro: falha de Acessibilidade **nunca** deve descartar uma transcrição.

**Item de menu permanente "Estado das permissões"** no menu da barra, mostrando as duas com estado atual e botão de deep-link em cada. Em um app sem janela, é o único lugar em que o usuário pode diagnosticar sozinho.

### 7.4 Keychain

- Ler a chave da Groq **uma vez, no boot**, e manter em memória. As chamadas síncronas de `safeStorage` bloqueiam a thread para coletar input do usuário; um prompt do Keychain no meio de um ditado seria péssimo.
- Preferir `decryptStringAsync` (a doc do Electron recomenda e avisa que a API síncrona pode ser depreciada).
- Se `safeStorage.isEncryptionAvailable()` for `false`, falhar com mensagem clara em vez de silenciosamente cair para plaintext.
- Assinatura estável (§ 7.1) é o que impede o re-prompt a cada atualização.

### 7.5 Pasteboard

Assumir que a restauração do pasteboard é a única parte do app exposta ao futuro alerta de privacidade de pasteboard (macOS 15.4+ / versões seguintes). Colocá-la atrás de uma preferência (default: **desligada**, ou ligada mas facilmente desligável) e, em macOS 15.4+, consultar `NSPasteboard.accessBehavior` antes de tentar a leitura de backup. Escrever no pasteboard não é afetado.

---

## 8. Lacunas

Itens que **não** consegui resolver com fonte primária, com o experimento que resolveria cada um:

1. **Default de `NSPasteboard.accessBehavior` em macOS 15.4+ sem o developer preview ligado.** A referência da API não declara o default e as release notes de macOS 15.4 não mencionam pasteboard. → Ler `NSPasteboard.general.accessBehavior` em uma máquina 15.4+ limpa e ver se retorna `.alwaysAllow` ou `.ask`.

2. **Comportamento de um `MediaStream` ativo quando o Microfone é revogado durante a captura.** Nem a Apple nem o Electron documentam. → Iniciar `getUserMedia`, revogar em Ajustes do Sistema com a captura rodando, observar eventos `ended`/`mute` na `MediaStreamTrack` e o conteúdo do buffer de áudio. (Não executado: exige alterar os Ajustes do usuário.)

3. **A notificação `com.apple.accessibility.api` é confiável?** Não está em nenhuma documentação da Apple. O Chromium não a usa — faz polling de 1s. → Registrar observador em `DistributedNotificationCenter` e alternar o toggle de Acessibilidade. (Não executado.) Recomendação atual: polling, não a notificação.

4. **As URLs `x-apple.systempreferences` funcionam nesta máquina (macOS 15)?** Testadas pelo Chromium em macOS 13/14/15/26, mas eu não as executei. → `open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"`. (Não executado: abriria os Ajustes do Sistema do usuário.)

5. **Anchor de Input Monitoring.** Não está no enum do Chromium; `Privacy_ListenEvent` é palpite por analogia. Irrelevante para o app atual.

6. **Requisito de `NSMicrophoneUsageDescription` afeta *qual* binário no Electron.** A Apple diz que frameworks e helpers herdam entitlements do host, mas o `Info.plist` do helper é um arquivo separado. → Inspecionar `codesign -d --entitlements :-` e o `Info.plist` de cada helper no `.app` empacotado e confirmar que a captura funciona a partir do processo que realmente abre o dispositivo.

7. **Existe alerta "Quit & Reopen" dos Ajustes do Sistema para Acessibilidade em macOS 15?** O Electron documenta a necessidade de restart para *microfone* após conceder pós-negação. Se há comportamento análogo para Acessibilidade (a confiança AX é cacheada no processo em execução?) não achei fonte primária. → Conceder Acessibilidade com o app rodando e ver se `isTrustedAccessibilityClient(false)` passa a `true` sem relaunch. (Não executado.) Mitigação de design: o polling do Passo 2 detecta ambos os casos; se após N segundos concedido-em-Ajustes o check continuar `false`, oferecer o botão "Reiniciar o app".

---

## 9. Fontes

**Apple — referência de API e conceitos**
- [CGEvent.post(tap:)](https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:))
- [CGEventTapLocation](https://developer.apple.com/documentation/coregraphics/cgeventtaplocation)
- [AXIsProcessTrustedWithOptions(_:)](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions)
- [AXError.apiDisabled](https://developer.apple.com/documentation/applicationservices/axerror/apidisabled)
- [IOHIDRequestAccess](https://developer.apple.com/documentation/iokit/3181574-iohidrequestaccess)
- [Requesting authorization to capture and save media](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
- [NSMicrophoneUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)
- [NSAppleEventsUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription)
- [Audio Input Entitlement (com.apple.security.device.audio-input)](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.device.audio-input)
- [Apple Events Entitlement (com.apple.security.automation.apple-events)](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.automation.apple-events)
- [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [NSPasteboard.accessBehavior](https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-86972) · [NSPasteboard.AccessBehavior](https://developer.apple.com/documentation/appkit/nspasteboard/accessbehavior-swift.enum)
- [macOS Sequoia 15.4 Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-15_4-release-notes)

**Apple — WWDC, technotes, HIG, suporte, DTS**
- [WWDC 2019 Session 701 — Advances in macOS Security](https://developer.apple.com/videos/play/wwdc2019/701/) *(fonte definitiva para Acessibilidade vs Input Monitoring)*
- [TN3127: Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) *(DR, TCC, ad-hoc/unsigned)*
- [TN2206: macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html) *(ACL de Keychain rastreado por DR)*
- [HIG — Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [Allow accessibility apps to access your Mac](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac)
- [Control access to input monitoring on Mac](https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac)
- [Forums 707177 — Quinn/DTS: TCC usa o DR para identificar builds](https://developer.apple.com/forums/thread/707177)
- [Forums 649163 — Quinn/DTS: revogação em macOS falha a API, não mata o processo](https://developer.apple.com/forums/thread/649163)
- [Forums 761314 — Quinn/DTS: URL schemes não documentados são unsupported](https://developer.apple.com/forums/thread/761314)

**Electron**
- [systemPreferences](https://www.electronjs.org/docs/latest/api/system-preferences)
- [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Code Signing § macOS APIs that require code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing)
- [`shell/browser/api/electron_api_system_preferences_mac.mm`](https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_system_preferences_mac.mm)

**Chromium**
- [`remoting/host/mac/permission_utils.mm`](https://chromium.googlesource.com/chromium/src/+/main/remoting/host/mac/permission_utils.mm) *(`CGEventPost` → `AXIsProcessTrusted`)*
- [`remoting/host/mac/permission_wizard.mm`](https://chromium.googlesource.com/chromium/src/+/main/remoting/host/mac/permission_wizard.mm) *(polling de 1s)*
- [`base/mac/mac_util.mm`](https://chromium.googlesource.com/chromium/src/+/main/base/mac/mac_util.mm) · [`base/mac/mac_util.h`](https://chromium.googlesource.com/chromium/src/+/main/base/mac/mac_util.h) *(URLs de deep-link testadas em macOS 13/14/15/26)*
- [`ui/base/cocoa/permissions_utils.mm`](https://chromium.googlesource.com/chromium/src/+/main/ui/base/cocoa/permissions_utils.mm)
