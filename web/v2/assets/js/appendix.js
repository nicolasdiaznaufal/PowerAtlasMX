// Appendix page (#/appendix): accordion of A1-A4 from v1. Opens in its own tab from the Revenue page; works offline (shell precache).
import { appendixHTML } from './appendix-text.js';
import { mountLive } from './appendix-live.js';

const REFS = [
  'Holmgren, Hansen, Mikofski (2018), pvlib python, <i>JOSS</i> 3(29), 884; Anderson et al. (2023), <i>JOSS</i> 8(92), 5994. <a href="https://pvlib-python.readthedocs.io" target="_blank" rel="noopener noreferrer">pvlib-python.readthedocs.io</a>',
  'Ineichen, Perez (2002), Linke turbidity formulation, <i>Solar Energy</i> 73(3), 151–157.',
  'NASA Langley Research Center POWER Project. <a href="https://power.larc.nasa.gov" target="_blank" rel="noopener noreferrer">power.larc.nasa.gov</a>',
  'Hirth (2013), The market value of variable renewables, <i>Energy Economics</i> 38, 218–236.',
  'Faiman (2008), <i>Progress in Photovoltaics</i> 16(4), 307–315.',
  'Dobos (2014), PVWatts Version 5 Manual, NREL/TP-6A20-62641.',
];

export function mountAppendix(root) {
  root.innerHTML = `<main class="apx" id="apx"><header class="apx-head"><a class="btn btn-ghost btn-sm" href="#/">Back to PowerAtlasMx</a>
    <p class="mono">PowerAtlasMx by REPSA Group · Appendix</p>
    <h1 tabindex="-1">How a node's hourly production is modelled</h1>
    <p class="apx-lead">Four short sections: where the hourly production comes from, how light reaches the panel, how heat and the inverter shape the power, and one hour worked step by step. Open a section to read it.</p></header>
    <div class="apx-acc" id="apx-acc">${appendixHTML()}</div>
    <section class="apx-refs"><h2 class="mono">References</h2><ol>${REFS.map((r) => `<li>${r}</li>`).join('')}</ol>
      <p class="fine">Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg); PV model: pvlib-python. Prices are the MDA reference price (CENACE).</p></section></main>`;
  const acc = root.querySelector('#apx-acc');
  // one section open at a time (native exclusive accordion where supported, small fallback elsewhere)
  acc.querySelectorAll(':scope > details').forEach((d) => {
    d.setAttribute('name', 'apx');
    d.addEventListener('toggle', () => { if (d.open) acc.querySelectorAll(':scope > details').forEach((o) => { if (o !== d && o.open) o.open = false; }); });
  });
  const live = mountLive(root);
  return { destroy() { live.destroy(); } };
}
