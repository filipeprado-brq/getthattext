#!/usr/bin/env python3
"""A/B do prompt de reescrita: gpt-oss-20b vs gpt-oss-120b, sobre o corpus real.

Implementa exatamente o que os tickets decidiram:
  - saída ESTRUTURADA (texto + correções escopadas a termos)  [ticket 19]
  - agressividade por tamanho, limiar ~40 palavras            [ticket 08 corrigido]
  - travas NUNCA MUDE / NUNCA ACRESCENTE                      [ticket 08]
  - reasoning_effort low, reasoning_format hidden, temp 0.3   [ticket 05]
"""
import json, pathlib, sys, time, urllib.request

DIR = pathlib.Path(__file__).parent
KEY = pathlib.Path.home().joinpath(".config/groq/key").read_text().strip()
MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]

SYSTEM = """Você reescreve transcrições de ditado em português do Brasil.

O texto de entrada está em português do Brasil e a saída deve estar em português
do Brasil. Nunca traduza.

AGRESSIVIDADE PELO TAMANHO:
- Se o texto tiver menos de 40 palavras: corrija APENAS pontuação, capitalização
  e acentuação. Não reformule, não expanda, não mude o registro.
- Se tiver 40 palavras ou mais: reescreva para ficar bem escrito, respeitando
  todas as regras abaixo.

MUDE:
- disfluências ("é...", "tipo", "né", "assim", "então" de preenchimento)
- falsos começos e repetições ("no, no endpoint")
- pontuação, capitalização, acentuação e concordância
- quebra em parágrafos quando o texto for longo
- quando a pessoa se corrigir no meio, mantenha APENAS a versão corrigida

NUNCA MUDE:
- números, datas, valores, quantidades, prazos
- nomes próprios, de pessoas, empresas e produtos
- nomes de arquivos, variáveis, funções, comandos, endpoints
- siglas
- termos técnicos em inglês — mantenha em inglês
- o grau de certeza: se a pessoa disse "acho que", não afirme

NUNCA ACRESCENTE:
- informação que não está no texto
- conclusões, aprovações ou decisões que a pessoa não disse
- o final de uma frase que ficou incompleta — deixe incompleta

Responda SOMENTE com um objeto JSON com estas duas chaves:
  "texto": string com o texto final, e nada além dele
  "correcoes": lista de objetos {"de": "...", "para": "..."} contendo APENAS
    correções de nomes próprios, termos técnicos, nomes de arquivo/variável/
    comando e siglas que você corrigiu. NÃO liste remoção de disfluência,
    pontuação nem reformulação. Se não houver nenhuma, use lista vazia."""


def chamar(model, texto):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": texto},
        ],
        "temperature": 0.3,
        "max_completion_tokens": 1500,
        "reasoning_effort": "low",
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                 "User-Agent": "getthattext/0.1"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    dt = time.time() - t0
    raw = d["choices"][0]["message"]["content"]
    try:
        obj = json.loads(raw)
        return {"ok": True, "texto": obj.get("texto", ""),
                "correcoes": obj.get("correcoes", []),
                "latencia": dt, "usage": d.get("usage", {})}
    except json.JSONDecodeError:
        return {"ok": False, "raw": raw[:300], "latencia": dt}


out = {}
ids = sorted(p.stem for p in (DIR / "cru").glob("*.txt"))
for i in ids:
    cru = (DIR / "cru" / f"{i}.txt").read_text().strip()
    if not cru:
        continue
    out[i] = {"cru": cru, "palavras": len(cru.split())}
    for m in MODELS:
        try:
            out[i][m] = chamar(m, cru)
        except Exception as e:
            out[i][m] = {"ok": False, "erro": str(e)[:200]}
        print(f"{i} {m.split('/')[-1]:14} "
              f"{out[i][m].get('latencia', 0):.2f}s "
              f"{'ok' if out[i][m].get('ok') else 'FALHOU'}", flush=True)

(DIR / "ab-resultado.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print(f"\n{len(out)} amostras · resultado em ab-resultado.json")
