// One-off: node web/v2/assets/js/export-logo.mjs  -> writes assets/icons/eclipse.svg
import { writeFileSync } from 'node:fs';
import { eclipseSVG } from './logo.js';
const out = new URL('../icons/eclipse.svg', import.meta.url);
writeFileSync(out, eclipseSVG({ title: 'PowerAtlasMx' }).replace('<svg class="mark" ', '<svg ') + '\n');
