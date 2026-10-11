// WCAG AA contrast test on the real tokens of v2/assets/css/tokens.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contrast } from '../assets/js/contrast.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'v2', 'assets', 'css', 'tokens.css'), 'utf8');
const T = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2]]));
const c = (n) => { assert.ok(T[n], `token ${n} missing`); return T[n]; };

const TEXT = 4.5, UI = 3;
const pairs = [
  ['c-energy', 'surface', UI, 'chart: energy on card'],
  ['c-losses', 'surface', UI, 'chart: losses on card'],
  ['c-cong', 'surface', UI, 'chart: congestion on card'],
  ['c-prod', 'surface', UI, 'chart: solar output on card'],
  ['c-prod', 'black', UI, 'chart: solar output on black'],
  ['c-energy', 'black', UI, 'chart: energy on black'],
  ['c-losses', 'black', UI, 'chart: losses on black'],
  ['c-cong', 'black', UI, 'chart: congestion on black'],
  ['s1', 'surface', UI, 'slot 1 on card'],
  ['ink', 'black', TEXT, 'main text on page black'],
  ['ink-2', 'black', TEXT, 'muted text on page black'],
  ['ink-3', 'black', TEXT, 'tertiary text on page black'],
  ['accent', 'black', TEXT, 'accent text on page black'],
  ['black', 'ink', TEXT, 'cream pill text (black on ink)'],
  ['ink', 'surface', TEXT, 'cards on black page'],
  ['s1', 'black', UI, 'series 1 on black'],
  ['s2', 'black', UI, 'series 2 on black'],
  ['s3', 'black', UI, 'series 3 on black'],
  ['ink', 'canvas', TEXT, 'main text on canvas'],
  ['ink', 'surface', TEXT, 'main text on surface'],
  ['ink', 'raised', TEXT, 'main text on raised'],
  ['ink-2', 'canvas', TEXT, 'muted text on canvas'],
  ['ink-2', 'surface', TEXT, 'muted text on surface'],
  ['ink-2', 'raised', TEXT, 'muted text on raised'],
  ['ink-3', 'canvas', TEXT, 'tertiary text (labels) on canvas'],
  ['ink-3', 'surface', TEXT, 'tertiary text on surface'],
  ['accent', 'canvas', TEXT, 'accent text on canvas'],
  ['accent', 'surface', TEXT, 'accent text on surface'],
  ['accent', 'raised', TEXT, 'accent text on raised'],
  ['on-accent', 'accent', TEXT, 'button text on accent'],
  ['s1', 'canvas', UI, 'series 1 on canvas'],
  ['s2', 'canvas', UI, 'series 2 on canvas'],
  ['s3', 'canvas', UI, 'series 3 on canvas'],
  ['s1', 'surface', UI, 'series 1 on surface'],
  ['s2', 'surface', UI, 'series 2 on surface'],
  ['s3', 'surface', UI, 'series 3 on surface'],
  ['c-energy', 'canvas', UI, 'chart: system energy'],
  ['c-losses', 'canvas', UI, 'chart: losses'],
  ['c-cong', 'canvas', UI, 'chart: congestion'],
  ['map-hi', 'canvas', UI, 'map ramp high end'],
  ['map-dot-lo', 'canvas', UI, 'map node dot, low end'],
  ['map-nodata', 'canvas', 1.5, 'map no-data dot (decorative)'],
];
for (const [fg, bg, min, desc] of pairs) {
  test(`contrast ${desc}: ${fg} on ${bg} >= ${min}`, () => {
    const r = contrast(c(fg), c(bg));
    assert.ok(r >= min, `${r.toFixed(2)}:1 < ${min}:1 (${c(fg)} on ${c(bg)})`);
  });
}
test('series colours are distinct', () => {
  assert.equal(new Set([c('s1'), c('s2'), c('s3')]).size, 3);
});
test('black page sits below surface and raised', () => {
  assert.ok(contrast(c('black'), '#000000') < contrast(c('surface'), '#000000'));
});
test('canvas is darker than surface, surface darker than raised', () => {
  assert.ok(contrast(c('canvas'), '#000000') < contrast(c('surface'), '#000000'));
  assert.ok(contrast(c('surface'), '#000000') < contrast(c('raised'), '#000000'));
});
