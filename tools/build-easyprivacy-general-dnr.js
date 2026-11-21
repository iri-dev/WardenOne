/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* EasyPrivacy's general section blocks tracking endpoints by path on every site, the site's own collectors included.
   rules-easyprivacy.json carries only EasyPrivacy's tracker hosts, so a page sending analytics to its own address was
   untouched. This compiles the general rules that name a collector (collect, beacon, telemetry) into a static
   ruleset. EasyPrivacy's allowlist exceptions for those rules are folded into the rules they undo as excluded
   domains, so an exception can loosen these rules only and never another list.

   node tools/build-easyprivacy-general-dnr.js --build <easyprivacy.txt>   refresh the pinned excerpt and the rules
   node tools/build-easyprivacy-general-dnr.js --check                     rebuild from the excerpt, compare bytes */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'easyprivacy-general-snapshot.txt');
const OUT = path.join(ROOT, 'rules-easyprivacy-general.json');
const KEYWORD = /collect|beacon|telemetry/i;
/* WardenOne fails open on payments and bot checks: a blocked PerimeterX sensor can lock a reader out behind a challenge. */
const FAIL_OPEN = /(?:^|\/)(?:pay|payment|checkout|captcha|challenge)(?:\/|$)|\/api\/v2\/collector/i;
const selected = rule => rule && !rule.exception && KEYWORD.test(rule.pattern) && !FAIL_OPEN.test(rule.pattern);
const PRIORITY = 1000;
const MAX_RULES = 400;
const TYPES = { script: 'script', image: 'image', stylesheet: 'stylesheet', object: 'object', xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest', subdocument: 'sub_frame', frame: 'sub_frame', ping: 'ping', beacon: 'ping', media: 'media',
  font: 'font', websocket: 'websocket', other: 'other' };

