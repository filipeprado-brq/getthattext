# Captura de áudio no Electron (macOS 15) → `whisper-cli`

Pesquisa contra fontes primárias (docs oficiais Electron, specs W3C/WHATWG, MDN, Apple Developer,
código-fonte de Chromium/whisper.cpp/miniaudio). Cada afirmação tem URL. O que não consegui verificar
está marcado explicitamente em **"Não verificado"**.

Data: 2026-08-26.

---

## 0. Resumo executivo

1. **A captura tem que acontecer no renderer.** `getUserMedia` é uma API web; o main process do Electron
   não tem equivalente. O main controla a sessão/permissão e executa o `whisper-cli`, mas o áudio
   nasce no renderer (que pode ser uma `BrowserWindow` oculta).
2. **`new AudioContext({ sampleRate: 16000 })` é a forma correta e é garantida por spec.** A spec do Web
   Audio obriga implementações a suportar 3000–768000 Hz, e Chromium implementa exatamente esse range.
   A conversão 48 kHz → 16 kHz do microfone é feita pelo `MediaStreamAudioSourceNode`, que a spec obriga
   a reamostrar para a taxa do contexto.
3. **Não use `MediaRecorder`.** Ele produz contêiner (WebM/Opus no Chromium) e você teria que decodificar
   depois. O caminho para PCM cru é `AudioWorkletNode` capturando `Float32Array` de 128 frames por render
   quantum, e escrever o header WAV de 44 bytes na mão.
4. **`whisper-cli` aceita stdin.** Verifiquei no fonte: `read_audio_data()` trata `fname == "-"` lendo
   stdin inteiro para memória e decodificando via miniaudio. Então `whisper-cli -f -` funciona.
   Mas ele **não é streaming** (lê tudo até EOF antes de decodificar).
5. **Não delegue a reamostragem ao whisper-cli.** Ele resolve (miniaudio converte formato/canais/taxa),
   mas o resampler default do miniaudio é `ma_resample_algorithm_linear` — "Fastest, lowest quality".
   Melhor entregar já em 16 kHz mono reamostrado pelo Chromium.
6. **Latência de abrir o device: sem número oficial publicado.** O que existe de concreto no fonte do
   Chromium: um timeout de 5 s para considerar a captura "iniciada com sucesso", e um **atraso deliberado
   de 5 segundos** para iniciar streams de áudio logo após suspend/resume do Mac. Isso é um risco real
   para push-to-talk.
7. **Manter o stream aberto elimina a latência, mas o ponto laranja fica aceso permanentemente** — a spec
   de Media Capture diz que o UA deve indicar continuamente enquanto o device está "live", e a Apple
   documenta o ponto laranja como "o microfone do seu Mac está em uso".

---

## 1. Onde capturar: renderer vs main process

### 1.1 Não existe captura de mic no main process

O Electron não expõe nenhuma API de captura de áudio de microfone no main process. As APIs de mídia do
main são:

- `systemPreferences.getMediaAccessStatus()` / `askForMediaAccess()` — só **permissão**, não captura.
  <https://www.electronjs.org/docs/latest/api/system-preferences>
- `desktopCapturer` / `session.setDisplayMediaRequestHandler` — para **captura de tela/áudio de sistema**,
  e ainda assim o consumo do stream acontece no renderer via `getDisplayMedia`.
  <https://www.electronjs.org/docs/latest/api/desktop-capturer>

Portanto: `navigator.mediaDevices.getUserMedia({ audio: … })` roda no renderer. (Alternativa fora do
Electron seria um addon nativo N-API falando CoreAudio direto — descarto: reintroduz build nativo,
assinatura, e a permissão TCC teria que ser negociada igual.)

### 1.2 Controle de início/fim é suficiente no renderer

O renderer tem controle total e síncrono o bastante:

- `stream.getAudioTracks()[0].stop()` encerra a fonte (spec: quando todas as tracks de uma fonte param,
  a fonte é parada e o UA marca `[[devicesLiveMap]][deviceId] = false`).
  <https://w3c.github.io/mediacapture-main/>
- `AudioWorkletNode` entrega frames continuamente; você decide onde começa e termina o buffer.
- `audioContext.suspend()` / `resume()` param o render graph sem fechar o device.

O que **não** é suficiente é o `globalShortcut` do Electron para push-to-talk: `register(accelerator, callback)`
dispara **um único callback no press**, não há key-up.
<https://www.electronjs.org/docs/latest/api/global-shortcut>
Push-to-talk com key-down/key-up precisa de outra fonte de eventos (módulo nativo de hook de teclado, ou
uma janela focada usando `keydown`/`keyup` do DOM). Isso é escopo de outro ticket, mas define de onde vêm
os sinais "começa"/"para".

### 1.3 Contexto seguro

`getUserMedia` só existe em secure context. Se a UI for servida por um custom scheme (`app://`),
registre-o com `secure: true` antes do evento `ready`:

```js
// main.js — antes de app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
```
<https://www.electronjs.org/docs/latest/api/protocol>

**Não verificado:** se `file://` no Chromium/Electron conta como potentially-trustworthy para
`getUserMedia`. Trate como risco e teste, ou use `app://`.

---

## 2. Permissão de microfone no macOS

São **duas camadas independentes** e ambas precisam passar.

### 2.1 Camada Chromium (permissão do "site")

Por padrão o Electron **aprova tudo**:

