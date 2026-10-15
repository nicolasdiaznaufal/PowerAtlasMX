// v2 integrity: every module of the import graph exists, every named import is exported by its target, every module loads,
// and a failing card degrades to a message instead of blanking the page. Regression for the "Explorer is not shown" report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleGraph } from '../v2/tools/precache-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPORT = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g;

function exportsOf(file) {
  const s = fs.readFileSync(file, 'utf8'), out = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => out.add(x.split(/\s+as\s+/).pop().trim()));
  if (/export\s+default/.test(s)) out.add('default');
  if (/export\s+\*\s+from/.test(s)) out.add('*');
  return out;
}

test('every static import of the v2 graph resolves to a file that exports the imported names', () => {
  const files = moduleGraph();
  assert.ok(files.length > 60);
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(IMPORT)) {
      if (!m[3].startsWith('.')) continue;
      const t = resolve(dirname(f), m[3]);
      if (!fs.existsSync(t)) { bad.push(`${f} -> ${m[3]} missing`); continue; }
      const ex = exportsOf(t);
      if (ex.has('*')) continue;
      for (const n of (m[2] || '').split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) if (!ex.has(n)) bad.push(`${f.split('/web/')[1]}: ${n} is not exported by ${m[3]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('copy keys used by the views exist', () => {
  const copy = fs.readFileSync(join(HERE, '..', 'v2/assets/js/copy.js'), 'utf8');
  const used = new Set();
  for (const f of fs.readdirSync(join(HERE, '..', 'v2/assets/js')).filter((x) => x.endsWith('.js') && x !== 'copy.js')) {
    for (const m of fs.readFileSync(join(HERE, '..', 'v2/assets/js', f), 'utf8').matchAll(/\bCOPY\.([A-Za-z]+)/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(new RegExp(`\\b${k}\\b`).test(copy), `COPY.${k}`);
});

test('every pure v2 module loads in node (no syntax or top-level errors)', async () => {
  const dir = join(HERE, '..', 'v2/assets/js'), failed = [];
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    try { await import(pathToFileURL(join(dir, f)).href); } catch (e) { if (!/document|window|navigator|location|self is not defined/.test(String(e))) failed.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(failed, []);
});

test('a card that throws degrades to its own message (guard) and the page keeps its other cards', async () => {
  const { guard } = await import('../v2/assets/js/card-guard.js');
  const box = { innerHTML: '' }, root = { querySelector: (s) => (s === '#x' ? box : null) };
  const log = console.error; console.error = () => {};
  try {
    guard(root, '#x', 'The map', () => { throw new Error('boom'); });
    assert.match(box.innerHTML, /The map could not be drawn/);
    box.innerHTML = '';
    guard(root, '#x', 'The daily charts', () => Promise.reject(new Error('lazy chunk failed')));
    await new Promise((r) => setTimeout(r, 0));
    assert.match(box.innerHTML, /The daily charts could not be drawn/);
    guard(root, '#missing', 'Nothing', () => { throw new Error('x'); });   // a missing box never throws
  } finally { console.error = log; }
  for (const f of ['explorer.js', 'revenue.js']) {
    const s = fs.readFileSync(join(HERE, '..', 'v2/assets/js', f), 'utf8');
    for (const fn of ['mountDaily', 'paintSeries']) assert.match(s, new RegExp(`guard\\(root, '[^']+', '[^']+', \\(\\) => ${fn}\\(`), `${f} ${fn}`);
  }
  assert.match(fs.readFileSync(join(HERE, '..', 'v2/assets/js/view-base.js'), 'utf8'), /try \{ build\.draw\(/);
});

test('service worker: a finished install takes over, precache bypasses the HTTP cache, tabs look for updates', () => {
  const sw = fs.readFileSync(join(HERE, '..', 'v2/sw.js'), 'utf8'), main = fs.readFileSync(join(HERE, '..', 'v2/main.js'), 'utf8');
  assert.match(sw, /cache: 'reload'/); assert.match(sw, /self\.skipWaiting\(\)/); assert.match(sw, /clients\.claim\(\)/);
  assert.match(main, /controllerchange/); assert.match(main, /reg\.update\(\)/); assert.match(main, /visibilitychange/);
  const ver = /const VERSION = '(v2-m\d+-\d+-[0-9a-f]{8})'/.exec(sw);
  assert.ok(ver, 'VERSION carries the content hash');
});

test('map panel and left column: no horizontal scroll (wrap, min-width 0, no fixed widths)', () => {
  const map = fs.readFileSync(join(HERE, '..', 'v2/assets/css/map.css'), 'utf8'), ex = fs.readFileSync(join(HERE, '..', 'v2/assets/css/explorer.css'), 'utf8');
  assert.match(map, /\.panel \{ overflow-x: hidden;/);
  assert.match(map, /\.panel \.seg \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 84px\), 1fr\)\)/);
  assert.match(map, /\.panel \.seg button \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere/);
  assert.match(map, /\.panel > \*[^{]*\{ min-width: 0; \}/);
  assert.match(ex, /\.an-side \.span \.span-text \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis/);   // readout on one line
  const vb = fs.readFileSync(join(HERE, '..', 'v2/assets/js/view-base.js'), 'utf8');
  assert.match(vb, /side\.innerHTML = `<div id="vb-span">/);           // the span control is in the sticky left column
});
