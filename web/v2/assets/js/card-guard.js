// A card that fails to draw (a lazy chunk, bad data, an exception) must never blank the page: it degrades to a one-line message in
// its own box and the other cards keep working.
export function guard(root, sel, label, fn) {
  const fail = (e) => {
    console.error(`${label}:`, e);
    const el = root.querySelector && root.querySelector(sel);
    if (el) el.innerHTML = `<p class="xp-text" role="status">${label} could not be drawn. The other cards are not affected; reload the page to try again.</p>`;
  };
  try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(fail); } catch (e) { fail(e); }
}
