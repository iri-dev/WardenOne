/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * XSS/behavioral Activity events originate in MAIN world and are page-forgeable.
 * This executes the real background boundary to ensure free-form page strings do
 * not reach local history and that these warning-only events cannot learn a domain.
 *
 * Run: node tools/test-xss-event-boundary.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const background = fs.readFileSync('background.js', 'utf8');
const bridge = fs.readFileSync('bridge.js', 'utf8');
const start = background.indexOf("const UNSAFE_DETAIL_KEYS = new Set(");
/* Anchored on CODE, not on a comment. The end marker used to be the line
   "// Seed the counters from what Chrome is already showing", which described a
   badge model that has since been replaced -- so rewording it took this whole
   suite out. beginBadgeCountRecovery() is the call that actually follows the
   region under test. */
const end = background.indexOf(String.fromCharCode(10) + 'beginBadgeCountRecovery();', start);
assert(start >= 0 && end > start, 'background Activity-boundary source markers are missing');

const sandbox = {
  URL, Set, Object, Array, Number, String, Math, Date,
  messageHostFromText(value) {
    try { return new URL(String(value || '')).hostname.replace(/^www\./, '').toLowerCase(); }
    catch (_) { return ''; }
  },
};
vm.createContext(sandbox);
vm.runInContext(
  background.slice(start, end)
    + '\nthis.__normalizeTabBlockMessage=normalizeTabBlockMessage;',
  sandbox,
  { filename: 'background.js:xss-event-boundary' },
);
const normalize = sandbox.__normalizeTabBlockMessage;
const sender = { tab: { id: 77, url: 'https://github.com/iri-dev/WardenOne/issues/1?token=SECRETURL' } };

{
  const result = normalize({
    type: 'warned_potential_dom_xss',
    detail: {
      source: 'access_token=SECRET_SOURCE',
      sink: 'SECRET_SINK',
      why: 'access_token=SECRET_WHY',
      outcome: 'SECRET_OUTCOME',
      confidence: 'Definitely compromised',
    },
  }, sender);
  const serialized = JSON.stringify(result);
  assert(!/SECRET|access_token/.test(serialized), 'forged free-form XSS detail crossed into history');
  assert.strictEqual(result.detail.source, 'attacker-controlled browser input');
  assert.strictEqual(result.detail.sink, 'sensitive browser sink');
  assert.strictEqual(result.detail.category, 'html');
  assert.strictEqual(result.detail.confidence, 'High');
  assert.strictEqual(result.detail.severity, 'Medium');
  console.log('ok - forged XSS detail is rebuilt from safe enums');
}

{
  const first = normalize({
    type: 'warned_potential_xss_script_injection',
    detail: {
      source: 'postMessage event.data',
      sink: 'script.src',
      confidence: 'Very high',
    },
  }, sender);
  const duplicate = normalize({
    type: 'warned_potential_xss_script_injection',
    detail: {
      source: 'postMessage event.data',
      sink: 'script.src',
      confidence: 'Very high',
    },
  }, sender);
  assert.strictEqual(first.log, true);
  assert.strictEqual(duplicate.log, false, 'repeated forged XSS events can flood local history');
  assert.strictEqual(first.detail.category, 'script');
  assert(/script creation or loading/.test(first.detail.why));
  console.log('ok - XSS history events are deduplicated and technically useful');
}

{
  const forged = normalize({
    type: 'behavioral_risk',
    detail: {
      score: 0,
      level: 'Dangerous',
      learningEligible: true,
      reasons: ['SECRET_REASON'],
      why: 'SECRET_WHY',
    },
  }, { tab: { id: 78, url: 'https://example.test/page?secret=VALUE' } });
  assert.strictEqual(forged.detail.score, 0);
  assert.strictEqual(forged.detail.level, 'Safe', 'page-supplied level overrode the numeric score');
  assert.strictEqual(forged.detail.learningEligible, false, 'MAIN-world behavior event remained learning-eligible');
  assert.strictEqual(forged.detail.host, 'example.test');
  assert(!/SECRET|VALUE/.test(JSON.stringify(forged)), 'free-form behavioral detail or URL secrets survived');

  const bounded = normalize({ type: 'behavioral_risk', detail: { score: 80, level: 'Safe' } },
    { tab: { id: 79, url: 'https://risk.example/' } });
  assert.strictEqual(bounded.detail.level, 'Suspicious');
  console.log('ok - behavioral severity is derived locally and remains warning-only');
}

