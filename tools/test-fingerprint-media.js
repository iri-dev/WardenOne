/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
const start = source.indexOf('if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices)');
const end = source.indexOf('if(Navigator.prototype.getBattery)', start);
assert(start >= 0 && end > start);
const wrapper = source.slice(start, source.lastIndexOf('catch(_)', end)).replace(/\s*}\s*$/, '');
process.exitCode = 1;

(async () => {
  const devices = ['videoinput', 'audioinput', 'audiooutput'].map((kind, i) => ({
    kind, deviceId: i ? 'opaque-device-' + i : 'default', label: 'Private hardware ' + i, groupId: 'private-group',
  }));
  const failure = new Error('native enumeration refused');
  const mediaDevices = {
    fail: false,
    enumerateDevices() { assert.equal(this, mediaDevices); return this.fail ? Promise.reject(failure) : Promise.resolve(devices); },
    getUserMedia({ video }) {
      return devices.some((d) => d.kind === 'videoinput' && d.deviceId === video.deviceId.exact)
        ? Promise.resolve('selected') : Promise.reject(new Error('unusable camera ID'));
    },
  };
  vm.runInNewContext(wrapper, { navigator: { mediaDevices } });
  for (const device of await mediaDevices.enumerateDevices()) {
    assert(devices.some((d) => d.kind === device.kind && d.deviceId === device.deviceId), 'opaque native ID survives');
    assert.equal(device.label, '');
    assert.equal(device.groupId, '');
    assert.equal(device.toJSON().deviceId, device.deviceId);
    if (device.kind === 'videoinput') assert.equal(await mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } } }), 'selected');
  }
  mediaDevices.fail = true;
  await assert.rejects(mediaDevices.enumerateDevices(), (error) => error === failure);
  vm.runInNewContext(wrapper, { navigator: {} });
  console.log('[ok] fingerprint noise hides media metadata without breaking native selection IDs');
  process.exitCode = 0;
})().catch((error) => console.error(error));
