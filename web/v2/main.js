// v2 entry: hash router. M1 = landing; #/map is mounted by the map module (M2).
import { renderLanding } from './assets/js/landing.js';

const app = document.getElementById('app');
const routes = { '': renderLanding, '/': renderLanding };
let current = null;

async function route() {
  const path = (location.hash.replace(/^#/, '').split('?')[0]) || '/';
  if (current && current.destroy) current.destroy();
  if (path === '/map') {
    const { mountMap } = await import('./assets/js/map-page.js');
    current = mountMap(app);
    return;
  }
  current = (routes[path] || renderLanding)(app);
}
window.addEventListener('hashchange', route);
route();
