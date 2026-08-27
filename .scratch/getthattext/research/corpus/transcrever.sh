#!/usr/bin/env bash
# Transcreve tudo em wav/ nas DUAS vias: com e sem VAD.
# A comparação valida se o VAD engole fala real (ticket "Quando não há fala").
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
M="$HOME/.cache/whisper/ggml-large-v3-turbo-q5_0.bin"
V="$HOME/.cache/whisper/ggml-silero-v5.1.2.bin"
mkdir -p "$DIR/cru" "$DIR/cru-vad"
[ -f "$M" ] || { echo "modelo ausente: $M"; exit 1; }

shopt -s nullglob
wavs=("$DIR"/wav/*.wav)
[ ${#wavs[@]} -eq 0 ] && { echo "nenhum .wav gravado ainda — rode: bash gravar.sh"; exit 0; }

printf '%-4s %8s %9s  %s\n' id audio whisper "primeiras palavras (com VAD)"
for w in "${wavs[@]}"; do
  id=$(basename "$w" .wav)
  a=$(soxi -D "$w" 2>/dev/null)
  [ -s "$DIR/cru/$id.txt" ] || whisper-cli -m "$M" -f "$w" -l pt -nt -np -sns -bs 1 -nf \
      2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' > "$DIR/cru/$id.txt"
  s=$(python3 -c 'import time;print(time.time())')
  [ -s "$DIR/cru-vad/$id.txt" ] || whisper-cli -m "$M" -f "$w" -l pt -nt -np -sns -bs 1 -nf --vad -vm "$V" \
      2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' > "$DIR/cru-vad/$id.txt"
  e=$(python3 -c 'import time;print(time.time())')
  printf '%-4s %7.1fs %8.2fs  %.60s\n' "$id" "$a" "$(echo "$e-$s"|bc)" "$(cat "$DIR/cru-vad/$id.txt")"
done
echo
echo "cru/ = sem VAD   cru-vad/ = com VAD   — me avise que eu comparo."
