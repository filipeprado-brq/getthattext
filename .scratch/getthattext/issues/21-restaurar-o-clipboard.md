# Restaurar o clipboard

Type: prototype
Status: closed-out-of-scope

## Question

[Permissões e ordem de pedido](./06-permissoes-e-ordem-de-pedido.md) desenterrou um risco datado que ninguém tinha visto, e ele bate direto no mecanismo de injeção escolhido.

**O macOS 15.4 adicionou `NSPasteboard.accessBehavior` e um bucket de privacidade "Colar de Outros Apps".** *Escrever* no pasteboard é livre. **Ler** não é — e ler é exatamente o que o app precisa fazer para *restaurar* o clipboard do usuário depois de colar, porque essa leitura não se qualifica como "user originated and paste related".

Esta máquina roda **15.7.3**, então isso é presente, não futuro.

O aperto: [Injeção de texto no input focado](./01-injecao-de-texto-no-input-focado.md) escolheu Pasteboard + `⌘V`, e salvar-e-restaurar o clipboard é o que impede a ferramenta de destruir o que você tinha copiado. Se restaurar disparar um alerta do sistema a cada ditação, a cura é pior que a doença.

**Medir primeiro** (o default de `accessBehavior` em 15.4+ ficou como lacuna declarada na research):

- Ler o pasteboard de um app assinado dispara alerta, ou o default é permissivo?
- Se dispara: dispara **toda vez**, ou uma vez e memoriza?
- A leitura *antes* de escrever (o snapshot) conta igual à leitura de restauração?

**Depois decidir:**

- **Restaurar** — clipboard preservado, mas possível alerta por ditação
- **Não restaurar** — cada ditação sobrescreve seu clipboard silenciosamente. Para quem dita muito, isso destrói o clipboard como ferramenta de trabalho
- **Não restaurar, mas avisar uma vez** — e talvez oferecer o texto anterior em algum lugar
- **Restaurar atrás de flag**, default a definir

Guardar a medição em `.scratch/getthattext/research/` como asset.

## Fechado — fora de escopo

Ficou além do destino após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md): o clipboard passou a ser o **destino** do texto, por design. O app é dono dele — não há conteúdo do usuário a preservar, e a leitura de backup que dispararia o alerta de "Colar de Outros Apps" nunca acontece.
