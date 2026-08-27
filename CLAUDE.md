# getthattext

Ferramenta de ditado para macOS. Clique no ícone da barra de menu, fale, clique
de novo: o texto é transcrito localmente pelo whisper.cpp, melhorado pelo Groq,
e colocado na área de transferência. Uso pessoal do autor.

A spec do MVP está em `.scratch/getthattext/spec.md`, e as decisões que a
originaram estão em `.scratch/getthattext/map.md` com o raciocínio completo de
cada uma em `.scratch/getthattext/issues/`.

## Padrões de código

Identificadores em inglês, prosa em português. Regras completas em
`CODING_STANDARDS.md` — leia antes de escrever código neste repo.

## Agent skills

### Issue tracker

Issues vivem no GitHub (`filipeprado-brq/getthattext`), via `gh` CLI.
Ver `docs/agents/issue-tracker.md`.

### Triage labels

Os cinco rótulos canônicos, sem renomeação. Ver `docs/agents/triage-labels.md`.

### Domain docs

Contexto único — `CONTEXT.md` e `docs/adr/` na raiz. Ver `docs/agents/domain.md`.
