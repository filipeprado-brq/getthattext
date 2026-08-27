# Captura de áudio no Electron

Type: research
Status: resolved

## Question

Como capturar áudio do microfone num app Electron no macOS 15 e entregá-lo ao `whisper-cli` no formato que ele espera?

Cobrir:
- `getUserMedia` no renderer vs alternativas no main process — qual dá controle suficiente sobre início/fim da gravação
- Como reamostrar para **16kHz mono** com `AudioContext` / `OfflineAudioContext`, e se a qualidade sobrevive à conversão
- Como escrever o WAV: `MediaRecorder` produz WebM/Opus, não WAV — qual o caminho para PCM cru sem passar por transcodificação com ffmpeg?
- Entrega ao whisper: arquivo temporário vs stdin. Onde gravar o temp e como limpar
- Permissão de microfone no macOS: como é solicitada num app Electron, como detectar se foi negada, e o que acontece se o mic estiver ocupado por outro app (Zoom, Meet)
- Latência de abrir o device de áudio — importa porque push-to-talk precisa começar a gravar imediatamente ao apertar, sem perder as primeiras palavras
- Se vale manter o stream aberto o tempo todo para eliminar essa latência, e o custo disso

Gravar achados em `.scratch/getthattext/research/captura-de-audio.md`.

## Answer

Achados completos, com fonte no código do Chromium e do whisper.cpp: [`research/captura-de-audio.md`](../research/captura-de-audio.md) (850 linhas).

**Pipeline decidido:**

- **Captura no renderer.** `getUserMedia` é API web; o main process não tem equivalente. O main faz só permissão e o spawn do whisper. A `BrowserWindow` pode ser oculta.
- **`new AudioContext({ sampleRate: 16000 })`.** Garantido por spec (3000–768000 Hz) e implementado assim no Chromium. O `MediaStreamAudioSourceNode` reamostra 48k→16k com resampler sinc.
- **Mono pelo grafo** (`channelCount: 1, channelCountMode: 'explicit'`), não por constraint.
- **`AudioWorkletNode` → `Float32Array`, header WAV de 44 bytes escrito à mão.** Nada de `MediaRecorder` (produz WebM/Opus, exigiria decodificar depois), nada de ffmpeg.
- **Entrega por stdin: `whisper-cli -f -`.** Verificado no fonte (`common-whisper.cpp` trata `fname == "-"`). Sem arquivo em disco, sem cleanup a errar. O README oficial não menciona isso e está desatualizado — daí a necessidade de smoke test no binário empacotado.
- **Não delegar a reamostragem ao whisper.** Ele resolve, mas o resampler default do miniaudio é `ma_resample_algorithm_linear`, comentado no próprio fonte como "Fastest, lowest quality", com LPF de ordem 1.

**Fatos que outros tickets dependem:**

- **O Chromium adia o início de streams de input em 5 segundos após suspend/resume do Mac** (`kStartDelayInSecsForPowerEvents = 5`, com comentário confirmando que ainda é necessário em Nov/2025). Abrir a tampa e apertar o atalho imediatamente pode custar 5 s. **Consequência: a UI só pode dizer "gravando" quando o áudio realmente chegar, não no key-down.** Isso é obrigatório, não cosmético.
- **Não existe número público de latência de abertura do device.** Só os limites do Chromium (timeout de startup de 5 s). Precisa ser medido.
- **Pré-aquecimento que não custa privacidade:** criar o `AudioContext` e rodar `audioWorklet.addModule()` no boot abre device de **saída**, não de entrada — o ponto laranja não acende. Sobra só `getUserMedia` + `resume()` no key-down.
- **Mic ocupado por Zoom/Meet NÃO bloqueia.** O HAL do macOS é multi-cliente e o Chromium não usa hog mode. Os efeitos colaterais são de formato (taxa nativa, AEC/AGC), não de exclusividade. Isso derruba uma preocupação que estava na névoa.
- **Faltar `NSMicrophoneUsageDescription` ou o entitlement `com.apple.security.device.audio-input` causa crash, não prompt** (a doc da Apple diz que `requestAccess` "raises an exception"). Permissão negada não reabre o alerta e a mudança só vale após restart do app.
- **São duas camadas independentes de permissão:** a do Chromium (que aprova tudo por default no Electron — precisa de `setPermissionRequestHandler` **e** `setPermissionCheckHandler`) e a do TCC do macOS.

**Deixado em aberto de propósito:** a decisão sobre por quanto tempo manter o device aberto envolve um trade-off de privacidade visível (ponto laranja) que não é meu para tomar. Vira ticket próprio.
