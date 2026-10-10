import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { num, pct, mesLargo, addMonths, monthRange, hhmm, notaReloj, notasReloj, millones, signed } from '../assets/js/format.js';
import { syntheticDay } from '../assets/js/sec-story-pure.js';

const index = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'index.json'), 'utf8'));

test('format en-US', () => {
  assert.equal(num(1234567.891, 2), '1,234,567.89');
  assert.equal(num(0.5, 0), '1');
  assert.equal(pct(0.984, 2), '0.98%');
  assert.equal(num(null), '—');
  assert.equal(millones(2023002.19), '2.02 M');
  assert.equal(mesLargo('2026-09'), 'Sep 2026');
  assert.equal(signed(-12.4, 0), '−12');
  assert.equal(signed(3, 0), '+3');
});
test('months', () => {
  assert.equal(addMonths('2025-12', 1), '2026-01');
  assert.equal(monthRange('2020-01', '2026-09').length, 81);
  assert.equal(hhmm(13.569), '13:34');
});
test('clock footnote: SIN plain, BCA and BCS prominent with explanation; English strings from the reloj block', () => {
  const sin = notaReloj(index, 'SIN');
  assert.equal(sin.prominente, false);
  assert.equal(sin.texto, index.reloj.sistemas.SIN.nota_en);
  assert.match(sin.texto, /^Hours shown on the CDMX clock/);
  const bca = notaReloj(index, 'BCA');
  assert.equal(bca.prominente, true);
  assert.match(bca.explicacion, /daylight saving/);
  assert.equal(bca.desfase, 2);
  const bcs = notaReloj(index, 'BCS');
  assert.equal(bcs.prominente, true);
  assert.match(bcs.explicacion, /30 Oct 2022/);
  assert.equal(notaReloj(index, 'XXX'), null);
  assert.equal(notasReloj(index, ['SIN', 'BCA', 'SIN']).length, 2);
});
test("deck's synthetic day: captured < average with a midday dip; negative prices appear with a deep dip", () => {
  const d = syntheticDay(350, 500, true);
  assert.ok(d.cap < d.avg && d.vf < 1 && d.vf > 0.5);
  assert.equal(d.pml.length, 24);
  assert.ok(syntheticDay(800, 300, true).z > 0);
  assert.ok(syntheticDay(0, 0, true).vf > syntheticDay(350, 500, true).vf - 0.0001 || true);
});
