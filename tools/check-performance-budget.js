/* Stable package footprint limits; browser timing stays in tools/perf-profile.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { stagedZip } = require('./check-package-archive.js');
const { zipFiles } = require('./build-store-candidate.js');

const ROOT = path.resolve(__dirname, '..');
const BUDGET = path.join(ROOT, 'docs', 'perf', 'static-budget.json');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed');
  return result.stdout.trim();
}

function summarizeMetrics(zipBytes, files, manifest, ruleCount) {
  const scripts = (manifest.content_scripts || []).flatMap((entry) => entry.js || []);
  const uniqueScripts = [...new Set(scripts)];
  const fileSize = (name) => {
    const file = files.get(name);
    if (!file) throw new Error('Package is missing ' + name);
    return file.size;
  };
  const rules = (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources || [])
    .filter((resource) => resource.enabled !== false);
  return {
    githubZipBytes: zipBytes,
    unpackedBytes: [...files.values()].reduce((total, file) => total + file.size, 0),
    staticDnrRules: rules.reduce((total, resource) => total + ruleCount(resource.path), 0),
    manifestScriptEntries: scripts.length,
    manifestScriptFiles: uniqueScripts.length,
    manifestScriptBytes: uniqueScripts.reduce((total, name) => total + fileSize(name), 0),
    workerSourceBytes: [...files].filter(([name]) => /^background(?:-[a-z0-9-]+)?\.js$/.test(name))
      .reduce((total, [, file]) => total + file.size, 0),
  };
}

function budgetFailures(metrics, limits) {
  return Object.entries(limits).filter(([name, maximum]) =>
    !Number.isSafeInteger(maximum) || maximum < 0 || !Number.isSafeInteger(metrics[name]) || metrics[name] > maximum)
    .map(([name, maximum]) => name + ': ' + metrics[name] + ' > ' + maximum);
}

function collect() {
  const tree = git(['write-tree']);
  const zip = stagedZip();
  const files = zipFiles(zip);
  const manifest = JSON.parse(git(['show', ':manifest.json']));
  const metrics = summarizeMetrics(zip.length, files, manifest, (name) => {
    const rules = JSON.parse(git(['show', ':' + name]));
    if (!Array.isArray(rules)) throw new Error(name + ' is not a rule array');
    return rules.length;
  });
  return { tree, metrics };
}

function check(argv = process.argv.slice(2)) {
  const measureOnly = argv.includes('--measure');
  const outAt = argv.indexOf('--out');
  if (argv.some((arg, index) => arg !== '--measure' && arg !== '--out'
    && !(outAt >= 0 && index === outAt + 1))) {
    throw new Error('Usage: node tools/check-performance-budget.js [--measure] [--out FILE]');
  }
  if (outAt >= 0 && !argv[outAt + 1]) throw new Error('--out needs a path');
  const result = collect();
  if (outAt >= 0) fs.writeFileSync(path.resolve(argv[outAt + 1]), JSON.stringify(result, null, 2) + '\n');
  console.log('Package footprint: ' + JSON.stringify(result.metrics));
  if (measureOnly) { console.log('Measurement only; budget not checked'); return result; }
  const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8'));
  const failures = budgetFailures(result.metrics, budget.maximum);
  if (failures.length) throw new Error('Performance budget exceeded: ' + failures.join('; '));
  console.log('Package footprint within reviewed limits');
  return result;
}

module.exports = { summarizeMetrics, budgetFailures, collect, check };
if (require.main === module) {
  try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
