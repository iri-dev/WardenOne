/*
 * Tests the safer remote supplemental-list path without network access.
 *
 * Run: node tools/test-supplemental-lists.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const BG = fs.readFileSync('background.js', 'utf8');
const BUNDLED_MANIFEST = JSON.parse(fs.readFileSync('supplemental-manifest.json', 'utf8'));
const START = BG.indexOf('function emptySupplementalLists()');
const END = BG.indexOf('function remoteListSourceKind', START);
if (START < 0 || END < START) {
  console.error('FATAL: supplemental-list helper markers not found in background.js');
  process.exit(2);
}

const helperSlice = BG.slice(START, END);
const harness = `
const SUPPLEMENTAL_LIST_CAPS = {
  adultDomainsExtra: 3000,
  grabberDomainsExtra: 1500,
  trustedPaymentHostsExtra: 300,
};
const SUPPLEMENTAL_LIST_DRIFT = {
  adultDomainsExtra: { minBaseline: 25, dropRatio: 0.25, spikeRatio: 5, spikeFloor: 1500 },
  grabberDomainsExtra: { minBaseline: 25, dropRatio: 0.25, spikeRatio: 4, spikeFloor: 1000 },
  trustedPaymentHostsExtra: { minBaseline: 25, dropRatio: 0.35, spikeRatio: 2, spikeFloor: 100 },
};
function normalizeAllowlistHost(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(raw)) raw = new URL(raw).hostname;
    else raw = new URL('https://' + raw).hostname;
  } catch (_) {
    if (/[/?#]/.test(raw)) return '';
  }
  const h = String(raw || '').toLowerCase().replace(/^www\\./, '').replace(/^\\.+|\\.+$/g, '');
  if (!h || h.includes('*') || h.includes('%') || h.includes('/') || h.includes('\\\\') || h.includes('..')) return '';
  if (!/^[a-z0-9.-]+$/i.test(h)) return '';
  if (/^(localhost|local|internal|example)$/.test(h.split('.').pop())) return '';
  if (h.split('.').length < 2) return '';
  return h;
}
function isNeverBlockDomain(value) {
  const h = String(value || '').replace(/^www\\./, '').toLowerCase();
  return ['google.com', 'github.com', 'stripe.com', 'paypal.com', 'twitch.tv'].some((d) => h === d || h.endsWith('.' + d));
}
function parseList(text) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    let h = String(raw || '').trim().toLowerCase();
    if (!h || /^[#!]/.test(h) || /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(h)) return;
    h = h.replace(/^\\|\\|/, '').replace(/^https?:\\/\\//, '').replace(/^www\\./, '').replace(/[\\^/?#:].*$/, '').replace(/\\.$/, '');
    if (/^[a-z0-9.-]+\\.[a-z]{2,}$/.test(h) && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  };
  String(text || '').split(/\\s+/).forEach(add);
  return out;
}
function listCountDriftReason(previous, next, label, opts) {
  const prev = Number(previous || 0);
  const cur = Number(next || 0);
  const minBaseline = Number(opts && opts.minBaseline) || 50;
  if (prev < minBaseline) return '';
  const dropLimit = Math.max(1, Math.floor(prev * (Number(opts && opts.dropRatio) || 0.35)));
  const spikeLimit = Math.ceil(prev * (Number(opts && opts.spikeRatio) || 2.5) + (Number(opts && opts.spikeFloor) || 0));
  if (cur < dropLimit) return label + ' dropped from ' + prev + ' to ' + cur;
  if (cur > spikeLimit) return label + ' jumped from ' + prev + ' to ' + cur;
  return '';
}
${helperSlice}
`;

const sandbox = { URL, Date, console, globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(harness, sandbox, { filename: 'supplemental-list-helpers.js' });
const api = sandbox.globalThis.__wardenOneSupplementalListTest;
if (!api) {
  console.error('FATAL: supplemental-list test API not exposed');
  process.exit(2);
}

function check(name, fn) {
  try {
    fn();
    console.log('  ok  - ' + name);
    check.pass++;
  } catch (e) {
    console.error('FAIL - ' + name);
    console.error(e && e.stack || e);
    check.fail++;
  }
}
check.pass = 0;
check.fail = 0;

check('normalizes only safe public domains for supplemental block lists', () => {
  assert.strictEqual(api.normalizeSupplementalListDomain('https://www.bad.testsite/path', 'adultDomainsExtra'), 'bad.testsite');
  assert.strictEqual(api.normalizeSupplementalListDomain('google.com', 'adultDomainsExtra'), '');
  assert.strictEqual(api.normalizeSupplementalListDomain('legal.twitch.tv', 'adultDomainsExtra'), '');
  assert.strictEqual(api.normalizeSupplementalListDomain('127.0.0.1', 'grabberDomainsExtra'), '');
  assert.strictEqual(api.normalizeSupplementalListDomain('not a host', 'grabberDomainsExtra'), '');
});

check('payment processor hints reject suspicious remote allow-list entries', () => {
  assert.strictEqual(api.normalizeSupplementalListDomain('processor-payments.com', 'trustedPaymentHostsExtra'), 'processor-payments.com');
  assert.strictEqual(api.normalizeSupplementalListDomain('pay-now.xyz', 'trustedPaymentHostsExtra'), '');
  assert.strictEqual(api.normalizeSupplementalListDomain('xn--paypa1-ova.com', 'trustedPaymentHostsExtra'), '');
  assert.strictEqual(api.normalizeSupplementalListDomain('aaaaaaaaaaaaaaa.com', 'trustedPaymentHostsExtra'), '');
});

check('manifest routes adult, IP-logger, and payment categories separately', () => {
  const parsed = api.parseSupplementalManifestText(JSON.stringify({
    adultDomains: ['adult.testsite', 'https://www.second-adult.testsite/path'],
    ipLoggerDomains: ['grabify.testsite'],
    paymentProcessorDomains: ['processor-payments.com', 'pay-now.xyz'],
    phishingDomains: ['phish.testsite'],
  }));
  assert.deepStrictEqual(Array.from(parsed.adultDomainsExtra), ['adult.testsite', 'second-adult.testsite']);
  assert.deepStrictEqual(Array.from(parsed.grabberDomainsExtra), ['grabify.testsite']);
  assert.deepStrictEqual(Array.from(parsed.trustedPaymentHostsExtra), ['processor-payments.com']);
});

check('plain list sources are parsed into the source bucket only', () => {
  const parsed = api.parseSupplementalListText(
    { bucket: 'adultDomainsExtra' },
    '0.0.0.0 adult-one.testsite\n||www.adult-two.testsite^\ngoogle.com'
  );
  assert.deepStrictEqual(Array.from(parsed.adultDomainsExtra), ['adult-one.testsite', 'adult-two.testsite']);
  assert.deepStrictEqual(Array.from(parsed.grabberDomainsExtra), []);
});

check('suspicious category drop keeps previous cached list', () => {
  const previous = {
    adultDomainsExtra: Array.from({ length: 100 }, (_, i) => 'old' + i + '.testsite'),
    grabberDomainsExtra: [],
    trustedPaymentHostsExtra: [],
  };
  const candidate = {
    adultDomainsExtra: ['new1.testsite', 'new2.testsite'],
    grabberDomainsExtra: [],
    trustedPaymentHostsExtra: [],
  };
  const merged = api.mergeSupplementalLists(previous, candidate, { adultDomainsExtra: true });
  assert.strictEqual(merged.lists.adultDomainsExtra.length, 100);
  assert.strictEqual(merged.keptPrevious.adultDomainsExtra, true);
  assert.strictEqual(merged.rejected.length, 1);
});

check('category caps are enforced after merging', () => {
  const candidate = {
    adultDomainsExtra: [],
    grabberDomainsExtra: Array.from({ length: 1700 }, (_, i) => 'grab' + i + '.testsite'),
    trustedPaymentHostsExtra: Array.from({ length: 400 }, (_, i) => 'pay' + i + '.safepay'),
  };
  const merged = api.mergeSupplementalLists({}, candidate, { grabberDomainsExtra: true, trustedPaymentHostsExtra: true });
  assert.strictEqual(merged.lists.grabberDomainsExtra.length, 1500);
  assert.strictEqual(merged.lists.trustedPaymentHostsExtra.length, 300);
});

check('bundled owner manifest is wired as a supplemental manifest source', () => {
  assert.ok(BG.includes("SUPPLEMENTAL_BUNDLED_MANIFEST_PATH = 'supplemental-manifest.json'"));
  assert.ok(BG.includes("localPath: SUPPLEMENTAL_BUNDLED_MANIFEST_PATH"));
  assert.ok(Array.isArray(BUNDLED_MANIFEST.paymentProcessorDomains));
  assert.ok(BUNDLED_MANIFEST.paymentProcessorDomains.includes('mollie.com'));
});

if (check.fail) {
  console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
  process.exit(1);
}
console.log('\n' + check.pass + ' passed, 0 failed');
