// KaTeX rendering from LaTeX source. Delimiters: \( inline \)  and  \[ display \]. KaTeX is vendored (assets/vendor/katex).
let loading = null;
export function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/katex/katex.min.js';
    s.onload = () => res(window.katex);
    s.onerror = () => rej(new Error('KaTeX failed to load'));
    document.head.appendChild(s);
  });
  return loading;
}
const RE = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT', 'SELECT', 'OPTION']);

/** Pure splitter, used by the tests: text -> [{t:'text'|'inline'|'display', v}] */
export function splitMath(text) {
  const out = []; let last = 0; RE.lastIndex = 0;
  for (let m; (m = RE.exec(text));) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: 'display', v: m[1] } : { t: 'inline', v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}
const cache = new Map();
function html(katex, tex, display) {
  const k = (display ? 'D' : 'I') + tex;
  let h = cache.get(k);
  if (h === undefined) {
    try { h = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' }); } catch (e) { h = null; }
    cache.set(k, h);
  }
  return h;
}
/** Render every math delimiter under root (text nodes only). Safe to call repeatedly. */
export async function renderMath(root = document.body) {
  const katex = await loadKatex();
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.includes('\\(') && !n.nodeValue.includes('\\[')) return NodeFilter.FILTER_REJECT;
      for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (p.nodeType === 1 && (SKIP.has(p.tagName) || p.classList.contains('katex'))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = []; for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const parts = splitMath(n.nodeValue);
    if (!parts.some((p) => p.t !== 'text')) continue;
    const frag = document.createDocumentFragment();
    for (const p of parts) {
      if (p.t === 'text') { frag.appendChild(document.createTextNode(p.v)); continue; }
      const span = document.createElement('span');
      span.className = p.t === 'display' ? 'tex-d' : 'tex-i';
      const h = html(katex, p.v, p.t === 'display');
      if (h) span.innerHTML = h; else span.textContent = p.v;
      span.setAttribute('data-tex', p.v);
      frag.appendChild(span);
    }
    n.parentNode.replaceChild(frag, n);
  }
}
