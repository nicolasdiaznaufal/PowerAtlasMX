// Landing: nav, hero, logo strip, Talk to Sales modal.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';

const STAMPS = ['2,431 nodes', 'Hour-by-hour production × price', 'Last 12 months, every region'];

async function clientLogos() {
  try {
    const r = await fetch('assets/img/clients/manifest.json');
    const j = await r.json();
    return Array.isArray(j.clients) ? j.clients : [];
  } catch { return []; }
}

const grain = `<svg class="grain" width="100%" height="100%" aria-hidden="true"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 .8  0 0 0 0 .6  0 0 0 1.4 -.2"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;

export function renderLanding(root) {
  const email = CONFIG.CONTACT_EMAIL;
  root.innerHTML = `
  <header class="nav">
    <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span><span class="by mono">${CONFIG.BYLINE}</span></a>
    <span class="spacer"></span>
    <nav class="nav-links mono" aria-label="Primary"><a href="#/map">Map</a></nav>
    <button class="btn btn-ghost btn-sm" data-sales ${email ? '' : 'disabled title="Contact address pending"'}>Talk to Sales</button>
    <a class="btn btn-primary btn-sm" href="#/map">Deploy Analysis</a>
  </header>
  <main class="hero">
    <section class="hero-main" aria-labelledby="h1">
      <div>
        <h1 id="h1">Solar value,<br>node by node.</h1>
        <div class="hero-cta">
          <a class="btn btn-primary" id="deploy" href="#/map">Deploy Analysis</a>
          <button class="btn btn-ghost" data-sales ${email ? '' : 'disabled title="Contact address pending"'}>Talk to Sales</button>
        </div>
      </div>
      <div class="hero-mark" aria-hidden="true"><div class="glow"></div>${grain}<div class="shadow"></div>${eclipseSVG({ cls: 'mark' })}</div>
      <ul class="stamps mono" aria-label="Highlights">${STAMPS.map((s) => `<li>${s}</li>`).join('')}</ul>
    </section>
    <section class="strip" aria-label="Built with">
      <div class="strip-label mono">Built with</div>
      <ul id="logos">
        <li><img src="assets/img/repsa-logo.png" alt="REPSA Group"></li>
        <li><span class="word mono">NASA POWER</span></li>
        <li><img src="assets/img/pvlib-logo.png" alt="pvlib"></li>
      </ul>
    </section>
  </main>
  <div class="modal" id="sales" hidden role="dialog" aria-modal="true" aria-labelledby="sales-h">
    <form id="sales-form">
      <h2 id="sales-h">Talk to Sales</h2>
      <label><span class="mono">Your name</span><input name="name" autocomplete="name" required></label>
      <label><span class="mono">Company</span><input name="company" autocomplete="organization"></label>
      <label><span class="mono">What do you want to look at?</span><textarea name="msg"></textarea></label>
      <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" type="submit">Open email</button></div>
    </form>
  </div>`;

  // append client logos from the manifest (empty until Nico supplies them)
  clientLogos().then((list) => {
    const ul = root.querySelector('#logos');
    if (!ul) return;
    for (const c of list) {
      if (!c || !c.src || !c.name) continue;
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = c.src; img.alt = c.name;
      li.append(img); ul.prepend(li);
    }
  });

  const modal = root.querySelector('#sales');
  let opener = null;
  const close = () => { modal.hidden = true; if (opener) opener.focus(); };
  root.querySelectorAll('[data-sales]').forEach((b) => b.addEventListener('click', () => {
    if (!email) return;
    opener = b; modal.hidden = false; modal.querySelector('input').focus();
  }));
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
  const onKey = (e) => { if (e.key === 'Escape' && !modal.hidden) close(); };
  document.addEventListener('keydown', onKey);
  modal.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const body = `Name: ${d.get('name')}\nCompany: ${d.get('company')}\n\n${d.get('msg')}`;
    location.href = `mailto:${email}?subject=${encodeURIComponent('PowerAtlasMx enquiry')}&body=${encodeURIComponent(body)}`;
    close();
  });
  return { destroy() { document.removeEventListener('keydown', onKey); } };
}
