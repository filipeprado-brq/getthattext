# whisper.cpp local em Electron (macOS 15 / Apple Silicon)

Pesquisa contra fontes primárias: repositório `ggml-org/whisper.cpp`, código-fonte, issues de
benchmark, model cards no Hugging Face, registry do npm, formula do Homebrew e o paper original
do Whisper. Cada afirmação tem URL. O que não consegui verificar está marcado explicitamente.

Versão corrente no momento da pesquisa: **whisper.cpp v1.9.3** (release de 2026-08-20).
Fonte: https://api.github.com/repos/ggml-org/whisper.cpp/releases

---

## 1. TL;DR para o caso de uso (push-to-talk, 5–60 s)

- O binário se chama **`whisper-cli`** (não `main`). Ele lê **stdin** (`-f -`) e escreve texto puro
  em **stdout**, então o contrato de child process é limpo.
- **Metal liga sozinho** em Apple Silicon — `GGML_METAL` tem default `ON` quando `APPLE`. Não
  precisa de flag.
- **Não existe binário macOS pré-compilado nos releases do whisper.cpp.** Os assets são só
  Windows/Ubuntu + um `xcframework`. Para macOS: buildar você mesmo (rápido, ~1–2 min), usar
  Homebrew, ou usar um pacote npm que traga prebuilt.
- O detalhe de latência mais importante: **o encoder sempre processa uma janela de 30 s**, mesmo
  que o áudio tenha 5 s. E o **decoder domina o tempo** em ditado longo. Por isso o
  `large-v3-turbo` (4 camadas de decoder em vez de 32) é desproporcionalmente melhor aqui.
- Custo escondido de child process: **cada spawn recarrega o modelo** (~320 ms para turbo-q5_0,
  ~1570 ms para large-v3 em M4). Isso é somado a cada utterance.

---

## 2. Como obter o binário

### 2.1 Buildar do fonte (recomendado)

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build -j --config Release
./build/bin/whisper-cli -m models/ggml-base.bin -f samples/jfk.wav
```
Fonte: https://github.com/ggml-org/whisper.cpp/blob/master/README.md (seção "Quick start")

Detalhes de empacotamento verificados no CMake:

- `BUILD_SHARED_LIBS` tem default **ON** em macOS (ggml `CMakeLists.txt`, linhas 67–85). O build
  padrão produz `whisper-cli` + `libwhisper.dylib` + `libggml*.dylib` em `build/bin/`. Para um
  binário único dentro do `.app`, buildar com `-DBUILD_SHARED_LIBS=OFF`.
  Fonte: https://github.com/ggml-org/ggml/blob/master/CMakeLists.txt
- `GGML_BACKEND_DL` tem default **OFF** → o backend Metal é linkado no binário, não é um `.dylib`
  separado que precise ser descoberto em runtime. Mesma fonte, linha 86.
- `GGML_METAL_EMBED_LIBRARY` tem default igual a `GGML_METAL` (linha 241) → o shader Metal fica
  **embutido no binário**. Não é preciso distribuir `.metallib` ao lado. Isso é importante para
  Electron: o binário é autocontido em relação a shaders.

Consequência: o build acontece na **sua** máquina (CI), não na do usuário. Você commita/publica o
binário resultante como asset do app.

### 2.2 Release pré-compilado — **não existe para macOS**

Assets do release `b4938` / `v1.9.2`:

| Asset | Tamanho |
|---|---|
| `whisper-bin-x64.zip` (Windows) | 8,4 MB |
| `whisper-bin-Win32.zip` | 5,3 MB |
| `whisper-bin-ubuntu-x64.tar.gz` | 9,5 MB |
| `whisper-bin-ubuntu-arm64.tar.gz` | 4,6 MB |
| `whisper-blas-bin-x64.zip` | 21,1 MB |
| `whisper-cublas-12.4.0-bin-x64.zip` | 671,0 MB |
| `whisper-b4938-xcframework.zip` | 53,6 MB |

Fonte: https://api.github.com/repos/ggml-org/whisper.cpp/releases

O `xcframework` é a biblioteca (`libwhisper`) para linkar em projetos Apple — **não** contém o CLI.
Serve para um addon nativo próprio, não para child process.

### 2.3 Homebrew

`brew install whisper-cpp` instala o binário `whisper-cli` (o teste da formula executa
`#{bin}/whisper-cli`), com bottles para `arm64_tahoe`, `arm64_sequoia`, `arm64_sonoma`.
Fonte: https://github.com/Homebrew/homebrew-core/blob/master/Formula/w/whisper-cpp.rb

Metal está ligado: a formula `ggml` só desliga Metal em macOS Intel
(`args += %w[-DGGML_METAL=OFF ...] if OS.mac? && Hardware::CPU.intel?`).
Fonte: https://github.com/Homebrew/homebrew-core/blob/master/Formula/g/ggml.rb

**Não serve para distribuir um app**: depende das formulas `ggml` e `sdl2-compat` com rpath para
`/opt/homebrew`. Serve para desenvolvimento e prototipagem local.

