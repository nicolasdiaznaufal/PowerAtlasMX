// Pure helpers of the story sections (no DOM): the deck's synthetic day.
const H = [...Array(24).keys()];
export function syntheticDay(D_, P_, track) {
  const g = (h, m, s) => Math.exp(-((h - m) ** 2) / (2 * s * s));
  const w = H.map((h) => { if (h < 6 || h >= 18) return 0; const s = Math.sin(Math.PI * (h - 6 + 0.5) / 12); return 0.95 * (track ? s ** 0.45 : s); });
  const pml = H.map((h) => 600 + P_ * g(h, 20, 1.6) + 120 * g(h, 7.5, 1.2) - D_ * g(h, 13, 2.6));
  const avg = pml.reduce((a, b) => a + b, 0) / 24, sw = w.reduce((a, b) => a + b, 0);
  const cap = pml.reduce((a, x, i) => a + x * w[i], 0) / sw, z = w.reduce((a, x, i) => a + (pml[i] <= 0 ? x : 0), 0) / sw;
  return { w, pml, avg, cap, vf: cap / avg, z };
}
