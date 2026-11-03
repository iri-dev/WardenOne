/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('src/content.js', 'utf8');
const helper = source.slice(source.indexOf('function __woClientHints(){'), source.indexOf('/* CLIENT-HINTS-END */'));
async function run() {
  const native = { architecture: 'arm', bitness: '64', wow64: false, model: 'Phone Model', platformVersion: '17.0.0', uaFullVersion: '156.0.1234.5',
    brands: [{ brand: 'Chromium', version: '156' }], fullVersionList: [{ brand: 'Chromium', version: '156.0.1234.5' }], mobile: false, platform: 'Windows' };
  let received, resolve;
  class UAData {
    getHighEntropyValues(hints) {
      if (!(this instanceof UAData)) return Promise.reject(new TypeError('Illegal invocation'));
      received = hints;
      return new Promise(done => { resolve = done; });
    }
  }
  const data = new UAData(), original = UAData.prototype.getHighEntropyValues;
  const context = vm.createContext({ navigator: { userAgentData: data } });
  vm.runInContext(helper + '\nthis.control=__woClientHints();', context);
  context.control.set(true);
  const hints = ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList'];
  const pending = data.getHighEntropyValues(hints); resolve(native);
  const reduced = await pending;
  assert.equal(received, hints, 'native argument conversion remains authoritative');
  for (const name of ['architecture', 'bitness', 'wow64', 'brands', 'mobile', 'platform']) assert.equal(reduced[name], native[name], name);
  assert.equal(reduced.model, ''); assert.equal(reduced.platformVersion, ''); assert.equal(reduced.uaFullVersion, '156.0.0.0');
  assert.equal(reduced.fullVersionList[0].version, '156.0.0.0');
  assert.equal(native.fullVersionList[0].version, '156.0.1234.5', 'native result is not mutated');
  await assert.rejects(UAData.prototype.getHighEntropyValues.call({}, []), /Illegal invocation/);
  const captured = UAData.prototype.getHighEntropyValues;
  const beforeOff = data.getHighEntropyValues(hints); context.control.set(false); resolve(native);
  assert.equal(await beforeOff, native, 'turning off also releases pending results');
  assert.equal(UAData.prototype.getHighEntropyValues, original, 'off restores native descriptor');
  const off = captured.call(data, hints); resolve(native); assert.equal(await off, native, 'captured wrappers become inert');
  context.control.set(true);
  const later = function () { return Promise.resolve('site wrapper'); };
  UAData.prototype.getHighEntropyValues = later;
  context.control.set(false); assert.equal(UAData.prototype.getHighEntropyValues, later, 'a later site wrapper survives');
  vm.runInNewContext(helper + ';__woClientHints().set(true)', { navigator: {} });
  console.log('[ok] Client Hints metadata: version reduction, architecture/bitness preserved, native arguments and errors, live off, later wrappers and missing API');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
