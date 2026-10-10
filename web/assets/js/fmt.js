// Short number formatters used by chart callbacks and sections (en-US).
import { num, signed } from './format.js';
export const f0 = (v) => num(v, 0);
export const fx = (v, d = 2) => num(v, d);
export { signed };
