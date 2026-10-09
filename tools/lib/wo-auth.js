/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Model the bridge's one-time synchronous key handoff and signed message sequence
// for sandboxed MAIN-world consumers. Tests also use this helper to forge messages
// that consumers must reject.

const crypto = require('crypto');

function hmac(keyHex, text) {
  return crypto.createHmac('sha256', Buffer.from(String(keyHex), 'hex')).update(String(text), 'utf8').digest('hex');
}

function newKey() { return crypto.randomBytes(32).toString('hex'); }

class Signer {
  constructor(key) { this.key = key; this.seq = 0; }
  sign(kind, payload, message) {
    this.seq += 1;
    message.seq = this.seq;
    message.mac = hmac(this.key, this.seq + '\n' + kind + '\n' + String(payload));
    return message;
  }
}

function configMessage(signer, token, overrides) {
  return signer.sign('config', JSON.stringify(overrides), { source: 'wardenone', kind: 'config', token, overrides });
}

function disposeMessage(signer, token) {
  return signer.sign('dispose', '', { source: 'wardenone', kind: 'dispose', token });
}

function safeBrowsingReply(signer, token, id, result) {
  return signer.sign('safe-browsing', id + '\n' + JSON.stringify(result), { source: 'wardenone-safe-browsing', token, id, result });
}

function backgroundReply(signer, token, id, result) {
  return signer.sign('bg-response', id + '\n' + JSON.stringify(result), { source: 'wardenone-bg-response', token, id, result });
}

function frameClickfixMessage(signer, token, detail) {
  return signer.sign('frame-clickfix', JSON.stringify(detail), { source: 'wardenone', kind: 'frame-clickfix', token, detail });
}

// Give a fake document a listener registry and return a synchronous dispatcher for it. Most
// harnesses stub document.addEventListener to a no-op; the key arrives on the document, so
// that stub has to become real for the consumer to receive it.
function documentEvents(doc) {
  const registry = Object.create(null);
  doc.addEventListener = (type, fn) => { (registry[type] = registry[type] || []).push(fn); };
  doc.removeEventListener = (type, fn) => { registry[type] = (registry[type] || []).filter((f) => f !== fn); };
  const dispatch = (type, detail) => {
    (registry[type] || []).slice().forEach((fn) => { try { fn({ type, detail, target: doc }); } catch (_) {} });
  };
  dispatch.registry = registry;
  return dispatch;
}

// The whole hand-off: the key by wo-key, then a signer bound to it. `fireWindow(data)` must
// deliver a window "message" whose source is the sandbox window and whose data is `data`.
function handshake(dispatchDoc, fireWindow, opts) {
  const o = opts || {};
  const token = o.token || 'tok';
  const key = o.key || newKey();
  const signer = new Signer(key);
  dispatchDoc('wo-key', { token, key });
  return {
    token, key, signer,
    sign: (kind, payload, message) => signer.sign(kind, payload, message),
    sendConfig: (overrides) => fireWindow(configMessage(signer, token, overrides)),
    sendDispose: () => fireWindow(disposeMessage(signer, token)),
    sendSafeBrowsingReply: (id, result) => fireWindow(safeBrowsingReply(signer, token, id, result)),
    sendBackgroundReply: (id, result) => fireWindow(backgroundReply(signer, token, id, result)),
    sendFrameClickfix: (detail) => fireWindow(frameClickfixMessage(signer, token, detail)),
    pong: (nonce) => hmac(key, 'pong\n' + nonce),
    installedMac: () => hmac(key, 'installed\n' + token),
  };
}

module.exports = {
  hmac, newKey, Signer, configMessage, disposeMessage, safeBrowsingReply, backgroundReply,
  frameClickfixMessage, documentEvents, handshake,
};