### 2.4 Wrappers npm

Todos os dados abaixo vêm do registry do npm e das APIs do GitHub (consultados em 2026-08-26).

| Pacote | Última publicação | Downloads/mês | Estratégia | Veredito |
|---|---|---|---|---|
| `nodejs-whisper` 0.3.1 | 2026-08-03 | 87.097 | **Compila** whisper.cpp (vendorizado no tarball, 1.832 arquivos, whisper.cpp 1.9.1) com `cmake` na máquina onde roda; depois faz `shelljs` no `whisper-cli` | Ativo, mas exige cmake + Xcode CLT no usuário final |
| `smart-whisper` 0.8.1 | 2024-10-02 | 13.148 | Addon N-API; `install: node-gyp rebuild` → compila na instalação | **Parado** desde out/2024; whisper.cpp fixado num submódulo de 2024 |
| `whisper-node` 1.1.1 | 2023-11-29 | 19.889 | Idem `nodejs-whisper` (é o ancestral dele) | **Abandonado**; README nem existe mais no branch main |
| `@fugood/whisper.node` 1.1.2 | 2026-08-24 | 22.118 | Addon N-API com **prebuilts por plataforma** via `optionalDependencies` | Melhor opção "sem build" (ver abaixo) |
| `@remotion/install-whisper-cpp` 4.0.517 | 2026-08-25 | 112.681 | Helper que baixa e **compila** whisper.cpp em runtime | Ativo, mas é a mesma dependência de toolchain |
| `@echogarden/whisper.cpp-binding` 0.2.2 | 2026-08-04 | 13.345 | Binding N-API mínimo (usado pelo Echogarden) | Ativo, pouco documentado |

Fontes: https://registry.npmjs.org/nodejs-whisper · https://registry.npmjs.org/smart-whisper ·
https://registry.npmjs.org/whisper-node · https://registry.npmjs.org/@fugood%2Fwhisper.node ·
https://api.npmjs.org/downloads/point/last-month/<pkg>

Notas concretas por pacote:

- **`nodejs-whisper`**: o tarball de 5,6 MB carrega o whisper.cpp inteiro (`package/cpp/whisper.cpp/`,
  `project("whisper.cpp" VERSION 1.9.1)`). Ele roda `cmake -B build` sem flags extras
  (`src/buildConfig.ts`), então em Apple Silicon o Metal entra por default. Ele procura o binário em
  `build/bin/whisper-cli` (`src/whisper.ts`, `getWhisperExecutablePath`) — ou seja, já usa o nome
  novo. O problema é o momento do build: acontece no `npx nodejs-whisper download` / primeiro uso,
  na máquina onde o pacote está instalado. Num app Electron distribuído isso significa exigir
  Command Line Tools do Xcode do usuário final. Inviável.
  Fonte: https://github.com/ChetanXpro/nodejs-whisper/blob/main/src/whisper.ts

- **`smart-whisper`**: API boa para o caso de uso (aceita `Float32Array` direto, mantém o modelo
  carregado entre inferências, `new Whisper(model, { gpu: true })`). Mas o último commit no `main`
  é de **2024-10-02** e o submódulo de whisper.cpp está fixado num commit daquela época. Como o
  `large-v3-turbo` e a maioria das otimizações Metal recentes vieram depois, considerar morto.
  Fonte: https://github.com/JacobLinCool/smart-whisper/commits/main

- **`@fugood/whisper.node`**: publica `@fugood/node-whisper-darwin-arm64` (`os: ["darwin"]`,
  `cpu: ["arm64"]`, 3,2 MB descompactado, contendo apenas `index.node`) como optionalDependency.
  O README declara "macOS arm64: CPU and Metal GPU acceleration". A API é in-process
  (`initWhisper`, `transcribeData(pcm16Buffer)`), o que elimina o reload de modelo por utterance.
  Fontes: https://registry.npmjs.org/@fugood%2Fnode-whisper-darwin-arm64 ·
  https://www.npmjs.com/package/@fugood/whisper.node
  **Não verifiquei** se o `.node` prebuilt é Node-API puro (o que o tornaria carregável no Electron
  sem `electron-rebuild`). Precisa de teste prático antes de apostar nisso.

### 2.5 Confirmação do rename `main` → `whisper-cli`

