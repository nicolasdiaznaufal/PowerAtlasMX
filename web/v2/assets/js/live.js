// One polite live region (#live). A priority message (e.g. "Removed X; 0 of 3 slots") is never overwritten by the
// route announcement that follows it within a moment: the later text is appended instead.
export const MERGE_MS = 1500;

/** pure: what the live region should say. prev = {text, at, priority}. */
export function mergeAnnouncement(prev, text, now, priority = false) {
  if (!priority && prev && prev.priority && now - prev.at < MERGE_MS) return { text: `${prev.text}. ${text}`, at: prev.at, priority: true };
  return { text, at: now, priority };
}

let state = null;
export function announce(text, { priority = false } = {}) {
  const el = document.getElementById('live');
  if (!el) return;
  state = mergeAnnouncement(state, text, Date.now(), priority);
  const out = state.text;
  el.textContent = '';
  setTimeout(() => { if (state && state.text === out) el.textContent = out; }, 50);
}
