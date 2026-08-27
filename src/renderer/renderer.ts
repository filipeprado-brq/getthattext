import { encodeWav } from "../shared/wav.js";
import "../shared/bridge.js";

/** A taxa que o whisper.cpp espera. Pedimos direto ao Web Audio. */
const TARGET_SAMPLE_RATE = 16_000;

/** Teto de gravação da spec: dois minutos. */
const MAX_DURATION_MS = 2 * 60 * 1000;

/**
 * Folga para os quanta já postados pelo worklet chegarem depois que o
 * microfone é desconectado. São ~8 ms por bloco a 16 kHz; sem essa espera
 * o fim da fala se perdia.
 */
const DRAIN_MS = 60;

/** O grafo de áudio, montado uma vez no pré-aquecimento. */
type AudioGraph = {
  context: AudioContext;
  captureNode: AudioWorkletNode;
};

/** Uma gravação em curso. Existir já significa "gravando". */
type Recording = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  chunks: Float32Array[];
  maxDurationTimer: ReturnType<typeof setTimeout>;
  startedAt: number | undefined;
};

const recordButton = document.querySelector<HTMLButtonElement>("#gravar")!;
const statusLine = document.querySelector<HTMLParagraphElement>("#estado")!;
const resultLine = document.querySelector<HTMLParagraphElement>("#resultado")!;

let graph: AudioGraph | undefined;
let recording: Recording | undefined;
/** Trava contra clique duplo enquanto o microfone abre ou o arquivo salva. */
let busy = false;

/** Soma os frames de uma lista de blocos. */
function countFrames(chunks: readonly Float32Array[]): number {
  let frames = 0;
  for (const chunk of chunks) frames += chunk.length;
  return frames;
}

function showFailure(message: string): void {
  statusLine.textContent = message;
  recordButton.textContent = "Gravar";
  recordButton.classList.remove("gravando");
  recordButton.disabled = false;
}

/**
 * Cria o contexto e compila o worklet no boot.
 *
 * Isso abre um device de SAÍDA, não de entrada — o ponto laranja do macOS
 * não acende. No clique sobra só o `getUserMedia` e o `resume()`, que é
 * onde a spec quer que a latência fique.
 */
async function prewarm(): Promise<void> {
  const context = new AudioContext({
    sampleRate: TARGET_SAMPLE_RATE,
    latencyHint: "interactive",
  });
  await context.audioWorklet.addModule("./pcm-worklet.js");

  // O nó só é processado se o grafo for puxado a partir do destino.
  // Ele não escreve nada na saída, então não há eco.
  const captureNode = new AudioWorkletNode(context, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  captureNode.connect(context.destination);

  captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const current = recording;
    if (!current) return;
    if (current.startedAt === undefined) markAudioFlowing(current);
    current.chunks.push(event.data);
  };

  await context.suspend();
  graph = { context, captureNode };

  if (context.sampleRate !== TARGET_SAMPLE_RATE) {
    // Garantido pela spec do Web Audio, mas se a plataforma ignorar, o WAV
    // sairia com a taxa errada em silêncio.
    resultLine.textContent = `Atenção: o contexto abriu a ${context.sampleRate} Hz, não a ${TARGET_SAMPLE_RATE} Hz.`;
  }

  recordButton.disabled = false;
  recordButton.textContent = "Gravar";
  statusLine.textContent = "Pronto";
}

/**
 * O cronômetro só começa quando o primeiro frame chega de verdade.
 *
 * O Chromium adia o início da captura em até 5 s depois que o Mac acorda do
 * sleep. Marcar no clique faria você falar no vazio achando que gravou.
 */
function markAudioFlowing(current: Recording): void {
  current.startedAt = performance.now();
  recordButton.textContent = "Parar";
  recordButton.classList.add("gravando");
  tick();
}

function tick(): void {
  const current = recording;
  if (!current?.startedAt) return;
  const seconds = (performance.now() - current.startedAt) / 1000;
  statusLine.textContent = `Gravando — ${seconds.toFixed(1)}s`;
  requestAnimationFrame(tick);
}

async function startRecording(): Promise<void> {
  if (!graph || recording || busy) return;

  busy = true;
  recordButton.disabled = true;
  recordButton.textContent = "Abrindo o microfone…";
  statusLine.textContent = "Abrindo o microfone";
  resultLine.textContent = "";

  let stream: MediaStream;
  try {
    // Mono é definido pelo grafo, não por constraint: pedir por constraint
    // deixa a decisão para o driver, que nem sempre obedece.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    busy = false;
    showFailure(
      error instanceof Error && error.name === "NotAllowedError"
        ? "Permissão de microfone negada."
        : `Falha ao abrir o microfone: ${String(error)}`,
    );
    return;
  }

  // Ligar o portão ANTES de conectar: a flag leva um tempo para atravessar
  // até a thread de áudio, e conectar primeiro perderia os quanta iniciais.
  graph.captureNode.port.postMessage("start");

  const source = graph.context.createMediaStreamSource(stream);
  source.connect(graph.captureNode);
  await graph.context.resume();

  recording = {
    stream,
    source,
    chunks: [],
    startedAt: undefined,
    maxDurationTimer: setTimeout(() => {
      void stopRecording("limite de 2 minutos atingido");
    }, MAX_DURATION_MS),
  };

  busy = false;
  recordButton.disabled = false;
}

async function stopRecording(reason?: string): Promise<void> {
  const current = recording;
  if (!current || !graph || busy) return;

  busy = true;
  recordButton.disabled = true;
  clearTimeout(current.maxDurationTimer);

  // Desconectar corta a fonte, mas os quanta já postados ainda estão a
  // caminho — e são fala de verdade. Só depois de drená-los o portão fecha.
  current.source.disconnect();
  // Fechar o device imediatamente: o ponto laranja só fica aceso enquanto
  // você está de fato sendo gravado.
  current.stream.getTracks().forEach((track) => track.stop());

  statusLine.textContent = reason ? `Salvando (${reason})…` : "Salvando…";
  await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));

  graph.captureNode.port.postMessage("stop");
  await graph.context.suspend();

  const { chunks } = current;
  recording = undefined;
  recordButton.textContent = "Gravar";
  recordButton.classList.remove("gravando");

  if (chunks.length === 0) {
    busy = false;
    recordButton.disabled = false;
    statusLine.textContent = "Nada foi capturado.";
    return;
  }

  const sampleRate = graph.context.sampleRate;
  const wav = encodeWav(chunks, sampleRate);
  const bytes = wav.buffer.slice(
    wav.byteOffset,
    wav.byteOffset + wav.byteLength,
  ) as ArrayBuffer;

  try {
    const path = await window.bridge.saveWav(bytes);
    const seconds = countFrames(chunks) / sampleRate;
    statusLine.textContent = `${seconds.toFixed(1)}s · ${(wav.byteLength / 1024).toFixed(0)} KB`;
    resultLine.textContent = path;
    await window.bridge.revealInFinder(path);
  } catch (error) {
    statusLine.textContent = `Falha ao salvar: ${String(error)}`;
  } finally {
    busy = false;
    recordButton.disabled = false;
  }
}

recordButton.addEventListener("click", () => {
  void (recording ? stopRecording() : startRecording());
});

void prewarm().catch((error) => {
  showFailure(`Falha ao preparar o áudio: ${String(error)}`);
});
