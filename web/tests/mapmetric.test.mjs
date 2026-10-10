// The map legend range must be a plausible MXN/MWh band (captured price) or a plausible VF band, for every config and price basis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { metricValue, metricDomain } from '../assets/js/mapmetric.js';

const index = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'index.json'), 'utf8'));

for (const cfg of ['tracker', 'fixed']) for (const real of [true, false]) {
  test(`legend range, captured price, ${cfg}, ${real ? "today's pesos" : 'nominal'}: plausible MXN/MWh band`, () => {
    const [lo, hi] = metricDomain(index.nodos, cfg, 'cap', real);
    assert.ok(lo > 100 && lo < 1500, `lo ${lo}`);
    assert.ok(hi > 400 && hi < 3000, `hi ${hi}`);
    assert.ok(lo < hi);
    // a typical node value falls inside a sane band too
    const n = index.nodos.find((x) => x.id === '01AAN-85');
    const v = metricValue(n, cfg, 'cap', real);
    assert.ok(v > 300 && v < 1500, `value ${v}`);
  });
  test(`legend range, VF, ${cfg}, ${real ? "today's pesos" : 'nominal'}: plausible VF band`, () => {
    const [lo, hi] = metricDomain(index.nodos, cfg, 'vf', real);
    assert.ok(lo > 0.2 && hi < 1.5 && lo < hi, `${lo}..${hi}`);
  });
}
test("today's-pesos captured price differs from nominal and is in the same order of magnitude", () => {
  const n = index.nodos.find((x) => x.id === '01AAN-85');
  const r = metricValue(n, 'tracker', 'cap', true), nom = metricValue(n, 'tracker', 'cap', false);
  assert.ok(r !== nom && r / nom > 0.9 && r / nom < 1.5);
});