{
  const xssOnly = normalize({
    type: 'behavioral_risk',
    detail: { score: 65, independentEvidenceScore: 0, xssObserved: true },
  }, { tab: { id: 80, url: 'https://xss-only.example/' } });
  assert.strictEqual(xssOnly.log, false,
    'a specific XSS event still creates a duplicate generic Activity row');

  const combined = normalize({
    type: 'behavioral_risk',
    detail: { score: 95, independentEvidenceScore: 35, xssObserved: true },
  }, { tab: { id: 81, url: 'https://combined.example/' } });
  assert.strictEqual(combined.log, true,
    'material independent behavior evidence was hidden with the duplicate XSS row');
  console.log('ok - XSS-only risk is deduplicated while genuinely combined evidence remains visible');
}

{
  const forged = normalize({
    type: 'warned_clickfix_correlated',
    detail: {
      instruction: 'SECRET_INSTRUCTION',
      evidence: 'SECRET_EVIDENCE',
      where: 'SECRET_WHERE',
      confidence: 'Definitely malicious',
      severity: 'Catastrophic',
      why: 'SECRET_WHY',
      outcome: 'SECRET_OUTCOME',
      blocked: true,
    },
  }, { tab: { id: 82, url: 'https://clickfix.example/' } });
  assert(!/SECRET|Definitely|Catastrophic/.test(JSON.stringify(forged)),
    'forgeable ClickFix detail crossed into local history');
  assert.strictEqual(forged.detail.instruction, 'Command-paste guidance');
  assert.strictEqual(forged.detail.confidence, 'Very high');
  assert.strictEqual(forged.detail.severity, 'High');
  assert.strictEqual(forged.detail.outcome, 'Suspicious clipboard write was blocked.');

  const warning = normalize({
    type: 'warned_clickfix_clipboard',
    detail: { instruction: 'No matching page instruction', blocked: false },
  }, { tab: { id: 83, url: 'https://copy.example/' } });
  const blocked = normalize({
    type: 'warned_clickfix_clipboard',
    detail: { instruction: 'No matching page instruction', blocked: true },
  }, { tab: { id: 83, url: 'https://copy.example/' } });
  assert.strictEqual(warning.log, true);
  assert.strictEqual(blocked.log, true, 'a later blocked upgrade was hidden by warning dedupe');
  console.log('ok - ClickFix events are rebuilt from enums and blocked upgrades remain visible');
}

assert(/type === 'behavioral_risk'/.test(bridge)
  && /warned_clickfix_/.test(bridge)
  && /wo-security-event[^\n]*12/.test(bridge),
'behavioral/XSS signals are not routed through the bounded security-event bridge bucket');
assert(!/else if \(tabHost && msg\.type === 'behavioral_risk'\)/.test(background),
  'page-forgeable behavioral events can still auto-learn a blocking rule');
console.log('ok - bridge routing cannot turn page claims into learned blocking');

{
  const learnedSandbox = {
    X_APP_COMPAT_DOMAINS: new Set(),
    normalizeAllowlistHost(value) { return String(value || '').toLowerCase().replace(/^www\./, ''); },
    registrableDomainBg(value) {
      const parts = String(value || '').split('.').filter(Boolean);
      return parts.length > 1 ? parts.slice(-2).join('.') : parts[0] || '';
    },
    isNeverBlockDomain(value) {
      return /^github(?:-[a-z0-9]+)*\.s3\.amazonaws\.com$/i.test(String(value || ''));
    },
  };
  vm.createContext(learnedSandbox);
  const policyStart = background.indexOf('function normalizeLearnedDomain(value)');
  const policyEnd = background.indexOf('function loadLearned()', policyStart);
  vm.runInContext(background.slice(policyStart, policyEnd)
    + '\nthis.__normalizeLearnedDomain=normalizeLearnedDomain;', learnedSandbox);
  const normalizeLearned = learnedSandbox.__normalizeLearnedDomain;
  assert.strictEqual(normalizeLearned('github-cloud.s3.amazonaws.com'), '');
  assert.strictEqual(normalizeLearned('github-user-attachments.s3.amazonaws.com'), '');
  assert.strictEqual(normalizeLearned('ordinary-tenant.s3.amazonaws.com'),
    'ordinary-tenant.s3.amazonaws.com', 'shared S3 tenant collapsed into amazonaws.com');
  console.log('ok - GitHub upload hosts and shared S3 tenants cannot become broad learned blocks');
}

console.log('\nXSS event-boundary checks passed.');
