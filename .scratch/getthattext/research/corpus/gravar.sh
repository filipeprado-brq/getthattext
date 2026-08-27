#!/usr/bin/env bash
# Grava o corpus de ditado. Retomável: pula o que já tem .wav.
# Compatível com o bash 3.2 do macOS.
#
#   bash gravar.sh          -> todas as pendentes
#   bash gravar.sh 09       -> só a 09 (regrava por cima)

DIR="$(cd "$(dirname "$0")" && pwd)"
WAV="$DIR/wav"
mkdir -p "$WAV"

bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; grn=$'\033[32m'; off=$'\033[0m'

if ! command -v rec >/dev/null 2>&1; then
  echo "sox não encontrado. Rode: brew install sox"
  exit 1
fi

ONLY="$*"

total=$(grep -c . "$DIR/prompts.tsv")

echo
echo "${bold}Corpus de ditado — getthattext${off}"
echo
echo "${dim}Cada tela mostra uma FALA de exemplo. Você pode ler ela como está —"
echo "as hesitações já estão escritas de propósito, então o teste funciona."
echo "Se preferir falar do seu jeito, ou trocar por algo real do seu trabalho,"
echo "melhor ainda: só mantenha o mesmo tipo de conteúdo.${off}"
echo
echo "${dim}Enter começa a gravar · Enter de novo para · r regrava${off}"
echo "${dim}Ctrl-C sai a qualquer momento; roda de novo e continua de onde parou.${off}"
echo

feitos=0
pulados=0

# FD 3 lê o arquivo; stdin fica livre para o Enter do usuário
while IFS=$'\t' read -r id cat rotulo txt <&3; do
  [ -z "$id" ] && continue

  if [ -n "$ONLY" ]; then
    case " $ONLY " in *" $id "*) ;; *) continue ;; esac
  else
    if [ -s "$WAV/$id.wav" ]; then
      pulados=$((pulados + 1))
      continue
    fi
  fi

  out="$WAV/$id.wav"

  while true; do
    echo "${bold}[$id de $total]${off} ${dim}$rotulo · $cat${off}"
    echo
    echo "  $txt"
    echo
    printf '  %sEnter para gravar%s ' "$dim" "$off"
    read -r _

    rec -q -r 16000 -c 1 -b 16 "$out" 2>/dev/null &
    pid=$!
    printf '  %s● gravando%s  %sEnter para parar%s ' "$red" "$off" "$dim" "$off"
    read -r _
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null

    dur=$(soxi -D "$out" 2>/dev/null | cut -d. -f1)
    [ -z "$dur" ] && dur=0
    printf '  %s✓%s %s%ss gravados%s\n' "$grn" "$off" "$dim" "$dur" "$off"
    printf '  %sEnter segue · r regrava%s ' "$dim" "$off"
    read -r ans
    echo
    if [ "$ans" = "r" ] || [ "$ans" = "R" ]; then
      rm -f "$out"
      continue
    fi
    feitos=$((feitos + 1))
    break
  done
done 3< "$DIR/prompts.tsv"

echo "${bold}$feitos gravadas nesta sessão${off}${dim} · $pulados já existiam · $total no total${off}"
ja=$(ls -1 "$WAV"/*.wav 2>/dev/null | wc -l | tr -d ' ')
if [ "$ja" -lt "$total" ]; then
  echo "${dim}Faltam $((total - ja)). Rode 'bash gravar.sh' de novo para continuar.${off}"
else
  echo "${grn}Corpus completo.${off}${dim} Me avise que eu transcrevo e analiso.${off}"
fi
echo
