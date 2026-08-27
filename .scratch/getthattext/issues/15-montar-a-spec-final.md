# Montar a spec final

Type: task
Status: resolved
Blocked by: 12, 16, 23, 24, 26

## Question

Nada a decidir — este é o destino do mapa. Consolidar todas as decisões dos tickets resolvidos numa spec única em `.scratch/getthattext/spec.md`, pronta para alguém implementar sem precisar reabrir nenhuma discussão.

A spec deve cobrir, cada item apontando para o ticket que o decidiu:
- Fluxo do usuário, ponta a ponta
- Arquitetura de processos e dependências, com versões
- Cada mecanismo escolhido (hotkey, captura de áudio, whisper, Groq, injeção) e por quê
- Permissões exigidas e fluxo de solicitação
- Estados da UI e o que os dispara
- Comportamento de erro e degradação
- Formato de preferências, dicionário e armazenamento da key
- Empacotamento e instalação
- O que está explicitamente **fora** do MVP

Se ao montar aparecer uma lacuna, isso não se resolve aqui — vira ticket novo.

## Answer

**Spec entregue: [`spec.md`](../spec.md).** É o destino do mapa.

Treze seções, cada decisão apontando para o ticket que a decidiu: fluxo ponta a ponta · arquitetura e pipeline de áudio · transcrição e portão de fala · dicionário · reescrita e o prompt completo · entrega pelo clipboard · os sete estados do ícone e o menu · permissões · onboarding · tabela de erros e degradação · empacotamento e assinatura · o que ficou fora · questões abertas declaradas.

**Nenhuma lacuna nova apareceu ao montar.** As cinco questões abertas listadas na seção 13 já eram conhecidas e nenhuma bloqueia a implementação — idioma fixo vs auto-detect, consumo de memória do Electron, renovação anual do certificado, `--vad-threshold` em fala sussurrada, e o trade-off do `-ac`.

**A spec carrega um apêndice deliberado:** as quatro decisões que o campo desmentiu. Ela parece mais firme do que o processo foi, e quem for implementar merece saber onde o chão foi testado e onde foi raciocinado.

**O que sustenta cada tipo de afirmação:**

- **Medido nesta máquina:** latência do whisper (1,3–2,6 s), latência do Groq (0,67 s média / 1,27 s pico), alucinação em silêncio (8 de 8), portão VAD (6 de 6), travas do prompt (0 invenções em 9 curtas), limiar de 40 (9 curtas intactas, 21 longas reescritas), baseline de jargão, limites reais da conta (250.000 TPM), SHA-256 do modelo.
- **Verificado em fonte primária:** stdin do `whisper-cli`, deferral de 5 s do Chromium, `--prompt` de 223 tokens, TN3127 sobre ad-hoc, entitlements default do `@electron/osx-sign`, `SMAppService` retornando `requires-approval`, `productName` nomeando o item do Keychain.
- **Raciocinado, não testado:** a ergonomia do menu, a cadência de 1,7 s, e as cinco questões da seção 13.
