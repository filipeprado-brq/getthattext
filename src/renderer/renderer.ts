import type { Command } from "../shared/bridge.js";
import { scheduleBlip } from "./blip.js";
import { encodeWav } from "../shared/wav.js";

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
  flowing: boolean;
  /** O microfone sumiu no meio — fone desconectado, device trocado. */
  interrupted: boolean;
};

let graph: AudioGraph | undefined;
let recording: Recording | undefined;
/** Trava contra ordens sobrepostas enquanto o microfone abre ou o áudio é entregue. */
let busy = false;

/**
 * Cria o contexto e compila o worklet no boot.
 *
 * Isso abre um device de SAÍDA, não de entrada — o ponto laranja do macOS
 * não acende. No comando sobra só o `getUserMedia` e o `resume()`, que é
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
    if (!current.flowing) {
      // O ícone só passa a "gravando" quando o áudio chega de fato: o
      // Chromium adia o início da captura em até 5 s depois que o Mac acorda.
      current.flowing = true;
      window.bridge.reportAudioFlowing();
    }
    current.chunks.push(event.data);
  };

  await context.suspend();
  graph = { context, captureNode };

  if (context.sampleRate !== TARGET_SAMPLE_RATE) {
    // Garantido pela spec do Web Audio, mas se a plataforma ignorar, o WAV
    // sairia com a taxa errada em silêncio.
    window.bridge.reportFailure(
      `contexto abriu a ${context.sampleRate} Hz, não a ${TARGET_SAMPLE_RATE} Hz`,
    );
  }
}

async function startRecording(): Promise<void> {
  if (!graph || recording || busy) return;
  busy = true;

  let stream: MediaStream;
  try {
    // Mono é definido pelo grafo, não por constraint: pedir por constraint
    // deixa a decisão para o driver, que nem sempre obedece.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    busy = false;
    window.bridge.reportFailure(
      error instanceof Error && error.name === "NotAllowedError"
        ? "permissão de microfone negada"
        : `falha ao abrir o microfone: ${String(error)}`,
    );
    return;
  }

  // Ligar o portão ANTES de conectar: a flag leva um tempo para atravessar
  // até a thread de áudio, e conectar primeiro perderia os quanta iniciais.
  graph.captureNode.port.postMessage("start");

  const source = graph.context.createMediaStreamSource(stream);
  source.connect(graph.captureNode);
  await graph.context.resume();

  const started: Recording = {
    stream,
    source,
    chunks: [],
    flowing: false,
    interrupted: false,
    maxDurationTimer: setTimeout(
      () =>
        void stopRecording().catch((error) =>
          window.bridge.reportFailure(`falha ao encerrar a gravação: ${String(error)}`),
        ),
      MAX_DURATION_MS,
    ),
  };
  recording = started;

  // O device sumindo no meio — fone desconectado, dock removido, entrada
  // trocada — encerra a trilha. Parar na hora e entregar o que já foi
  // capturado: a spec (seção 10) manda transcrever o que capturou e NUNCA
  // descartar. Esperar o clique de parar gravaria silêncio até você
  // perceber, e aí o portão de fala descartaria a ditação inteira.
  //
  // O listener guarda a gravação a que pertence, em vez de ler a variável de
  // módulo: sem isso, uma trilha de uma gravação já encerrada marcaria a
  // gravação SEGUINTE como interrompida.
  for (const track of stream.getAudioTracks()) {
    track.addEventListener(
      "ended",
      () => {
        if (recording !== started) return;

        started.interrupted = true;
        void stopRecording().catch((error) =>
          window.bridge.reportFailure(`falha ao encerrar a gravação: ${String(error)}`),
        );
      },
      { once: true },
    );
  }

  busy = false;
}

async function stopRecording(): Promise<void> {
  const current = recording;
  if (!current || !graph || busy) return;
  busy = true;

  clearTimeout(current.maxDurationTimer);

  // Desconectar corta a fonte, mas os quanta já postados ainda estão a
  // caminho — e são fala de verdade. Só depois de drená-los o portão fecha.
  current.source.disconnect();
  // Fechar o device imediatamente: o ponto laranja só fica aceso enquanto
  // você está de fato sendo gravado.
  current.stream.getTracks().forEach((track) => track.stop());

  await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));

  graph.captureNode.port.postMessage("stop");
  await graph.context.suspend();

  const { chunks } = current;
  recording = undefined;

  if (chunks.length === 0) {
    busy = false;
    // Interrompido sem NENHUM áudio é falha, não "nada foi ouvido": você
    // falou e o microfone morreu antes do primeiro quantum. Mostrar
    // "nada foi ouvido" seria falhar em silêncio.
    if (current.interrupted) {
      window.bridge.reportFailure("o microfone caiu antes de capturar áudio");
    } else {
      window.bridge.reportEmpty();
    }

    return;
  }

  const wav = encodeWav(chunks, graph.context.sampleRate);
  try {
    await window.bridge.deliverAudio(
      wav.buffer.slice(
        wav.byteOffset,
        wav.byteOffset + wav.byteLength,
      ) as ArrayBuffer,
      current.interrupted,
    );
  } catch (error) {
    window.bridge.reportFailure(`falha ao entregar o áudio: ${String(error)}`);
  } finally {
    busy = false;
  }
}

async function playBlip(): Promise<void> {
  if (!graph) return;
  const { context } = graph;

  await context.resume();
  const duration = scheduleBlip(context);
  await new Promise((resolve) => setTimeout(resolve, duration * 1000 + 50));

  // Só suspende se nada estiver gravando: uma ditação pode ter começado
  // enquanto o som tocava, e suspender ali mataria a captura dela.
  if (!recording) await context.suspend();
}

const HANDLERS: Record<Command, () => Promise<void>> = {
  start: startRecording,
  stop: stopRecording,
  blip: playBlip,
};

window.bridge.onCommand((command) => {
  void HANDLERS[command]().catch((error) =>
    window.bridge.reportFailure(`falha ao executar "${command}": ${String(error)}`),
  );
});

void prewarm().catch((error) => {
  window.bridge.reportFailure(`falha ao preparar o áudio: ${String(error)}`);
});
