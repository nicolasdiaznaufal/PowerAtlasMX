import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitMath } from '../assets/js/tex.js';

test('splitMath finds inline and display LaTeX and keeps the text around it', () => {
  const p = splitMath('Both \\(\\overline{\\mathrm{PML}}\\) and \\[ x^2 \\] end');
  assert.deepEqual(p.map((x) => x.t), ['text', 'inline', 'text', 'display', 'text']);
  assert.equal(p[1].v, '\\overline{\\mathrm{PML}}');
  assert.equal(splitMath('no math here').length, 1);
});
test('every formula on the page parses with the vendored KaTeX', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const katex = (await import('node:module')).createRequire(import.meta.url)(join(root, 'assets', 'vendor', 'katex', 'katex.min.js'));
  const src = ['index.html', 'assets/js/sec-meta.js', 'assets/js/sec-story.js', 'assets/js/sec-money.js'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  // sources use escaped backslashes inside JS strings; normalise to LaTeX
  const text = src.replace(/\\\\/g, '\\').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const f = splitMath(text).filter((x) => x.t !== 'text').map((x) => x.v);
  assert.ok(f.length > 100, `only ${f.length} formulas`);
  const bad = [];
  for (const tex of f) {
    if (tex.includes('${')) continue;                       // template expressions are checked at run time
    try { katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }); } catch (e) { bad.push(`${tex.slice(0, 60)}: ${e.message}`); }
  }
  assert.deepEqual(bad, []);
});
