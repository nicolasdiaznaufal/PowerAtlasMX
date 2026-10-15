// Shared-password gate for the whole site (HTML, JSON, tiles). Secret: SITE_PASSWORD.
const COOKIE = 'pa_auth';
const MAX_AGE = 60 * 60 * 24 * 30;
const enc = new TextEncoder();

async function token(secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('poweratlasmx-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function loginPage(error) {
  const msg = error ? '<p class="e">Incorrect password.</p>' : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>PowerAtlasMx</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#ededed;font:15px system-ui,sans-serif}
form{width:min(320px,86vw);display:grid;gap:12px}h1{font-size:20px;margin:0 0 4px}
input,button{padding:10px 12px;border-radius:8px;border:1px solid #333;background:#111;color:#ededed;font:inherit}
button{background:#ededed;color:#0a0a0a;border:0;cursor:pointer}.e{color:#ff6b6b;margin:0}
</style></head><body><form method="post" action="/__login"><h1>PowerAtlasMx</h1>${msg}
<input type="password" name="password" placeholder="Password" autofocus required>
<button>Enter</button></form></body></html>`;
  return new Response(html, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const secret = env.SITE_PASSWORD;
  if (!secret) return new Response('Site password not configured.', { status: 503 });
  const url = new URL(request.url);
  const expected = await token(secret);

  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    const given = await token(String(form.get('password') || ''));
    if (!same(given, expected)) return loginPage(true);
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (cookie && same(cookie.slice(COOKIE.length + 1), expected)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-cache');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  }

  if (request.headers.get('sec-fetch-dest') === 'document' || (request.headers.get('accept') || '').includes('text/html')) {
    return loginPage(false);
  }
  return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } });
}
