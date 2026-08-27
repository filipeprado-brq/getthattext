# Matriz de injeção nos apps reais

Type: task
Status: closed-out-of-scope

## Question

Nada a decidir por raciocínio — é trabalho manual que destrava uma decisão de arquitetura.

[Injeção de texto no input focado](./01-injecao-de-texto-no-input-focado.md) escolheu **Pasteboard + `⌘V` via `CGEvent`** com base em medição real, mas a própria research declarou o limite: **os apps de destino não foram testados.** O que o relatório afirma sobre eles é inferência a partir do motor de renderização, não observação.

Rodar a matriz manualmente e anotar o resultado de cada célula:

| App | Motor | Por que importa |
|---|---|---|
| Slack | Electron | onde mais se dita no dia a dia; `contenteditable` com modelo interno próprio |
| Discord | Electron | idem |
| VS Code / Cursor | Electron | editor de código — acentuação e indentação são casos de borda |
| Safari | WebKit | motor diferente do Chromium testado; pode se comportar de outro jeito |
| Mail | AppKit nativo | o caso "fácil" que precisa ser confirmado como fácil |
| iTerm2 / Terminal | nativo com input próprio | terminais costumam tratar colagem de forma especial (bracketed paste) |

Para cada um, verificar: o texto chega inteiro · acentuação pt-BR sobrevive · o app reage como se o usuário tivesse colado (contadores, autosave, botão de enviar habilitando) · o clipboard do usuário volta intacto · quanto tempo leva.

**Testar também o fallback** (`CGEventKeyboardSetUnicodeString` em chunks) nos que falharem com `⌘V`, e **campos de senha** — confirmando que o app detecta `IsSecureEventInputEnabled()` e recusa em vez de tentar.

Registrar a matriz preenchida em `.scratch/getthattext/research/matriz-de-apps.md`.

## Fechado — fora de escopo

Ficou além do destino após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md): o app não injeta mais texto em nenhum app. Nada a testar.
