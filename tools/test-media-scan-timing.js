/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Media Shield must preserve author media state and decide only at play time. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
const start = source.indexOf('const isMediaElement=el=>', source.indexOf('!1!==WO.blockAutoplayMedia'));
const end = source.indexOf('if(!0===WO.blockSuspiciousWebRTC', start);
assert(start >= 0 && end > start, 'hidden-media play guard markers moved');
const guard = source.slice(start, end);

let playCalls = 0;
let gesture = false;
let logs = 0;
function Media() {}
Media.prototype.play = function () { playCalls++; return Promise.resolve('playing'); };
const sandbox = {
  window: { HTMLMediaElement: Media },
  document: { readyState: 'complete' },
  getComputedStyle: (el) => el.style,
  playerShellFor: (el) => el.playerShell,
  recentMediaGesture: () => gesture,
  noteMedia: () => { logs++; },
  mediaRisk: { autoplay: 'Low' },
  Promise, Object, String, Number, DOMException,
};
vm.createContext(sandbox);
vm.runInContext('if(true){' + guard, sandbox);

function make(tag, opts = {}) {
  const el = new Media();
  el.tagName = tag;
  el.hidden = !!opts.hidden;
  el.autoplay = true;
  el.muted = false;
  el.controls = !!opts.controls;
  el.style = { display: opts.display || 'inline', visibility: 'visible', opacity: '1' };
  el.playerShell = opts.playerShell || null;
  el.size = opts.size || { width: 0, height: 0 };
  el.getBoundingClientRect = () => el.size;
  el.hasAttribute = (name) => name === 'controls' && el.controls;
  el.pause = () => { throw new Error('Media Shield must not pause author media'); };
  el.removeAttribute = () => { throw new Error('Media Shield must not remove author attributes'); };
  return el;
}

(async () => {
  const audio = make('AUDIO', { hidden: true });
  assert.strictEqual(audio.autoplay, true);
  assert.strictEqual(audio.muted, false);
  assert.strictEqual(await audio.play(), 'playing', 'hidden accessibility audio should play');
  assert.strictEqual(audio.autoplay, true);
  assert.strictEqual(audio.muted, false);

  const video = make('VIDEO', { hidden: true });
  await assert.rejects(video.play(), { name: 'NotAllowedError' });
  assert.strictEqual(logs, 1);
  assert.strictEqual(video.autoplay, true, 'rejected play must not erase autoplay intent');
  assert.strictEqual(video.muted, false, 'rejected play must not mute a reused element');

  gesture = true;
  assert.strictEqual(await video.play(), 'playing', 'an intentional play should work');
  gesture = false;
  video.hidden = false;
  video.size = { width: 640, height: 360 };
  assert.strictEqual(await video.play(), 'playing', 'revealed player should work');
  video.hidden = true;
  video.playerShell = {};
  assert.strictEqual(await video.play(), 'playing', 'recognized player shell should work');
  assert.strictEqual(playCalls, 4);
  console.log('media play compatibility tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