O binário se chama `whisper-cli` e vive em `build/bin/whisper-cli`. Isso está no README
(https://github.com/ggml-org/whisper.cpp/blob/master/README.md), no teste da formula do Homebrew, e
o rename aparece na PR **#2707 — "docs: Fix main -> whisper-cli in download scripts"**, de
2025-01-06 (https://github.com/ggml-org/whisper.cpp/pull/2707). O código-fonte vive em
`examples/cli/cli.cpp`.

Invocação canônica para o nosso caso:

```bash
whisper-cli -m models/ggml-large-v3-turbo-q5_0.bin \
            -f - -l pt -nt -np -bs 1 \
            --prompt "Transcrição de ditado em português do Brasil."
```

---

## 3. Metal e Core ML

### 3.1 Metal: ligado por default, sem flag

```cmake
if (APPLE)
    set(GGML_METAL_DEFAULT ON)
...
option(GGML_METAL "ggml: use Metal" ${GGML_METAL_DEFAULT})
```
Fonte: https://github.com/ggml-org/ggml/blob/master/CMakeLists.txt (linhas 95–96, 238)

O README confirma: "On Apple Silicon, the inference runs fully on the GPU via Metal".
Para desligar em runtime existe `-ng / --no-gpu` no CLI.

Bônus: `flash_attn` tem default **`true`** no CLI (`examples/cli/cli.cpp`, struct `whisper_params`).
Nos benchmarks de M1 Ultra com FA ligado o decode cai ~25% (ver §6).

### 3.2 Core ML: vale a pena? Depende — e o custo caiu muito

O README anuncia "more than x3 faster compared with CPU-only execution" para o encoder na ANE.
Fonte: https://github.com/ggml-org/whisper.cpp/blob/master/README.md (seção "Core ML support")

O README manda gerar o modelo você mesmo (`pip install ane_transformers openai-whisper coremltools`
+ `./models/generate-coreml-model.sh`), o que historicamente era caro — na discussão #548 alguém
reportou 40 min e 29 GB de RAM para converter o `medium`, e crash com o `large`.
Fonte: https://github.com/ggml-org/whisper.cpp/discussions/548

**Mas os encoders Core ML já vêm prontos no Hugging Face**, o que o README não deixa óbvio:

| Arquivo | Tamanho |
|---|---|
| `ggml-tiny-encoder.mlmodelc.zip` | 14,3 MiB |
| `ggml-base-encoder.mlmodelc.zip` | 36,2 MiB |
| `ggml-small-encoder.mlmodelc.zip` | 155,5 MiB |
| `ggml-medium-encoder.mlmodelc.zip` | 541,5 MiB |
| `ggml-large-v3-encoder.mlmodelc.zip` | 1121,2 MiB |
| `ggml-large-v3-turbo-encoder.mlmodelc.zip` | 1119,0 MiB |

Fonte: https://huggingface.co/ggerganov/whisper.cpp/tree/main (via
https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true)
Existe também `models/download-coreml-model.sh` no repo (HTTP 200 confirmado).

Custos reais de Core ML que pesam contra:

1. **Requer build com `-DWHISPER_COREML=1`** (default é OFF —
   `option(WHISPER_COREML "whisper: enable Core ML framework" OFF)` no CMakeLists do whisper.cpp).
2. **Primeira execução é lenta**: "The first run on a device is slow, since the ANE service compiles
   the Core ML model to some device-specific format. Next runs are faster." (README). Para
   push-to-talk isso é um cold start ruim na primeira vez após instalar/atualizar.
3. **+1,1 GB de download** para o encoder do turbo — mais que dobra o peso do modelo.
4. **Fragilidade real e aberta**: issue **#3702**, "ANE inference fails on M4 + macOS 26.4 beta with
   CoreML encoder", aberta em 2026-03-11, ainda **open**. A falha é
   `MILCompilerForANE error: failed to compile ANE model using ANEF` e o fallback para Metal é
   "~2-3× slower than expected ANE performance".
   Fonte: https://github.com/ggml-org/whisper.cpp/issues/3702

E, decisivo: **Core ML acelera só o encoder**. Como veremos em §6, o encoder não é o gargalo do
turbo. Nos números do M1 Ultra com Core ML, o `large-v3-turbo` tem `Enc.` de 618 ms enquanto o
`medium` tem 347 ms — Core ML **não** deixa o encoder do turbo mais rápido que o do medium.

**Veredito: não vale a pena para este produto.** Dobra o tamanho do download, exige uma flag de
build extra, tem um bug aberto em M4 + macOS recente, e ataca a metade errada do problema.

---

## 4. Modelos, tamanhos em disco e de onde vêm

Origem: `models/download-ggml-model.sh` aponta para
`https://huggingface.co/ggerganov/whisper.cpp` + `resolve/main/ggml-<model>.bin`.
Fonte: https://github.com/ggml-org/whisper.cpp/blob/master/models/download-ggml-model.sh

Tamanhos **exatos** (bytes reais dos blobs no HF, não os arredondados do README):

| Modelo | Arquivo | MiB | MB |
|---|---|---:|---:|
| tiny | `ggml-tiny.bin` | 74,1 | 77,7 |
| tiny-q5_1 | `ggml-tiny-q5_1.bin` | 30,7 | 32,2 |
| base | `ggml-base.bin` | 141,1 | 148,0 |
| base-q5_1 | `ggml-base-q5_1.bin` | 56,9 | 59,7 |
| small | `ggml-small.bin` | 465,0 | 487,6 |
| small-q5_1 | `ggml-small-q5_1.bin` | 181,3 | 190,1 |
| small-q8_0 | `ggml-small-q8_0.bin` | 252,2 | 264,5 |
| medium | `ggml-medium.bin` | 1462,7 | 1533,8 |
| medium-q5_0 | `ggml-medium-q5_0.bin` | 514,2 | 539,2 |
| medium-q8_0 | `ggml-medium-q8_0.bin` | 785,2 | 823,4 |
| large-v2 | `ggml-large-v2.bin` | 2951,3 | 3094,6 |
| large-v2-q5_0 | `ggml-large-v2-q5_0.bin` | 1030,7 | 1080,7 |
| large-v3 | `ggml-large-v3.bin` | 2951,7 | 3095,0 |
| large-v3-q5_0 | `ggml-large-v3-q5_0.bin` | 1031,1 | 1081,1 |
| **large-v3-turbo** | `ggml-large-v3-turbo.bin` | **1549,3** | **1624,6** |
| **large-v3-turbo-q8_0** | `ggml-large-v3-turbo-q8_0.bin` | **833,7** | **874,2** |
| **large-v3-turbo-q5_0** | `ggml-large-v3-turbo-q5_0.bin` | **547,4** | **574,0** |

Fonte: https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true

Observações:
- Não existe `large-v3-q8_0` publicado — só `q5_0`.
- Variantes `.en` existem para tiny/base/small/medium e são **inúteis aqui** (não fazem português).
- O `large-v3-turbo` tem 809 M de parâmetros contra 1550 M do `large-v3`, porque "the number of
  decoding layers have reduced from 32 to 4".
  Fonte: https://huggingface.co/openai/whisper-large-v3-turbo

---

## 5. Qualidade em pt-BR por tamanho de modelo

Não há WER por idioma publicado para `large-v3` nem para `large-v3-turbo` em forma numérica pela
OpenAI (só um gráfico SVG). Os números por modelo **e** por idioma que existem em fonte primária
vêm dos apêndices do paper "Robust Speech Recognition via Large-Scale Weak Supervision".
Fonte: https://arxiv.org/abs/2212.04356 (extraído de https://ar5iv.labs.arxiv.org/html/2212.04356)

**WER (%) em português, por modelo, em três benchmarks:**

| Modelo | FLEURS pt (Tabela 13) | Common Voice 9 pt (Tabela 11) | MLS pt (Tabela 10) |
|---|---:|---:|---:|
| tiny | 20,1 | 35,2 | 31,3 |
| base | 13,0 | 23,7 | 21,9 |
| small | **7,3** | 12,5 | 13,0 |
| medium | **5,0** | 8,1 | 9,0 |
| large (v1) | 4,8 | 7,1 | 9,2 |
| large-v2 | **4,3** | 6,3 | 6,8 |

FLEURS é o benchmark mais relevante: no FLEURS o código do português é **`pt_br`** (fala lida,
locutores brasileiros), enquanto MLS pt vem de audiolivros LibriVox e Common Voice pt mistura
variantes. Ou seja, a coluna FLEURS é a que mais se aproxima do nosso caso.

**Leitura para ditado corrido:**

- `tiny` (20% WER) e `base` (13%) — 1 em cada 5 e 1 em cada 8 palavras erradas. Inutilizável para
  ditado; o usuário gasta mais tempo corrigindo do que digitando.
- `small` (7,3%) — **é o primeiro ponto utilizável**. ~1 erro a cada 14 palavras. Aceitável com
  revisão, desconfortável sem.
- `medium` (5,0%) — patamar de "confortável". O salto small→medium (7,3 → 5,0) é o último grande
  ganho de qualidade da escada.
- `large-v2` (4,3%) — melhoria marginal sobre medium (0,7 pp) por 2× o disco e ~2× o tempo.

**E o `large-v3-turbo` em português?** A OpenAI não publicou WER por idioma para ele, mas o
anúncio oficial diz que o turbo "performs similarly to `large-v2`, though it shows larger
degradation on some languages like Thai and Cantonese". Português **não** está entre os idiomas
degradados citados.
Fonte: https://github.com/openai/whisper/discussions/2363

Portanto a estimativa razoável (não medida) é que `large-v3-turbo` fique na faixa de ~4–5% WER em
pt-BR, ou seja, nível medium/large-v2 — mas com o custo de decodificação de um modelo bem menor.
**Isso é uma inferência, não um número medido.** Não encontrei nenhuma medição de WER pt-BR do
turbo em fonte primária.

Sobre quantização: não encontrei nenhuma medição primária do impacto de `q5_0`/`q8_0` no WER em
português. O README só afirma que modelos quantizados "require less memory and disk space and
depending on the hardware can be processed more efficiently". **Não verificado.**

---

## 6. Latência — a parte que importa

### 6.1 Como ler os números de benchmark (crítico)

O `whisper-bench` reporta três colunas, e é preciso saber exatamente o que cada uma mede
(`examples/bench/bench.cpp` + `src/whisper.cpp`):

- **`Enc.`** = tempo de **uma** chamada `whisper_encode` sobre um mel completo. O whisper sempre
  encoda uma janela de **30 segundos** — o código faz "pad 30 seconds of zeros at the end of audio
  (480,000 samples)" (`src/whisper.cpp`, linha 3246). **Consequência direta para push-to-talk: um
  utterance de 5 s custa o mesmo encode que um de 30 s.**
- **`Dec.`** = ms por token gerado (batch de 1). O contador `n_decode++` incrementa por chamada.
- **`Bch5`** = ms **por token** dentro de um batch de 5 (`n_batchd += n_tokens`). Como o CLI usa
  **beam search com `beam_size = 5` por default**
  (`beam_size = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH).beam_search.beam_size`,
  que é 5 em `src/whisper.cpp` linha 6132), o custo real por passo de decodificação é
  aproximadamente **`Bch5 × 5`**, não `Dec`.

Fontes: https://github.com/ggml-org/whisper.cpp/blob/master/examples/bench/bench.cpp ·
https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp

### 6.2 Números MEDIDOS em Apple Silicon com Metal

**MacBook M3 Pro, Sonoma 14.5, NEON BLAS METAL, 4 threads** (commit 858452d):

| Modelo | Enc. (ms) | Dec. (ms/token) | Bch5 (ms/token) | PP (ms/token) |
|---|---:|---:|---:|---:|
| tiny | 34,15 | 1,45 | 0,47 | 0,03 |
| base | 59,32 | 2,27 | 0,79 | 0,05 |
| small | 200,45 | 5,50 | 1,75 | 0,15 |
| medium | 534,54 | 12,88 | 3,90 | 0,37 |
| large-v1 | 989,45 | 22,29 | 6,58 | 0,64 |
| large-v2 | 962,34 | 22,38 | 6,61 | 0,64 |
| large-v3 | 969,27 | 22,23 | 6,59 | 0,64 |

Fonte: https://github.com/ggml-org/whisper.cpp/issues/89#issuecomment-2076059931

**Mac Studio M1 Ultra, macOS Tahoe 26.2, NEON COREML METAL, 8 threads** (commit f53dc748,
janeiro/2026) — o único conjunto que inclui o turbo:

Flash attention OFF:

| Modelo | Enc. (ms) | Dec. (ms/token) | Bch5 (ms/token) |
|---|---:|---:|---:|
| tiny | 18,88 | 1,49 | 0,37 |
| base | 34,28 | 2,11 | 0,55 |
| small | 114,99 | 4,06 | 1,19 |
| medium | 346,97 | 8,18 | 2,65 |
| **large-v3-turbo Q8_0** | **618,23** | **2,01** | **0,60** |

Flash attention ON:

| Modelo | Enc. (ms) | Dec. (ms/token) | Bch5 (ms/token) |
|---|---:|---:|---:|
| tiny | 18,10 | 1,27 | 0,28 |
| base | 35,21 | 1,74 | 0,42 |
| small | 114,12 | 3,13 | 0,80 |
| medium | 352,35 | 6,22 | 1,75 |
| **large-v3-turbo Q8_0** | **621,38** | **1,63** | **0,43** |

Fonte: https://github.com/ggml-org/whisper.cpp/issues/89#issuecomment-3762700537

Repare no número que decide tudo: o turbo tem `Dec.` de **1,63–2,01 ms/token**, contra **6,22–8,18**
do medium e **22,23** do large-v3. É 11–14× mais rápido no decoder que o large-v3, ao custo de um
encoder ~1,8× mais lento que o do medium.

**Mac Mini M4 (base), Core ML + Metal**, `whisper-bench -t 4`:

| Modelo | load time (ms) | encode time (ms) | total bench (ms) |
|---|---:|---:|---:|
| small.en | 173,15 | 95,17 | 2.600,96 |
| large-v3 | 1.569,35 | 569,74 | 12.068,95 |
| large-v3-q5_0 | 553,95 | 581,01 | 10.259,65 |
| **large-v3-turbo-q5_0** | **321,89** | **457,06** | **2.113,31** |

E via `bench-all.sh 4`: `large-v3-turbo` Enc 455,17 / Dec 4,46 / Bch5 0,94 ;
`large-v3-turbo-q5_0` Enc 462,83 / Dec 2,57 / Bch5 1,06.
Fonte: https://github.com/ggml-org/whisper.cpp/issues/89#issuecomment-2827317514

O turbo-q5_0 termina o bench inteiro em **2,1 s** contra **12,1 s** do large-v3: **5,7× mais rápido
no total**, com 1/5 do disco.

### 6.3 Real-time factor medido em arquivo longo

Transcrição de um trecho de 1 h 15 min 17 s (4.517 s de áudio) com `medium.en`:

| Máquina | Tempo total (ms) | RTF |
|---|---:|---:|
| Mac Mini M4 base, CPU/Metal | 437.230 | **~10,3× tempo real** |
| Mac Mini M4 base, Core ML ("AI") | 377.927 | **~11,9× tempo real** |
| PC CUDA (RTX 4070 mobile) | 295.568 | ~15,3× |

Fonte: https://github.com/ggml-org/whisper.cpp/issues/89#issuecomment-2746144586
(o RTF é cálculo meu a partir dos tempos publicados)

Note que Core ML deu só **+15%** no arquivo inteiro, coerente com o argumento de §3.2: o encoder
não é a metade cara.

### 6.4 Um utterance curto, medido ponta a ponta

Benchmark de terceiros (repositório público com metodologia, não post de blog), MacBook Pro M4 24 GB,
frase falada "Which is the fastest transcription on my Mac?" (~2–3 s de fala):

| Implementação | Tempo médio (s) |
|---|---:|
| fluidaudio-coreml (Parakeet TDT) | 0,1935 |
| mlx-whisper (large-v3-turbo) | 1,0230 |
| **whisper.cpp (large-v3-turbo-q5_0, coreml=True, 4 threads)** | **1,2293** |
| whisperkit (large-v3) | 2,2190 |
| faster-whisper (large-v3-turbo, CPU int8) | 6,9613 |

Fonte: https://github.com/anvanvan/mac-whisper-speedtest
Ressalva: o README não declara a duração exata do áudio nem se o load do modelo está incluído no
tempo. Trate como ordem de grandeza, não como medida controlada.

### 6.5 Estimativas derivadas para o nosso caso (5–60 s)

Cálculo meu a partir dos números medidos acima. Modelo:
`T ≈ load + ceil(dur/30) × Enc + n_tokens × (Bch5 × 5)`, com ~2,8 tokens/s de fala em português
(≈30 tokens para 10 s, ≈170 tokens para 60 s), beam search 5 (default do CLI).

**M3 Pro, Metal, sem Core ML** (usando a tabela de 6.2), *excluindo* o load do modelo:

| Modelo | 10 s de fala | 60 s de fala |
|---|---:|---:|
| tiny | ~0,10 s | ~0,47 s |
| base | ~0,18 s | ~0,79 s |
| small | ~0,46 s | ~1,9 s |
| medium | ~1,1 s | ~4,4 s |
| large-v3 | ~2,0 s | ~7,5 s |

**M4 Mac Mini, `large-v3-turbo-q5_0`** (Enc 462,8 / Bch5 1,06): ~0,62 s para 10 s de fala e
~1,8 s para 60 s — mais ~0,32 s de load se o processo for novo a cada utterance.

**M1 Ultra, `large-v3-turbo Q8_0`, FA ON** (Enc 621 / Bch5 0,43): ~0,69 s para 10 s e ~1,6 s para 60 s.

São **estimativas**, não medições. Mas a forma da curva é confiável e vem dos dados medidos:
o turbo entrega qualidade nível large-v2 com latência entre small e medium.

### 6.6 As três armadilhas de latência do child process

1. **Load do modelo por spawn.** Medido em M4: 321,89 ms (turbo-q5_0), 553,95 ms (large-v3-q5_0),
   1.569,35 ms (large-v3). Num modelo persistente (addon ou servidor) isso é pago uma vez.
   Para um utterance de 10 s com turbo, o load é ~34% do tempo total.
2. **Janela fixa de 30 s.** 5 s de fala pagam o encode inteiro. Existe `-ac N / --audio-ctx N`
   ("audio context size (0 - all)") que encurta o contexto do encoder — é a alavanca óbvia para
   utterances curtos, mas **não encontrei medição primária do trade-off qualidade/velocidade** e o
   código valida apenas `params.audio_ctx <= whisper_n_audio_ctx(ctx)` (1500). Testar empiricamente.
3. **Temperature fallback.** Default `temperature_inc = 0.2` a partir de 0,0 → até 6 re-decodificações
   da mesma janela quando o decoder falha nos thresholds (`entropy_thold 2.40`,
   `logprob_thold -1.00`). No pior caso a latência multiplica. `-nf / --no-fallback` zera isso
   (`wparams.temperature_inc = params.no_fallback ? 0.0f : params.temperature_inc`) ao custo de
   aceitar decodificações ruins. Combinado com `-bs 1` (greedy), é o modo de menor latência.

---

## 7. Formato de entrada e stdin

O código-fonte (`examples/common-whisper.cpp`) responde isso melhor que o README.

- O decoder é configurado como:
  ```c
  decoder_config = ma_decoder_config_init(ma_format_f32, stereo ? 2 : 1, WHISPER_SAMPLE_RATE);
  ```
  Ou seja: **miniaudio converte e reamostra automaticamente** para float32, mono, 16 kHz. Você
  **não** precisa entregar exatamente PCM s16 16 kHz — WAV int16 a 48 kHz também funciona, o
  miniaudio resampleia. O README ainda diz "currently runs only with 16-bit WAV files", o que está
  **desatualizado**; o próprio usage do CLI imprime
  `supported audio formats: flac, mp3, ogg, wav`.
  Fonte: https://github.com/ggml-org/whisper.cpp/blob/master/examples/common-whisper.cpp

- Ainda assim, entregar **WAV PCM s16le, 16 kHz, mono** é o caminho mais barato: zero resample,
  zero conversão de formato, menor payload. É o que o README recomenda:
  `ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le output.wav`.
  Internamente tudo vira float32 de qualquer jeito.

- **stdin funciona.** `-f -` (ou o argumento posicional `-`) faz o CLI ler stdin até EOF:
  ```c
  if (fname == "-") {
      while (true) { const size_t n = fread(buf, 1, sizeof(buf), stdin); ... }
      result = ma_decoder_init_memory(audio_data.data(), audio_data.size(), &decoder_config, &decoder);
  }
  ```
  Cuidados: (a) o stream inteiro é bufferizado em memória antes de decodificar — não é streaming
  incremental, então não há ganho de latência em começar a escrever cedo; (b) como usa
  `ma_decoder_init_memory`, o container precisa estar **completo e coerente**. Um WAV com header de
  tamanho placeholder (streaming) tende a falhar. Escreva o header com o tamanho correto no fim.

- Saída: os segmentos vão para **stdout** via `printf` (`whisper_print_segment_callback`), e todos
  os logs vão para **stderr**. `-np / --no-prints` suprime "anything other than the results".
- Truque útil: `-of -` faz o formato escolhido ir para stdout em vez de arquivo
  (`is_stdout{fname_out == "-"}`). Então `-oj -of -` entrega **JSON no stdout**, sem tocar disco.
  Só um formato por vez ("warning: Not appending multiple file formats to stdout").

---

## 8. Flags relevantes

Todas verificadas em https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp

| Flag | Default | Nota |
|---|---|---|
| `-l pt`, `--language pt` | `en` | Aceita `auto`. `-dl/--detect-language` só detecta e sai. Sempre fixe `pt` — evita trocar de idioma no meio. |
| `--prompt "..."` | vazio | "initial prompt (max n_text_ctx/2 tokens)". **`n_text_ctx = 448` → limite de 224 tokens.** Se exceder, o log avisa "initial prompt is too long (%d tokens), will use only the last %d tokens" e trunca pelos **últimos** tokens. |
| `--carry-initial-prompt` | false | Reprega o prompt em toda janela de 30 s. Útil para ditado longo com vocabulário próprio. |
| `-nt`, `--no-timestamps` | false | Remove `[00:00:00.000 --> ...]` do stdout. Essencial aqui. |
| `-np`, `--no-prints` | false | Só resultados; logs somem. Essencial aqui. |
| `-sns`, `--suppress-nst` | false | **"suppress non-speech tokens"** — é essa a flag. Suprime coisas como `(música)`, `[risos]`. Muito recomendada para ditado. |
| `--suppress-regex REGEX` | vazio | Complemento: suprime tokens que casam com o regex. |
| `-otxt/-oj/-ojf/-osrt/-ovtt/-ocsv/-olrc` | false | Formatos de saída em **arquivo** (ou stdout com `-of -`). |
| `-of FNAME` | — | Base do nome de saída sem extensão; `-` = stdout. |
| `-bs N`, `--beam-size` | **5** | `-bs 1` cai para greedy e reduz muito a latência (ver §6.1). |
| `-bo N`, `--best-of` | 5 | Só usado no modo greedy. |
| `-nf`, `--no-fallback` | false | Desliga temperature fallback → latência previsível. |
| `-t N`, `--threads` | `min(4, hw_concurrency)` | Com Metal, aumentar pouco ajuda. |
| `-fa` / `-nfa` | **`-fa` ligado** | Flash attention já vem ligado no CLI. |
| `-ng`, `--no-gpu` | GPU ligada | Só para debug/comparação. |
| `-ac N`, `--audio-ctx N` | 0 (=1500, tudo) | Alavanca para encurtar o encoder em áudio curto. Trade-off não medido. |
| `--vad`, `-vm FNAME` | off | VAD Silero embutido — pode aparar silêncio das bordas do push-to-talk antes de encodar. |
| `-mc N`, `--max-context` | -1 | Limita o histórico de texto entre janelas. |

---

## 9. Tabela consolidada: modelo × disco × velocidade × qualidade pt-BR

Velocidade = latência estimada para 60 s de fala (§6.5) na config prática (Metal, beam 5).
Qualidade = WER FLEURS pt_br do paper (§5).

| Modelo | Disco | Latência ~60 s fala | WER pt (FLEURS) | Veredito para ditado pt-BR |
|---|---:|---:|---:|---|
| tiny | 74 MiB | ~0,5 s | 20,1% | Inutilizável |
| tiny-q5_1 | 31 MiB | ≈ tiny (não medido) | n/d | Inutilizável |
| base | 141 MiB | ~0,8 s | 13,0% | Inutilizável para ditado corrido |
| small | 465 MiB | ~1,9 s | 7,3% | **Piso do utilizável**; exige revisão |
| small-q5_1 | 181 MiB | ≈ small (não medido) | n/d | Opção de baixo disco, qualidade não medida |
| medium | 1.463 MiB | ~4,4 s | 5,0% | Bom, mas lento e pesado |
| medium-q5_0 | 514 MiB | ≈ medium (não medido) | n/d | Bom custo-disco; latência ainda alta |
| **large-v3-turbo-q5_0** | **547 MiB** | **~1,8 s** | ~4–5% (inferido) | **Melhor ponto da curva** |
| large-v3-turbo-q8_0 | 834 MiB | ~1,6 s (M1U) | ~4–5% (inferido) | Idem, +50% disco |
| large-v3-turbo | 1.549 MiB | ~1,8 s | ~4–5% (inferido) | Sem ganho claro sobre q5_0 |
| large-v3-q5_0 | 1.031 MiB | ≈ large-v3 (não medido) | ~4% | Lento demais para PTT |
| large-v3 | 2.952 MiB | ~7,5 s | ~4% | Descartado |

O `large-v3-turbo-q5_0` tem **disco de small** (547 vs 465 MiB), **latência entre small e medium**
e **qualidade de large-v2**. Não há trade-off aqui — ele domina o medium em todas as dimensões.

---

## 10. O que NÃO consegui verificar

- WER medido de `large-v3` e `large-v3-turbo` em português (a OpenAI publica só um gráfico SVG sem
  valores numéricos legíveis; o paper para em `large-v2`). A faixa "~4–5%" é inferência a partir de
  "turbo performs similarly to large-v2".
- Impacto da quantização (`q5_0`, `q8_0`) sobre o WER em português. Nenhuma medição primária.
- Trade-off qualidade/velocidade de `-ac / --audio-ctx` em utterances curtos.
- Se o `.node` prebuilt de `@fugood/whisper.node` carrega no Electron sem `electron-rebuild`
  (depende de ser Node-API puro — não confirmado por documentação).
- Overhead de spawn de processo + inicialização do backend Metal isoladamente (os "load time"
  reportados já misturam leitura do arquivo com init do backend, e provavelmente com page cache
  quente).
- Comportamento de code signing / hardened runtime ao embarcar um binário de terceiro num `.app`
  notarizado — fora do escopo das fontes consultadas.

---

## 11. Recomendação

### Modelo: `large-v3-turbo-q5_0`

547 MiB de download, ~1,8 s para transcrever 60 s de fala em Apple Silicon, qualidade equivalente
a large-v2 (~4–5% WER em pt-BR). Ele é estritamente melhor que o `medium` — menor no disco (547 vs
1.463 MiB), ~2,4× mais rápido, e igual ou melhor em qualidade. E é estritamente melhor que o
`large-v3` para este produto — 5,4× menor, ~4× mais rápido, com perda de qualidade que a própria
OpenAI chama de "minor" e que não afeta português.

Ter `small-q5_1` (181 MiB) como fallback opcional para máquinas com pouco disco é defensável, mas
com aviso claro de qualidade — 7,3% de WER significa retrabalho visível no ditado.

Baixar de `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`
no primeiro uso, não embutir no instalador.

### Invocação

```bash
whisper-cli \
  -m ~/Library/Application Support/<app>/models/ggml-large-v3-turbo-q5_0.bin \
  -f - \
  -l pt \
  -nt -np -sns \
  -bs 1 -nf \
  --prompt "<termos do usuário, ≤224 tokens>"
```
Áudio no stdin como WAV PCM s16le 16 kHz mono com header completo; texto puro no stdout;
logs no stderr.

### Distribuição: buildar no CI e embarcar o binário

Não usar nenhum dos wrappers npm que compilam (`nodejs-whisper`, `smart-whisper`,
`@remotion/install-whisper-cpp`) — todos empurram cmake + Xcode Command Line Tools para o usuário
final, o que é inaceitável num app de consumo.

O caminho é: no CI (macOS arm64), rodar

```bash
cmake -B build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
cmake --build build -j --config Release
```

e embarcar `build/bin/whisper-cli` como `extraResource` do Electron. Metal entra por default,
o shader vai embutido no binário, e o resultado é um único executável autocontido de poucos MB.
Fixar uma tag (`v1.9.3`) em vez de `master`. **Não** ligar `WHISPER_COREML` (§3.2).

### Se a latência de spawn incomodar

O plano B — não o plano A — é `@fugood/whisper.node`, que traz prebuilt darwin-arm64 com Metal,
roda in-process e mantém o modelo carregado, eliminando os ~320 ms de load por utterance. Vale
prototipar antes de adotar: é preciso confirmar que o `.node` carrega no Electron sem rebuild.
Uma alternativa sem dependência nova é manter um único processo `whisper-cli` vivo — mas o CLI não
tem modo daemon, então isso exigiria o `whisper-server` do próprio repo, que é outra investigação.

Para utterances curtos, medir `-ac` (audio context reduzido) antes de otimizar qualquer outra coisa:
como o encoder sempre paga 30 s, é ali que está a gordura de um push-to-talk de 5 s.
