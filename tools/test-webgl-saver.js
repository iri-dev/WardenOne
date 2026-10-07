/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const SRC = read('src/content.js');
const CONTENT = read('content.min.js');
const REALM = read('fingerprint-realm.js');
const BRIDGE = read('bridge.js');
const BG = read('background.js');
const POPUP = read('popup.html');
const POPUP_JS = read('popup.js');
const SETTINGS = read('settings.js');
const SETTINGS_DATA = read('settings-data.js');
const PROFILE = read('build-profile.js');
const README = read('README.md');
const CHANGELOG = read('CHANGELOG.md');

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push(name + (detail ? ' — ' + detail : ''));
}

function marked(source, name) {
  const a = source.indexOf('/* ' + name + '-BEGIN');
  const end = '/* ' + name + '-END */';
  const b = source.indexOf(end, a);
  return a >= 0 && b > a ? source.slice(a, b + end.length) : '';
}

function bridgeFunction(name) {
  const start = BRIDGE.indexOf('  function ' + name + '(');
  const end = BRIDGE.indexOf('\n  }\n', start);
  return start >= 0 && end > start ? BRIDGE.slice(start, end + 4) : '';
}

(function wrapperBehaviour() {
  class HTMLCanvasElement {
    getContext(kind, attrs) { return { owner: this, kind, attrs }; }
  }
  class OffscreenCanvas {
    getContext(kind) { return { owner: this, kind }; }
  }
  const originalCanvas = HTMLCanvasElement.prototype.getContext;
  const originalOffscreen = OffscreenCanvas.prototype.getContext;
  const context = { window: null, HTMLCanvasElement, OffscreenCanvas, Object, String, RegExp };
  context.window = context;
  vm.createContext(context);
  const region = marked(SRC, 'WEBGL-SAVER');
  check('the engine has one shared WebGL saver region', !!region && SRC.indexOf('/* WEBGL-SAVER-BEGIN', SRC.indexOf('/* WEBGL-SAVER-BEGIN') + 1) < 0);
  vm.runInContext(region + '\nthis.control = __woWebGLSaver();', context);
  const canvas = new HTMLCanvasElement();
  const existing = canvas.getContext('webgl', { alpha: false });
  check('the saver starts fail-open', existing && existing.kind === 'webgl' && existing.owner === canvas);
  context.control.set(true);
  check('blocking covers every WebGL context spelling', canvas.getContext('webgl') === null
    && canvas.getContext('WEBGL2') === null && canvas.getContext('experimental-webgl') === null);
  const twoD = canvas.getContext('2d', { alpha: false });
  check('Canvas 2D and its arguments still pass through', twoD && twoD.kind === '2d' && twoD.attrs.alpha === false);
  check('OffscreenCanvas follows the same verdict', new OffscreenCanvas().getContext('webgl2') === null);
  check('a context created before the verdict remains an ordinary object', existing && existing.kind === 'webgl');
  context.control.set(false);
  check('turning the saver off restores future contexts', !!canvas.getContext('webgl') && !!new OffscreenCanvas().getContext('webgl'));
  check('the wrapper retains each native method behind it', HTMLCanvasElement.prototype.getContext !== originalCanvas
    && OffscreenCanvas.prototype.getContext !== originalOffscreen);
})();

