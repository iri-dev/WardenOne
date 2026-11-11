# Content script source

`src/content.js` is the readable source for the page engine that ships as `content.min.js`.

It holds exactly the same code as the shipped file, just with newlines and indentation added so a
person can read and review it. Building strips those back out again, so `content.min.js` comes out
byte for byte identical.

The commands:

- `node tools/build-content.js --check` makes sure `src/content.js` still rebuilds the shipped file
  exactly.
- `node tools/build-content.js --build` rewrites `content.min.js` from `src/content.js`. Run this
  after every change to the source.
- `node tools/build-content.js --format-from-runtime` regenerates `src/content.js` from the shipped
  file. Please don't reach for this one: it splits some regular expressions across lines, and
  about twenty test suites that read the source break at once.

One more thing that catches people out: never write `//` comments in `src/content.js`. The build
only joins lines, so a `//` comment would swallow the code after it. Use `/* ... */` instead.
