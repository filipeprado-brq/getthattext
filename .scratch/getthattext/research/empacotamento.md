# Empacotamento e execução (macOS 15 / arm64 / uso pessoal)

Pesquisa documental para o ticket [14 - Empacotamento e execução](../issues/14-empacotamento-e-execucao.md).

**Escopo e restrições assumidas como fechadas:** Electron, macOS 15 Sequoia, Apple Silicon (arm64) apenas, sem App Store, **sem notarização**, mas **com code signing** (porque `safeStorage`/Keychain reprompta a cada atualização se a assinatura não for estável). Um addon nativo Carbon para hotkey global (vendorizado ou `hotcakey@0.8.0`), possivelmente `robotjs@0.9.1`, binário `whisper-cli` como `extraResource`, modelo Whisper baixado no primeiro uso.

**Nada neste documento foi validado empiricamente na máquina do usuário.** Nenhum experimento foi executado contra a sessão de desktop (sem síntese de eventos, sem pasteboard, sem Accessibility API contra outros apps, sem abrir/fechar apps). As verificações feitas foram: leitura de docs oficiais, leitura de headers do SDK do Xcode instalado, `man codesign`, inspeção de tarballs publicados no npm, e requisições HTTP read-only ao registry do npm / GitHub raw / Hugging Face. Itens que só se resolvem empiricamente estão marcados **[NÃO VERIFICADO]** e listados em *Lacunas*.

Versões observadas no npm em 2026-08-26 (via `registry.npmjs.org`):

| pacote | `latest` |
|---|---|
| `electron` | 44.0.0 |
| `electron-builder` | 26.15.3 (tag `v26` = 26.15.7; `next` = 27.0.0-alpha.7) |
| `@electron-forge/cli` | 7.11.2 (`alpha` = 8.0.0-alpha.10) |
| `@electron/rebuild` | 4.2.0 |
| `robotjs` | 0.9.1 |
| `hotcakey` | 0.8.0 (publicado em 2021-10-23; só 4 versões existem) |

---

## 1. Ferramenta de empacotamento: electron-builder vs electron-forge

### O que cada um realmente é

`electron-builder` e `electron-forge` resolvem o mesmo problema por caminhos diferentes, mas **os dois delegam as partes difíceis para os mesmos pacotes do time do Electron**. Isso é verificável no `package.json` publicado do `app-builder-lib@26.15.3` (o core do electron-builder), que declara:

```
"@electron/asar": "3.4.1",
"@electron/notarize": "2.5.0",
"@electron/osx-sign": "1.3.3",
"@electron/rebuild": "^4.0.4",
"@electron/universal": "2.0.3",
"@electron/fuses": "^1.8.0",
```

Fonte: tarball `https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz`, arquivo `package/package.json`.

O Forge usa `@electron/packager` + `@electron/osx-sign` + `@electron/rebuild` + `@electron/notarize` da mesma forma, apenas orquestrados por *makers* e *plugins*. Documentação: <https://www.electronforge.io/guides/code-signing/code-signing-macos> ("Electron Forge uses the @electron/osx-sign tool to sign your macOS application"), <https://www.electronforge.io/config/plugins/auto-unpack-natives>.

Ou seja: **a escolha não muda quem assina nem quem faz rebuild**. Muda a ergonomia da configuração e o que vem ligado por padrão.

### Diferenças que importam para esta forma de projeto

| Necessidade | electron-builder 26 | electron-forge 7 |
|---|---|---|
| `asar` ligado | `asar` **default `true`** | `packagerConfig.asar` **default `false`**; precisa ligar explicitamente |
| Desempacotar `.node` do asar | **automático**: "Node modules, that must be unpacked, will be detected automatically, you don't need to explicitly set `asarUnpack`" | precisa do plugin `@electron-forge/plugin-auto-unpack-natives`: "This plugin will automatically add all native Node modules in your `node_modules` folder to the `asar.unpack`" |
| Rebuild nativo antes de empacotar | `npmRebuild` **default `true`** — "Whether to rebuild native dependencies before starting to package the app" | automático via `@electron/rebuild` ("Electron Forge integrates this automatically during development and distribution") |
| Binário externo → `Contents/Resources` | `extraResources` — "copy the file or directory with matching names directly into the app's resources directory (`Contents/Resources` for MacOS…)" | `packagerConfig.extraResource` — "One or more files to be copied directly into the app's `Contents/Resources` directory for macOS target platforms" |
| Hardened runtime | `mac.hardenedRuntime` **default `true`** | default vem de `@electron/osx-sign` |
| Assinar binário extra fora de `Contents` | `mac.binaries`: "Paths of any extra binaries that need to be signed" | `optionsForFile` / `binaries` do `@electron/osx-sign` |
| Assinar sem notarizar | documentado explicitamente (`identity`, `hardenedRuntime`, ad-hoc) | a doc oficial **afirma que não basta**: "From macOS 10.15 (Catalina) onwards, your application needs to be **both code signed and notarized**" |
| Entitlements | auto-detecta `build/entitlements.mac.plist` / `build/entitlements.mac.inherit.plist` | defaults do `@electron/osx-sign` |

Fontes: typings publicadas em `app-builder-lib@26.15.3` (`package/out/options/PlatformSpecificBuildOptions.d.ts`, `package/out/options/macOptions.d.ts`, `package/out/configuration.d.ts`), <https://www.electron.build/docs/mac/>, <https://www.electronforge.io/config/plugins/auto-unpack-natives>, <https://electron.github.io/packager/main/interfaces/Options.html>, <https://www.electronforge.io/guides/code-signing/code-signing-macos>.

### Recomendação: **electron-builder**

Três motivos concretos, nessa ordem:

1. **Ad-hoc e "assinado sem notarizar" são cenários de primeira classe na doc do electron-builder e não na do Forge.** O JSDoc de `mac.identity` no pacote publicado descreve literalmente os três estados (não-setado / `null` / `"-"`) e o efeito colateral do hardened runtime com ad-hoc. O Forge, na página oficial de code signing, trata "signed but not notarized" como não-suportado no macOS moderno. Para um projeto que decidiu não notarizar, é melhor usar a ferramenta cuja documentação cobre o caminho escolhido.
2. **Menos configuração para a forma "asar + addon nativo + binário externo".** `asar: true` e a detecção automática de módulos nativos para `asarUnpack` já são o default; no Forge você liga o asar e adiciona um plugin. Menos superfície para errar.
3. **`mac.binaries` e `signIgnore` dão controle direto sobre a assinatura do `whisper-cli`** sem escrever um `optionsForFile` em JS.

Contraponto honesto: o Forge é o caminho "oficial" do time do Electron e tem melhor integração com `@electron/fuses` e dev-server. Se o projeto já tivesse Forge, migrar não valeria a pena. Partindo de zero, com esta forma, electron-builder tem menos atrito.

**Atenção à versão:** a documentação em <https://www.electron.build/docs/mac/> já descreve a v27, onde *todas* as opções de assinatura macOS passam a viver dentro de um objeto único `mac.sign` (`sign.identity`, `sign.hardenedRuntime`, …). Na v26 (a `latest` hoje) as opções são **planas** em `mac` (`mac.identity`, `mac.hardenedRuntime`, `mac.entitlements`), como confirmam as typings do `app-builder-lib@26.15.3`. Fixe a major no `package.json` e leia a doc da versão correspondente.

---

## 2. Addons nativos: rebuild, prebuild, ABI, asar

### 2.1 Por que o usuário final nunca roda `node-gyp`

A resposta é mais simples do que parece e vale dizer explicitamente: **o usuário final não roda `npm install`**. Ele recebe um `.app` (dentro de um `.dmg`/`.zip`) que já contém o `.node` compilado. `node-gyp` só roda em duas situações: no seu `npm install` de desenvolvimento e no job de CI que produz o bundle. Nenhuma delas está na máquina do usuário.

O que precisa ser garantido é que o `.node` **dentro do bundle** seja o certo: compilado para `darwin-arm64` e carregável pela ABI do Electron que está no bundle.

