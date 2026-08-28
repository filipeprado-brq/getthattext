# getthattext — spec do MVP

**Ferramenta de ditado para macOS.** Você clica no ícone da barra de menu, fala, clica de novo. O texto é transcrito localmente, melhorado por IA e colocado na área de transferência. Você cola onde quiser.

**Uso pessoal do autor.** Não há distribuição a terceiros.

Cada decisão abaixo aponta para o ticket que a decidiu. Onde houver dúvida, o ticket tem o raciocínio completo e as alternativas descartadas. O mapa é [`map.md`](./map.md).

**Alvo:** macOS 15 (Sequoia), Apple Silicon (arm64). Desenvolvido e medido em MacBook Pro M4 / macOS 15.7.3.

---

## 1. Fluxo do usuário

1. **Clique esquerdo no ícone** da barra de menu, ou o atalho global **`⌃⌥⌘G`**. Os dois alternam: começam e param. → [Orçamento de latência](./issues/18-orcamento-de-latencia.md) · [Qual é o atalho](./issues/07-qual-e-o-atalho.md)
2. O app abre o microfone. O ícone mostra **"abrindo"** e só passa a **"gravando"** quando o primeiro frame de áudio realmente chega. → [Captura de áudio](./issues/04-captura-de-audio-no-electron.md)
3. Você fala. O ícone fica **vermelho, respirando a 1,7 s**. Limite de **2 minutos**; ao bater, para e processa normalmente. → [Forma do indicador](./issues/11-forma-do-indicador-de-estado.md) · [Orçamento de latência](./issues/18-orcamento-de-latencia.md)
4. **Clique ou atalho de novo** para parar. O microfone fecha imediatamente. → [Janela de microfone aberto](./issues/17-janela-de-microfone-aberto.md)
5. **Portão de fala:** o VAD verifica se houve fala. Se não houve, o app volta a ocioso **em silêncio** — não transcreve, não chama o Groq, não toca som, não mexe no clipboard. → [Quando não há fala](./issues/25-quando-nao-ha-fala.md)
6. **Transcrição local** pelo `whisper-cli`, no áudio inteiro.
7. **Substituição determinística** dos termos do dicionário.
8. **Reescrita no Groq.**
9. **Texto no clipboard.** Ícone vira **check preenchido** por ~2 s e toca um **blip curto**; volta a ocioso.
10. Você cola com `⌘V` onde quiser.

**Latência típica ponta a ponta:** ~2 s para uma ditação curta, ~3 s para uma de um minuto. Medido. → [A/B de modelo](./issues/16-ab-de-modelo-em-pt-br.md)

**Clique direito** no ícone abre o menu (seção 7).

---

## 2. Arquitetura

**Electron, sem nenhum addon nativo.** O único binário externo é o `whisper-cli`.

| Componente | Escolha | Ticket |
|---|---|---|
| Empacotador | `electron-builder` v26, versão fixada | [Empacotamento](./issues/14-empacotamento-e-execucao.md) |
| Atalho global | `globalShortcut` do Electron — toggle só precisa de key-down | [Orçamento de latência](./issues/18-orcamento-de-latencia.md) |
| Ícone | `Tray` API — é gatilho **e** indicador | [Forma do indicador](./issues/11-forma-do-indicador-de-estado.md) |
| Captura de áudio | `getUserMedia` no renderer (janela oculta) | [Captura de áudio](./issues/04-captura-de-audio-no-electron.md) |
| Transcrição | `whisper-cli` via child process | [whisper.cpp](./issues/03-whisper-cli-via-child-process.md) |
| Reescrita | `groq-sdk` no main process | [API do Groq](./issues/05-api-do-groq.md) |
| Chave | `safeStorage` do Electron (Keychain) | [API do Groq](./issues/05-api-do-groq.md) |

**Por que não há addon nativo:** a versão anterior do desenho usava push-to-talk (exigia key-up, que o Electron não tem) e injetava texto no input focado (exigia `CGEvent`). Ambos caíram quando o gatilho virou toggle e o destino virou o clipboard. Isso eliminou o addon Carbon, o `robotjs`, o `prebuildify`, o `@electron/rebuild` e a permissão de Acessibilidade. → [Orçamento de latência](./issues/18-orcamento-de-latencia.md)

