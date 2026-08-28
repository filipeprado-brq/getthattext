import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Declara `dist/shared/` como ESM, e confere que ele é mesmo ESM.
 *
 * O PROBLEMA: `src/shared/` é compilado DUAS vezes. O build do main usa
 * `module: node16` e, sem `"type"` no package.json, isso é CommonJS; o do
 * renderer usa `module: ES2022`, que é ESM. Os dois escrevem em
 * `dist/shared/`, e o renderer roda depois — então o que fica no disco é
 * ESM, e o processo main o carrega assim mesmo.
 *
 * Isso FUNCIONA: o Node 22 do Electron sabe carregar ESM por `require`. O
 * que não funciona é o silêncio: sem `"type"` declarado, o carregador tenta
 * ler o arquivo como CommonJS, falha, reparseia como ESM e avisa
 * (`MODULE_TYPELESS_PACKAGE_JSON`) a cada abertura do app.
 *
 * A correção que o próprio aviso sugere — `"type": "module"` na raiz —
 * está ERRADA aqui: ela tornaria ilegal o emit CommonJS de `dist/main/`, que
 * é justamente quem o Electron carrega, e os preloads precisam ser CommonJS
 * enquanto o renderer roda em sandbox.
 *
 * Então o tipo é declarado onde ele vale: dentro de `dist/shared/`.
 *
 * A GUARDA existe porque a correção depende da ORDEM do build. Se um dia o
 * build do main rodar por último, `dist/shared/` volta a ser CommonJS — e um
 * marcador dizendo "ESM" sobre arquivos CommonJS quebraria as três janelas
 * de uma vez, em runtime. Melhor falhar aqui.
 */
const SHARED = join("dist", "shared");

const files = readdirSync(SHARED).filter((name) => name.endsWith(".js"));

if (files.length === 0) {
  console.error(`${SHARED} está vazio — o build do renderer não rodou.`);
  process.exit(1);
}

/** Emit CommonJS do TypeScript: sempre marca `exports` logo no topo. */
const commonjs = files.filter((name) =>
  /^(?:"use strict";|Object\.defineProperty\(exports|exports\.)/m.test(
    readFileSync(join(SHARED, name), "utf8"),
  ),
);

if (commonjs.length > 0) {
  console.error(
    `${SHARED} saiu como CommonJS (${commonjs.join(", ")}).\n` +
      "O renderer carrega esses arquivos com <script type=\"module\">, e módulo " +
      "CommonJS não tem exports nomeados para o navegador. Confira a ordem em " +
      "`npm run build`: o renderer precisa ser o último a escrever aqui.",
  );
  process.exit(1);
}

writeFileSync(join(SHARED, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
console.log(`${SHARED} declarado como ESM.`);
