# Empacotamento e execução

Type: research
Status: resolved
Blocked by: 01, 02, 03

## Question

Como esse app fica de fato instalado e rodando na máquina, dado que ele carrega addons nativos e um binário externo?

- Como empacotar (`electron-builder`, `electron-forge`) um app que inclui **módulos nativos compilados** (os dos tickets 01 e 02) — rebuild para a versão do Electron, arquitetura arm64
- Como o **binário do whisper** e o **modelo** chegam ao disco: embarcados no bundle (infla muito), baixados no primeiro uso, ou dependência externa que o usuário instala à parte
- **Sandbox**: a Accessibility API normalmente exige app não-sandboxed. Confirmar, e registrar a consequência
- **Assinatura**: para uso pessoal, o mínimo necessário para o macOS não bloquear e para o app aparecer na lista de Acessibilidade. Notarização está fora de escopo, mas ad-hoc signing pode ser obrigatório
- Rodar como **login item** — como registrar, e se deve ser padrão ou opcional
- Onde ficam preferências, dicionário e a API key no disco

Gravar achados em `.scratch/getthattext/research/empacotamento.md`.

## Adendo (após [Key-up global no macOS](./02-key-up-global-no-macos.md))

O addon nativo do atalho tem uma decisão de manutenção junto: **fazer vendor do código ou depender do pacote abandonado?**

`hotcakey@0.8.0` é a única implementação npm da rota Carbon, funciona, mas está sem manutenção desde 2021 e sem prebuilds. São ~16 KB de C++ com licença permissiva, e o `binding.gyp` compila limpo com `@electron/rebuild` para Electron 44 em arm64. A referência mais limpa e ativa da mesma técnica, se preferirmos escrever do zero, é o `platform_impl/macos` do crate `global-hotkey` do Tauri.

- **Vendor:** controle total, sem dependência morta, mas é código nativo próprio pra manter.
- **Depender + prebuildar no CI:** menos código seu, mas é uma dependência abandonada que vai precisar de fork cedo ou tarde.

Em qualquer caso o `.node` precisa ser prebuildado no CI — `node-gyp` na máquina do usuário final é inaceitável.

## Answer

Achados completos: [`research/empacotamento.md`](../research/empacotamento.md) (780 linhas). Nenhum experimento tocou a sessão de desktop.

**Assinatura ad-hoc NÃO serve — e isso resolve o adendo acima pela raiz.**

TN3127, literal: *"Ad hoc signed code […] has a DR but it's tied to that specific version of the code. In both cases macOS can't reliably track the identity of the code."* Cada rebuild gera novo cdhash → novo designated requirement → **prompt novo de Acessibilidade e de Keychain**. Corroborado por `man codesign` ("identifies exactly one instance of code") e pela doc de PPPC do MDM, cuja chave `CodeRequirement` diz literalmente *"Obtain this value by running `codesign -display -r -`"* — prova de que o TCC indexa pelo DR, não pelo bundle ID.

**Um certificado Apple Development gratuito basta.** Os DRs default do `codesign` são desenhados justamente para que *"a privilege, like microphone access, acquired by an existing version of your app is still available to a new version."*

E assinar não é opcional de qualquer forma: Apple Platform Security — *"A Mac with Apple silicon doesn't permit native arm64 code to execute unless a valid signature is attached."* Ad-hoc é só o piso.

**Sandbox é impossibilidade arquitetural, não preferência de distribuição.** A Apple lista "Use of accessibility APIs in assistive apps" e "Sending Apple Events to arbitrary apps" entre as atividades **proibidas** sob App Sandbox. Registrado como impossibilidade para que nenhum "e se fôssemos pra App Store?" reabra isso depois.

**Decisões travadas:**

- **`electron-builder` v26, versão fixada.** Principalmente porque "assinado mas não notarizado" é caso de primeira classe documentado nele, enquanto a doc do próprio Forge declara isso **não suportado** em macOS moderno. `asar: true` e unpack automático de módulos nativos já são default.
- **Padrão de addon nativo: `prebuildify --napi` + `node-gyp-build`.** A alegação do `robotjs` 0.9.1 confere estruturalmente — o tarball realmente traz `prebuilds/darwin-arm64/node.napi.node` com `NAPI_VERSION=3`. Adotar esse mesmo padrão para o addon de hotkey vendorizado: o mesmo `.node` serve testes em Node e o Electron, e **upgrades de Electron não exigem recompilar**.
- **Entitlements: só `allow-jit` + `com.apple.security.device.audio-input`.** O `default.darwin.plist` do `@electron/osx-sign` concede câmera, bluetooth, USB, localização e biblioteca de fotos — tudo isso sai.
- **Assinatura dos binários embarcados é automática:** o `@electron/osx-sign` percorre todo o `Contents/`, então o `.node` desempacotado e o `Contents/Resources/whisper-cli` são assinados sem configuração. `mac.binaries` serve só para código fora do bundle.
- **Modelo do Whisper: verificar checksum por conta própria.** O Hugging Face **publica** SHA-256 (ponteiro LFS, `?blobs=true`, header `x-linked-etag`): `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`, 574.041.195 bytes. Download resumível confirmado (`206 Partial Content`). **Mas o `download-ggml-model.sh` do próprio whisper.cpp não verifica nada.**
- **Login item via `SMAppService`** — verificado que o Electron 44 usa isso em `platform_util_mac.mm`. **Armadilha:** `register()` pode ter sucesso e ainda retornar `requires-approval`, então um checkbox ligado só a `openAtLogin` **mente para o usuário**. Precisa ler o estado real.
- **Nunca mudar `productName`.** Ele define ao mesmo tempo o caminho de `userData` **e** o nome do item no Keychain (`"<appName> Safe Storage"`, verificado no fonte do Electron). Renomear órfã todos os segredos guardados.

**Lacuna que virou ticket:** se o CN da folha do certificado Apple Development é estável nas renovações anuais. O DR embute o CN, então uma mudança derrubaria todas as concessões de TCC e Keychain de uma vez.

## Superado em parte

**O addon nativo desapareceu.** [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md) trocou push-to-talk por toggle, que usa o `globalShortcut` do Electron — não há mais hotkey Carbon a vendorizar nem `robotjs` para sintetizar `⌘V`. Caem: `prebuildify`/`node-gyp-build`, `@electron/rebuild` no CI, `asarUnpack` do `.node`, e a decisão vendor-vs-depender.

O único binário externo que resta é o `whisper-cli`, ainda como `extraResource`.

O que **sobrevive** e continua importante: `electron-builder` v26; assinatura obrigatória (arm64 não executa código nativo sem assinatura, e o Keychain exige identidade estável); entitlements enxutos (`allow-jit` + áudio); verificação de SHA-256 do modelo por conta própria; a armadilha do `SMAppService` retornando `requires-approval`; e **nunca mudar `productName`**.
