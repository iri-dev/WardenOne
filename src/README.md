# Content Script Source

`src/content.js` is the reviewable source artifact for the runtime loaded as
`content.min.js`.

The source is generated losslessly from the existing one-line runtime: only
newlines and indentation are added. The build step strips those generated
newlines and indentation so `content.min.js` is rebuilt byte-for-byte.

Commands:

- `node tools/build-content.js --check` verifies that `src/content.js` rebuilds
  the current runtime exactly.
- `node tools/build-content.js --build` rewrites `content.min.js` from
  `src/content.js`.
- `node tools/build-content.js --format-from-runtime` regenerates
  `src/content.js` from the current runtime.

