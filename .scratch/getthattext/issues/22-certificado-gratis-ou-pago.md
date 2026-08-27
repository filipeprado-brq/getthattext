# Certificado grátis ou pago

Type: grilling
Status: resolved

## Question

[Empacotamento e execução](./14-empacotamento-e-execucao.md) estabeleceu que assinar é obrigatório (arm64 não executa código nativo sem assinatura) e que **ad-hoc não serve** — cada rebuild geraria prompt novo de Acessibilidade e de Keychain. Um certificado **Apple Development gratuito** resolve.

Mas ficou uma lacuna com consequência anual: **o designated requirement embute o CN da folha do certificado, e o Apple Development gratuito expira todo ano.** Se o CN mudar na renovação, o DR muda — e **todas** as concessões caem de uma vez: a entrada em Acessibilidade e a chave do Groq no Keychain. Uma vez por ano você reconfiguraria tudo, provavelmente sem entender por quê.

A research não pôde verificar se o CN é de fato estável entre renovações. O experimento que resolveria leva um ano.

**A decisão:**

- **Apple Development gratuito** — custo zero. Risco: possível re-concessão anual de tudo. Mitigável documentando o sintoma (o toggle aparece ligado e `AXIsProcessTrusted()` retorna `false`) para você reconhecer quando acontecer.
- **Developer ID pago (US$99/ano)** — certificado de 5 anos, identidade estável, e abre a porta pra notarização se algum dia você quiser dar o app pra outra pessoa. Para uma ferramenta de uso pessoal, é dinheiro real por uma conveniência anual.

Decidir também: dev e release usam a **mesma** identidade? TN3127 avisa que os DRs default de Apple Development e Developer ID **não são compatíveis entre si** — usar as duas criaria entrada própria em Acessibilidade e chave própria no Keychain para cada variante, e você acabaria com dois apps disputando o mesmo atalho.

## Adendo (após [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md))

Metade do argumento caiu: **não há mais permissão de Acessibilidade a perder** numa renovação de certificado. O que ainda está em risco é a **chave do Groq no Keychain** — o `safeStorage` continua indexando pela identidade do código.

Ou seja, o pior caso anual deixou de ser "reconfigura tudo" e passou a ser "cola a API key de novo". Isso enfraquece bastante o argumento de pagar US$99/ano.

## Answer

**Certificado Apple Development gratuito.** Sem conta paga no Apple Developer Program.

**O que decidiu:** quando a permissão de Acessibilidade caiu em [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md), metade do risco anual caiu junto — não há mais concessão de TCC a perder numa renovação de certificado. Sobrou apenas a **chave do Groq no Keychain**, porque o `safeStorage` indexa pela identidade do código.

Pior caso anual, portanto: **recolar a API key uma vez por ano.** Isso não justifica US$99/ano num app de uso pessoal — ainda mais porque o efeito **sequer foi confirmado**: a research não conseguiu verificar se o CN da folha do certificado muda entre renovações, e o experimento que resolveria leva um ano.

**Registrar na spec, para reconhecer o sintoma se acontecer:** depois de uma renovação de certificado, o app pode passar a pedir a API key do Groq de novo, como se nunca tivesse sido configurada. Não é bug do app — é o `safeStorage` não conseguindo descriptografar o que foi cifrado sob a identidade anterior. A ação é recolar a chave.

**Continua valendo de [Empacotamento e execução](./14-empacotamento-e-execucao.md):**

- Assinar é obrigatório de qualquer forma — arm64 não executa código nativo sem assinatura válida, e ad-hoc não dá identidade estável (TN3127: o DR fica atado àquela versão exata do código)
- Dev e release devem usar a **mesma** identidade; misturar Apple Development com Developer ID criaria chave própria no Keychain para cada variante
- **Notarização segue fora de escopo** — não é necessária para uso pessoal

Se o destino for redesenhado algum dia para incluir distribuição a outras pessoas, isso vira um esforço novo: aí o Developer ID pago passa a ser exigido, não opcional.
