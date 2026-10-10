// Eclipse mark as inline SVG (no raster). Pure string builder, also used to export assets/icons/eclipse.svg.
const SAND = '#E8A266', SHADE = '#050806';
const f = (n) => Math.round(n * 100) / 100;

function rays() {
  const out = [];
  for (let k = 0; k < 24; k++) {
    const long = k % 2 === 0;
    const a = (k * 15 - 90) * Math.PI / 180;
    const r0 = 68, r1 = long ? 104 : 86, hw = (long ? 3.6 : 3.0) * Math.PI / 180;
    const p = (r, ang) => `${f(r * Math.cos(ang))},${f(r * Math.sin(ang))}`;
    out.push(`M${p(r0, a - hw)}L${p(r1, a)}L${p(r0, a + hw)}Z`);
  }
  return out.join('');
}

/** Flat mark. cls: optional class on <svg>. Rays live in <g class="rays"> so the hero can drift them. */
export function eclipseSVG({ cls = 'mark', title = '' } = {}) {
  const t = title ? `<title>${title}</title>` : '';
  return `<svg class="${cls}" viewBox="-110 -110 220 220" role="${title ? 'img' : 'presentation'}" ${title ? '' : 'aria-hidden="true"'} xmlns="http://www.w3.org/2000/svg">${t}`
    + `<g class="rays"><path fill="${SAND}" d="${rays()}"/></g>`
    + `<circle r="63" fill="${SHADE}" stroke="${SAND}" stroke-opacity=".28" stroke-width="1"/>`
    + `<ellipse cx="-9" cy="0" rx="52" ry="57" fill="${SAND}"/>`
    + `</svg>`;
}