### 2.2 `@electron/rebuild` no CI

`@electron/rebuild` "rebuilds native Node.js modules against the version of Node.js that your Electron project is using" (<https://github.com/electron/rebuild>). Flags relevantes: `--version`/`-v` (versão do Electron), `--arch`/`-a` (arquitetura alvo — necessário para cross-compile), `--force`/`-f`, `--which-module`/`-w`, `--types`/`-t`.

No electron-builder isso é **implícito**: `npmRebuild` tem default `true` e `@electron/rebuild` é dependência direta do `app-builder-lib`. Existem duas opções de escape documentadas nas typings:

- `buildDependenciesFromSource` — default `false` ("Whether to build the application native dependencies from source"). Deixe `false`: com `false`, módulos que publicam prebuilds usam o prebuild.
- `nodeGypRebuild` — força `node-gyp rebuild`. Não use.

Fluxo de CI recomendado (runner macOS arm64, para não cross-compilar nada):

```
1. npm ci                       # compila/baixa .node para o Node do runner
2. npx @electron/rebuild -v <electronVersion> -a arm64
                                # recompila para a ABI do Electron
3. build whisper.cpp na tag fixada  -> whisper-cli
4. npx electron-builder --mac --arm64  (npmRebuild=true é redundante mas inofensivo)
5. codesign + verify + empacotar dmg/zip
```

Rodar o `@electron/rebuild` explicitamente antes do `electron-builder` deixa a falha aparecer num step próprio, com log próprio, em vez de dentro do packager. Barato e melhora o diagnóstico.

### 2.3 ABI: Node-API resolve isso, ABI bruta não

Existem dois regimes:

**Regime A — `NODE_MODULE_VERSION` (ABI do V8/Node).** O `.node` precisa casar com o número de ABI do runtime. Do registry oficial `electron/node-abi` (`abi_registry.json`):

```
electron 40.x -> abi 143
electron 41.x -> abi 145
electron 42.x -> abi 146
electron 43.x -> abi 148
electron 44.x -> abi 149
```

Fonte: <https://raw.githubusercontent.com/electron/node-abi/main/abi_registry.json>. Nesse regime, **cada bump de major do Electron exige recompilar**, e a doc do Electron confirma o motivo: "Electron has a different application binary interface (ABI) from a given Node.js binary" (<https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>).

**Regime B — Node-API.** A doc do Node é explícita: "This API will be Application Binary Interface (ABI) stable across versions of Node.js. It is intended to insulate addons from changes in the underlying JavaScript engine and allow modules compiled for one major version to run on later major versions of Node.js without recompilation" (<https://nodejs.org/api/n-api.html>). É por isso que um `.node` Node-API atravessa upgrades de Electron sem recompilar.

**Os dois candidatos deste projeto estão no regime B:**

- `hotcakey@0.8.0`: `dependencies` = `{ bindings: ^1.5.0, node-addon-api: ^4.2.0, node-gyp: ^8.1.0 }`, `gypfile: true`. `node-addon-api` ⇒ Node-API. Mas **não publica prebuilds** — `gypfile: true` e nenhuma pasta `prebuilds/`.
- `robotjs@0.9.1`: `dependencies` = `{ node-addon-api: ^4.2.0, node-gyp-build: ^4.8.4 }`, `scripts.install = "node-gyp-build"`, `scripts["build:prebuild"] = "prebuildify --napi --name node.napi --strip"`, e `binding.gyp` contém `'defines': ['NAPI_VERSION=3']`. O tarball publicado **contém de fato**:

```
package/prebuilds/darwin-arm64/node.napi.node
package/prebuilds/darwin-x64/node.napi.node
package/prebuilds/linux-arm64/node.napi.glibc.node
package/prebuilds/linux-x64/node.napi.glibc.node
package/prebuilds/win32-arm64/node.napi.node
package/prebuilds/win32-x64/node.napi.node
```

Fonte: `tar tzf` do tarball `robotjs-0.9.1.tgz` obtido do registry. O nome `node.napi.node` (sem sufixo de ABI) é a convenção do `prebuildify` para "binário Node-API, serve para qualquer runtime". Isso **sustenta a alegação de "no rebuild needed for Electron"** — `node-gyp-build` encontra `prebuilds/darwin-arm64/node.napi.node` no `require` e nunca invoca o `node-gyp`. Node-API v3 é um piso muito baixo, suportado por qualquer Electron moderno.

**Consequência prática para o addon do hotkey:** adote o mesmo padrão do robotjs no seu código vendorizado — `prebuildify --napi` no CI, `node-gyp-build` como `install` script, `#define NAPI_VERSION` explícito no `binding.gyp`. Com isso o mesmo `.node` funciona nos testes rodando sob Node puro e no app rodando sob Electron, e um upgrade de Electron não pede recompilação. Se você **depender** do `hotcakey@0.8.0`, ele não tem prebuild e o `@electron/rebuild` vai compilá-lo no CI a cada build — funciona, mas você fica preso a um pacote sem manutenção desde 2021 e com `node-gyp: ^8` no dependency tree. Vendorizar é a escolha melhor aqui, e o custo (≈16 KB de C++) é menor que o custo de um fork emergencial.

### 2.4 O que o `asar` faz com módulos nativos e com o binário

Da doc oficial do Electron (<https://www.electronjs.org/docs/latest/tutorial/asar-archives>):

- O arquivo é **read-only**: "The archives can not be modified so all Node APIs that can modify files will not work with ASAR archives."
- Diretórios dentro do arquivo não podem ser `cwd`, porque não existem no filesystem real.
- Carregar módulo nativo via `process.dlopen` é uma das APIs que **exige extração para um local temporário**. Foi justamente esse custo que motivou a opção `--unpack` "specifically for native shared libraries to avoid repeated extraction".
- Executar binário de dentro do asar: **só `child_process.execFile` funciona**. "`exec` and `spawn` methods cannot reliably determine whether shell commands reference archived binaries".
- Desempacotar produz uma pasta irmã `app.asar.unpacked` que "ships alongside the archive".

Traduzindo para as decisões deste projeto:

- **`.node` do addon**: precisa ficar em `app.asar.unpacked`. No electron-builder isso é automático ("Node modules, that must be unpacked, will be detected automatically"). Verifique no artefato final; se falhar, `asarUnpack: ["**/*.node"]`.
- **`whisper-cli`**: **não** coloque dentro do asar. Use `extraResources`, que copia direto para `Contents/Resources`. Dois motivos: (a) você quer `spawn` com streaming de stdout, não `execFile`, e `spawn` não funciona para binário dentro do asar; (b) um binário em `Contents/Resources` é um Mach-O normal no filesystem, que o `codesign` e o `dyld` tratam sem nenhuma mágica. O caminho em runtime é `path.join(process.resourcesPath, 'bin', 'whisper-cli')` — `process.resourcesPath` é documentado como "A `string` representing the path to the resources directory" (<https://www.electronjs.org/docs/latest/api/process>).
- **Modelo Whisper**: nem asar nem `extraResources` — vai para `userData` (seção 6).

### 2.5 Assinatura dos artefatos nativos

O `@electron/osx-sign@1.3.3` (usado por builder e Forge) **caminha por todo o `Contents/` do bundle** e assina cada arquivo detectado como binário, antes de selar o bundle:

```js
const discovered = await walk(getAppContentsPath(opts));
if (opts.binaries) discovered.push(...opts.binaries);
...
/**
 * Sign from the inside out: codesign requires nested code to be signed before the code
 * that contains it is sealed.
 */
const children = sortForSigning(discovered);
```

e o `walk` classifica arquivos com `getFilePathIfBinary` → `isBinaryFile`. Fonte: tarball `@electron/osx-sign@1.3.3`, `package/dist/sign.js` e `package/dist/util.js`.

Consequência: **o `.node` em `app.asar.unpacked` e o `whisper-cli` em `Contents/Resources` são assinados automaticamente**, porque estão sob `Contents/`. A opção `mac.binaries` ("Paths of any extra binaries that need to be signed") só é necessária para código *fora* do bundle. Isso importa porque com hardened runtime a *library validation* exige que bibliotecas carregadas sejam assinadas pela Apple ou pelo mesmo Team ID do executável principal (ver 4.2) — assinar tudo com a mesma identidade satisfaz isso naturalmente.

---

## 3. Assinatura sem notarização: o mínimo que funciona

Esta é a seção mais importante do ticket, porque a resposta é contra-intuitiva: **ad-hoc signing é suficiente para o app *rodar* e insuficiente para o app *lembrar* das permissões.**

### 3.1 (a) O mínimo para o macOS 15 *executar* o app: ad-hoc basta

O Apple Platform Security é explícito sobre Apple Silicon:

> "A Mac with Apple silicon doesn't permit native arm64 code to execute unless a valid signature is attached. This signature can be as simple as an ad hoc code signature (`cf.codesign(1)`) that doesn't bear any actual identity from the secret half of an asymmetric key pair."

> "For binary compatibility, translated x86_64 code is permitted to execute through Rosetta with no signature information at all."

Fonte: <https://support.apple.com/guide/security/rosetta-2-on-a-mac-with-apple-silicon-secebb113be1/web>

Ou seja, num alvo arm64-only, **assinar não é opcional** — código arm64 sem assinatura nenhuma não executa. Mas o piso é ad-hoc.

Separadamente, existe o Gatekeeper, que é outra coisa. Gatekeeper "verifies that the software is from an identified developer, is notarized by Apple to be free of known malicious content, and hasn't been altered" (<https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web>). Um app não notarizado que chegou na máquina em estado de quarentena (download por navegador, AirDrop) é bloqueado, e o caminho do usuário no macOS 15 é System Settings → Privacy & Security → **Open Anyway** → confirmar no prompt que reaparece; feito isso "The app is now saved as an exception to your security settings" (<https://support.apple.com/en-us/102445>). Note que a página oficial descreve **apenas** o fluxo por System Settings — não menciona Control-click → Open. Para uso pessoal isso é um clique único por versão instalada, não um bloqueio.

### 3.2 (b) O mínimo para uma identidade **estável**: ad-hoc NÃO serve

Aqui a Apple documenta o mecanismo com precisão, na TN3127 (<https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements>).

Primeiro, o conceito. O **designated requirement (DR)** é como o código se identifica:

> "Most code has a designated requirement (DR) which is how the code identifies itself: It's the code's way of saying 'If you see me again, here's how you tell it's really me.'"

Depois, o mecanismo exato de TCC:

> "Imagine you have an app that accesses the microphone. At that point macOS prompts the user to authorize that. A few days later your app's software update mechanism runs and replaces version 1.2 with version 1.3. […] How can macOS tell that version 1.3 of your app is the 'same code' as version 1.2? macOS solves this problem by recording your app's DR in its database of apps authorized to access the microphone. Each time your app tries to access the microphone, macOS checks that this version of the app satisfies the original DR."

E então a frase que decide a questão do ad-hoc:

> "Unsigned code has no DR. **Ad hoc signed code, called Sign to Run Locally by Xcode, has a DR but it's tied to that specific version of the code. In both cases macOS can't reliably track the identity of the code.** […] If you tweak the code and run it again, macOS repeats that prompt. Without a DR, macOS can't track this authorization across versions of your app."

Isso é corroborado pelo `man codesign` do sistema instalado:

> "If identity is the single letter '-' (dash), ad-hoc signing is performed. Ad-hoc signing does not use an identity at all, and **identifies exactly one instance of code**. Significant restrictions apply to the use of ad-hoc signed code; consult documentation before using this."

Ao contrário, com uma identidade real o `codesign` aplica um DR default projetado exatamente para sobreviver a updates:

> "When you sign code with `codesign`, it applies a default designated requirement based on the code signing identity you supply. […] These default DRs strike a balance between generality and specificity. They ensure that: **A privilege, like microphone access, acquired by an existing version of your app is still available to a new version.** Other teams can't sign an app that impersonates your app."

**Resposta direta à pergunta do ticket:** não. Uma assinatura ad-hoc **não** dá identidade estável o bastante nem para TCC (Accessibility, microfone) nem para o Keychain, porque o DR ad-hoc é atrelado a *aquele build específico*. Cada rebuild = novo `cdhash` = novo DR = TCC não reconhece o app = novo prompt de Accessibility e novo prompt de autorização do Keychain. Esse é exatamente o sintoma que motivou a decisão de assinar.

Que o TCC guarde o DR (e não só o bundle ID) também aparece na documentação de MDM do payload PPPC: a entrada `Identity` de um serviço de privacidade tem as chaves `Identifier` ("The bundle ID or installation path of the binary"), `IdentifierType` ("Application bundles must be identified by bundle ID") e `CodeRequirement`, cuja instrução é literalmente:

> "Obtain this value by running `codesign -display -r -`."

Fonte: <https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary/identity>. É o DR, dumpado do binário. O payload também documenta o serviço `Accessibility` — "Specifies the policies for the app via the Accessibility subsystem" — no mesmo esquema de identificação (<https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary>).

Nota lateral útil: "Helper tools embedded within an application bundle automatically inherit the permissions of their enclosing app bundle" — ou seja, o `whisper-cli` em `Contents/Resources` herda as permissões do app.

Sobre o Keychain, a própria TN3127 abre listando o sintoma no seu resumo de motivação:

> "You might find that the keychain presents unexpected authorization alerts when you deploy your app through a new channel, like TestFlight."

E a doc do Electron fecha o argumento pelo lado do `safeStorage`:

> "On macOS, your app should be code signed for `safeStorage` to behave consistently." / "Encryption keys are stored for your app in Keychain Access in a way that prevents other applications from loading them without user override."

Fonte: <https://www.electronjs.org/docs/latest/api/safe-storage>. O item do Keychain que o Electron usa é nomeado a partir do nome do app — verificável no código do Electron 44:

```cpp
#if BUILDFLAG(IS_MAC)
  KeychainPassword::GetServiceName() = app_name + " Safe Storage";
  KeychainPassword::GetAccountName() = app_name;
#endif
```

Fonte: <https://raw.githubusercontent.com/electron/electron/v44.0.0/shell/browser/electron_browser_main_parts.cc> (linhas ~596-599). Consequência operacional: **não mude o `name`/`productName` do app depois de gravar segredos**, senão o `safeStorage` procura um item de Keychain que não existe e você perde o material cifrado.

### 3.3 Ad-hoc vs Apple Development gratuito vs Developer ID pago

| | roda no macOS 15 arm64 | Gatekeeper em download com quarentena | DR estável entre rebuilds | Aparece na lista de Accessibility | Custo |
|---|---|---|---|---|---|
| **Sem assinatura** | **Não** (arm64 exige assinatura) | — | não tem DR | — | 0 |
| **Ad-hoc (`codesign -s -`)** | Sim | bloqueado → Open Anyway | **Não** — DR atrelado a um build | Sim, mas o grant não sobrevive ao rebuild | 0 |
| **Apple Development** (Apple ID grátis, "personal team") | Sim | bloqueado → Open Anyway | **Sim** entre versões do app | Sim | 0 |
| **Developer ID Application** (Developer Program, anual) | Sim | com notarização, sem prompt; sem notarização, bloqueado → Open Anyway | **Sim**, e amarrado ao Team ID | Sim | pago |

O que muda entre Apple Development e Developer ID é a **forma do DR**, e isso tem consequência prática. A TN3127 mostra o DR de um app assinado com Apple Development:

```
designated =>
identifier "com.example.apple-samplecode.AppWithTool"
and anchor apple generic
and certificate leaf[subject.CN] = "Apple Development: …"
and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */
```

Já o de Developer ID checa o **Team ID** (`certificate leaf[subject.OU] = SKMME9E2Y8`) em vez do CN da folha. A TN3127 também avisa que os dois não são intercambiáveis:

> "This Apple Development DR is very different from the DR used by Developer ID and Mac App Store apps. […] if you run an Apple Development variant of your app and use that to access the microphone, and then run a Developer ID or Mac App Store variant of your app, the system will display a prompt when the new app accesses the microphone."

**Leitura para este projeto:** um certificado **Apple Development gratuito é suficiente** para o objetivo declarado (identidade estável entre rebuilds, Keychain sem reprompt, grant de Accessibility persistente), e é grátis. O risco a monitorar é que o DR do Apple Development depende do **CN da folha** — logo, uma troca/renovação de certificado que altere o CN muda o DR e derruba os grants. Se um dia migrar Apple Development → Developer ID, espere **um** ciclo de reprompt (Accessibility + Keychain) e planeje isso como parte do release.

Notarização não entra em nenhuma dessas linhas por escolha do projeto, e a Apple é clara sobre o que ela exigiria: certificado Developer ID ("Don't use a Mac Distribution, ad hoc, Apple Developer, or local development certificate"), hardened runtime e secure timestamp (<https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>). Um Apple Development cert é *estruturalmente* inelegível para notarização — o que é consistente com a decisão de não notarizar.

### 3.4 (c) Aparecer corretamente na lista de Accessibility

Isso não depende do tipo de certificado; depende de o app **pedir**. O header do SDK instalado (`AXUIElement.h`, MacOSX.sdk) documenta:

```c
/*!
 @function AXIsProcessTrustedWithOptions
 @abstract Returns whether the current process is a trusted accessibility client.
 @param options ... KEY: kAXTrustedCheckOptionPrompt
   VALUE: ACFBooleanRef indicating whether the user will be informed if the current
   process is untrusted. This could be used, for example, on application startup to
   always warn a user if accessibility is not enabled for the current process.
   Prompting occurs asynchronously and does not affect the return value.
 */
extern Boolean AXIsProcessTrustedWithOptions (CFDictionaryRef __nullable options) CF_AVAILABLE_MAC(10_9);
```

E para o caso específico de *sintetizar* eventos, existem APIs mais precisas desde o macOS 10.15, documentadas em `CGEvent.h` do SDK:

```c
/* Checks whether the current process already has event listening access */
CG_EXTERN bool CGPreflightListenEventAccess(void) API_AVAILABLE(macos(10.15));
/* Requests event listening access if absent, potentially prompting */
CG_EXTERN bool CGRequestListenEventAccess(void)   API_AVAILABLE(macos(10.15));
/* Checks whether the current process already has event synthesizing access */
CG_EXTERN bool CGPreflightPostEventAccess(void)   API_AVAILABLE(macos(10.15));
/* Requests event synthesizing access if absent, potentially prompting */
CG_EXTERN bool CGRequestPostEventAccess(void)     API_AVAILABLE(macos(10.15));
```

Fonte: `/Applications/Xcode.app/.../MacOSX.sdk/System/Library/Frameworks/CoreGraphics.framework/Versions/A/Headers/CGEvent.h`, linhas 398-408.

`CGPreflightPostEventAccess()` / `CGRequestPostEventAccess()` são a checagem e o pedido corretos para **postar** CGEvents (é isso que o Cmd+V sintético faz). O par `Listen*` é para *receber* eventos de outros processos — o payload PPPC descreve esse serviço como `ListenEvent`: "Allows the application to use CoreGraphics and HID APIs to listen to (receive) CGEvents and HID events from all processes. A profile can't grant access to these events; it can only deny it."

Recomendação de UX: chame `CGPreflightPostEventAccess()` no boot (não prompta) e mostre estado na UI; chame `CGRequestPostEventAccess()` só quando o usuário acionar um botão "Conceder permissão". `AXIsProcessTrustedWithOptions` com `kAXTrustedCheckOptionPrompt: true` é a alternativa quando você também vai *ler* a árvore de acessibilidade.

O que faz o app aparecer com nome e ícone corretos na lista é ele ser um bundle `.app` válido, com `CFBundleIdentifier` e `CFBundleName`, assinado — não o tipo de certificado.

---

## 4. Hardened runtime e entitlements

### 4.1 Hardened runtime é obrigatório?

**Não, se você não notariza.** A Apple condiciona a exigência à notarização:

> "To upload a macOS app to be notarized, you must enable the Hardened Runtime capability."

E descreve o efeito geral: "The Hardened Runtime doesn't affect the operation of most apps, but it does disallow certain less common capabilities, like just-in-time (JIT) compilation. If your app relies on a capability that the Hardened Runtime restricts, add an entitlement to disable an individual protection. **Make sure to use only the entitlements that are absolutely necessary for your app's functionality.**"

Dois detalhes importantes da mesma página: "You add entitlements only to executables. Shared libraries, frameworks, and in-process plug-ins inherit the entitlements of their host executable." e "The default value of these Boolean entitlements is `false`. When Xcode signs your code, it includes an entitlement only if the value is `true`. If you're manually signing code, follow this convention […] Don't include an entitlement if the value is `false`."

Fonte: <https://developer.apple.com/documentation/security/hardened-runtime>

Mesmo sendo opcional, **recomendo mantê-lo ligado** (que é o default do electron-builder, `hardenedRuntime: true`): ele é um endurecimento real de baixo custo quando você já assina com identidade válida, e mantém o build compatível com uma futura decisão de notarizar.

### 4.2 Ad-hoc + hardened runtime = armadilha

Se você optar por ad-hoc apesar da seção 3, leia o JSDoc do próprio electron-builder em `mac.hardenedRuntime`:

> "When using ad-hoc signing (`identity: "-"`), hardened runtime enforces library validation which will reject pre-signed Electron frameworks that carry a different Team ID. To resolve this either set `hardenedRuntime: false` or add the `com.apple.security.cs.disable-library-validation` entitlement to your entitlements file."

E o entitlement em questão, pela doc da Apple: "The hardened-runtime enables library validation by default. This security-hardening feature prevents a program from loading frameworks, plug-ins, or libraries unless they're either signed by Apple or signed with the same Team ID as the main executable." Com o aviso: "Because library validation is such an important security-hardening feature, Gatekeeper runs extra security checks on programs that have it disabled." (<https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation>)

Com um certificado Apple Development real, o electron-builder reassina o Electron Framework e o `.node` com a *sua* identidade, então a library validation é satisfeita e **você não precisa desse entitlement**. Mais um argumento contra o ad-hoc.

### 4.3 Entitlements que um app Electron tipicamente precisa

O `@electron/osx-sign@1.3.3` publica os defaults que ele aplica. Extraídos do tarball (`package/entitlements/`):

`default.darwin.plist` (processo principal):
```xml
com.apple.security.cs.allow-jit                        = true
com.apple.security.device.audio-input                  = true
com.apple.security.device.bluetooth                    = true
com.apple.security.device.camera                       = true
com.apple.security.device.print                        = true
com.apple.security.device.usb                          = true
com.apple.security.personal-information.location       = true
com.apple.security.personal-information.photos-library = true
```

`default.darwin.renderer.plist` e `default.darwin.gpu.plist`: apenas `com.apple.security.cs.allow-jit = true`.

`default.darwin.plugin.plist`: `allow-jit` + `allow-unsigned-executable-memory` + `disable-library-validation`.

Análise por entitlement, com a doc da Apple:

- **`com.apple.security.cs.allow-jit`** — **necessário.** "A Boolean value that indicates whether the app may create writable and executable memory using the `MAP_JIT` flag. […] Examples include: The fast-path of the JavaScriptCore framework". É V8. Note também o aviso das typings do electron-builder: "your app may crash if the right entitlements are not set like `com.apple.security.cs.allow-jit` for example on arm64 builds with Electron 20+". (<https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit>)
- **`com.apple.security.device.audio-input`** — **necessário.** "A Boolean value that indicates whether the app may record audio using the built-in microphone and access audio input using Core Audio. […] To add this entitlement to your app, first enable the Hardened Runtime capability in Xcode, and then under Resource Access, select Audio Input." (<https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input>)
  - **Não confunda** com `com.apple.security.device.microphone` — esse é o entitlement do **App Sandbox** ("To add this entitlement to your app, enable the App Sandbox capability in Xcode and under Hardware select Audio Input"). Como o app não será sandboxed (seção 5), o correto é `device.audio-input`.
- **`com.apple.security.cs.allow-unsigned-executable-memory`** — **não incluir.** A Apple: "In rare cases, an app might need to override or patch C code, use the long-deprecated `NSCreateObjectFileImageFromMemory` […] Including this entitlement exposes your app to common vulnerabilities in memory-unsafe code languages." V8 moderno usa `MAP_JIT`, coberto por `allow-jit`.
- **`com.apple.security.cs.disable-library-validation`** — **não incluir** (com identidade real; ver 4.2).
- **`com.apple.security.cs.allow-dyld-environment-variables`** — não incluir.
- **`device.camera` / `bluetooth` / `usb` / `print` / `location` / `photos-library`** — **remover.** Contrariam a instrução da Apple ("only the entitlements that are absolutely necessary") e cada um desses pode fazer o app aparecer em listas de privacidade onde ele não tem razão de estar. Escreva seu próprio `build/entitlements.mac.plist` em vez de aceitar os defaults.

**Entitlements recomendados** — `build/entitlements.mac.plist`:
```xml
com.apple.security.cs.allow-jit       = true
com.apple.security.device.audio-input = true
```
`build/entitlements.mac.inherit.plist` (helpers): `com.apple.security.cs.allow-jit = true` + `com.apple.security.inherit`.

**Info.plist**: `NSMicrophoneUsageDescription` é **obrigatório** — "This key is required if your app uses APIs that access the device's microphone" (<https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription>). No electron-builder, via `mac.extendInfo`. Para um app só de menu bar, adicione também `LSUIElement` — "A Boolean value indicating whether the app is an agent app that runs in the background and doesn't appear in the Dock" (<https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement>).

Não existe entitlement para Accessibility: é puramente TCC, concedido pelo usuário.

---

## 5. Sandbox: confirmado, é incompatível

A documentação atual da Apple lista explicitamente, sob o título **"Review functionality that is incompatible with App Sandbox"**:

> "Certain activities are forbidden by the operating system when an app runs in a sandbox. Identify whether your app performs these, and remove them or find alternative ways to provide the same functionality. The restricted activities are:
> - Use of authorization-services API.
> - **Use of accessibility APIs in assistive apps.**
> - **Sending Apple Events to arbitrary apps.**
> - Sending userInfo dictionaries in distributed notifications to other tasks.
> - Loading kernel extensions.
> - **Simulating user input in Open and Save dialogs.**
> - Accessing or modifying preferences in other apps.
> - Configuring network settings.
> - Terminating other running apps."

Fonte: <https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox>

**Consequência, dita sem rodeios:** este app **não pode ser sandboxed**. Ele usa Accessibility API para leitura e posta CGEvents em outros apps — as duas primeiras e a sexta linhas da lista. Portanto:

1. **Nunca** declare `com.apple.security.app-sandbox` no entitlements. (A Apple: "To distribute a macOS app through the Mac App Store, you must enable the App Sandbox capability" — <https://developer.apple.com/documentation/security/app-sandbox>.)
2. Logo, **App Store está definitivamente fora** — não por escolha de distribuição, mas por incompatibilidade técnica. Isso reforça uma decisão já tomada, e é bom que esteja registrado como *impossibilidade*, não como preferência: nenhuma reavaliação futura de "e se publicássemos na App Store?" pode reverter isso sem remover a funcionalidade central do produto.
3. No electron-builder, o alvo `mas` fica fora; use `dmg` e/ou `zip`.
4. Como o app não é sandboxed, ele lê e escreve em `~/Library/Application Support/<app>` diretamente, sem container.

---

## 6. Download do modelo Whisper

### 6.1 Onde

`app.getPath('userData')` — "The directory for storing your app's configuration files, which by default is the `appData` directory appended with your app's name", e no macOS `appData` é `~/Library/Application Support` (<https://www.electronjs.org/docs/latest/api/app>). Ou seja:

```
~/Library/Application Support/<productName>/models/ggml-large-v3-turbo-q5_0.bin
```

**Não** use `app.getPath('cache')` (`~/Library/Caches`): o sistema pode limpar Caches, e recomeçar um download de 547 MiB por conta de uma limpeza de disco é um péssimo modo de falha. Application Support é o lugar certo para dado grande, recriável, mas caro de recriar.

### 6.2 A Hugging Face publica checksums? Sim — SHA-256, por três caminhos

Verificado por requisições read-only:

**(1) Ponteiro Git LFS** em `https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-large-v3-turbo-q5_0.bin`:
```
version https://git-lfs.github.com/spec/v1
oid sha256:394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2
size 574041195
```

**(2) API do Hub** — `https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true` devolve, por arquivo, `lfs.sha256` e `lfs.size`:

| arquivo | bytes | sha256 |
|---|---|---|
| `ggml-large-v3-turbo-q5_0.bin` | 574 041 195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |
| `ggml-large-v3-turbo-q8_0.bin` | 874 188 075 | `317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1` |
| `ggml-large-v3-turbo.bin` | 1 624 555 275 | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` |

574 041 195 bytes = 547,4 MiB, o que confere com o número do ticket.

**(3) Header HTTP** — o redirect do endpoint `/resolve/` carrega `x-linked-etag: "394221709cd5ad…"` (o mesmo SHA-256) e `x-linked-size: 574041195`.

**Importante:** o script oficial `models/download-ggml-model.sh` do whisper.cpp **não verifica checksum nenhum**. Ele faz `curl -L --fail --retry 5 …` e considera sucesso qualquer exit code 0 (fonte: <https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh>). Você deve verificar por conta própria. É trivial e vale muito: um `.bin` truncado faz o `whisper-cli` falhar de formas confusas.

### 6.3 Fixe a revisão, não `main`

O endpoint `/resolve/main/…` aponta para o commit atual do repo. Melhor fixar:

```
https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin
```

Verificado: esse URL com commit SHA funciona (retorna 302 → 206 com o range pedido). Assim o SHA-256 embutido no app é sempre o do arquivo que ele vai baixar, mesmo que o repo receba novos commits.

### 6.4 Download interrompido / retomado

**Retomada por HTTP Range funciona.** Verificado com uma requisição de 1 KiB:

```
HTTP/2 206
accept-ranges: bytes
content-range: bytes 0-1023/574041195
content-length: 1024
```

Desenho recomendado:

1. Baixar para `models/ggml-large-v3-turbo-q5_0.bin.part` no **mesmo volume** do destino final.
2. Ao retomar, `stat` do `.part` → `Range: bytes=<size>-`. Se o servidor responder `200` em vez de `206`, ele ignorou o Range: descarte o parcial e recomece.
3. Guardar ao lado um `.part.meta` com `{ url, revision, expectedSha256, expectedSize, bytesDownloaded }`. Se `expectedSha256` no meta divergir do compilado no app (você trocou de modelo/revisão numa atualização), apague o `.part` e recomece.
4. Ao completar: conferir `size === 574041195`, calcular SHA-256 em streaming e comparar com o valor esperado. Só então `fs.rename(.part → .bin)` — rename no mesmo volume é atômico, então nunca existe um `.bin` de tamanho certo e conteúdo errado.
5. Em falha de checksum: apagar tudo e recomeçar de zero (não retomar — um checksum ruim significa que você não sabe qual parte está corrompida).

Sobre o rename, vale notar que a Apple recomenda o mesmo padrão para **atualizar arquivos que contêm código assinado** — e isso se aplica se algum dia você atualizar o `whisper-cli` fora do bundle:

> "macOS caches information about the code's signature in the kernel. It doesn't flush that cache when you modify the file's contents. Modifying the file in place yields a mismatch between the file's contents and the in-kernel cache, which can cause a hard-to-reproduce code-signing crash. […] To update a file that contains signed code without risking this crash, write the updated code to a temporary file and replace the existing file with that temporary one"

Fonte: <https://developer.apple.com/documentation/security/updating-mac-software>. O modelo `.bin` não é código assinado, mas a mesma disciplina (escrever novo + rename, nunca sobrescrever in-place) é o hábito certo e obrigatório para o binário.

### 6.5 App aberto antes do download terminar

Trate "modelo pronto" como estado explícito de uma máquina de estados, não como suposição:

```
NO_MODEL → DOWNLOADING → VERIFYING → READY
                ↓             ↓
              FAILED ← ← ← ← ←
```

- No boot, resolva o estado por I/O: existe `.bin` verificado? existe `.part`? Persista o resultado da verificação (ex.: `models/.verified` com o sha) para não gastar segundos re-hasheando 547 MiB a cada início.
- O ícone da menu bar reflete o estado. O hotkey global **fica registrado desde o começo** — ele é da camada de UI, não depende do modelo — mas acioná-lo em `NO_MODEL`/`DOWNLOADING` deve mostrar progresso, não erro.
- **Nunca** faça `spawn` do `whisper-cli` fora de `READY`.
- O download acontece no main process com `net`/`fetch` do Electron, sobrevive ao fechar janelas (é um app de menu bar, sem janela permanente), e emite progresso para a UI quando ela existir.
- Retome automaticamente no próximo boot se ficou um `.part` — sem perguntar nada.

---

## 7. Login item

### 7.1 Como o Electron faz hoje: `SMAppService`

**Confirmado por leitura do código do Electron 44.0.0.** `Browser::SetLoginItemSettings` delega para `platform_util::SetLoginItemEnabled`, que em `shell/common/platform_util_mac.mm` faz:

```objc
SMAppService* GetServiceForType(const std::string& type, const std::string& name) {
  ...
  if (type == "mainAppService")        return [SMAppService mainAppService];
  else if (type == "agentService")     return [SMAppService agentServiceWithPlistName:service_name];
  else if (type == "daemonService")    return [SMAppService daemonServiceWithPlistName:service_name];
  else if (type == "loginItemService") return [SMAppService loginItemServiceWithIdentifier:service_name];
  ...
}

bool SetLoginItemEnabled(const std::string& type, const std::string& service_name, bool enabled) {
  SMAppService* service = GetServiceForType(type, service_name);
  NSError* error = nil;
  bool result = enabled ? [service registerAndReturnError:&error]
                        : [service unregisterAndReturnError:&error];
  ...
}
```

Fontes: <https://raw.githubusercontent.com/electron/electron/v44.0.0/shell/browser/browser_mac.mm>, <https://raw.githubusercontent.com/electron/electron/v44.0.0/shell/common/platform_util_mac.mm>.

Então: **sim, `app.setLoginItemSettings` é `SMAppService` por baixo** no Electron atual, não mais `LSSharedFileList`. Para o caso deste app (o próprio app de menu bar deve subir no login), o `type` correto é o default `mainAppService` — nenhum `serviceName` é necessário; os outros três tipos exigem `name` (o Electron lança `TypeError` sem ele).

A doc da Apple sobre `SMAppService`: "In macOS 13 and later, use `SMAppService` to register and control `LoginItems`, `LaunchAgents`, and `LaunchDaemons` as helper executables for your app." E sobre `register()`: "**If the service corresponds to the main application, the application launches on subsequent logins.**" Também: "If the service is already registered, this method returns `kSMErrorAlreadyRegistered`." (<https://developer.apple.com/documentation/servicemanagement/smappservice>, <https://developer.apple.com/documentation/servicemanagement/smappservice/register()>)

### 7.2 O estado `requires-approval` não é opcional de tratar

`GetLoginItemEnabled` mapeia `SMAppServiceStatus` para strings: `"not-registered"`, `"enabled"`, `"requires-approval"`, `"not-found"`. O significado de `requiresApproval`, pela Apple:

> "The Service Management framework successfully registered this service, but the user needs to take action in System Settings before the service is eligible to run. **The framework also returns this status if the user revokes consent for the service to run in System Settings.**"

Fonte: <https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/requiresapproval>

Ou seja: `register()` pode "dar certo" e o app **ainda não** subir no login. Sua UI de preferências deve ler `app.getLoginItemSettings().status` e, quando for `requires-approval`, dizer ao usuário para aprovar em System Settings → General → Login Items. Um checkbox que só reflete o booleano `openAtLogin` vai mentir para o usuário.

A doc do Electron também alerta: "On macOS, your app should be code signed and notarized for login item settings to work reliably" (<https://www.electronjs.org/docs/latest/api/app>). Sem notarização, espere ter que passar pelo fluxo de aprovação; com assinatura estável (seção 3) isso é uma vez, não a cada build.

### 7.3 Ligado ou desligado por padrão?

**Desligado por padrão, com opt-in explícito nas preferências.** Razões:

1. Registrar login item sem o usuário pedir é comportamento que macOS trata como suspeito por design — daí o `requiresApproval` e a notificação do sistema. Você trocaria um "app não faz nada até eu ligar" por um "app pediu para subir no login e o sistema me avisou", que é pior primeira impressão.
2. O app já precisa de dois consentimentos na primeira execução (microfone e Accessibility). Empilhar um terceiro no primeiro boot é ruim.
3. Um app de ditado por hotkey só é útil depois de configurado (modelo baixado, hotkey escolhido, permissões concedidas). Subir no login antes disso não entrega valor.
4. É uma ferramenta pessoal: o momento natural de ligar é quando o usuário decide "quero isso sempre disponível" — e nesse momento ele vai nas preferências de propósito.

Bom momento para *oferecer* (não ativar): depois da primeira transcrição bem-sucedida.

---

## 8. Onde ficam preferências, dicionário e a API key

Caminhos macOS via `app.getPath()` (<https://www.electronjs.org/docs/latest/api/app>): `userData` = `appData` + nome do app; `appData` no macOS = `~/Library/Application Support`.

| Dado | Local | Por quê |
|---|---|---|
| **Preferências** (hotkey, idioma, autostart, device de áudio) | `<userData>/config.json` | Pequeno, do usuário, versionável por migração. `userData` é o default correto. Não use `NSUserDefaults`/plist — você perde a leitura/edição fácil e ganha o cache de `cfprefsd` como inimigo. |
| **Dicionário customizado** | `<userData>/dictionary.json` | É conteúdo do usuário, cresce, e há chance real de ele querer abrir/editar/versionar à mão. `~/Library/Application Support/<app>/` é um caminho que um usuário técnico encontra. Separe do `config.json` para que uma migração de schema de preferências não arrisque o dicionário. |
| **API key cifrada** | ciphertext em `<userData>/secrets.json`; **a chave** no login Keychain, item `"<appName> Safe Storage"` | `safeStorage.encryptString()` devolve um `Buffer` que **você** persiste; o Electron guarda apenas a chave simétrica no Keychain (verificado no código: `KeychainPassword::GetServiceName() = app_name + " Safe Storage"`). Grave como base64 em JSON, com um campo `version` para permitir rotação. |
| **Modelo Whisper** (547 MiB) | `<userData>/models/` | Grande e recriável, mas caro de recriar → Application Support, não Caches (seção 6.1). |
| **`whisper-cli`** | `Contents/Resources/bin/whisper-cli` **dentro do bundle** | Via `extraResources`; assinado junto com o app; substituído inteiro a cada update. Nunca em `userData` — um binário executável em diretório gravável pelo usuário é uma superfície de ataque desnecessária e sai do escopo da assinatura do bundle. |
| **`.node` do addon** | `Contents/Resources/app.asar.unpacked/…` | Automático no electron-builder; obrigatório porque `process.dlopen` não lê de dentro do asar. |
| **Logs** | `app.getPath('logs')` = `~/Library/Logs/<appName>` | Convenção macOS; Console.app acha. |
| **Áudio temporário** (WAV para o whisper-cli) | `app.getPath('temp')` | Efêmero por definição; apague depois de transcrever. Nunca em `userData` — voz gravada não deve ficar em disco além do necessário. |

Regras que orientaram essa distribuição:

- **`userData` para tudo que é estado do usuário** e deve sobreviver a atualizações do app.
- **Bundle para tudo que é código** — assinado, imutável, substituído por inteiro no update.
- **`temp` para tudo que é efêmero**, especialmente dado sensível (áudio).
- **Keychain só para a chave**, não para o segredo — é o que o `safeStorage` implementa e é o desenho certo: um item de Keychain, N segredos cifrados em arquivo.
- Cuidado com o nome: mudar `productName` muda `userData` **e** o nome do item de Keychain. Escolha na v1 e não mexa.

---

## Lacunas

Itens que a pesquisa documental não fecha. Para cada um, o experimento que resolveria — **nenhum foi executado**, e nenhum deles deve ser executado sem consentimento explícito do usuário, pois vários tocam a sessão de desktop / TCC / Keychain.

1. **[NÃO VERIFICADO] O CN do certificado Apple Development é estável entre renovações?** A TN3127 mostra que o DR de código assinado com Apple Development contém `certificate leaf[subject.CN] = "Apple Development: …"`. Se o CN mudar quando o certificado for renovado (anualmente), o DR muda e os grants de TCC/Keychain caem. Não achei documentação da Apple sobre a estabilidade do CN entre renovações. **Experimento:** `security find-identity -v -p codesigning` para ver o CN atual; guardar; após a próxima renovação, comparar. Adicionalmente, `codesign -d -r - <App>.app` antes/depois para comparar os DRs literalmente. Ambos são read-only e não tocam TCC.

2. **[NÃO VERIFICADO] O DR default do `codesign` para identidade Apple Development é idêntico ao do Xcode?** A TN3127 diz explicitamente que `codesign` e Xcode aplicam DRs *diferentes* ("Xcode avoids this limitation by signing code with custom DRs"), e só documenta em detalhe os do Xcode. O electron-builder usa `codesign`, não Xcode. **Experimento:** assinar um bundle de teste com electron-builder e rodar `codesign --display -r - <App>.app`. Read-only quanto ao sistema; produz um `.app` de teste que não precisa ser executado.

3. **[NÃO VERIFICADO] O grant de Accessibility, especificamente, é chaveado pelo DR do mesmo modo que o do microfone?** A TN3127 documenta o mecanismo usando o microfone como exemplo e o payload PPPC mostra `CodeRequirement` no esquema de identidade para todos os serviços, incluindo `Accessibility`. A generalização é fortemente sustentada mas não é uma afirmação literal da Apple sobre Accessibility. **Experimento:** conceder Accessibility a um build assinado, rebuildar com a mesma identidade (código alterado), reabrir e checar `CGPreflightPostEventAccess()`. **Toca TCC do usuário — não fazer sem autorização.**

4. **[NÃO VERIFICADO] Um `.app` construído localmente (sem atributo de quarentena) escapa do bloqueio de Gatekeeper por falta de notarização?** É o comportamento amplamente observado e é consistente com a doc (Gatekeeper avalia software com quarentena; XProtect verifica tudo). Mas a Apple não documenta `com.apple.quarantine` como API, e eu não achei uma afirmação oficial na forma "sem quarentena, sem checagem de notarização". **Experimento:** `xattr -p com.apple.quarantine <App>.app` no artefato construído localmente vs. no baixado via navegador (read-only); depois abrir cada um. Abrir toca a sessão — não fazer sem autorização.

5. **[NÃO VERIFICADO] O `SMAppService.mainAppService` sobrevive ao app ser movido no disco?** A doc não diz como o registro é resolvido se o bundle mudar de caminho (ex.: `~/Downloads` → `/Applications`). **Experimento:** registrar, mover, checar `app.getLoginItemSettings().status`. Toca configuração do usuário — não fazer sem autorização.

6. **[NÃO VERIFICADO] O `whisper-cli` construído em CI e assinado com a identidade do app roda sob hardened runtime com apenas `allow-jit` + `audio-input` herdados?** O binário embute shaders Metal e faz alocação executável? Se usar JIT próprio, pode precisar de entitlement no *processo filho* — e a Apple diz que "Shared libraries, frameworks, and in-process plug-ins inherit the entitlements of their host executable", o que **não** cobre um processo filho separado, que tem os seus próprios. **Experimento:** rodar o `whisper-cli` assinado a partir do bundle e ler o log. Precisa de um build real primeiro.

7. **[NÃO VERIFICADO] `isBinaryFile` (heurística do `@electron/osx-sign`) classifica corretamente todos os artefatos deste bundle?** Ela é heurística, não detecção de Mach-O. Falsos positivos em assets podem fazer o `codesign` reclamar; falsos negativos deixariam um binário sem assinar (fatal sob library validation). **Experimento:** após o build, `codesign -vvv --deep --strict <App>.app` (comando de diagnóstico documentado pela Apple em *Resolving common notarization issues*) e `find <App>.app -type f -exec file {} \; | grep Mach-O` cruzado com `codesign -d` em cada um.

8. **[NÃO VERIFICADO] `robotjs@0.9.1` realmente carrega dentro do Electron 44 sem rebuild?** A evidência é forte e estrutural (`prebuilds/darwin-arm64/node.napi.node`, `NAPI_VERSION=3`, `node-gyp-build` como resolvedor, garantia de ABI do Node-API), mas eu não carreguei o módulo. **Experimento:** `require('robotjs')` num processo Electron — **e nada além disso**. Não chamar nenhuma função de `robotjs`: `keyTap`, `typeString` etc. sintetizam eventos na sessão real. Foi assim que um agente anterior injetou texto no Terminal do usuário.

9. **Lacuna de escopo, não de fato:** eu não avaliei `mergeASARs`/universal binaries (irrelevante em arm64-only), auto-update (Squirrel.Mac exige `dmg` **e** `zip` — "Squirrel.Mac auto update mechanism requires both `dmg` and `zip` to be enabled" — e auto-update sem notarização tem suas próprias complicações), nem `@electron/fuses`. Se auto-update entrar no escopo, é outra pesquisa.

10. **[NÃO VERIFICADO] A licença do `hotcakey` permite vendorizar.** O `package.json` publicado declara `"license": "MIT"`, o que é permissivo e compatível. Não li o arquivo `LICENSE` do repositório nem verifiquei headers de copyright nos arquivos `.cc`/`.mm`. **Experimento:** ler `LICENSE` e os headers dos fontes antes de copiar; preservar o aviso de copyright.

---

## Recomendação

Setup concreto de build/assinatura/distribuição.

### Ferramenta e alvos

**`electron-builder`, major fixada em 26** (`"electron-builder": "~26.15.7"`). Alvos `dmg` + `zip`, `arm64` só.

### `electron-builder.yml`

```yaml
appId: com.<seu-dominio>.getthattext
productName: GetThatText          # NUNCA mudar: define userData e o item de Keychain

directories:
  buildResources: build

asar: true                         # default; .node é desempacotado automaticamente

extraResources:
  - from: vendor/whisper/whisper-cli
    to: bin/whisper-cli

mac:
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
  category: public.app-category.productivity
  minimumSystemVersion: "15.0"

  identity: "Apple Development: <NOME> (<TEAMID>)"   # NÃO usar "-" nem null
  hardenedRuntime: true                              # default
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  notarize: false
  gatekeeperAssess: false                            # default
  strictVerify: true                                 # default

  extendInfo:
    LSUIElement: 1
    NSMicrophoneUsageDescription: >-
      O GetThatText usa o microfone para transcrever sua fala em texto, localmente na sua máquina.
```

`build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
</dict></plist>
```

`build/entitlements.mac.inherit.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.inherit</key><true/>
</dict></plist>
```

Sem `app-sandbox`. Sem `disable-library-validation`. Sem `allow-unsigned-executable-memory`. Sem `camera`/`usb`/`bluetooth`/`location`/`photos-library` — escreva seu próprio plist em vez de herdar os defaults do `@electron/osx-sign`.

### Assinatura

**Certificado Apple Development gratuito** (Apple ID, personal team). Ele custa zero e entrega os três objetivos: o app roda em arm64, o DR é estável entre rebuilds (Keychain não reprompta, grant de Accessibility persiste), e o app aparece normalmente na lista de Accessibility. **Não** use ad-hoc: a TN3127 é inequívoca de que o DR ad-hoc está "tied to that specific version of the code", o que reintroduz exatamente o reprompt que motivou assinar.

Gate de verificação no CI, depois do build:

```
codesign -vvv --deep --strict "out/mac-arm64/GetThatText.app"
codesign -d --entitlements :- "out/mac-arm64/GetThatText.app"
codesign --display -r -      "out/mac-arm64/GetThatText.app"   # DR: grave no artefato do build
```

Guarde a saída do `-r -` como artefato de cada release. Quando um grant de TCC cair inexplicavelmente, comparar dois DRs responde em segundos o que de outra forma vira um dia de depuração.

### Pipeline de CI (runner macOS arm64)

```
1. npm ci
2. npx @electron/rebuild -v $ELECTRON_VERSION -a arm64      # step próprio, log próprio
3. build whisper.cpp na tag fixada -> vendor/whisper/whisper-cli
4. import do certificado numa keychain temporária (CSC_LINK/CSC_KEY_PASSWORD)
5. npx electron-builder --mac --arm64
6. gate de verificação (acima); publicar dmg + zip + DR + SHA-256 dos artefatos
```

Nada de `node-gyp` na máquina do usuário — ele recebe um `.app` pronto. Compile o addon do hotkey com `prebuildify --napi` + `node-gyp-build`, espelhando o `robotjs@0.9.1`, para que o mesmo `.node` sirva a testes sob Node e ao app sob Electron, e para que um upgrade de Electron não exija recompilar.

### Addon do hotkey: **vendorizar**

`hotcakey@0.8.0` não tem prebuild, está sem manutenção desde outubro de 2021, e são ~16 KB de C++ MIT. Vendorize com `NAPI_VERSION` explícito no `binding.gyp`, `prebuildify --napi` no CI, `node-gyp-build` no `install`. Confira o `LICENSE` e preserve o aviso de copyright (lacuna 10). Se `robotjs` acabar entrando só para o Cmd+V, considere fundir essa função no mesmo addon — um addon nativo a menos é uma dependência de risco a menos, e `CGEventPost` para Cmd+V é pouco código.

### Modelo

Baixar de URL com **revisão fixada** (`/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/…`), para `<userData>/models/*.part`, retomando com `Range` (206 confirmado), verificando `size == 574041195` e `sha256 == 394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`, e só então `rename` para `.bin`. O script oficial do whisper.cpp não verifica nada — verifique você. Máquina de estados `NO_MODEL → DOWNLOADING → VERIFYING → READY`, com `spawn` do `whisper-cli` proibido fora de `READY`.

### Login item

`app.setLoginItemSettings({ openAtLogin: true })` (tipo default `mainAppService` → `SMAppService`), **desligado por padrão**, opt-in nas preferências, oferecido depois da primeira transcrição bem-sucedida. A UI deve ler `status` e tratar `requires-approval` explicitamente, apontando o usuário para System Settings → General → Login Items — porque `register()` pode retornar sucesso sem o app estar habilitado a subir.

### Sandbox

Não. Confirmado pela documentação da Apple: "Use of accessibility APIs in assistive apps" e "Sending Apple Events to arbitrary apps" estão na lista de atividades incompatíveis com App Sandbox. Registre isso como restrição arquitetural permanente, não como preferência de distribuição: App Store está fora por impossibilidade técnica.

---

## Fontes

**Apple — code signing e identidade**
- TN3127: Inside Code Signing: Requirements — <https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements>
- Rosetta 2 on a Mac with Apple silicon (Platform Security) — <https://support.apple.com/guide/security/rosetta-2-on-a-mac-with-apple-silicon-secebb113be1/web>
- Gatekeeper and runtime protection (Platform Security) — <https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web>
- Notarizing macOS software before distribution — <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Resolving common notarization issues — <https://developer.apple.com/documentation/security/resolving-common-notarization-issues>
- Updating Mac software — <https://developer.apple.com/documentation/security/updating-mac-software>
- If an app on Mac isn't from an identified developer — <https://support.apple.com/en-us/102445>
- `man codesign` (macOS 15 instalado localmente)

**Apple — hardened runtime, entitlements, sandbox**
- Hardened Runtime — <https://developer.apple.com/documentation/security/hardened-runtime>
- App Sandbox — <https://developer.apple.com/documentation/security/app-sandbox>
- Protecting user data with App Sandbox — <https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox>
- `com.apple.security.device.audio-input` — <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input>
- `com.apple.security.device.microphone` — <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.microphone>
- `com.apple.security.cs.allow-jit` — <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit>
- `com.apple.security.cs.allow-unsigned-executable-memory` — <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-unsigned-executable-memory>
- `com.apple.security.cs.disable-library-validation` — <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation>
- `NSMicrophoneUsageDescription` — <https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription>
- `LSUIElement` — <https://developer.apple.com/documentation/bundleresources/information-property-list/lsuielement>

**Apple — TCC, Accessibility, login items**
- PrivacyPreferencesPolicyControl Services — <https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary>
- PrivacyPreferencesPolicyControl Services Identity (chave `CodeRequirement`) — <https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary/identity>
- `SMAppService` — <https://developer.apple.com/documentation/servicemanagement/smappservice>
- `SMAppService.register()` — <https://developer.apple.com/documentation/servicemanagement/smappservice/register()>
- `SMAppService.Status.requiresApproval` — <https://developer.apple.com/documentation/servicemanagement/smappservice/status-swift.enum/requiresapproval>
- Headers do SDK instalado: `MacOSX.sdk/…/HIServices.framework/Headers/AXUIElement.h` e `MacOSX.sdk/…/CoreGraphics.framework/Headers/CGEvent.h`

**Electron**
- `app` (setLoginItemSettings, getPath) — <https://www.electronjs.org/docs/latest/api/app>
- `safeStorage` — <https://www.electronjs.org/docs/latest/api/safe-storage>
- `process.resourcesPath` — <https://www.electronjs.org/docs/latest/api/process>
- ASAR Archives — <https://www.electronjs.org/docs/latest/tutorial/asar-archives>
- Using Native Node Modules — <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>
- Code Signing — <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- Código-fonte v44.0.0: `shell/browser/browser_mac.mm`, `shell/common/platform_util_mac.mm`, `shell/browser/electron_browser_main_parts.cc`
- `electron/node-abi` `abi_registry.json` — <https://raw.githubusercontent.com/electron/node-abi/main/abi_registry.json>

**Empacotadores**
- electron-builder macOS — <https://www.electron.build/docs/mac/>
- electron-builder Code Signing macOS — <https://www.electron.build/docs/features/code-signing/code-signing-mac/>
- Typings publicadas em `app-builder-lib@26.15.3` (`out/options/macOptions.d.ts`, `out/options/PlatformSpecificBuildOptions.d.ts`, `out/configuration.d.ts`)
- `@electron/osx-sign@1.3.3` publicado (`dist/sign.js`, `dist/util.js`, `entitlements/*.plist`)
- `@electron/rebuild` — <https://github.com/electron/rebuild>
- Electron Forge auto-unpack-natives — <https://www.electronforge.io/config/plugins/auto-unpack-natives>
- Electron Forge Code Signing macOS — <https://www.electronforge.io/guides/code-signing/code-signing-macos>
- `@electron/packager` Options — <https://electron.github.io/packager/main/interfaces/Options.html>

**Node / addons nativos**
- Node-API (estabilidade de ABI) — <https://nodejs.org/api/n-api.html>
- `robotjs@0.9.1` publicado no npm (`package.json`, `binding.gyp`, `prebuilds/`)
- `hotcakey@0.8.0` metadados no npm — <https://registry.npmjs.org/hotcakey>

**Whisper / modelo**
- `models/download-ggml-model.sh` — <https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh>
- Ponteiro LFS — <https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-large-v3-turbo-q5_0.bin>
- API do Hub com blobs — `https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true`
- Headers HTTP do endpoint `/resolve/` (verificação de `Range`/206 e `x-linked-etag`)