> "By default, Electron will automatically approve all permission requests unless the developer has
> manually configured a custom handler."
> <https://www.electronjs.org/docs/latest/tutorial/security>

Para um app local isso é conveniente, mas configure explicitamente os dois handlers — o Chromium usa
`setPermissionCheckHandler` (checagem síncrona) além do `setPermissionRequestHandler` (prompt):

```js
const { session } = require('electron')

session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
  if (permission === 'media' && details.mediaTypes?.includes('audio')) return callback(true)
  callback(false)
})

session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
  return permission === 'media' && details.mediaType === 'audio'
})
```

- Lista de permissões e assinatura dos handlers: <https://www.electronjs.org/docs/latest/api/session>
  A permission string é `'media'` ("Request access to media devices such as camera, microphone and speakers").
- `details` do request é um `MediaAccessPermissionRequest`: campos `securityOrigin` (string, opcional) e
  `mediaTypes` (string[], elementos `video` ou `audio`).
  <https://www.electronjs.org/docs/latest/api/structures/media-access-permission-request>
- No `setPermissionCheckHandler` o campo é `mediaType` (singular): `'video' | 'audio' | 'unknown'`.

### 2.2 Camada macOS (TCC)

`systemPreferences.getMediaAccessStatus('microphone')` retorna
`'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'`; `askForMediaAccess('microphone')`
retorna `Promise<boolean>` (macOS only).
<https://www.electronjs.org/docs/latest/api/system-preferences>

Pontos que a doc do Electron deixa explícitos e que mudam o design da UX:

- **Se já foi negado, o alerta não reaparece.** "Once denied, users must change permissions via System
  Preferences; alerts won't reappear."
- **Mudança de permissão exige restart do app** para valer.
- Em macOS 10.13 sempre retorna `granted` (irrelevante para macOS 15).

Fluxo recomendado no main, antes de mandar o renderer capturar:

```js
async function ensureMic () {
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return 'granted'
  if (status === 'not-determined') {
    const ok = await systemPreferences.askForMediaAccess('microphone')
    return ok ? 'granted' : 'denied'
  }
  // 'denied' | 'restricted': só resta abrir o painel do sistema
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
  return status
}
```

### 2.3 `NSMicrophoneUsageDescription` e entitlement

- **Info.plist**: `NSMicrophoneUsageDescription` — "A message that tells people why the app is requesting
  access to the device's microphone." E: "This key is required if your app uses APIs that access the
  device's microphone."
  <https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription>
- Consequência de faltar: a doc da Apple para `AVCaptureDevice.requestAccess(for:completionHandler:)` é
  categórica — "Calling this method or attempting to start a capture session without a usage description
  **raises an exception**."
  <https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess(for:completionhandler:)>
  Na prática: **crash**, não prompt.
- **Entitlement**: a doc do Electron (`systemPreferences`) diz que é preciso adicionar
  `com.apple.security.device.audio-input` = `<true/>` nos entitlements, senão o app pode crashar ao chamar
  `systemPreferences.askForMediaAccess('microphone')`.
  <https://www.electronjs.org/docs/latest/api/system-preferences> e
  <https://www.electronjs.org/docs/latest/tutorial/code-signing>

Texto sugerido (aparece no diálogo do sistema, em português para o usuário BR):

```xml
<key>NSMicrophoneUsageDescription</key>
<string>O GetThatText usa o microfone para transcrever sua fala em texto localmente, no seu Mac.</string>
```