### Pipeline de áudio

```
getUserMedia (renderer)
  → AudioContext({ sampleRate: 16000 })
  → MediaStreamAudioSourceNode  (reamostra 48k→16k, resampler sinc do Chromium)
  → canal único pelo grafo (channelCount: 1, channelCountMode: 'explicit')
  → AudioWorkletNode  → Float32Array(128) por render quantum, via postMessage transferível
  → Float32 → Int16  (clamp; s < 0 ? s*0x8000 : s*0x7fff)
  → header WAV de 44 bytes escrito à mão
  → stdin do whisper-cli
```

**Não usar `MediaRecorder`** — produz WebM/Opus e exigiria decodificar depois.
**Não delegar a reamostragem ao `whisper-cli`** — o resampler default do miniaudio é `ma_resample_algorithm_linear`, comentado no próprio fonte como "Fastest, lowest quality".

**Pré-aquecimento:** criar o `AudioContext` e rodar `audioWorklet.addModule()` no boot do app. Isso abre um device de **saída**, não de entrada — **não acende o ponto laranja**. No clique sobra apenas `getUserMedia` + `resume()`.

---

## 3. Transcrição

**Modelo: `ggml-large-v3-turbo-q5_0`** — 547 MiB, ou seja disco de `small` com qualidade de `large-v2` (~4–5% WER em pt-BR). Domina o `medium` em todas as dimensões. → [whisper.cpp](./issues/03-whisper-cli-via-child-process.md)

### Portão de fala, antes de transcrever

```
whisper-vad-speech-segments -vm ggml-silero-v5.1.2.bin -f <audio>
```

**Zero segmentos → descarta em silêncio.** Qualquer segmento → segue para a transcrição.

**O VAD nunca entra no caminho da transcrição.** Isso é deliberado e foi corrigido a partir de medição: ligar `--vad` no `whisper-cli` suprime alucinação mas **danifica conteúdo real** — no corpus ele engoliu `modules/home/hooks/useMenu.ts` e perdeu uma frase inteira noutra amostra. → [Quando não há fala](./issues/25-quando-nao-ha-fala.md)

**Por que o portão existe:** sem ele, o Whisper alucina em **8 de 8** gravações sem fala. Silêncio de 1 s vira `Obrigado.`; 5 s vira `E aí`; meio segundo vira `Legenda por Sônia Ruberti` — vazamento de dado de treino. Ruído baixo de sala silenciosa também dispara.

### Invocação

```
whisper-cli -m ggml-large-v3-turbo-q5_0.bin -f - -otxt -of - -l pt -nt -np -sns -bs 1 -nf
```

- `-f -` lê o WAV do **stdin** (o README oficial não menciona)
- **`-otxt -of -` são obrigatórios com stdin, e a razão não é óbvia.** O `whisper-cli` deriva o nome do arquivo de saída do nome da entrada; com entrada `-`, a saída vira `-`, e sem um formato `--output-*` pedido explicitamente ele **não imprime a transcrição em lugar nenhum** — lê o áudio, transcreve e descarta, saindo com código 0. Descoberto ao implementar o [Ditar e colar](./issues/02-ditar-e-colar.md): a research original verificou o caminho de *leitura* no fonte e não seguiu o de *saída*.
- `-bs 1 -nf` — greedy, sem temperature fallback: modo de menor latência
- **Sem `--prompt`.** Ele é apagado após a primeira janela de 30 s, some de vez quando o fallback de temperatura sobe, e tem modos de falha destrutivos documentados. → [Onde entra o dicionário](./issues/10-onde-entra-o-dicionario-customizado.md)

**Latência medida:** 1,3 s a 2,6 s por ditação, incluindo ~320 ms de load do modelo a cada spawn.

---

## 4. Dicionário customizado

**Formato:** `dicionario.json` em `~/Library/Application Support/<productName>/`, arranjo ordenado de `{ term, heard?[], context? }`.

