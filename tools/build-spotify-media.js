/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream asset attribution: CREDITS.md */
'use strict';

/* Reproduce the packaged uBlock Origin one-second silent MP4. The upstream bytes are
   SHA-256 pinned so an upstream change cannot silently alter a release. --check is
   offline and runs in the gate; --build is only for regenerating the tracked asset. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DEST = path.join(__dirname, '..', 'spotify-silent-1s.mp4');
const URL = 'https://raw.githubusercontent.com/gorhill/uBlock/master/src/web_accessible_resources/noop-1s.mp4';
const SHA256 = 'a27edba0e34b2648a90a800ae94fdef3e39016d1b9bd6e54a31ede1f1cddfed0';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function verify(bytes) {
  if (hash(bytes) !== SHA256) throw new Error('Spotify silent media SHA-256 mismatch');
  if (bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Spotify silent media is not MP4');
}

if (process.argv[2] === '--check') {
  verify(fs.readFileSync(DEST));
  console.log('[ok] pinned Spotify silent media');
} else if (process.argv[2] === '--build') {
  https.get(URL, (response) => {
    if (response.statusCode !== 200) throw new Error('upstream returned HTTP ' + response.statusCode);
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const bytes = Buffer.concat(chunks);
      verify(bytes);
      fs.writeFileSync(DEST, bytes);
      console.log('[ok] built Spotify silent media');
    });
  }).on('error', (error) => { throw error; });
} else {
  throw new Error('Usage: node tools/build-spotify-media.js --build|--check');
}
