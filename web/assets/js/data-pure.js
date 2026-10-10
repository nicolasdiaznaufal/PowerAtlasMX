// Price-basis aware pick of an area figure (pure).
export const px = (s, base, real) => (s && real && s[`${base}_real`] != null ? s[`${base}_real`] : s ? s[base] : null);
export const rn = (s, base, real) => (s ? s[`${base}_${real ? 'real' : 'nominal'}`] ?? null : null);