**Aplicação: substituição determinística, ANTES do Groq.** A ordem importa — depois, ela desfaria escolhas boas do LLM. Os termos também vão na lista do prompt do Groq.

**Dimensionamento medido: 10 a 30 entradas, não 500.** O Whisper erra de forma estreita e sistemática: → [Corpus](./issues/24-corpus-de-transcricoes-reais.md)

1. **Palavras curtas em inglês** — `auth` → `alf`, `me` → `MI`
2. **Nomes de ferramenta pouco comuns** — `Danger` → `dungeon`
3. **camelCase, sempre** — `dateFormat` → `date format`, `useMenu` → `use menu`, `useEffect` → `useffect`

E acerta o que se temia: `import.spec.ts` e `fixtures.json` saem perfeitos; `<sigla-de-domínio>`, `deploy`, `merge`, `squad`, `code review`, `undefined`, `capacity` passam limpos.

**camelCase é regra, não dicionário.** Uma regra de recomposição cobre infinitos identificadores que uma lista nunca cobriria — vale tratar separado.

### Como o dicionário se popula

O editor de dicionário tem **"adicionar do último ditado"**: mostra a transcrição crua (que está em memória), você clica na palavra que saiu errada e digita a correta. → [Aprender correções](./issues/19-aprender-correcoes-automaticamente.md)

**Por que não é o Groq que detecta:** foi tentado e rendeu **1 em 29**. A trava `NUNCA MUDE nomes de arquivos` impede exatamente a correção que a detecção precisaria — o modelo vê `services/alf.ts` e não tem como saber que era `services/auth.ts`. A fonte da verdade é você.

---

## 5. Reescrita no Groq

**Modelo: `openai/gpt-oss-20b`.** Confirmado por A/B sobre 29 transcrições reais contra o `gpt-oss-120b`. → [A/B de modelo](./issues/16-ab-de-modelo-em-pt-br.md)

| Parâmetro | Valor |
|---|---|
| `reasoning_effort` | `"low"` |
| `reasoning_format` | `"hidden"` |
| `temperature` | `0.3` |
| `max_completion_tokens` | `~800` |
| `stream` | `true` |
| `timeout` | `10_000` (default do SDK é 60 s) |
| `maxRetries` | `1` (default é 2) |

**Saída: texto puro.** Mais uma limpeza defensiva no cliente removendo preâmbulos conhecidos (`Aqui está…`, `Texto revisado:`) e aspas envolventes.

### O prompt

```
Você reescreve transcrições de ditado em português do Brasil.

A saída é EXCLUSIVAMENTE o texto reescrito. Nenhum preâmbulo, nenhuma
explicação, nenhuma aspas em volta. O que você responder vai direto para
a área de transferência do usuário.

O texto de entrada está em português do Brasil e a saída deve estar em
português do Brasil. Nunca traduza.

AGRESSIVIDADE PELO TAMANHO:
- Menos de 40 palavras: corrija APENAS pontuação, capitalização e
  acentuação. Não reformule, não expanda, não mude o registro.
- 40 palavras ou mais: reescreva para ficar bem escrito.

MUDE:
- disfluências ("é...", "tipo", "né", "assim", "então" de preenchimento)
- falsos começos e repetições ("no, no endpoint")
- pontuação, capitalização, acentuação e concordância
- quebra em parágrafos quando o texto for longo
- quando a pessoa se corrigir no meio, mantenha APENAS a versão corrigida

NUNCA MUDE:
- números, datas, valores, quantidades, prazos
- nomes próprios, de pessoas, empresas e produtos
- nomes de arquivos, variáveis, funções, comandos, endpoints
- siglas
- termos técnicos em inglês — mantenha em inglês
- o grau de certeza: se a pessoa disse "acho que", não afirme

NUNCA ACRESCENTE:
- informação que não está no texto
- conclusões, aprovações ou decisões que a pessoa não disse
- o final de uma frase que ficou incompleta — deixe incompleta
```

**As travas não são precaução teórica.** Sem elas, com prompt mínimo, `"ok pode subir"` virou **`"Upload concluído com sucesso!"`** — invenção total. Com elas: **0 invenções em 9 amostras curtas**, e nomes de arquivo intactos em todas.

