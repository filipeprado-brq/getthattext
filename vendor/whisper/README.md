# Binários do whisper.cpp

Esta pasta recebe os executáveis que o `.app` embarca. Ela é **gerada**, não
versionada — o `.gitignore` exclui os binários.

## Por que não dá para copiar o do Homebrew

O `whisper-cli` do Homebrew é dinamicamente ligado:

```
@rpath/libwhisper.1.dylib
/opt/homebrew/opt/ggml/lib/libggml.0.dylib
/opt/homebrew/opt/ggml/lib/libggml-base.0.dylib
```

Copiá-lo para dentro do bundle produz um app que quebra em qualquer máquina
sem Homebrew — exatamente o critério "roda numa sessão limpa" do #12.

## Como preencher

`npm run vendor:whisper` compila a tag fixada com bibliotecas estáticas, ou
o workflow do CI (`.github/workflows/whisper.yml`) produz o mesmo artefato
sem exigir cmake na sua máquina.

Metal entra por default e o shader vai embutido, então o executável é
autocontido. `WHISPER_COREML` fica **desligado**: ele exigiria o modelo
convertido em CoreML ao lado, e a spec (§11) o descarta.
