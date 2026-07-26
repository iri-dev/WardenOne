/*
 * Runs against shipped content.min.js and checks the adult-site gate domain list.
 *
 * Run: node tools/test-adult-gate.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const MIN = fs.readFileSync('content.min.js', 'utf8');
const marker = 'ADULT_DOMAINS=';
const start = MIN.indexOf(marker);
if (start < 0) {
  console.error('FATAL: ADULT_DOMAINS marker not found in content.min.js');
  process.exit(2);
}
const arrayStart = MIN.indexOf('[', start);
const arrayEnd = MIN.indexOf('],DEFAULTS=', arrayStart);
if (arrayStart < 0 || arrayEnd < arrayStart) {
  console.error('FATAL: ADULT_DOMAINS array bounds not found in content.min.js');
  process.exit(2);
}

const domains = vm.runInNewContext('(' + MIN.slice(arrayStart, arrayEnd + 1) + ')');
const set = new Set(domains);

function normalized(host) {
  return String(host || '').replace(/^www\./, '').toLowerCase();
}

function matches(host) {
  const h = normalized(host);
  return domains.some((d) => h === d || h.endsWith('.' + d));
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

check('adult domain list is substantially expanded', () => {
  assert(domains.length >= 130, 'expected >= 130 domains, got ' + domains.length);
});

check('adult domain list has no duplicates', () => {
  assert.strictEqual(set.size, domains.length);
});

check('adult domain list entries are safe domain literals', () => {
  for (const d of domains) {
    assert.strictEqual(d, d.toLowerCase(), d + ' should be lowercase');
    assert(!/^\./.test(d), d + ' should not start with a dot');
    assert(!/[*:/?#]/.test(d), d + ' should be a domain, not a URL/filter');
    assert(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d), d + ' should look like a domain');
  }
});

check('representative expanded adult domains are present', () => {
  [
    'camsoda.com',
    'clips4sale.com',
    'manyvids.com',
    'redgifs.com',
    'literotica.com',
    'javlibrary.com',
    'rule34.paheal.net',
    'thothub.to',
    'xlovecam.com',
  ].forEach((d) => assert(set.has(d), d + ' missing'));
});

check('known adult domains and their subdomains match', () => {
  [
    'www.camsoda.com',
    'live.camsoda.com',
    'thumbzilla.com',
    'cdn.rule34.paheal.net',
    'videos.redgifs.com',
  ].forEach((h) => assert(matches(h), h + ' should match adult gate'));
});

check('common non-adult lookalike hosts stay out of the static list', () => {
  [
    'cambridge.ac.uk',
    'essex.ac.uk',
    'sexeducationforum.org.uk',
    'adultlearning.example',
    'webcam-driver.example',
  ].forEach((h) => assert(!matches(h), h + ' should not match adult gate static list'));
});

if (check.fail) {
  console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
  process.exit(1);
}
console.log('\n' + check.pass + ' passed, 0 failed');