**O limiar de 40 foi medido, não estimado.** Pedindo brevidade explícita, a fala natural saiu com 9, 14, 19, 27, 33, 35 e 37 palavras — o limiar anterior de 15 quase nunca dispararia. → [Prompt de reescrita](./issues/08-prompt-de-reescrita.md)

**Preferência "reescrever com IA"**, ligada por padrão. Desligar quando o texto não pode ser alterado: citação literal, trecho contratual, nome que precisa sair exato.

---

## 6. Entrega do texto

**O texto vai para a área de transferência.** O app **nunca toca outro aplicativo** — não injeta, não usa `CGEvent`, não usa a Accessibility API. → [Orçamento de latência](./issues/18-orcamento-de-latencia.md)

**O cru fica em memória até a próxima ditação**, recuperável por "Copiar transcrição crua" no menu. **Nada vai para o disco** — não é histórico. → [Cola direto ou revisa antes](./issues/09-cola-direto-ou-revisa-antes.md)

**Sem janela de revisão.** A distorção vive no texto longo, que é onde você menos pega o erro — mas cobrar uma confirmação em toda ditação para proteger o caso minoritário é fricção desproporcional. O cru recuperável é o seguro barato.

---

## 7. Interface

### Estados do ícone

Monocromático (`template image`, o sistema tinge) **exceto vermelho ao gravar**. → [Forma do indicador](./issues/11-forma-do-indicador-de-estado.md)

| Estado | Forma | Quando |
|---|---|---|
| **Ocioso** | contorno de microfone | repouso |
| **Abrindo o microfone** | contorno esmaecido, respirando | entre o clique e o primeiro frame de áudio |
| **Gravando** | microfone preenchido, **vermelho**, respirando a **1,7 s** | capturando |
| **Processando** | três pontos | transcrição + reescrita, fundidas num estado só |
| **Pronto** | **check preenchido** ~2 s **+ blip** | texto reescrito no clipboard |
| **Pronto (cru)** | **check vazado** ~2 s + mesmo blip | o Groq falhou; clipboard tem o cru |
| **Erro** | círculo com exclamação, **persiste até clicar** | falha real |

**Todo o orçamento de cor vai para "gravando"** — o único estado onde não perceber custa algo. Isso é consistente com a plataforma: o indicador de privacidade do próprio macOS é um ponto laranja.

**"Gravando" só acende quando o áudio chega.** O Chromium adia o início da captura em até 5 s depois que o Mac acorda; sem esse cuidado você fala no vazio.

**O som é o que fecha o ciclo.** No momento em que o texto fica pronto, seu olhar está no input onde vai colar, não na barra de menu. Deve ser desligável.

### Menu (clique direito)

```
Ditar                          ⌃⌥⌘G
─────────────────────────────
Copiar transcrição crua          (desabilitado se não houver)
─────────────────────────────
Preferências…                    ⌘,
Dicionário…
─────────────────────────────
Sair                             ⌘Q
```

### Preferências

Atalho (com **aviso visível de conflito** — `globalShortcut.register` retorna `false` e isso não pode falhar em silêncio) · modelo do Whisper · idioma · reescrever com IA (on/off) · som (on/off) · abrir no login · API key do Groq.

---

## 8. Permissões

**Uma só: Microfone.** → [Permissões](./issues/06-permissoes-e-ordem-de-pedido.md)

Acessibilidade era exigida exclusivamente pelo `CGEventPost`, que sumiu com a injeção. Automação e Input Monitoring nunca foram necessárias. **O app não aparece em Privacidade > Acessibilidade.**

Num app que grava áudio, isso é a diferença entre "pode ver tudo que eu digito" e "só usa o microfone".

**Obrigatórios no bundle** — a falta de **qualquer um dos dois causa crash, não prompt**:

- `NSMicrophoneUsageDescription` no `Info.plist`
- `com.apple.security.device.audio-input` nos entitlements