Entitlements (`entitlements.mac.plist`):
```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

**Atenção em desenvolvimento:** rodando via `electron .`, o bundle que o macOS enxerga é o
`Electron.app` do `node_modules`, e o TCC atribui a permissão a ele — o `Info.plist` do seu app ainda não
existe. Sintomas de "prompt não aparece" ou "aparece com o texto errado" em dev são esperados; valide o
fluxo de permissão sempre no app empacotado.

### 2.4 Microfone ocupado por outro app (Zoom, Meet)

No macOS o HAL de áudio é **multi-cliente por padrão**: vários processos podem ter streams de input no
mesmo device simultaneamente. A exclusividade só existe se alguém tomar *hog mode*
(`kAudioDevicePropertyHogMode`, <https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertyhogmode>),
o que aplicativos de conferência normalmente não fazem.

Verifiquei que o Chromium **não usa hog mode** — `grep -i hogmode` em
`media/audio/mac/audio_manager_mac.cc` e `media/audio/apple/audio_low_latency_input.cc` não retorna nada
(<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/apple/audio_low_latency_input.cc>).
Ou seja: seu app não vai tomar o mic de ninguém, e nem deveria ser bloqueado por Zoom/Meet.

Os efeitos colaterais reais quando outro app está usando o mic são **de formato**, não de exclusividade:

- Se o outro app mudar a taxa nativa ou o layout de canais do device, o Chromium reabre com os novos
  parâmetros (`AudioManagerMac::GetInputStreamParameters` lê `HardwareSampleRateForDevice(device)` a cada
  abertura; fallback `kFallbackSampleRate = 44100`).
- Chromium pode ativar o VoiceProcessingIO (AEC nativo do macOS) dependendo dos constraints —
  `AUAudioInputStream::IsEchoCancellationSupported`. Com AEC/AGC ligados, o ganho e o espectro do sinal
  mudam. Para transcrição, prefira `echoCancellation: false, noiseSuppression: false, autoGainControl: false`
  e valide.

**Não verificado:** comportamento específico do macOS 15 quando o device muda de taxa com um stream do
Chromium aberto (se gera `ended`/`mute` na track). Trate `track.onended` e `track.onmute` defensivamente.

---

## 3. Reamostragem para 16 kHz mono

### 3.1 `AudioContext({ sampleRate: 16000 })` funciona — e é a rota certa

Spec (Web Audio API, §2.4 Supported Sample Rates):

> "Implementations MUST support sample rates between 3000 Hz and 768000 Hz, inclusive. A
> `NotSupportedError` MUST be thrown if a sample rate outside this range is specified."
> <https://webaudio.github.io/web-audio-api/>

Construtor do `AudioContext`:

> "If `contextOptions.sampleRate` is specified, set the `sampleRate` of context to this value. […] If
> `contextOptions.sampleRate` differs from the sample rate of the output device, the user agent MUST
> resample the audio output to match the sample rate of the output device."

Chromium implementa esse range literalmente:

```cpp
float MinAudioBufferSampleRate() { return 3000; }    // crbug.com/344375
float MaxAudioBufferSampleRate() { return 768000; }
bool IsValidAudioBufferSampleRate(float r) { return r >= Min… && r <= Max…; }
```
<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/platform/audio/audio_utilities.cc>
e a validação no construtor:
<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webaudio/audio_context.cc>
(`audio_utilities::IsValidAudioBufferSampleRate(sample_rate)` → lança se fora do range).

Então **16000 é aceito de forma confiável no macOS**. Não depende do hardware: o Chromium abre o device
mac na taxa nativa (48 kHz tipicamente) e reamostra.

### 3.2 Quem faz a reamostragem do microfone

O caminho do mic → contexto é coberto normativamente:

> "If the sample rate of the `MediaStreamTrack` differs from the sample rate of the associated
> `AudioContext`, then the output of the `MediaStreamTrack` is resampled to match the context's sample rate."
> — Web Audio API §1.24, `MediaStreamAudioSourceNode`
> <https://webaudio.github.io/web-audio-api/#MediaStreamAudioSourceNode>

E o Chromium de fato abre o device na taxa de hardware (não em 16 kHz):

```cpp
int sample_rate = HardwareSampleRateForDevice(device);
if (!sample_rate) sample_rate = kFallbackSampleRate;  // 44100
const int buffer_size = ChooseBufferSize(true, sample_rate);
```
<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/mac/audio_manager_mac.cc>

### 3.3 A qualidade sobrevive?

Para Whisper, sim, com folga — mas por razões que vale registrar:

- Whisper é treinado em 16 kHz. `WHISPER_SAMPLE_RATE` é 16000 em todo o whisper.cpp
  (<https://github.com/ggml-org/whisper.cpp>). Fala humana inteligível cabe em banda ≤8 kHz (Nyquist de
  16 kHz). A perda de 48→16 kHz é de conteúdo acima de 8 kHz, que o modelo ignora de qualquer forma.
- O que importa é o **anti-aliasing** do resampler. O resampler do Chromium (`media::SincResampler`,
  usado no pipeline WebAudio) é sinc-windowed; o do miniaudio no whisper.cpp é **linear**:
  ```c
  ma_resample_algorithm_linear = 0,  /* Fastest, lowest quality. Optional low-pass filtering. Default. */
  …
  config.resampling.linear.lpfOrder = 1;
  ```
  <https://github.com/mackron/miniaudio/blob/master/miniaudio.h>
  Um low-pass de ordem 1 antes de decimar 3:1 deixa passar aliasing audível.

**Conclusão:** reamostre no Web Audio (sinc), não deixe para o miniaudio (linear + LPF ordem 1).

### 3.4 Mono

Deixe o grafo fazer o downmix, seguindo a regra normativa de speakers downmix
(Web Audio §4.5): `2 → 1 : output = 0.5 * (input.L + input.R)`.

```js
const node = new AudioWorkletNode(ctx, 'pcm-capture', {
  numberOfInputs: 1,
  numberOfOutputs: 0,
  channelCount: 1,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers'   // aplica a fórmula de downmix da spec
})
```

Alternativa: peça mono já no constraint (`channelCount: { ideal: 1 }`) — mas isso é *hint*, e o Chromium
no macOS pode abrir estéreo mesmo assim (`GetInputDeviceChannels(device, &channels)` acima). Configure
o worklet como acima e não dependa do constraint.

### 3.5 `OfflineAudioContext` — quando (não) usar

`OfflineAudioContext(numberOfChannels, length, sampleRate)` renderiza mais rápido que tempo real e é a
ferramenta certa para reamostrar um `AudioBuffer` **que você já tem inteiro**
(<https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/OfflineAudioContext>).

Isso só faria sentido se você gravasse em 48 kHz e convertesse depois. Para push-to-talk é pior:
adiciona um passo de render **depois** do key-up, ou seja, latência que o usuário sente. Com
`AudioContext({ sampleRate: 16000 })` a reamostragem acontece durante a fala, de graça.

**Ressalva:** MDN documenta o range obrigatório do `OfflineAudioContext` como 8000–96000 Hz, mais estreito
que o do `AudioContext` — 16000 está dentro, sem problema.

---

## 4. Escrevendo o WAV: do `Float32Array` ao PCM 16-bit

### 4.1 Por que não `MediaRecorder`

`MediaRecorder` grava em **contêiner**; a spec não define nenhum formato obrigatório e manda checar
`MediaRecorder.isTypeSupported()`
(<https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder>). No Chromium isso é
WebM/Opus (ou MP4/AAC), não WAV/PCM. Usar `MediaRecorder` te obrigaria a decodificar Opus depois —
com ffmpeg ou com `decodeAudioData` — o que é exatamente o que queremos evitar.

### 4.2 `AudioWorkletNode` — o caminho para PCM cru

O `AudioWorkletProcessor.process()` recebe blocos de `Float32Array` por canal:

```webidl
callback AudioWorkletProcessCallback = boolean (
  sequence<sequence<Float32Array>> inputs,
  sequence<sequence<Float32Array>> outputs,
  object parameters
);
```

Tamanho do bloco (render quantum): "Its default value is 128, and it can be configured by setting
`renderSizeHint`." <https://webaudio.github.io/web-audio-api/>

A 16 kHz, 128 frames = **8 ms** por callback. Ou seja, granularidade de start/stop de 8 ms — muito abaixo
de qualquer coisa perceptível em push-to-talk.

Processor (`pcm-capture.worklet.js`):

```js
class PcmCapture extends AudioWorkletProcessor {
  constructor () {
    super()
    this.recording = false
    this.port.onmessage = (e) => { this.recording = e.data === 'start' }
  }

