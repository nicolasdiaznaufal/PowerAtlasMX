// Landing (from the approved mock): black page, eclipse photo right of centre, headline, two pills, muted wordmarks.
import { CONFIG } from '../../config.js';
import { eclipseSVG } from './logo.js';

async function clientLogos() {
  try {
    const j = await (await fetch('assets/img/clients/manifest.json')).json();
    return Array.isArray(j.clients) ? j.clients : [];
  } catch { return []; }
}

export function renderLanding(root) {
  const email = CONFIG.CONTACT_EMAIL;
  root.innerHTML = `
  <div class="landing">
    <!-- Hero image: NASA/SDO, AIA 171, 2017-08-21 19:41 UT (public domain), caption cropped. -->
    <img class="hero-sun" id="sun" src="assets/img/hero-sun-1000.webp" srcset="assets/img/hero-sun-1000.webp 1000w, assets/img/hero-sun-2000.webp 2000w" sizes="(max-width: 900px) 560px, 1000px" alt="" width="1000" height="900" decoding="async" fetchpriority="high">
    <header class="nav">
      <a class="brand" href="#/" aria-label="${CONFIG.PRODUCT}, home">${eclipseSVG()}<span>${CONFIG.PRODUCT}</span></a>
    </header>
    <main class="land-main">
      <p class="mono eyebrow">${CONFIG.BYLINE}</p>
      <h1 id="h1">Mexican Solar Atlas</h1>
      <div class="hero-cta">
        <a class="btn btn-cream" id="deploy" href="#/map">Deploy Analysis</a>
        <button class="btn btn-dark" data-sales ${email ? '' : 'disabled title="Contact address pending"'}>Talk to Sales</button>
      </div>
    </main>
    <footer class="land-strip" aria-label="Built with">
      <ul id="logos"><li>REPSA</li><li>NASA POWER</li><li>pvlib</li></ul>
    </footer>
    <div class="modal" id="sales" hidden role="dialog" aria-modal="true" aria-labelledby="sales-h">
      <form id="sales-form">
        <h2 id="sales-h">Talk to Sales</h2>
        <label><span class="mono">Your name</span><input name="name" autocomplete="name" required></label>
        <label><span class="mono">Company</span><input name="company" autocomplete="organization"></label>
        <label><span class="mono">What do you want to look at?</span><textarea name="msg"></textarea></label>
        <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-cream btn-sm" type="submit">Open email</button></div>
      </form>
    </div>
  </div>`;

  clientLogos().then((list) => {
    const ul = root.querySelector('#logos');
    if (!ul) return;
    for (const c of list) {
      if (!c || !c.src || !c.name) continue;
      const li = document.createElement('li'); const img = document.createElement('img');
      img.src = c.src; img.alt = c.name; li.append(img); ul.prepend(li);
    }
  });

  const modal = root.querySelector('#sales');
  let opener = null;
  const bg = () => [...root.querySelectorAll('.landing > header, .landing > main, .landing > footer, .landing > img')];
  const close = () => { modal.hidden = true; bg().forEach((n) => n.removeAttribute('inert')); if (opener) opener.focus(); };
  root.querySelectorAll('[data-sales]').forEach((b) => b.addEventListener('click', () => {
    if (!email) return;
    opener = b; modal.hidden = false; bg().forEach((n) => n.setAttribute('inert', '')); modal.querySelector('input').focus();
  }));
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) close(); });
  const onKey = (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...modal.querySelectorAll('input, textarea, button:not([disabled])')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
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
