# Permissões e ordem de pedido

Type: research
Status: resolved
Blocked by: 01, 02, 04

## Question

Com os mecanismos de injeção, hotkey e áudio já escolhidos: qual é o **conjunto final** de permissões do macOS que o app exige, em que ordem elas são pedidas, e o que o app faz quando cada uma é negada?

Cobrir:
- A lista definitiva (Microfone, Acessibilidade, Automação/Apple Events — quais de fato) e qual funcionalidade morre sem cada uma
- Quais podem ser pedidas por prompt do sistema e quais exigem que o usuário vá manualmente em Ajustes do Sistema
- Como detectar em runtime se cada uma está concedida
- Ordem de pedido na primeira execução: pedir tudo de uma vez ou sob demanda no primeiro uso de cada capacidade
- O que acontece quando uma permissão é **revogada com o app rodando** — o app percebe? trava? avisa?
- Se um app Electron não assinado consegue aparecer na lista de Acessibilidade dos Ajustes do Sistema durante desenvolvimento

Gravar achados em `.scratch/getthattext/research/permissoes.md`.

## Answer

Achados completos: [`research/permissoes.md`](../research/permissoes.md). Nenhum experimento tocou a sessão do usuário.

**São só duas permissões TCC: Microfone e Acessibilidade.**

- **Automação / Apple Events: descartada.** A decisão de usar `CGEvent` em vez de `osascript` é o que elimina — Automação seria por app-alvo, um prompt para cada app onde você ditasse.
- **Input Monitoring: descartada.** O Carbon `RegisterEventHotKey` não é event tap. Nada no app dispara esse bucket.
- **Acessibilidade é exigida pelo `CGEventPost`.** A fonte definitiva é a **WWDC 2019 sessão 701**, não a referência da API — a página de `CGEvent.post(tap:)` não menciona permissão nenhuma. A sessão diz que os eventos "are discarded" e separa os buckets: tap somente-leitura → Input Monitoring; tap que modifica ou `post` → Acessibilidade. Confirmado no código do Chrome Remote Desktop: `bool CanInjectInput() { return AXIsProcessTrusted(); }`. Então `isTrustedAccessibilityClient` é o gate correto.

**A assimetria que define o onboarding:**

O prompt de Acessibilidade **não concede nada**. A doc da Apple diz que `kAXTrustedCheckOptionPrompt` apenas *informa* e "does not affect the return value". Microfone é 1 clique dentro do app; Acessibilidade são 5 passos manuais nos Ajustes. **Não podem compartilhar o mesmo componente de onboarding.**

**Correção a uma premissa deste ticket:** eu perguntei o que acontece quando uma permissão é revogada com o app rodando, assumindo que o macOS pudesse matar o processo. **Está invertido** — Quinn (Apple DTS) testou: revogação faz a API falhar, o processo **não** morre. O `SIGKILL` em mudança de privacidade é comportamento de **iOS**. O crash em macOS vem de outra coisa: falta de `NSMicrophoneUsageDescription` **ou** do entitlement `com.apple.security.device.audio-input` — a Apple usa "and", cada uma isolada já mata o processo.

**Falha silenciosa é o pior modo de falha deste app.** Não existe notificação suportada de mudança de TCC (o Chromium faz polling de 1 s; `com.apple.accessibility.api` é undocumented) e `CGEventPost` retorna `void`. Consequência dura: o app **tem** que checar Acessibilidade imediatamente antes de cada injeção, e **nunca descartar a transcrição** quando a injeção falhar.

**Deep-links — a forma que circula por aí está obsoleta.** `com.apple.preference.security?Privacy_Accessibility` é o prefPane pré-Ventura. A forma usada em produção pelo Chromium no macOS 13–15 é `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility` (e `?Privacy_Microphone`). O scheme é **unsupported** pela Apple — usar como conveniência e sempre mostrar o caminho textual ao lado.

**Fluxo decidido:** onboarding up front de 3 passos, microfone **antes** de acessibilidade, com polling de 1 s por passo, mais re-verificação a cada acionamento. A HIG prega pedido lazy, mas abre exceção para o que é "required for your app to function" — e aqui as duas permissões são as duas metades de um único fluxo, num app que no momento do uso está em background e sem janela.

**Reforço à decisão de assinar:** TN3127 é a fonte exata — "Unsigned code has no DR. Ad hoc signed code… has a DR but it's tied to that specific version of the code." O sintoma é confuso: o toggle aparece **ligado** mas `AXIsProcessTrusted()` retorna `false`. E dev e release precisam usar a **mesma** identidade: TN3127 avisa que os DRs default de Apple Development e Developer ID não são compatíveis entre si, então cada variante ganharia entrada própria em Acessibilidade **e** chave própria no Keychain.

## Superado em parte

**Sobrou uma permissão: Microfone.** [Orçamento de latência e duração do ditado](./18-orcamento-de-latencia.md) removeu a injeção de texto, e a Acessibilidade era exigida **exclusivamente** pelo `CGEventPost`. Cai com ela: o onboarding de 3 passos, a assimetria dos 5 passos manuais nos Ajustes, o polling de 1 s, a re-verificação antes de cada injeção, e os deep-links para o painel de Acessibilidade.

O que **sobrevive**: `NSMicrophoneUsageDescription` **e** o entitlement `com.apple.security.device.audio-input` continuam obrigatórios, e a falta de qualquer um dos dois causa **crash, não prompt**. O deep-link `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone` continua útil para quem negar. E a exigência de assinatura estável permanece — agora só pelo Keychain, não mais pelo TCC.
