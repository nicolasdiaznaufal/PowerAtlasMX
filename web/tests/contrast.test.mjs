// Automated WCAG AA contrast test on the real tokens of assets/css/tokens.css (dark theme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contrast } from '../assets/js/contrast.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'css', 'tokens.css'), 'utf8').split('@media print')[0];
const T = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2]]));
const c = (n) => { assert.ok(T[n], `token ${n} no existe`); return T[n]; };

// [foreground, background, minimum, description]
const TEXTO = 4.5, UI = 3;
const pares = [
  ['ink', 'bg', TEXTO, 'main text on the forest field'],
  ['ink', 'bg-2', TEXTO, 'main text on raised forest'],
  ['ink', 'bg-3', TEXTO, 'main text on the lightest forest'],
  ['ink-2', 'bg', TEXTO, 'muted text on the field'],
  ['ink-2', 'bg-2', TEXTO, 'muted text on raised forest'],
  ['ink-3', 'bg', UI, 'tertiary text / rules on the field (large or decorative only)'],
  ['dark', 'cream', TEXTO, 'text on cream paper'],
  ['dark', 'cream-2', TEXTO, 'text on darker cream paper'],
  ['dark-2', 'cream', TEXTO, 'muted text on cream paper'],
  ['orange-on-cream', 'cream', TEXTO, 'accent text on cream paper'],
  ['orange-text', 'bg', TEXTO, 'accent text on the field'],
  ['orange-text', 'bg-2', TEXTO, 'accent text on raised forest'],
  ['on-orange', 'orange', TEXTO, 'button text on orange'],
  ['on-orange', 'sun', TEXTO, 'button text on hover (sun)'],
  ['orange', 'bg', UI, 'orange marks (thumbs, selection) on the field'],
  ['sun', 'bg', UI, 'sun marks on the field'],
  ['cream', 'bg', UI, 'cream series on the field'],
  ['c-energy', 'bg', UI, 'chart: system energy fill on the field'],
  ['c-losses', 'bg', UI, 'chart: losses fill on the field'],
  ['c-cong', 'bg', UI, 'chart: congestion fill on the field'],
  ['line-2', 'bg', 1.5, 'control borders are visible against the field'],
  // traffic light: text/icon on tinted fill, marks on the field
  ['sig-ok-text', 'sig-ok-bg', TEXTO, 'green: text on its fill'],
  ['sig-warn-text', 'sig-warn-bg', TEXTO, 'yellow: text on its fill'],
  ['sig-bad-text', 'sig-bad-bg', TEXTO, 'red: text on its fill'],
  ['sig-neutral-text', 'sig-neutral-bg', TEXTO, 'neutral: text on its fill'],
  ['sig-ok-mark', 'bg', UI, 'green mark on the field'],
  ['sig-warn-mark', 'bg', UI, 'yellow mark on the field'],
  ['sig-bad-mark', 'bg', UI, 'red mark on the field'],
  ['sig-ok-text', 'bg', TEXTO, 'green text on the field'],
  ['sig-warn-text', 'bg', TEXTO, 'yellow text on the field'],
  ['sig-bad-text', 'bg', TEXTO, 'red text on the field'],
  ['sig-bad-text', 'bg-2', TEXTO, 'red text on raised forest'],
];
for (const [fg, bg, min, desc] of pares) {
  test(`contrast ${desc}: ${fg} sobre ${bg} >= ${min}`, () => {
    const r = contrast(c(fg), c(bg));
    assert.ok(r >= min, `${r.toFixed(2)}:1 < ${min}:1 (${c(fg)} sobre ${c(bg)})`);
  });
}

test('traffic light: green, yellow and red are distinct', () => {
  const [g, y, r] = ['sig-ok-mark', 'sig-warn-mark', 'sig-bad-mark'].map(c);
  assert.notEqual(g, y); assert.notEqual(y, r); assert.notEqual(g, r);
});

test('known limits of the palette (documented in the UI)', () => {
  // the deck's orange is a mark colour: as small text it needs its lighter or darker variant
  assert.ok(contrast(c('orange'), c('bg')) < TEXTO + 0.5);
  assert.ok(contrast(c('orange'), c('cream')) < TEXTO);
});
