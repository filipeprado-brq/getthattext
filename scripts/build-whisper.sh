#!/usr/bin/env bash
#
# Compila o whisper.cpp autocontido para macOS arm64, em vendor/whisper/.
#
#   npm run vendor:whisper
#
# Por que não usar o binário do Homebrew: ele é dinamicamente ligado a
# libwhisper e libggml de /opt/homebrew, e um bundle que dependesse dele
# quebraria em qualquer máquina sem Homebrew.
#
# A TAG É FIXA de propósito. O app depende de detalhes medidos do
# whisper-cli — que `-f -` lê o stdin, que `-otxt -of -` são obrigatórios
# com stdin, e a saída exata do whisper-vad-speech-segments. Seguir o HEAD
# faria essas premissas mudarem sem aviso.
#
# Metal entra por default e o shader vai embutido, então o executável é
# autocontido. WHISPER_COREML fica DESLIGADO: exigiria o modelo convertido
# em CoreML ao lado, e a spec (§11) o descarta.
set -euo pipefail

TAG="v1.9.2"   # a mesma que o Homebrew instalou nesta máquina
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/whisper"
WORK="${TMPDIR:-/tmp}/whisper-build-$TAG"

command -v cmake >/dev/null || {
  echo "cmake não está instalado. Rode: brew install cmake" >&2
  exit 1
}

[ -d "$WORK" ] || git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$WORK"

cmake -S "$WORK" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_COREML=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON
cmake --build "$WORK/build" --config Release -j

mkdir -p "$OUT"
for bin in whisper-cli whisper-vad-speech-segments; do
  found="$(find "$WORK/build/bin" -name "$bin" -type f | head -1)"
  [ -n "$found" ] || { echo "não encontrei $bin no build" >&2; exit 1; }
  cp "$found" "$OUT/$bin"
done

echo
echo "em $OUT:"
for bin in whisper-cli whisper-vad-speech-segments; do
  printf "  %-32s %5.1f MB\n" "$bin" "$(echo "$(stat -f%z "$OUT/$bin")/1000000" | bc -l)"
  # A prova de que é autocontido: nada de /opt/homebrew nas dependências.
  if otool -L "$OUT/$bin" | grep -q "/opt/homebrew"; then
    echo "    AINDA DEPENDE DO HOMEBREW — o bundle quebraria numa máquina limpa" >&2
    otool -L "$OUT/$bin" | grep homebrew >&2
    exit 1
  fi
done
echo
echo "nenhuma dependência de /opt/homebrew: o executável é autocontido."