(function sitePolicy() {
  const source = bridgeFunction('bridgeFrameWebGLDisabled');
  check('the bridge owns a dedicated WebGL page-tree verdict', !!source && /bridgeTopHost\(\)\s*\|\|\s*bridgeOwnHost\(\)/.test(source));
  let topHost = 'page.example.com';
  const context = {
    String, RegExp,
    bridgeTopHost: () => topHost,
    bridgeOwnHost: () => 'frame.widgets.test',
    sanitizeBridgeHostList: (list, limit) => (Array.isArray(list) ? list : []).slice(0, limit),
    bridgeHostMatchesList: (host, list) => (Array.isArray(list) ? list : []).some((saved) => host === saved || host.endsWith('.' + saved)),
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.verdict = bridgeFrameWebGLDisabled;', context);
  const verdict = context.verdict;
  const base = { enabled: true, allowlist: [], webglSaverBlockHosts: [], webglSaverAllowHosts: [] };
  check('Off and malformed modes leave WebGL alone', verdict({ ...base, webglSaverMode: 'off' }) === false
    && verdict({ ...base, webglSaverMode: 'broken' }) === false);
  check('Selected sites blocks only a listed top site', verdict({ ...base, webglSaverMode: 'selected', webglSaverBlockHosts: ['page.example.com'] }) === true
    && verdict({ ...base, webglSaverMode: 'selected', webglSaverBlockHosts: ['elsewhere.test'] }) === false);
  topHost = 'maps.example.com';
  check('a saved parent host covers its subdomains', verdict({ ...base, webglSaverMode: 'selected', webglSaverBlockHosts: ['example.com'] }) === true);
  check('Everywhere blocks unless the top site is allowed', verdict({ ...base, webglSaverMode: 'everywhere' }) === true
    && verdict({ ...base, webglSaverMode: 'everywhere', webglSaverAllowHosts: ['example.com'] }) === false);
  check('pausing WardenOne on the page also pauses WebGL saving', verdict({ ...base, webglSaverMode: 'everywhere', allowlist: ['example.com'] }) === false);
  check('the master switch off is fail-open', verdict({ ...base, enabled: false, webglSaverMode: 'everywhere' }) === false);
})();

(function integrationAndCopy() {
  check('both shipped page realms contain the exact shared saver', CONTENT.includes(marked(CONTENT, 'WEBGL-SAVER'))
    && REALM.includes(marked(CONTENT, 'WEBGL-SAVER')));
  check('the signed frame verdict reaches the child bootstrap and can update later', /webglDisabled/.test(REALM)
    && /if\s*\(settled\)\s*publishWebGL/.test(REALM));
  check('the bridge removes raw site lists before entering the page world', /clean\.webglDisabled = bridgeFrameWebGLDisabled\(clean\);[\s\S]{0,180}delete clean\.webglSaverBlockHosts;[\s\S]{0,100}delete clean\.webglSaverAllowHosts;/.test(BRIDGE));
  check('stored WebGL fields have conservative defaults in both owners', /webglSaverMode: 'off',[\s\S]{0,100}webglSaverBlockHosts: \[\],[\s\S]{0,100}webglSaverAllowHosts: \[\]/.test(BG)
    && /webglSaverMode: 'off', webglSaverBlockHosts: \[\], webglSaverAllowHosts: \[\]/.test(POPUP_JS));
  check('the storage boundary validates mode and caps both host lists', /\^\(\?:off\|selected\|everywhere\)\$/.test(BG)
    && /normalizeAllowlistHosts\(source\[field\], 300\)/.test(BG));
  check('generated Settings data carries the new defaults', SETTINGS_DATA.includes('"webglSaverMode":"off"')
    && SETTINGS_DATA.includes('"webglSaverBlockHosts":[]') && SETTINGS_DATA.includes('"webglSaverAllowHosts":[]'));
  check('the popup offers the three modes and a current-site action', /id="webgl-saver-mode"/.test(POPUP)
    && /value="off"/.test(POPUP) && /value="selected"/.test(POPUP) && /value="everywhere"/.test(POPUP)
    && /id="webgl-saver-current"/.test(POPUP)
    && /<details data-feature="memoryShield"[^>]+id="webgl-saver"/.test(POPUP));
  check('Settings exposes the mode and both site lists', /pick\('webglSaverMode'/.test(SETTINGS)
    && /WebGL disabled sites/.test(SETTINGS) && /WebGL allowed sites/.test(SETTINGS));
  check('the compatibility warning names the main breakage classes', /can break games, maps, 3D viewers and some web apps/i.test(POPUP)
    && /games, maps, 3D viewers and some web apps/i.test(SETTINGS));
  check('the Store profile carries every WebGL preference', ['webglSaverMode', 'webglSaverBlockHosts', 'webglSaverAllowHosts'].every((key) => PROFILE.includes("'" + key + "'")));
  check('the guide and changelog state the off default and site modes', /WebGL saver[\s\S]{0,300}off by default/i.test(README)
    && /WebGL control with Off, selected-site and everywhere modes/i.test(CHANGELOG));
})();

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((failure) => console.error('  - ' + failure));
  process.exit(1);
}
console.log('webgl saver: ' + pass + ' checks passed');