/* One filter line, or null when it uses anything this compiler does not reproduce exactly. */
function parseFilter(raw) {
  let line = String(raw || '').trim();
  if (!line || line[0] === '!' || line[0] === '[' || /#[@?$%]*#/.test(line)) return null;
  const exception = line.startsWith('@@');
  if (exception) line = line.slice(2);
  const dollar = line.lastIndexOf('$');
  const hasOptions = dollar > 0 && /^[a-z0-9~_,=|.-]+$/i.test(line.slice(dollar + 1));
  const pattern = hasOptions ? line.slice(0, dollar) : line;
  if (!pattern || pattern.length > 2048 || /[^\x21-\x7E]/.test(pattern)) return null;
  if (pattern.length > 2 && pattern[0] === '/' && pattern.endsWith('/')) return null;
  /* Pipes anchor only at the ends; one inside the pattern, or "||*", is not something DNR reads the same way. */
  if (/^\|\|\*/.test(pattern) || pattern.replace(/^\|\|?/, '').replace(/\|$/, '').includes('|')) return null;
  const rule = { exception, pattern, types: [], domains: [], excluded: [], domainType: null, caseSensitive: false };
  for (let opt of hasOptions ? line.slice(dollar + 1).split(',') : []) {
    opt = opt.trim();
    const negated = opt[0] === '~';
    if (negated) opt = opt.slice(1);
    const [key, value] = opt.split('=');
    if (key === 'third-party' || key === '3p' || key === 'first-party' || key === '1p') {
      const third = (key === 'third-party' || key === '3p') !== negated;
      if (rule.domainType && rule.domainType !== (third ? 'thirdParty' : 'firstParty')) return null;
      rule.domainType = third ? 'thirdParty' : 'firstParty';
    } else if (TYPES[key] && value === undefined) {
      if (negated) return null;
      rule.types.push(TYPES[key]);
    } else if (key === 'domain' && value && !negated) {
      for (let host of value.split('|')) {
        const off = host[0] === '~';
        host = (off ? host.slice(1) : host).toLowerCase();
        if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
        (off ? rule.excluded : rule.domains).push(host);
      }
    } else if (key === 'match-case' && value === undefined && !negated) {
      rule.caseSensitive = true;
    } else return null;
  }
  return rule;
}

const requestHost = pattern => (/^\|\|([a-z0-9.-]+)(?:\^|\/|\*|$)/i.exec(pattern) || [])[1];

function compile(blockLines, exceptionLines) {
  const blocks = blockLines.map(parseFilter).filter(selected);
  const exceptions = exceptionLines.map(line => ({ line, rule: parseFilter(line) }))
    .filter(entry => entry.rule && entry.rule.exception && KEYWORD.test(entry.rule.pattern));
  const exempt = blocks.map(() => ({ requests: new Set(), initiators: new Set() }));
  const used = new Set();
  exceptions.forEach(({ line, rule: exception }) => {
    const host = requestHost(exception.pattern);
    blocks.forEach((block, b) => {
      if (!exception.pattern.toLowerCase().includes(block.pattern.toLowerCase())) return;
      /* Excluding the whole host (or the sites named) is a little broader than the exception, never narrower. */
      if (host) exempt[b].requests.add(host.toLowerCase());
      else if (exception.domains.length) exception.domains.forEach(site => exempt[b].initiators.add(site));
      else return;
      used.add(line);
    });
  });
  const seen = new Set();
  const rules = [];
  blocks.forEach((block, b) => {
    const condition = { urlFilter: block.pattern, isUrlFilterCaseSensitive: block.caseSensitive };
    if (block.types.length) condition.resourceTypes = [...new Set(block.types)].sort();
    if (block.domainType) condition.domainType = block.domainType;
    if (block.domains.length) condition.initiatorDomains = [...new Set(block.domains)].sort();
    const excludedSites = [...new Set(block.excluded.concat([...exempt[b].initiators]))].sort();
    if (excludedSites.length) condition.excludedInitiatorDomains = excludedSites;
    if (exempt[b].requests.size) condition.excludedRequestDomains = [...exempt[b].requests].sort();
    const key = JSON.stringify(condition);
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({ id: rules.length + 1, priority: PRIORITY, action: { type: 'block' }, condition });
  });
  if (rules.length > MAX_RULES) throw new Error(rules.length + ' rules is over the ' + MAX_RULES + ' this ruleset may use');
  return { rules, usedExceptions: exceptionLines.filter(line => used.has(line)) };
}

const serialize = rules => '[\n' + rules.map(rule => '  ' + JSON.stringify(rule)).join(',\n') + '\n]\n';

function readSnapshot() {
  const text = fs.readFileSync(SNAPSHOT, 'utf8');
  const commit = /^! Commit: ([0-9a-f]{40})$/m.exec(text);
  if (!commit || !/^! Version: \d{12}$/m.test(text) || !/^! Licence: /m.test(text)) throw new Error('the pinned excerpt lost its provenance header');
  const general = text.split('\n! [allowlist]\n')[0].split('\n! [general]\n')[1];
  const allowlist = text.split('\n! [allowlist]\n')[1];
  if (general === undefined || allowlist === undefined) throw new Error('the pinned excerpt lost its sections');
  const lines = part => part.split('\n').filter(line => line && line[0] !== '!');
  return { general: lines(general), allowlist: lines(allowlist) };
}

function section(lines, name) {
  const start = lines.findIndex(line => line === '! *** easylist:easyprivacy/' + name + ' ***');
  if (start < 0) throw new Error('EasyPrivacy has no ' + name + ' section');
  let end = lines.findIndex((line, i) => i > start && /^! \*\*\* easylist:/.test(line));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

function build(source) {
  const lines = fs.readFileSync(source, 'utf8').replace(/\r/g, '').split('\n');
  const version = (lines.find(line => /^! Version: \d{12}$/.test(line)) || '').slice(11);
  const commit = (lines.find(line => /^! Commit: [0-9a-f]{40}$/.test(line)) || '').slice(10);
  if (!version || !commit) throw new Error('the input does not look like EasyPrivacy');
  const general = section(lines, 'easyprivacy_general.txt');
  const allowlist = section(lines, 'easyprivacy_allowlist.txt').concat(section(lines, 'easyprivacy_allowlist_international.txt'));
  const blockLines = general.filter(line => selected(parseFilter(line)));
  const { rules, usedExceptions } = compile(blockLines, allowlist);
  const snapshot = ['! WardenOne excerpt of EasyPrivacy, https://easylist.to/easylist/easyprivacy.txt',
    '! Version: ' + version, '! Commit: ' + commit,
    '! Licence: the EasyList authors, dual licensed GPLv3 and CC BY-SA 3.0, https://easylist.to/pages/licence.html',
    '! Selection: easyprivacy_general.txt rules whose pattern names a collector (collect, beacon, telemetry), and the',
    '! easyprivacy_allowlist exceptions that undo one of them. Payment, checkout, captcha and bot check sensor paths are',
    '! left out because WardenOne fails open on them. Built by tools/build-easyprivacy-general-dnr.js.',
    '! [general]', ...blockLines, '! [allowlist]', ...usedExceptions, ''].join('\n');
  fs.writeFileSync(SNAPSHOT, snapshot);
  fs.writeFileSync(OUT, serialize(rules));
  console.log('[ok] ' + rules.length + ' rules from ' + blockLines.length + ' EasyPrivacy general rules and '
    + usedExceptions.length + ' exceptions (EasyPrivacy ' + version + ', ' + commit.slice(0, 7) + ')');
}

function check() {
  const { general, allowlist } = readSnapshot();
  const { rules } = compile(general, allowlist);
  if (fs.readFileSync(OUT, 'utf8') !== serialize(rules)) {
    console.error('[fail] rules-easyprivacy-general.json differs from its pinned EasyPrivacy excerpt;'
      + ' run: node tools/build-easyprivacy-general-dnr.js --build <easyprivacy.txt>');
    process.exit(1);
  }
  console.log('[ok] ' + rules.length + ' EasyPrivacy general rules match their pinned excerpt');
}

module.exports = { parseFilter, compile, readSnapshot, selected, FAIL_OPEN };
if (require.main === module) {
  if (process.argv[2] === '--build' && process.argv[3]) build(process.argv[3]);
  else if (process.argv[2] === '--check') check();
  else { console.error('usage: --build <easyprivacy.txt> | --check'); process.exit(2); }
}