Configurar `setPermissionRequestHandler` **e** `setPermissionCheckHandler` para `'media'` + áudio. Se negado, levar ao painel do sistema por `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone` (scheme não suportado pela Apple — usar como conveniência e mostrar o caminho textual ao lado). A mudança só vale após reiniciar o app.

---

## 9. Onboarding

Primeira abertura, em ordem: → [Falhas locais](./issues/26-falhas-locais.md)

1. Pede **permissão de microfone**
2. Baixa os **modelos com barra de progresso** — `large-v3-turbo-q5_0` (547 MiB) e `ggml-silero-v5.1.2` (885 KiB)
3. Pede a **API key do Groq** (opcional — sem ela o app funciona em modo cru)
4. Libera o uso

**Só então.** Baixar na primeira ditação travaria por minutos exatamente no momento em que a ferramenta está sendo julgada.

**Integridade:** verificar SHA-256 depois de baixar — o Hugging Face publica (`394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`, 574.041.195 bytes) e o `download-ggml-model.sh` do whisper.cpp **não verifica nada**. Download retomável (`206 Partial Content`). Checar ~600 MB livres antes de começar.

---

## 10. Erros e degradação

**Dois princípios valem em todo o app:**

1. **Nunca descartar uma transcrição.**
2. **Nunca falhar em silêncio** — com uma exceção deliberada: transcrição vazia é resultado **legítimo**, não erro. "Vazio" e "falhou" precisam ser estados distintos, ou o usuário aprende a ignorar os dois.

| Falha | Comportamento |
|---|---|
| **Sem fala** (portão VAD) | volta a ocioso em silêncio; não transcreve, não chama o Groq, não toca som, não mexe no clipboard |
| **Groq: timeout, sem rede, rate limit, erro do modelo** | cru no clipboard, **check vazado** |
| **Groq: chave inválida** | idem, mais limpa a chave e abre as preferências — única falha que exige ação sua |
| **Groq: chave ausente** | modo cru; não bloqueia |
| **Device de áudio trocando no meio** | transcreve o que capturou, variante de erro no ícone, **nunca descarta** |
| **Binário do `whisper-cli` ausente** | **não abre** — sem whisper não há produto; degradar seria fingir |
| **Modelo corrompido** | apaga, tenta uma vez, falha com mensagem clara |
| **Disco cheio** | recusa antes de começar, com mensagem específica |
| **Gravação atinge 2 min** | para e processa normalmente |

**Atalho após sleep/wake:** re-registrar defensivamente em `powerMonitor` nos eventos `resume`, `unlock-screen` e `user-did-become-active`. A alternativa é impossível — um atalho que não chega é indistinguível de um atalho que não foi apertado.

---

## 11. Empacotamento

→ [Empacotamento](./issues/14-empacotamento-e-execucao.md) · [Certificado](./issues/22-certificado-gratis-ou-pago.md)

- **`electron-builder` v26**, versão fixada. "Assinado mas não notarizado" é caso de primeira classe documentado nele; a doc do Forge declara isso não suportado em macOS moderno.
- **`whisper-cli` buildado no CI** (macOS arm64, tag fixada do whisper.cpp) e embarcado como `extraResource`. Metal entra por default e o shader vai embutido — o executável é autocontido. **Não** ligar `WHISPER_COREML`.
- **Nenhum wrapper npm serve** — `nodejs-whisper`, `smart-whisper` e `@remotion/install-whisper-cpp` empurram cmake + Xcode CLT para o usuário final.
- **Assinatura é obrigatória**, por duas razões independentes: arm64 não executa código nativo sem assinatura válida, e sem identidade estável o Keychain re-pergunta a cada rebuild.
- **Certificado Apple Development gratuito.** Ad-hoc não serve (TN3127: o DR fica atado àquela versão exata do código; o sintoma é o toggle aparecer ligado e `AXIsProcessTrusted()` retornar `false`).
- **Entitlements:** só `allow-jit` e `com.apple.security.device.audio-input`. O `default.darwin.plist` do `@electron/osx-sign` concede câmera, bluetooth, USB, localização e fotos — tudo isso sai.
- **Login item** via `SMAppService`. **Armadilha:** `register()` pode ter sucesso e ainda retornar `requires-approval` — um checkbox ligado só a `openAtLogin` mente para o usuário.
- **Nunca mudar `productName`.** Ele nomeia o `userData` **e** o item no Keychain (`"<appName> Safe Storage"`). Renomear órfã todos os segredos.

