# Empacotar e distribuir à mão

O app é de uso pessoal e **não é notarizado** — está fora de escopo pela
seção 12 da spec. Este documento é o caminho para gerar um `.app` e passá-lo
adiante à mão.

---

## 1. Os binários do whisper, autocontidos

O bundle embarca o `whisper-cli` e o `whisper-vad-speech-segments` em
`Contents/Resources/whisper`.

**O binário do Homebrew não serve.** Ele é dinamicamente ligado:

```
@rpath/libwhisper.1.dylib
/opt/homebrew/opt/ggml/lib/libggml.0.dylib
```

Um bundle que dependesse dele quebraria em qualquer máquina sem Homebrew.
Dois caminhos para o binário próprio, ambos com a tag fixada em `v1.9.2`:

```bash
brew install cmake && npm run vendor:whisper
```

ou dispare o workflow `whisper.yml` no GitHub Actions e baixe o artefato
para `vendor/whisper/`. O CI não exige nada instalado localmente.

Os dois **falham** se o `otool` encontrar `/opt/homebrew` nas dependências —
é a prova de que o executável é autocontido, e ela não é opcional.

**A tag é fixa de propósito.** O app depende de detalhes medidos do
`whisper-cli`: que `-f -` lê o stdin, que `-otxt -of -` são obrigatórios com
stdin, e o formato exato da saída do `whisper-vad-speech-segments`. Seguir o
HEAD faria essas premissas mudarem sem aviso.

---

## 2. Empacotar

```bash
npm run package
```

Sai em `release/mac-arm64/getthattext.app`.

O script força `CSC_IDENTITY_AUTO_DISCOVERY=false` **de propósito**. Sem
isso o electron-builder procura uma identidade no Keychain e usa a primeira
que servir — e a única válida nesta máquina é um `Apple Distribution` da
GOL, que é do empregador e não deve assinar app pessoal.

---

## 3. Assinar ad-hoc

```bash
codesign --force --deep --sign - release/mac-arm64/getthattext.app
codesign --verify --deep --strict release/mac-arm64/getthattext.app
codesign -dv release/mac-arm64/getthattext.app
```

O `-` é a identidade ad-hoc. **Este passo não é redundante**: o
electron-builder deixa `Identifier=Electron` na assinatura, e o `codesign`
explícito o corrige para `com.filipeprado.getthattext`, lendo do
`Info.plist`. O identificador importa — é por ele que o TCC reconhece o app
ao conceder o microfone.

Depois de assinar, `codesign -dv` deve mostrar:

```
Identifier=com.filipeprado.getthattext
Signature=adhoc
```

---

## 4. Quem recebe o app

Um `.app` que chega por download, AirDrop ou pen drive ganha o atributo
`com.apple.quarantine`, e o Gatekeeper bloqueia porque a assinatura ad-hoc
não é confiável. Quem recebe precisa remover:

```bash
xattr -d com.apple.quarantine /Applications/getthattext.app
```

Ou abrir uma vez pelo menu de contexto → **Abrir**, e confirmar.

App construído localmente não tem esse atributo, então na sua máquina ele
abre direto.

---

## O que a assinatura ad-hoc custa

**Você recola a chave do Groq a cada rebuild.**

O `safeStorage` guarda a chave mestra num item de Keychain chamado
`getthattext Safe Storage`, e o acesso é controlado pelo Designated
Requirement do app. Com ad-hoc, o DR é um hash do código:

```
designated => cdhash H"d48d810e7b110d8d70a793f827dd23a7b2506405"
```

Qualquer alteração — uma linha, um comentário — muda o `cdhash`. Para o
Keychain, o app novo é um app diferente, e ele nega o acesso ao item
anterior.

**O que a spec exagera:** a §11 diz que "arm64 não executa código nativo sem
assinatura válida". O kernel exige *uma* assinatura, não uma *confiável* — e
a ad-hoc satisfaz. O app ad-hoc executa; verificado.

**Como resolver, quando incomodar:** um certificado **Apple Development**
gratuito, criado no Xcode em Settings › Accounts › adicionar Apple ID ›
Manage Certificates › + › Apple Development. Não exige conta paga. Com ele o
DR referencia a identidade em vez do hash, e rebuilds mantêm o acesso.

Ressalva que **não** desaparece com o certificado: a §13 da spec levanta que
a renovação anual pode mudar o CN da folha e derrubar o acesso do mesmo
jeito. O sintoma seria o app pedir a chave do nada. Ninguém confirmou — o
experimento leva um ano.

---

## Nunca mude o `productName`

Ele batiza o `userData` **e** o item do Keychain (`"<appName> Safe
Storage"`). Mudá-lo órfã a chave do Groq, as preferências, o dicionário e os
574 MB de modelo baixado.

Ele está fixado em dois lugares que precisam concordar: `productName` no
`package.json`, para o empacotamento, e `app.setName` no topo do
`src/main/main.ts`, porque o Electron lê o `package.json` do diretório do
app — que em desenvolvimento é `dist/main/`, sem package.json nenhum.
