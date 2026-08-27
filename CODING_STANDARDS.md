# Padrões de código

Regras que valem para todo código deste repositório. Cada uma existe porque
um problema concreto apareceu — não são preferências estéticas.

Se uma regra atrapalhar num caso real, mude a regra aqui em vez de abrir
exceção em silêncio.

---

## 1. Idioma: código em inglês, prosa em português

**Identificadores em inglês.** Funções, variáveis, tipos, constantes, nomes de
arquivo, canais de IPC, mensagens entre threads.

**Prosa em português.** Comentários, mensagens de commit, spec, tickets,
descrições de teste e strings de interface.

**Por quê:** toda API que este projeto toca já é inglesa — `AudioContext`,
`sampleRate`, `getUserMedia`, `blockAlign`. Identificador em português produz
expressão meio-a-meio a cada linha:

```ts
// ✗ o substantivo aparece em duas línguas na mesma expressão
const contexto = new AudioContext({ sampleRate: TAXA_ALVO });

// ✓
const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
```

O raciocínio continua em português, que é onde ele mora: a spec, os tickets e
os comentários. O que muda é só a camada que conversa com as APIs.

**Vocabulário de domínio:** quando o glossário (`CONTEXT.md`) definir um termo
em português, ele registra o identificador em inglês ao lado. "Portão de fala"
e `speechGate` são o mesmo conceito; a discussão usa um, o código usa o outro.

---

## 2. Comentários explicam o porquê

O código já diz o quê. Comentário que parafraseia a linha seguinte é ruído que
envelhece.

```ts
// ✗
// incrementa o offset em 2
offset += 2;

// ✓
// Cópia obrigatória — o motor sobrescreve este buffer no próximo quantum.
port.postMessage(new Float32Array(channel));
```

Comente decisões não óbvias, restrições de plataforma, e armadilhas que
custaram tempo para descobrir. Se a razão veio de um ticket ou de uma medição,
diga qual.

---

## 3. Nunca formatar data ou número à mão

Concatenação manual com padding é fonte silenciosa de bug: fuso, ano de dois
dígitos, mês base zero, colisão de mesmo segundo.

```ts
// ✗
`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// ✓ — ordenável, sem ambiguidade de fuso, com milissegundos
new Date().toISOString().replace(/[:.]/g, "-");
```

Para texto voltado ao usuário, use `Intl.DateTimeFormat` / `Intl.NumberFormat`
com locale explícito. Para nome de arquivo e log, ISO 8601.

---

## 4. Toda promise tem dono

Nenhum `void promise` sem tratamento de falha. Uma promise rejeitada em
silêncio deixa a interface num estado intermediário para sempre, sem dizer por
quê — foi exatamente o que aconteceu com o pré-aquecimento travando o botão em
"Preparando…".

```ts
// ✗
void prewarm();

// ✓
void prewarm().catch((error) => showFailure(error));
```

O mesmo vale no processo main: um `ipcMain.handle` que rejeita precisa devolver
erro utilizável ao renderer, não estourar no vazio.

---

## 5. Estado relacionado vive num objeto

Variáveis de módulo soltas que só fazem sentido juntas são um tipo esperando
para nascer. Quando forem mais de três e mudarem em conjunto, agrupe.

```ts
// ✗ — nove `let` de módulo, mutáveis de seis funções diferentes
let contexto, worklet, stream, origem, blocos, gravando, limite;

// ✓
type Recording = { source: MediaStreamAudioSourceNode; chunks: Float32Array[]; startedAt: number };
let recording: Recording | undefined;
```

O ganho real não é estética: `recording === undefined` é um estado impossível de
representar pela metade, enquanto sete booleanos soltos têm 128 combinações e
só algumas são válidas.

---

## 6. Contrato entre processos definido uma vez

O tipo da ponte entre main e renderer mora em `src/shared/` e é importado pelos
dois lados. Escrever a assinatura duas vezes — uma no `contextBridge`, outra num
`declare global` — não tem nada que as mantenha em sincronia.

---

## 7. Nome diz o que a coisa é

Sem abreviação que não seja universal. Uma variável que guarda um id de timeout
se chama `maxDurationTimer`, não `limite`. Uma função que faz duas coisas ganha
um nome que admite as duas, ou vira duas funções.

Se nenhum nome honesto aparece, o desenho está confuso — o nome é o sintoma.

---

## 8. Lógica pura fica testável e testada

Qualquer coisa que não dependa de DOM, Electron ou rede vai para `src/shared/`
com teste unitário. É a parte onde bug se esconde e onde teste é barato.

O que depende de plataforma é verificado à mão, e a verificação vira comentário
ou script versionado — não conhecimento que só existiu numa sessão.

Descrições de teste em português, porque são prosa:

```ts
it("usa escalas diferentes para positivo e negativo", () => { /* … */ });
```

---

## 9. Ferramentas antes de regras

O que o compilador ou o formatador consegue impor não vira regra escrita aqui.
`strict` e `noUncheckedIndexedAccess` estão ligados no `tsconfig`; quando houver
formatador, o estilo de vírgula e aspas sai deste documento.

Este arquivo é para o que só revisão humana pega.
