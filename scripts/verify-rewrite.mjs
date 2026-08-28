/**
 * Verificação da reescrita no Groq (#4), contra a API de verdade.
 *
 *   npm run build && npm run verify:rewrite
 *
 * O que os testes unitários não cobrem: se as travas do prompt seguram um
 * modelo real. Cada caso aqui saiu de uma medição registrada na spec ou nos
 * tickets — não são exemplos inventados.
 *
 * Custa chamadas de API. A chave é lida do arquivo de desenvolvimento e
 * nunca é impressa. Sem ela, o script diz que pulou em vez de passar calado.
 *
 * UMA RODADA POR CASO, e o modelo tem variância real mesmo com
 * `temperature: 0.3` — medido ao escolher o prompt: a mesma entrada e o
 * mesmo prompt deram 2/13 numa bateria e 0/10 noutra. Um `FALHOU` isolado
 * aqui é esperado e NÃO significa regressão; rode de novo antes de concluir
 * qualquer coisa. O que importa é o padrão ao longo de várias rodadas.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { rewrite } = require("../dist/main/groq.js");
const { applyDictionary } = require("../dist/shared/dictionary.js");

const KEY_FILE = join(process.env.HOME ?? "", ".config/groq/key");

/**
 * Cada caso declara o que NÃO pode acontecer. A reescrita é generativa, então
 * asseverar a saída exata seria flaky; o que a spec promete são as travas.
 */
const CASES = [
  {
    name: "não inventa conclusão que a pessoa não disse",
    input: "ok pode subir",
    // Com prompt mínimo isto virou "Upload concluído com sucesso!" — invenção
    // total, medida. É o caso que justifica o bloco NUNCA ACRESCENTE.
    reject: [/sucesso/i, /conclu/i, /finalizad/i],
  },
  {
    name: "preserva nome de arquivo",
    input: "o bug tá em modules/home/hooks/useMenu.ts, na linha 42",
    must: ["modules/home/hooks/useMenu.ts", "42"],
  },
  {
    name: "preserva o grau de certeza",
    input: "acho que dá pra subir isso hoje ainda, mas não tenho certeza",
    must: [/acho que/i],
    reject: [/^vamos subir/i],
  },
  {
    name: "mantém termo técnico em inglês",
    input: "abre um pull request e pede code review pro time",
    must: [/pull request/i, /code review/i],
  },
  {
    // Conteúdo neutro de propósito: o corpus real é privado e não entra no
    // repo. O que importa aqui é o tamanho — passa de 40 palavras e cai no
    // caminho agressivo, que é onde a saudação sumia.
    name: "mantém saudação e despedida no caminho agressivo (>= 40 palavras)",
    input:
      "oi pessoal bom dia, então hoje eu queria falar rapidinho sobre a lista " +
      "de compras da semana que a gente combinou, eu acho que dá pra reduzir o " +
      "gasto se comprar as coisas na feira em vez do mercado, principalmente " +
      "fruta e verdura que sai bem mais barato, aí depois me confirma se faz " +
      "sentido, valeu pessoal até mais",
    must: [/bom dia|oi pessoal/i, /valeu|at[ée] mais/i],
  },
  {
    // Conteúdo neutro, mas com a forma que falhava: passa de 40 palavras,
    // tem hedge e tem vocativo. Sobre um ditado real assim, o grau de
    // certeza sumia em 10 de 10 rodadas.
    name: "preserva hedge e vocativo no caminho agressivo",
    input:
      "oi pessoal, então eu queria comentar uma coisa sobre a viagem que a " +
      "gente tá planejando pro fim do ano, eu acredito que sair na sexta de " +
      "manhã seja melhor do que na quinta à noite porque o trânsito na quinta " +
      "costuma ser pior, mas não tenho certeza disso, talvez valha a pena " +
      "checar antes de fechar, aí me falem o que vocês acham, abraço",
    must: [/acredito|acho|creio/i, /talvez|não tenho certeza/i, /pessoal/i],
  },
  {
    // O dicionário já trocou "use menu" por "useMenu" antes desta chamada;
    // o que se verifica aqui é o Groq NÃO desfazer. Sem a lista no prompt
    // ele não tem como saber que é identificador, e não erro de digitação.
    name: "não desfaz o que o dicionário corrigiu",
    dictionary: [
      // `useMenu` não precisa de `heard`: a regra de camelCase deriva
      // "use menu" sozinha. `Danger` precisa, porque erra por SOM — nenhuma
      // regra chegaria de "dungeon" a "Danger".
      { term: "useMenu", context: "hook do projeto" },
      { term: "Danger", heard: ["dungeon"], context: "ferramenta de CI" },
    ],
    input:
      "então o use menu tá quebrando quando o dungeon roda no pipeline, " +
      "eu acho que é por causa da ordem das coisas ali, mas não tenho certeza",
    must: ["useMenu", "Danger"],
    reject: [/use menu/i, /dungeon/i],
  },
  {
    name: "preserva número e prazo",
    input: "são 3 tickets pra entregar até sexta feira dia 12",
    must: ["3", "12"],
  },
];

/** Aberturas que nunca podem chegar ao clipboard. */
const FORBIDDEN_OPENINGS = [
  { pattern: /^(aqui está|aqui vai|segue|texto revisado)/i, why: "preâmbulo" },
  { pattern: /^["“']/, why: "aspas em volta" },
];

if (!existsSync(KEY_FILE)) {
  console.log(`pulado: sem chave em ${KEY_FILE} — nada foi verificado.`);
  process.exit(0);
}
const apiKey = readFileSync(KEY_FILE, "utf8").trim();

let failures = 0;

for (const { name, input, must = [], reject = [], dictionary = [] } of CASES) {
  // O mesmo caminho do app: substituição determinística primeiro, lista de
  // termos no prompt depois.
  const corrected = applyDictionary(input, dictionary);

  let result;
  try {
    result = await rewrite(corrected, apiKey, dictionary);
  } catch (error) {
    failures++;
    console.log(`FALHOU ${name} — a chamada não completou: ${error.message}`);
    continue;
  }

  if (result.kind === "raw") {
    failures++;
    console.log(`FALHOU ${name} — caiu no modo cru: ${result.why}`);
    continue;
  }

  const out = result.text;
  const problems = [];
  for (const { pattern, why } of FORBIDDEN_OPENINGS) {
    if (pattern.test(out)) problems.push(why);
  }
  for (const need of must) {
    const ok = typeof need === "string" ? out.includes(need) : need.test(out);
    if (!ok) problems.push(`perdeu ${need}`);
  }
  for (const bad of reject) if (bad.test(out)) problems.push(`inventou ${bad}`);

  if (problems.length > 0) failures++;
  console.log(`${problems.length === 0 ? "ok  " : "FALHOU"} ${name}`);
  console.log(`       ${JSON.stringify(out)}`);
  if (problems.length > 0) console.log(`       problemas: ${problems.join(", ")}`);
}

console.log(`\n${failures} falha(s) em ${CASES.length} casos.`);
process.exit(failures === 0 ? 0 : 1);