  process (inputs) {
    const ch = inputs[0]?.[0]          // 1 canal (channelCount: 1, explicit)
    if (!ch) return true               // fonte ainda não conectada
    if (this.recording) {
      // cópia: o Float32Array é reciclado entre render quanta
      const copy = new Float32Array(ch)
      this.port.postMessage(copy, [copy.buffer])   // transferível: zero-copy
    }
    return true                        // mantém o processor vivo
  }
}
registerProcessor('pcm-capture', PcmCapture)
```

Notas:
- O `Float32Array` de `inputs` **não pode ser retido** — copie. (Referência de uso do AudioWorklet:
  <https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process>)
- `postMessage` com transferable evita cópia extra. Para 16 kHz mono são ~64 KB/s de tráfego — irrelevante.
  Se quiser eliminar o `postMessage`, um ring buffer em `SharedArrayBuffer` funciona, mas em Electron
  exige headers de cross-origin isolation ou `--enable-features`; não vale a complexidade aqui.
- **Volume máximo:** 30 s de fala em f32 = 30 × 16000 × 4 B = 1,9 MB. Acumular em array de chunks está OK.

### 4.3 Float32 → Int16

Ranges normativos (WebCodecs §9.3.2, "Magnitude of the audio samples"):

| Sample type | IDL | Mínimo | Bias | Máximo |
|---|---|---|---|---|
| `s16` | short | −32768 | 0 | +32767 |
| `f32` | float | −1.0 | 0.0 | +1.0 |

<https://w3c.github.io/webcodecs/>

Note que a faixa é **assimétrica** em s16. A conversão correta preserva o zero e não estoura o positivo:

```js
function f32ToS16 (input) {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))   // clamp: f32 pode passar de ±1
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff        // -1 → -32768 ; +1 → +32767
  }
  return out
}
```

Usar `s * 0x8000` para os dois lados clipa em +1.0 (32768 estoura o Int16 e vira −32768 — um clique
audível). A spec do WebCodecs é explícita que os valores f32 podem sair do intervalo durante
processamento intermediário ("they are otherwise regular types, that can hold values outside this
interval"), então o clamp é obrigatório.

### 4.4 Layout exato do header WAV (44 bytes, PCM canônico)

RIFF é **little-endian**; um FOURCC "abcd" é 0x64636261 num sistema little-endian
(<https://learn.microsoft.com/en-us/windows/win32/xaudio2/resource-interchange-file-format--riff->).
Estrutura: chunk `RIFF` contendo o form type `WAVE`, um chunk `fmt ` com um `WAVEFORMATEX` e um chunk `data`.

Campos do `WAVEFORMATEX`
(<https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex>):
`wFormatTag` (WORD), `nChannels` (WORD), `nSamplesPerSec` (DWORD), `nAvgBytesPerSec` (DWORD),
`nBlockAlign` (WORD), `wBitsPerSample` (WORD), `cbSize` (WORD — "For WAVE_FORMAT_PCM formats
(and only WAVE_FORMAT_PCM formats), this member is ignored", por isso o chunk `fmt ` PCM tem 16 bytes).

Regras: `nBlockAlign = nChannels * wBitsPerSample / 8`; `nAvgBytesPerSec = nSamplesPerSec * nBlockAlign`.

Para 16 kHz / mono / 16-bit:

| Offset | Tam. | Tipo | Valor | Campo |
|---|---|---|---|---|
| 0  | 4 | ASCII  | `"RIFF"`   | ckID |
| 4  | 4 | u32 LE | `36 + N`   | ckSize (tudo depois deste campo) |
| 8  | 4 | ASCII  | `"WAVE"`   | formType |
| 12 | 4 | ASCII  | `"fmt "`   | subchunk id (com espaço!) |
| 16 | 4 | u32 LE | `16`       | tamanho do bloco fmt (PCM) |
| 20 | 2 | u16 LE | `1`        | wFormatTag = WAVE_FORMAT_PCM |
| 22 | 2 | u16 LE | `1`        | nChannels |
| 24 | 4 | u32 LE | `16000`    | nSamplesPerSec |
| 28 | 4 | u32 LE | `32000`    | nAvgBytesPerSec = 16000 × 2 |
| 32 | 2 | u16 LE | `2`        | nBlockAlign = 1 × 16/8 |
| 34 | 2 | u16 LE | `16`       | wBitsPerSample |
| 36 | 4 | ASCII  | `"data"`   | subchunk id |
| 40 | 4 | u32 LE | `N`        | tamanho dos dados em bytes |
| 44 | N | s16 LE | …          | amostras |

`N = numFrames * 2`. Os dados devem ser padded para WORD boundary — com 16-bit mono `N` já é sempre par.

```js
function encodeWav (pcm /* Int16Array */, sampleRate = 16000, channels = 1) {
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = pcm.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buf)
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }

  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true)                       // PCM fmt chunk size
  dv.setUint16(20, 1, true)                        // WAVE_FORMAT_PCM
  dv.setUint16(22, channels, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * blockAlign, true)  // nAvgBytesPerSec
  dv.setUint16(32, blockAlign, true)
  dv.setUint16(34, 8 * bytesPerSample, true)       // wBitsPerSample
  ascii(36, 'data')
  dv.setUint32(40, dataSize, true)
  new Int16Array(buf, 44).set(pcm)                 // host é LE em x64/arm64
  return new Uint8Array(buf)
}
```

Um detalhe: `new Int16Array(buf, 44).set(pcm)` usa a endianness do host. macOS (Intel e Apple Silicon) é
little-endian, então está correto. Se quiser ser pedante/portável, escreva com `dv.setInt16(off, v, true)`
num loop.

---

## 5. Entrega ao `whisper-cli`: stdin vs arquivo temporário

### 5.1 `whisper-cli` **aceita stdin** — verificado no fonte

`examples/common-whisper.cpp`, `read_audio_data()`:

```cpp
if (fname == "-") {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
#endif
    uint8_t buf[1024];
    while (true) {
        const size_t n = fread(buf, 1, sizeof(buf), stdin);
        if (n == 0) break;
        audio_data.insert(audio_data.end(), buf, buf + n);
    }
    result = ma_decoder_init_memory(audio_data.data(), audio_data.size(), &decoder_config, &decoder);
    …
    fprintf(stderr, "%s: read %zu bytes from stdin\n", __func__, audio_data.size());
}
```
<https://github.com/ggml-org/whisper.cpp/blob/master/examples/common-whisper.cpp>

E o `cli.cpp` explicitamente **pula a checagem de existência de arquivo** para `-`:

```cpp
if (*it != "-" && !is_file_exist(fname_inp)) {
    fprintf(stderr, "error: input file not found '%s'\n", fname_inp);
```
<https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp>

Histórico: o suporte a stdin existe desde 2022 (commit `7519eabf` "Adds support for stdin wav input");
`-` como stdout foi adicionado em 2025 (`934d4b30`, PR #3050).
`https://github.com/ggml-org/whisper.cpp/commits/master`

Ou seja: `whisper-cli -m model.bin -f - --no-timestamps -otxt -of -` funciona, alimentado por
`child.stdin.write(wavBytes); child.stdin.end()`.

**Caveats importantes:**
- **Não é streaming.** Ele faz `fread` até EOF, junta tudo em `audio_data`, e só então decodifica.
  Você não ganha nada tentando enviar áudio durante a fala; só depois do key-up é que faz sentido.
- O header WAV precisa estar **correto e completo** (o miniaudio decodifica de memória). Nada de
  `dataSize = 0xFFFFFFFF` ou header "de streaming".
- O `decoder_config` é `ma_decoder_config_init(ma_format_f32, mono?1:2, WHISPER_SAMPLE_RATE)` — o
  miniaudio **converterá** formato/canais/taxa se você mandar outra coisa, com o resampler linear
  (ver §3.3). Mande 16 kHz mono e a conversão vira no-op.
- O README do whisper.cpp ainda diz "the whisper-cli example currently runs only with 16-bit WAV files"
  e mostra `ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav`
  (<https://github.com/ggml-org/whisper.cpp>) — a documentação está **atrasada** em relação ao código.
  Confie no fonte, mas **pin/verifique a versão do binário que você empacotar**: rode
  `printf '' | whisper-cli -f - 2>&1 | head` uma vez no CI e confirme a mensagem
  `read_audio_data: read 0 bytes from stdin`.

### 5.2 Arquivo temporário

Onde: `app.getPath('temp')` — "Returns the system's temporary directory location"
(<https://www.electronjs.org/docs/latest/api/app>). No macOS isso é o `$TMPDIR` por usuário
(`/var/folders/…/T/`), que é privado ao usuário e limpo pelo sistema periodicamente.

Padrão seguro (diretório próprio + cleanup determinístico):

```js
const fs = require('node:fs/promises')
const path = require('node:path')
const { app } = require('electron')

async function withTempWav (bytes, fn) {
  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'gtt-'))
  const file = path.join(dir, 'audio.wav')
  try {
    await fs.writeFile(file, bytes, { mode: 0o600 })
    return await fn(file)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
```

Cleanup: `finally` cobre o caminho normal e o de erro. Cobrir crash/kill do app exige uma varredura de
`gtt-*` órfãos no `app.on('ready')` — barato e vale a pena, porque são gravações de voz do usuário
deitadas no disco.

### 5.3 Recomendação: **stdin**

| | stdin (`-f -`) | arquivo temp |
|---|---|---|
| Áudio tocando o disco | não | sim (dado sensível) |
| Cleanup a implementar | nenhum | mkdtemp + rm + varredura de órfãos |
| I/O extra | nenhum | write + read |
| Compatibilidade | verificada no fonte, não documentada no README | documentada e óbvia |
| Debug ("me manda o wav") | precisa de flag extra | trivial |

Use **stdin** como caminho padrão e mantenha um flag de debug (`GTT_KEEP_WAV=1`) que grava o mesmo buffer
em `app.getPath('temp')` para inspeção. Se o binário empacotado surpreender no smoke test, o fallback para
arquivo é trocar uma função.

```js
const { execFile } = require('node:child_process')

function transcribe (wavBytes, { bin, model }) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin,
      ['-m', model, '-f', '-', '-l', 'pt', '-nt', '-np', '-otxt', '-of', '-'],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()))
    child.stdin.on('error', reject)   // EPIPE se o processo morrer antes do end()
    child.stdin.end(Buffer.from(wavBytes))
  })
}
```
(`child.stdin.on('error')` não é opcional: sem ele, um EPIPE derruba o processo Electron inteiro.)

---

## 6. Latência de abrir o device de áudio

### 6.1 O que existe de figura documentada

**Não encontrei nenhum número oficial publicado** para o tempo de `getUserMedia` → primeiro frame de áudio,
nem em spec, nem em MDN, nem em docs do Electron/Chrome. O que existe são constantes e instrumentação no
fonte do Chromium, que dão os limites superiores que a própria engenharia do Chrome considera:

1. **Timeout de startup de 5 s** (macOS):
   ```cpp
   // CheckInputStartupSuccess() after this amount of time. UMA stats marked
   // Media.Audio.InputStartupSuccessMac is then updated where true is added
   constexpr base::TimeDelta kInputCallbackStartTimeout = base::Seconds(5);
   ```
   <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/apple/audio_low_latency_input.cc>
   O histograma correspondente é descrito como "Indicates if audio capturing did start after stream
   startup was requested. **Sampled once, a few seconds after** a stream has been asked to start."
   <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/tools/metrics/histograms/metadata/media/histograms.xml>

2. **Atraso deliberado de 5 s após suspend/resume** — este é o achado mais relevante para push-to-talk:
   ```cpp
   // OSX has issues with starting streams as the system goes into suspend and
   // immediately after it wakes up from resume. See http://crbug.com/160920.
   // As a workaround we delay Start() when it occurs after suspend and for a
   // small amount of time after resume.
   // As of Nov 2025, this is still helpful, see https://crbug.com/447640763.
   enum { kStartDelayInSecsForPowerEvents = 5 };
   ```
   <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/mac/audio_manager_mac.h>
   E o caminho que usa isso, em `AUAudioInputStream::Start()`:
   ```cpp
   if (manager_->ShouldDeferStreamStart()) {
     SendLog("Start of input audio is deferred");
     manager_->GetTaskRunner()->PostDelayedTask(FROM_HERE, deferred_start_cb_.callback(),
         base::Seconds(std::to_underlying(AudioManagerMac::kStartDelayInSecsForPowerEvents)));
     return;
   }
   ```
   **Consequência prática:** se o usuário abrir a tampa do MacBook e imediatamente apertar o push-to-talk,
   o Chromium pode atrasar o início da captura em até 5 segundos. Isso não é um bug seu, mas você precisa
   de UI que mostre "gravando" só quando o áudio realmente começar a chegar.

3. **Chromium mede** `Media.AudioInputController.CreateTime` (units="ms") — "Measures the execution time
   of `AudioInputController::Create`". Existe a métrica, mas os percentis são internos do Google; não há
   valor público.
   `SCOPED_UMA_HISTOGRAM_TIMER("Media.AudioInputController.CreateTime")` em
   <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/services/audio/input_controller.cc>

### 6.2 De onde a latência vem, em ordem de custo

Sem números oficiais, o que dá para afirmar estruturalmente:

- **Prompt TCC**, se `getMediaAccessStatus() !== 'granted'`: segundos a minutos (interação humana). Elimine
  isso pedindo a permissão no onboarding, não no primeiro push-to-talk.
- **IPC renderer → browser → Audio Service** e criação do `AudioInputController` (processo separado).
- **`AudioUnitInitialize` + `AudioOutputUnitStart`** no CoreAudio, incluindo, quando aplicável, a
  inicialização do `VoiceProcessingIO` (AEC nativo do macOS) — historicamente o mais caro dos dois modos.
- **`AudioWorklet.addModule()`** — carrega e compila o processor; é `await`-ável e não deveria estar no
  caminho crítico do key-down.

### 6.3 Mitigação que não custa privacidade

Pré-aqueça tudo **menos** o device:

```js
// no boot do app, depois de permissão concedida — NÃO acende o ponto laranja
const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
await ctx.audioWorklet.addModule('pcm-capture.worklet.js')
const worklet = new AudioWorkletNode(ctx, 'pcm-capture', { /* … */ })
await ctx.suspend()   // grafo parado, nenhum device de input aberto
```

Criar um `AudioContext` sozinho abre um device de **saída**, não de entrada — o ponto laranja (mic) não
acende. Assim, no key-down sobra só `getUserMedia` + `createMediaStreamSource` + `ctx.resume()`.

**Não verificado:** quanto isso economiza em ms no macOS 15. Meça com
`performance.now()` entre o key-down e o primeiro `process()` que recebe amostras não-nulas, e trate como
número do seu app, não da plataforma.

---

## 7. Manter o stream aberto permanentemente

### 7.1 O ponto laranja fica aceso — sim

Apple, sobre os privacy indicators:

> "Privacy indicators are the orange and green dots that appear next to Control Center in the menu bar"
> — e um ponto laranja indica que "the microphone on your Mac is in use".
> <https://support.apple.com/en-us/118449>

E a spec de Media Capture obriga o UA a indicar isso:

> "The User Agent MUST indicate to the user when the value of `anyLive` changes. […] Any false-to-true
> transition indicated MUST remain observable for a sufficient time that a reasonably-observant user could
> become aware of it. This SHOULD be at least 3 seconds."
> <https://w3c.github.io/mediacapture-main/>

Além do ponto: o Control Center do macOS mostra a lista de apps usando o microfone (macOS 13.3+), e ela
inclui o seu app enquanto o stream existir. Um app de ditado com o ponto laranja aceso o dia inteiro é
indistinguível, para o usuário, de um app que grava tudo. Isso é um problema de produto, não só de UX.

### 7.2 `track.enabled = false` não resolve limpo

MDN: `enabled = false` **não libera o device**, só emite frames de silêncio; e observa que para vídeo
"the green 'in use' light next to the camera in iMac and MacBook computers turns off while the track is
muted in this way".
<https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/enabled>

A spec vai além, e é aqui que a estratégia se desfaz:

> "When a 'live', unmuted, and enabled track sourced by a device exposed by `getUserMedia()` becomes either
> muted or disabled, and this brings all tracks connected to the device (across all navigables the user
> agent operates) to be either muted, disabled, or stopped, then the UA **SHOULD relinquish the device
> within 3 seconds**"
> <https://w3c.github.io/mediacapture-main/>

Ou seja: o comportamento *desejado* pela spec é exatamente devolver o device — o que apaga o ponto laranja
**e traz de volta a latência de reabertura**. Você não pode ter as duas coisas por design da plataforma.

**Não verificado:** se o Chromium/Electron atual implementa esse "relinquish within 3 seconds" para
tracks de **áudio** no macOS (MDN só documenta o caso de câmera). Procurei no issue tracker do Chromium e
não achei documento normativo. **Isso precisa de teste empírico** antes de qualquer decisão de arquitetura:
com um `getUserMedia` ativo e `track.enabled = false`, observe se o ponto laranja apaga em ~3 s.

### 7.3 Custo além do indicador

- **Processo/energia:** o Audio Service do Chromium mantém uma callback de CoreAudio rodando a cada
  `ChooseBufferSize(true, sample_rate)` frames (o input usa `limits::kMinAudioBufferSize`, ajustado por
  `GetMinAudioBufferSizeMacOS`) — ou seja, um wakeup por poucos ms, indefinidamente. Em notebook, isso
  aparece no consumo.
  <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/audio/mac/audio_manager_mac.cc>
- **Robustez:** troca de device (fone Bluetooth conectando), suspend/resume e mudança de taxa nativa
  geram `mute`/`ended` na track. Um stream de vida longa precisa de reconexão; um stream de vida curta
  simplesmente é aberto de novo na próxima vez.
- **Vantagem real:** com stream permanente dá para manter um **ring buffer de pré-roll** (ex.: 300 ms) e
  incluir o áudio *anterior* ao key-down na transcrição — resolvendo o "cortou as primeiras palavras" de
  forma que abrir-no-key-down nunca resolve.

### 7.4 Meio-termo recomendado

Uma terceira via, que preserva o indicador honesto e mata quase toda a latência: **abrir no key-down, mas
manter aberto por uma janela de inatividade curta** (ex.: 20–30 s desde o último uso), fechando depois.

- O primeiro push-to-talk de uma sessão paga a latência de abertura.
- Os seguintes (o caso comum: o usuário dita várias frases em sequência) são instantâneos.
- O ponto laranja fica aceso durante a sessão de ditado e apaga quando o usuário para — o que é
  **exatamente o que ele significa** e portanto defensável.

---

## 8. Pipeline recomendado (esqueleto)

```
[main]  systemPreferences.getMediaAccessStatus('microphone')
          └─ 'not-determined' → askForMediaAccess()  (no onboarding, não no key-down)
        session.setPermissionRequestHandler / setPermissionCheckHandler → 'media'+audio ⇒ true

[renderer, boot]
        ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
        await ctx.audioWorklet.addModule('pcm-capture.worklet.js')
        await ctx.suspend()

[renderer, key-down]
        stream = await getUserMedia({ audio: { echoCancellation:false,
                                               noiseSuppression:false,
                                               autoGainControl:false } })
        src = ctx.createMediaStreamSource(stream)   // resample 48k→16k pela spec
        src.connect(worklet)                        // channelCount:1 explicit ⇒ downmix 0.5*(L+R)
        await ctx.resume(); worklet.port.postMessage('start')
        → chunks: Float32Array(128) a cada 8 ms

[renderer, key-up]
        worklet.port.postMessage('stop'); src.disconnect()
        (idle timer 20–30s → stream.getAudioTracks()[0].stop())
        pcm  = concat(chunks) → f32ToS16 → encodeWav(16000, 1)
        ipcRenderer.invoke('transcribe', wavBytes)   // Uint8Array via structured clone

[main]  execFile(whisperCli, ['-m', model, '-f', '-', '-l','pt', '-nt','-np','-otxt','-of','-'])
        child.stdin.end(Buffer.from(wavBytes))
        → stdout = texto
```

Concatenação dos chunks (o único ponto onde vale otimizar se a gravação for longa):

```js
function concat (chunks) {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Float32Array(n)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}
```

Guard-rails que valem o código:

- Se `chunks` estiver vazio ou o RMS for ~0, não chame o whisper — ele alucina texto em cima de silêncio.
- Limite duração máxima (ex.: 120 s) e avise; 120 s a 16 kHz mono s16 = 3,8 MB, tranquilo em stdin.
- Trate `track.onended` (device sumiu) parando a gravação e mostrando erro, não travando o hotkey.

---

## 9. O que ficou não verificado

1. Se o Chromium/Electron atual **libera o device de input** (e apaga o ponto laranja) quando todas as
   tracks de áudio ficam `enabled = false`, no macOS 15. A spec diz SHOULD; MDN só documenta o caso de
   câmera. **Precisa de teste empírico.**
2. **Número real de latência** de `getUserMedia` → primeiro frame no macOS 15 com Electron. Não há figura
   pública. As únicas constantes concretas são o timeout de 5 s de startup e o deferral de 5 s pós-resume,
   ambos limites superiores/patológicos, não o caso comum.
3. Se `file://` é tratado como secure context suficiente para `getUserMedia` no Electron atual.
4. Comportamento do macOS 15 quando outro app muda a taxa nativa do device com um stream do Chromium
   aberto (se a track dispara `mute`/`ended`).
5. A versão exata do `whisper-cli` empacotada — o suporte a `-f -` está no `master`, mas confirme no
   binário que você distribuir (smoke test no CI).

---

## 10. Recomendação

**Capture no renderer, reamostre no Web Audio, escreva o WAV à mão, entregue por stdin.**

1. **Processo:** `getUserMedia` numa `BrowserWindow` (pode ser oculta) servida por um scheme registrado
   como `secure`. Main faz só permissão + spawn do whisper.
2. **Permissão:** peça `askForMediaAccess('microphone')` no onboarding, nunca no primeiro key-down.
   Configure `setPermissionRequestHandler` **e** `setPermissionCheckHandler` para `'media'`+`audio`.
   `NSMicrophoneUsageDescription` no Info.plist e `com.apple.security.device.audio-input` nos entitlements
   — sem eles é crash, não prompt. Detecte `'denied'`/`'restricted'` e leve o usuário direto ao painel do
   sistema, porque o alerta não reaparece e a mudança só vale depois de restart do app.
3. **Taxa:** `new AudioContext({ sampleRate: 16000 })`. É garantido por spec (3000–768000 Hz) e
   implementado assim no Chromium. O `MediaStreamAudioSourceNode` reamostra 48 k → 16 k com resampler
   sinc. **Não** delegue a reamostragem ao whisper-cli (miniaudio linear, LPF ordem 1).
4. **Mono:** pelo grafo (`channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'`),
   não pelo constraint.
5. **PCM:** `AudioWorkletNode` → `Float32Array(128)` a cada 8 ms via `postMessage` transferível.
   Nada de `MediaRecorder`, nada de ffmpeg.
6. **WAV:** header de 44 bytes little-endian conforme a tabela da §4.4; conversão f32→s16 com clamp e
   `s < 0 ? s*0x8000 : s*0x7fff`.
7. **Entrega:** `whisper-cli -f -` com o WAV completo em stdin (verificado no fonte). Sem arquivo no disco,
   sem cleanup a errar. Mantenha um fallback para `app.getPath('temp')` + `mkdtemp`/`rm` atrás de flag de
   debug, e um smoke test de CI que confirma o `-f -` no binário empacotado.
8. **Latência / stream aberto:** pré-aqueça `AudioContext` + `addModule` no boot (não acende o ponto laranja),
   abra o device no key-down e **mantenha aberto por uma janela de inatividade de ~20–30 s**. Isso paga a
   latência uma vez por sessão de ditado em vez de uma vez por frase, e mantém o ponto laranja honesto:
   aceso enquanto o usuário está ditando, apagado quando ele para. Manter o stream aberto 24/7 elimina
   ~100% da latência e habilita pré-roll, mas deixa o indicador laranja permanentemente aceso — custo de
   privacidade que não recomendo pagar num app de ditado.
9. **Mostre "gravando" só quando o áudio realmente chegar** (primeiro `process()` com dados), não no
   key-down. O deferral de 5 s pós-resume do Chromium torna isso obrigatório, não cosmético.

### Antes de fechar o design, rode dois experimentos

- **E1 (latência):** meça `performance.now()` do key-down até o primeiro frame não-nulo, 50 repetições,
  em três condições: device frio, device recém-usado, e logo após abrir a tampa do MacBook.
- **E2 (indicador):** com stream ativo e `track.enabled = false`, cronometre se e quando o ponto laranja
  apaga. O resultado decide se a estratégia de §7.4 pode ser substituída por "stream sempre aberto,
  mute lógico" — que seria melhor, se o indicador cooperasse.