### Armazenamento

| O quê | Onde |
|---|---|
| Preferências, dicionário | `~/Library/Application Support/<productName>/` |
| Modelos | idem, subpasta `models/` |
| API key | `safeStorage.encryptStringAsync` → ciphertext em `userData/groq.key.enc`, `0o600` |
| Transcrição crua | **só memória**, até a próxima ditação |

**Regras não-negociáveis da chave:** só no main process; o renderer fala por IPC e a chave nunca cruza o IPC; nunca `dangerouslyAllowBrowser`; se `isAsyncEncryptionAvailable()` for `false`, **falhar e avisar** — jamais gravar em texto claro; nunca `GROQ_LOG=debug` em produção.

### Armadilha de implementação

A API do Groq responde **HTTP 403** para requisições com `User-Agent: Python-urllib`. Não é erro de chave nem de payload — é bloqueio de user-agent, e o 403 não diz nada sobre a causa. O `groq-sdk` oficial provavelmente define o seu, mas vale saber.

---

## 12. Fora do MVP

→ seção **Out of scope** do [mapa](./map.md), com o raciocínio de cada um.

Colar automaticamente no input focado · push-to-talk · notarização, distribuição e auto-update · onboarding para usuário leigo · comandos de voz · histórico de transcrições · transcrição em nuvem · streaming palavra-a-palavra · formatação sensível ao app de destino · Swift/AppKit e Tauri.

**App Sandbox** permanece fora, mas por razão diferente da original: sandbox só importa para a App Store, e distribuição está fora de escopo. Se o destino for redesenhado para distribuir, isto vira pergunta aberta — em especial se um app sandboxed consegue dar `spawn` no `whisper-cli` embarcado. **Não investigado.**

---

## 13. Questões abertas, declaradas

Nenhuma bloqueia a implementação.

- **Idioma.** A spec fixa `-l pt`. Auto-detect nunca foi testado, e o corpus rodou inteiro com o idioma forçado. Se você ditar em inglês com frequência, isso vira decisão.
- **Consumo de memória e energia.** Electron na barra o dia inteiro tem custo de RAM que nunca foi medido.
- **Renovação anual do certificado.** O DR embute o CN da folha; se ele mudar na renovação, o `safeStorage` perde a chave do Groq. Não confirmado — o experimento leva um ano. Sintoma: o app pede a API key de novo do nada.
- **`--vad-threshold`.** O portão usou o default `0.50` e acertou 6 de 6 no corpus, incluindo a fala mais baixa (RMS 0,0351). Fala sussurrada ou muito longe do microfone não foi testada.
- **`-ac` (audio context reduzido).** O encoder sempre paga uma janela de 30 s, então ditação curta desperdiça a maior parte. É a alavanca óbvia de latência, mas o trade-off qualidade/velocidade não foi medido por ninguém.

---

## Apêndice — o que o campo desmentiu

Quatro decisões travadas no papel foram invalidadas ao rodar de verdade. Registrado porque a spec parece mais firme do que o processo foi.

| Decisão no papel | O que a medição mostrou |
|---|---|
| Ligar `--vad` no `whisper-cli` | Engoliu `modules/home/hooks/useMenu.ts` e uma frase inteira. Virou portão, fora do caminho da transcrição. |
| Limiar de 15 palavras | A fala "curta" real tem 19 a 37 palavras. O limiar quase nunca dispararia. Subiu para 40. |
| `gpt-oss-120b` como fallback de qualidade | Perdeu para o `20b` no caso mais difícil: manteve as duas versões de uma auto-correção. |
| O Groq relata as correções que fez | 1 em 29. A trava que protege nomes de arquivo impede a detecção. O usuário virou a fonte da verdade. |

Nenhuma era visível sem gravar áudio real e chamar a API real.
