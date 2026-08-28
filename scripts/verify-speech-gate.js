/**
 * Verificação de plataforma do portão de fala (#3).
 *
 * O que os testes unitários não cobrem: que o binário existe, aceita o WAV
 * pelo stdin e responde o que o corpus mediu. Roda contra o
 * `whisper-vad-speech-segments` de verdade.
 *
 *   npm run build && npm run verify:speech-gate
 *
 * Roda sob o ELECTRON, não em Node puro. Desde o #10 o caminho dos modelos
 * sai de `app.getPath("userData")`, então o módulo do whisper depende do
 * Electron — e o nome do app precisa ser fixado antes, ou o `userData`
 * aponta para a pasta errada e o binário não acha o modelo.
 *
 * O silêncio é sintetizado aqui, então esse lado sempre roda. O lado da fala
 * depende do corpus, que é privado e não vai para o repo — quando ele não
 * está na máquina, o caso é declarado pulado em vez de passar caladamente.
 */
const { app } = require("electron");
const { existsSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

app.setName("getthattext");

const { encodeWav } = require("../dist/shared/wav.js");
const { hasSpeech } = require("../dist/main/whisper.js");

const CORPUS = join(__dirname, "..", ".scratch/getthattext/research/corpus/wav");

const SAMPLE_RATE = 16_000;

/** Silêncio digital, o caso em que o Whisper alucinava 8 de 8. */
function silence(seconds) {
  return Buffer.from(encodeWav([new Float32Array(SAMPLE_RATE * seconds)], SAMPLE_RATE));
}

/**
 * Amostras do corpus com o número de segmentos que o VAD encontrou na
 * medição original. A 03 é a fala mais baixa que existe lá (RMS 0,0351) e é
 * o caso que importa: se o portão fosse cortar fala real, cortaria essa.
 */
const CORPUS_CASES = [
  { file: "02.wav", speech: false, note: "silêncio real, RMS 0,0011" },
  { file: "03.wav", speech: true, note: "a fala mais baixa do corpus" },
  { file: "21.wav", speech: true, note: "13 segmentos na medição" },
];

let failures = 0;
let skipped = 0;

/**
 * Roda o portão sobre uma amostra e compara com o que o corpus mediu.
 *
 * O `catch` não é decoração: binário, modelo ou ambiente errado é justamente
 * o que este script existe para detectar, e sem ele esse caso sairia como
 * stack trace de promise rejeitada em vez de uma linha do relatório.
 */
async function expectGateVerdict(name, wav, expected) {
  let actual;
  try {
    actual = await hasSpeech(wav);
  } catch (error) {
    failures++;
    console.log(`FALHOU ${name} — o portão não rodou: ${error.message.split("\n")[0]}`);

    return;
  }

  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${name} — esperado ${expected}, veio ${actual}`);
}

async function run() {
  await expectGateVerdict("2 s de silêncio digital", silence(2), false);
  await expectGateVerdict("meio segundo de silêncio digital", silence(0.5), false);

  for (const { file, speech, note } of CORPUS_CASES) {
    const path = join(CORPUS, file);
    if (!existsSync(path)) {
      skipped++;
      console.log(`pulado ${file} (${note}) — corpus não está nesta máquina`);
      continue;
    }
    await expectGateVerdict(`${file} (${note})`, await readFile(path), speech);
  }

  console.log(`\n${failures} falha(s), ${skipped} pulado(s).`);
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run);
