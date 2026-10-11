// Series identity for compare: colour AND line style AND marker (never colour alone).
export const STYLES = [
  { color: 'var(--s1)', dash: '', marker: 'circle', name: 'solid, circle' },
  { color: 'var(--s2)', dash: '7 4', marker: 'square', name: 'dashed, square' },
  { color: 'var(--s3)', dash: '2 4', marker: 'triangle', name: 'dotted, triangle' },
];

/** SVG path for a marker centred at 0,0 (size r). */
export function markerPath(kind, r = 3.6) {
  if (kind === 'square') return `M${-r},${-r}h${2 * r}v${2 * r}h${-2 * r}z`;
  if (kind === 'triangle') return `M0,${-r * 1.15}L${r * 1.1},${r * 0.9}L${-r * 1.1},${r * 0.9}z`;
  return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0z`;
}

/** small inline swatch (line sample + marker) used by chips and legends. */
export function swatchSVG(i) {
  const s = STYLES[i % 3];
  return `<svg class="swatch" viewBox="0 0 32 12" width="32" height="12" aria-hidden="true"><line x1="1" x2="31" y1="6" y2="6" stroke="${s.color}" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/><path transform="translate(16 6)" d="${markerPath(s.marker, 3.2)}" fill="${s.color}"/></svg>`;
}
