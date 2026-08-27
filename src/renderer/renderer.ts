import { encodeWav } from "../shared/wav.js";

/** A taxa que o whisper.cpp espera. Pedimos direto ao Web Audio. */
const TAXA_ALVO = 16_000;

/** Teto de gravação da spec: dois minutos. */
const DURACAO_MAXIMA_MS = 2 * 60 * 1000;

declare global {
  interface Window {
    ponte: {
      salvarWav(bytes: ArrayBuffer): Promise<string>;
      revelar(caminho: string): Promise<void>;
    };
  }
}

const botao = document.querySelector<HTMLButtonElement>("#gravar")!;
const estado = document.querySelector<HTMLParagraphElement>("#estado")!;
const resultado = document.querySelector<HTMLParagraphElement>("#resultado")!;

let contexto: AudioContext | undefined;
let worklet: AudioWorkletNode | undefined;
let stream: MediaStream | undefined;
let origem: MediaStreamAudioSourceNode | undefined;
let blocos: Float32Array[] = [];
let gravando = false;
let limite: ReturnType<typeof setTimeout> | undefined;
let iniciadoEm = 0;
let recebeuAudio = false;

/**
 * Pré-aquecimento: cria o contexto e compila o worklet no boot.
 *
 * Isso abre um device de SAÍDA, não de entrada — o ponto laranja do macOS
 * não acende. No clique sobra só o `getUserMedia` e o `resume()`, que é
 * onde a spec quer que a latência fique.
 */
async function preAquecer(): Promise<void> {
  const ctx = new AudioContext({ sampleRate: TAXA_ALVO, latencyHint: "interactive" });
  await ctx.audioWorklet.addModule("./pcm-worklet.js");

  // O nó só é processado se o grafo for puxado a partir do destino.
  // Ele não escreve nada na saída, então não há eco.
  const no = new AudioWorkletNode(ctx, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  no.connect(ctx.destination);

  no.port.onmessage = (evento: MessageEvent<Float32Array>) => {
    if (!gravando) return;
    if (!recebeuAudio) marcarAudioChegando();
    blocos.push(evento.data);
  };

  await ctx.suspend();

  contexto = ctx;
  worklet = no;

  if (ctx.sampleRate !== TAXA_ALVO) {
    // Documentado como garantido pela spec do Web Audio, mas se a
    // plataforma ignorar, o WAV sairia com a taxa errada em silêncio.
    resultado.textContent = `Atenção: o contexto abriu a ${ctx.sampleRate} Hz, não a ${TAXA_ALVO} Hz.`;
  }

  botao.disabled = false;
  botao.textContent = "Gravar";
  estado.textContent = "Pronto";
}

/**
 * O estado só vira "gravando" quando o primeiro frame chega de verdade.
 *
 * O Chromium adia o início da captura em até 5 s depois que o Mac acorda
 * do sleep. Acender no clique faria você falar no vazio.
 */
function marcarAudioChegando(): void {
  recebeuAudio = true;
  iniciadoEm = performance.now();
  botao.textContent = "Parar";
  botao.classList.add("gravando");
  tick();
}

function tick(): void {
  if (!gravando || !recebeuAudio) return;
  const s = (performance.now() - iniciadoEm) / 1000;
  estado.textContent = `Gravando — ${s.toFixed(1)}s`;
  requestAnimationFrame(tick);
}

async function iniciar(): Promise<void> {
  const ctx = contexto;
  const no = worklet;
  if (!ctx || !no) return;

  blocos = [];
  recebeuAudio = false;
  gravando = true;
  botao.textContent = "Abrindo o microfone…";
  estado.textContent = "Abrindo o microfone";
  resultado.textContent = "";

  try {
    // Mono é definido pelo grafo, não por constraint: pedir por constraint
    // deixa a decisão para o driver, que nem sempre obedece.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (erro) {
    gravando = false;
    botao.textContent = "Gravar";
    estado.textContent =
      erro instanceof Error && erro.name === "NotAllowedError"
        ? "Permissão de microfone negada."
        : `Falha ao abrir o microfone: ${String(erro)}`;
    return;
  }

  origem = ctx.createMediaStreamSource(stream);
  origem.connect(no);
  await ctx.resume();
  no.port.postMessage("iniciar");

  limite = setTimeout(() => {
    void parar("limite de 2 minutos atingido");
  }, DURACAO_MAXIMA_MS);
}

async function parar(motivo?: string): Promise<void> {
  if (!gravando) return;
  gravando = false;
  clearTimeout(limite);

  worklet?.port.postMessage("parar");
  origem?.disconnect();
  origem = undefined;

  // Fechar o device imediatamente: o ponto laranja só fica aceso enquanto
  // você está de fato sendo gravado.
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  await contexto?.suspend();

  botao.textContent = "Gravar";
  botao.classList.remove("gravando");

  const capturados = blocos;
  blocos = [];

  if (capturados.length === 0) {
    estado.textContent = "Nada foi capturado.";
    return;
  }

  estado.textContent = motivo ? `Salvando (${motivo})…` : "Salvando…";

  const wav = encodeWav(capturados, contexto?.sampleRate ?? TAXA_ALVO);
  const caminho = await window.ponte.salvarWav(
    wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer,
  );

  const frames = capturados.reduce((total, b) => total + b.length, 0);
  const segundos = frames / (contexto?.sampleRate ?? TAXA_ALVO);
  estado.textContent = `${segundos.toFixed(1)}s · ${(wav.byteLength / 1024).toFixed(0)} KB`;
  resultado.textContent = caminho;
  void window.ponte.revelar(caminho);
}

botao.addEventListener("click", () => {
  void (gravando ? parar() : iniciar());
});

void preAquecer();
