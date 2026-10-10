// Route helpers: hash <-> path + selection query.
import { serializeSel } from './store.js';
export function parseHash() {
  const [p, q] = location.hash.replace(/^#/, '').split('?');
  return { path: p || '/', sel: new URLSearchParams(q || '').get('sel') || '' };
}
export const hrefFor = (path, list) => `#${path}${list && list.length ? `?sel=${serializeSel(list)}` : ''}`;
