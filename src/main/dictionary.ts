import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Entry, parseDictionary } from "../shared/dictionary";

/**
 * O dicionário no disco.
 *
 * Lido a CADA ditação, de propósito: você edita o arquivo à mão e a
 * correção vale na próxima frase, sem reiniciar. São 10 a 30 entradas — o
 * custo de reler é irrelevante perto de uma transcrição de 1,3 s.
 *
 * DIVERGÊNCIA DA SPEC: a seção 4 chama o arquivo de `dicionario.json`. Aqui
 * é `dictionary.json`, porque a regra 1 do CODING_STANDARDS põe nome de
 * arquivo entre os identificadores em inglês, e o repo já gravou
 * `preferences.json`. Ter um arquivo em cada língua na mesma pasta seria
 * pior que qualquer das duas escolhas.
 */
const FILE = "dictionary.json";

function dictionaryPath(): string {
  return join(app.getPath("userData"), FILE);
}

/**
 * Lê o dicionário. Um arquivo ausente é o caso normal, não um erro.
 *
 * Falha de leitura de verdade vira dicionário vazio com registro no log: a
 * ditação continua, só sem as correções. Derrubá-la por causa do dicionário
 * seria trocar um texto imperfeito por nenhum texto.
 */
export function dictionary(): Entry[] {
  try {
    return parseDictionary(readFileSync(dictionaryPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("não foi possível ler o dicionário:", error);
    }

    return [];
  }
}
