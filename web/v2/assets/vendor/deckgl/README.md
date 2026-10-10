# deck.gl (vendored)

- Package: `deck.gl@9.4.0` (npm), file `dist.min.js` copied unchanged to `deck.min.js` (UMD, global `deck`).
- License: MIT (see `LICENSE`).
- Reproduce: `npm pack deck.gl@9.4.0 && tar xzf deck.gl-9.4.0.tgz && cp package/dist.min.js deck.min.js`.
- Size is about 2 MB; if it hurts first load, build a custom `@deck.gl/core + layers` bundle with esbuild and document the command here.
