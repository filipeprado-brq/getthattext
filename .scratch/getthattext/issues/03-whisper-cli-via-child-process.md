# whisper.cpp via child process

Type: research
Status: resolved

## Question

Como usar `whisper.cpp` localmente a partir de um app Electron no macOS 15 / Apple Silicon, e qual o custo real disso?

Cobrir:
- Como obter o binário: buildar do fonte, baixar release pré-compilado, ou usar um wrapper npm (`smart-whisper`, `nodejs-whisper`)? Prós e contras de cada, incluindo se o build precisa acontecer na máquina do usuário
- Suporte a **Metal** em Apple Silicon: está ligado por padrão? precisa de flag?
- Quais modelos existem (`tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo`), **tamanho em disco de cada um**, e de onde são baixados
- **Qualidade em pt-BR por modelo** — a partir de qual tamanho a transcrição de ditado corrido fica utilizável
- **Latência medida ou reportada** por segundo de áudio, por modelo, em Apple Silicon com Metal. Números concretos, não impressões
- Formato de entrada exigido (WAV PCM 16kHz mono float32/int16?) e se aceita stdin ou só arquivo
- Flags relevantes: `--language pt`, `--prompt` (limite de tokens do initial prompt), `--no-timestamps`, formato de saída

Gravar achados em `.scratch/getthattext/research/whisper-cli.md`.

## Answer

Achados completos, com WER por idioma extraído do paper e números de bench medidos: [`research/whisper-cli.md`](../research/whisper-cli.md) (625 linhas).

**Decisões travadas:**

- **Modelo: `large-v3-turbo-q5_0`.** 547 MiB — **disco de `small`, latência entre `small` e `medium`, qualidade de `large-v2`**. Ele domina o `medium` em todas as dimensões (2,7× menor, ~2,4× mais rápido, qualidade igual ou melhor). Não há trade-off a fazer aqui.
- **Baixar no primeiro uso**, de `huggingface.co/ggerganov/whisper.cpp`, não embutir no instalador.
- **Invocação:** `whisper-cli -m <modelo> -f - -l pt -nt -np -sns -bs 1 -nf --prompt "<termos>"`. Greedy (`-bs 1`) + sem temperature fallback (`-nf`) é o modo de menor latência.
- **Binário: buildar no CI (macOS arm64) e embarcar como `extraResource`, com tag fixada.** **Nenhum wrapper npm serve** — `nodejs-whisper`, `smart-whisper` (parado desde out/2024) e `@remotion/install-whisper-cpp` todos empurram cmake + Xcode CLT pro usuário final.
- **Metal liga sozinho** (`GGML_METAL_DEFAULT ON` quando APPLE) e o shader vai embutido no binário — o executável é autocontido, de poucos MB.
- **Core ML rejeitado:** +1,1 GB de encoder, flag de build extra, bug aberto em M4 com macOS recente (issue #3702), e rendeu só +15% no arquivo longo medido.

**Números de latência — a peça que faltava:**

| Duração da fala | whisper turbo-q5_0 | + load do modelo | + Groq | **Total** |
|---|---:|---:|---:|---:|
| 10 s | ~0,62 s | +0,32 s | +0,9–1,4 s | **~1,8–2,3 s** |
| 60 s | ~1,8 s | +0,32 s | +0,9–1,4 s | **~3,0–3,5 s** |

**Três armadilhas do child process:**

1. **Load do modelo a cada spawn: 321,89 ms medidos** (turbo-q5_0). Para um ditado de 10 s isso é ~34% do tempo total do whisper.
2. **O encoder sempre processa uma janela de 30 s com zero-padding** — 5 s de fala pagam o encode inteiro. A flag `-ac/--audio-ctx` é a alavanca óbvia, mas **não existe medição primária do trade-off qualidade/velocidade**. É onde está a gordura de um push-to-talk curto.
3. **Temperature fallback** pode disparar até 6 re-decodificações da mesma janela. `-nf` zera isso.

**Qualidade pt-BR (WER FLEURS `pt_br`, do apêndice do paper):** tiny 20,1% · base 13,0% · small 7,3% · medium 5,0% · large-v2 4,3%. O piso do utilizável é `small`; turbo é inferido em ~4–5% (a OpenAI diz que "performs similarly to large-v2" e português não está entre os idiomas degradados).

**Plano B registrado, não adotado:** `@fugood/whisper.node` tem prebuilt darwin-arm64 com Metal, roda in-process e mantém o modelo carregado — elimina os ~320 ms por ditado. Só vale se o orçamento de latência disser que 320 ms importam.

**Corrigido depois por [Onde entra o dicionário customizado](./10-onde-entra-o-dicionario-customizado.md):** o limite do `--prompt` é **223 tokens**, não 224 — e a flag `--prompt` foi **descartada** do comando final, porque o prompt é apagado após a primeira janela de 30 s e sumido de vez quando o fallback de temperatura sobe. A invocação real não leva `--prompt`.
