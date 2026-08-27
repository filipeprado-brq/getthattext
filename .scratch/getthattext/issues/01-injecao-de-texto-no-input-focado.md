# Injeção de texto no input focado

Type: research
Status: resolved

## Question

A partir de um app Electron no macOS 15 (Apple Silicon), quais mecanismos existem para inserir texto no campo de texto atualmente focado de **outro** app, e como cada um se comporta na prática?

Cobrir:
- **Accessibility API (`AXUIElement`)** — `kAXValueAttribute` / `kAXSelectedTextAttribute`. Existe módulo nativo npm que exponha isso, ou precisa de addon próprio?
- **Pasteboard + `⌘V` simulado** — via `osascript`/System Events, ou via `CGEvent` num módulo nativo. Como salvar e restaurar o clipboard do usuário sem corromper o conteúdo anterior (incluindo tipos não-texto)? Qual a corrida entre escrever no pasteboard e disparar o ⌘V?
- **`CGEventKeyboardSetUnicodeString`** — digitar o texto caractere a caractere. Viável para texto longo? Qual o custo de tempo?

Para cada mecanismo, responder:
- Qual permissão exige (Acessibilidade? Automação? ambas?) e como o app detecta se foi concedida
- Comportamento em: apps nativos (Notes, Mail), apps Electron (Slack, VS Code, Discord), navegadores (Safari, Chrome), terminais (Terminal.app, iTerm2), e campos de senha
- Se preserva acentuação e caracteres pt-BR corretamente
- Estado de manutenção dos pacotes npm envolvidos

**Este é o maior risco do projeto** — se não houver um mecanismo confiável, o produto inteiro muda de forma.

Gravar achados em `.scratch/getthattext/research/injecao-de-texto.md`.

## Answer

Achados completos, com cada afirmação etiquetada **[DOC]** / **[MEDIDO]** / **[NÃO VERIFICADO]**: [`research/injecao-de-texto.md`](../research/injecao-de-texto.md) (802 linhas). Os três mecanismos foram medidos nesta máquina (macOS 15.7.3, arm64) com programas Swift chamando as mesmas APIs C que um addon Node usaria.

**Decisão: Pasteboard + `⌘V` via `CGEvent` como caminho principal. `CGEventKeyboardSetUnicodeString` em chunks como fallback. Accessibility API só para *ler* contexto, nunca para escrever.**

**A Accessibility API é uma armadilha — e era o candidato que parecia mais limpo:**

- Com a árvore de a11y desligada (que é o padrão do Chromium), `kAXFocusedUIElement` retorna `kAXErrorNoValue` no Chrome, Cursor e Teams. Ou seja, **falha exatamente nos apps Electron onde você mais vai ditar.**
- Ligando via `AXEnhancedUserInterface` funciona, mas o `set` **retorna erro −25208 e mesmo assim surte efeito**, com ~2–3 s de latência (há um `kTwoSecondDelay` explícito no código do Electron).
- Setar `kAXSelectedTextAttribute` **retorna sucesso e não faz nada** — o Chromium só implementou o getter.
- `kAXValue` em `contenteditable` troca o conteúdo via `setInnerText` **sem disparar `input`** — quebra o modelo interno de Slack, Discord e Notion.

**Fatos medidos que contrariam o que a internet diz:**

- **O limite de 20 caracteres do `CGEventKeyboardSetUnicodeString` não se reproduz** no macOS 15.7.3 — chunks de 500 unidades UTF-16 chegaram inteiros, e 5.124 caracteres foram postados em ~1 ms. Isso torna o fallback viável para texto longo, ao contrário do que se supunha.
- **A corrida do clipboard é na restauração, não na escrita.** `pre_paste_delay` de 0 ms passou; restaurar em 0 ms **colou o conteúdo antigo do usuário**. 5 ms bastou nesta máquina, mas a recomendação é copiar as folgas do espanso (100/300 ms).

**Achado de segurança — o mais importante do ticket:**

`IsSecureEventInputEnabled()` bloqueia `⌘V` e CGEvent num campo de senha, mas **não bloqueia a Accessibility API, que escreveu na senha normalmente.** Isso não é só argumento contra usar AX para escrever: é motivo para o app **detectar secure input e abortar explicitamente**, em vez de tentar e torcer.

**Pacotes:**

- **Não existe pacote npm mantido que exponha `AXUIElementSetAttributeValue`.** Os candidatos são só de permissão (`node-mac-permissions`) ou somente leitura. Seria addon próprio ou `koffi`. Irrelevante agora que AX está fora do caminho de escrita.
- **`robotjs` ressuscitou** — 6 anos parado, e desde março/2026 saíram 0.7.0→0.9.1 (última em 2026-08-07), com Node-API e prebuild `darwin-arm64` no tarball, sem rebuild para Electron. Ressalva: `keyboardDelay` default de 10 ms/char torna `typeString` inutilizável para texto longo — precisa ser zerado.

**Risco residual declarado pela research:** **Slack, Discord, VS Code, Safari, Mail e iTerm2 não foram testados.** O que o relatório diz sobre eles vem do motor, não de medição. Vira ticket próprio.

## Superado

A decisão acima **não é mais aplicada**. [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md) mudou o destino do texto para o clipboard, então o app não injeta em nenhum app. A pesquisa fica registrada porque é exatamente o que seria necessário se colar automaticamente voltar ao escopo — e porque o achado de segurança (a Accessibility API **não** é bloqueada por secure input e escreve em campo de senha) é a razão mais forte para não trazer de volta sem cuidado.
