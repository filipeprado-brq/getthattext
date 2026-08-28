/**
 * A geometria do microfone, num lugar só.
 *
 * O ícone da bandeja e o ícone do app desenham o MESMO microfone em escalas
 * diferentes — 18 pt na barra de menu, 1024 px no Finder. Duas cópias da
 * cápsula divergiriam no dia em que uma delas mudasse de raio, e o app teria
 * dois microfones ligeiramente diferentes falando por ele.
 *
 * As medidas vêm do protótipo do #6: viewBox de 18 por 18, traço de 1,4.
 * Nada aqui conhece cor — quem pinta é quem chama, porque o glifo é o mesmo
 * em preto na bandeja e em vermelho sobre grafite no ícone do app.
 */

/** O quadrado de projeto do glifo. Tudo abaixo está nesta escala. */
const GLYPH_SIZE = 18;

/** A cápsula: o corpo do microfone. */
const CAPSULE = { x: 6.25, y: 2.25, width: 5.5, height: 8.5, rx: 2.75 };

/** O arco que abraça a cápsula por baixo. */
const ARC = "M3.75 8.5v.75a5.25 5.25 0 0 0 10.5 0V8.5";

/** A haste, que apoia o microfone na base. */
const STEM = "M9 14.5v1.75";

/** A espessura do traço, na escala do glifo. */
const STROKE = 1.4;

/**
 * O microfone como SVG, em `<g>`, pronto para ser posicionado.
 *
 * `body` pinta a cápsula: `"none"` deixa o contorno (a bandeja ociosa), uma
 * cor a preenche (o app gravando, e o ícone do app).
 *
 * A cápsula leva contorno SEMPRE, mesmo preenchida. Não é redundância: com
 * fill e stroke da mesma cor ela fica meia espessura mais gorda dos dois
 * lados, e é assim que o glifo de gravando existe desde o #6. Tirar o
 * contorno afinaria a cápsula vermelha sem ninguém pedir.
 */
function microphoneGroup({ stroke, body = "none", transform = "" }) {
  const open = transform.length > 0 ? `<g transform="${transform}">` : "<g>";

  return (
    open +
    `<rect x="${CAPSULE.x}" y="${CAPSULE.y}" width="${CAPSULE.width}" ` +
    `height="${CAPSULE.height}" rx="${CAPSULE.rx}" fill="${body}" ` +
    `stroke="${stroke}" stroke-width="${STROKE}"/>` +
    `<path d="${ARC}" stroke="${stroke}" stroke-width="${STROKE}" ` +
    `stroke-linecap="round" fill="none"/>` +
    `<path d="${STEM}" stroke="${stroke}" stroke-width="${STROKE}" ` +
    `stroke-linecap="round" fill="none"/>` +
    `</g>`
  );
}

module.exports = { GLYPH_SIZE, CAPSULE, ARC, STEM, STROKE, microphoneGroup };
