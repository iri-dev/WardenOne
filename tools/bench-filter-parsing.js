/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { performance, PerformanceObserver } = require('perf_hooks');
const { makeParser, sourceSnapshot } = require('./build-cosmetics.js');

const ROOT = path.resolve(__dirname, '..');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const outputHash = (value) => sha256(JSON.stringify(value));

function parseArgs(args) {
  const options = { runs: 3, out: null, cacheDir: null };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!['--runs', '--out', '--cache-dir'].includes(name) || !value || value.startsWith('--')) {
      throw new Error('usage: node tools/bench-filter-parsing.js [--runs 1..10] [--cache-dir path] [--out report.json]');
    }
    if (name === '--runs') {
      if (!/^(?:[1-9]|10)$/.test(value)) throw new Error('--runs must be 1..10');
      options.runs = Number(value);
    } else options[name === '--out' ? 'out' : 'cacheDir'] = path.resolve(value);
  }
  return options;
}

function loadCorpus(cacheDir) {
  const snapshot = sourceSnapshot();
  const sources = snapshot.sources.map((source) => {
    let text = source.text;
    if (cacheDir) {
      const name = crypto.createHash('sha1').update(source.url).digest('hex') + '.txt';
      text = fs.readFileSync(path.join(cacheDir, name), 'utf8');
      if (sha256(text) !== source.sha256) throw new Error('Full source hash mismatch: ' + source.url);
    }
    return { url: source.url, text, sha256: sha256(text), bytes: Buffer.byteLength(text) };
  });
  return { builtAt: snapshot.builtAt, sources };
}

function loadNetworkParser(background, timer = setTimeout) {
  const box = vm.createContext({ URL, setTimeout: timer });
  function region(from, to) {
    const start = background.indexOf(from), end = background.indexOf(to, start);
    if (start < 0 || end <= start) throw new Error('Missing parser region: ' + from);
    return background.slice(start, end);
  }
  vm.runInContext([
    fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8'),
    region('const NEVER_BLOCK_PUBLIC_SUFFIXES', 'function isNeverBlockDomain('),
    region('const UBO_TYPE_MAP', '\nfunction getListMeta('),
    'this.api = { parseList, parseListInSlices, parseNetworkRules, compileRemoteNetworkSource };',
  ].join('\n'), box, { filename: 'background.js:network-parser' });
  return box.api;
}

function countCosmetics(parsed) {
  const count = (buckets) => Object.values(buckets).reduce((sum, rows) => sum + rows.length, 0);
  return {
    generic: parsed.generic.length, specific: count(parsed.specific), exceptions: count(parsed.exceptions),
    genericHideExclusions: parsed.genericHideExclusions.length,
    procedural: count(parsed.procedural), scriptlets: count(parsed.scriptlets),
  };
}

function lineCoverage(sources, parse) {
  const counts = { records: 0, acceptedStandalone: 0, nonEmittingStandalone: 0 };
  for (const { text } of sources) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      counts.records++;
      if (Object.values(countCosmetics(parse(line))).some(Boolean)) counts.acceptedStandalone++;
      else counts.nonEmittingStandalone++;
    }
  }
  return counts;
}

function traceMetrics(stdout, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error('Invalid measurement boundaries');
  const events = stdout.split('\n').filter((line) => {
    const timestamp = /^\[[^\]]+\]\s+(\d+) ms:/.exec(line);
    return timestamp && /\bgc=/.test(line) && Number(timestamp[1]) >= startMs && Number(timestamp[1]) <= endMs;
  });
  let highWater = 0;
  for (const event of events) {
    const before = /\b(?:total_size_before|start_object_size)=(\d+)/.exec(event);
    const after = /\b(?:total_size_after|end_object_size)=(\d+)/.exec(event);
    if (!before || !after) throw new Error('Unrecognized V8 GC heap counters');
    highWater = Math.max(highWater, Number(before[1]), Number(after[1]));
  }
  return { tracedGcEvents: events.length, gcHeapHighWaterBytes: highWater };
}

async function worker(request) {
  if (typeof global.gc !== 'function') throw new Error('worker requires --expose-gc');
  const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const texts = loadCorpus(request.cacheDir).sources.map((source) => source.text);
  const cosmetics = makeParser(background).parseCosmeticFilters;
  const sliceTasks = [];
  let sliceStarted = 0;
  const network = loadNetworkParser(background, (callback, ms) => {
    sliceTasks.push(performance.now() - sliceStarted);
    return setTimeout(() => { sliceStarted = performance.now(); callback(); }, ms);
  });
  const limitMatch = /^const OPTION_RULES_PER_SOURCE_CAP = (\d+);/m.exec(background);
  if (!limitMatch) throw new Error('Missing per-source network rule cap');
  const execute = () => {
    if (request.kind === 'cosmetics') return cosmetics(request.joined ? texts.join('\n') : texts);
    if (request.kind === 'network') return texts.map((text) => network.parseNetworkRules(text, 0, Number(limitMatch[1])));
    if (request.kind === 'domains') return texts.map((text) => network.parseList(text));
    if (request.kind === 'domains-sliced') return (async () => {
      const results = [];
      for (const text of texts) results.push(await network.parseListInSlices(text));
      return results;
    })();
    throw new Error('Unknown workload');
  };
  let result = await execute();
  result = null;
  await new Promise(setImmediate);
  global.gc();
  await new Promise(setImmediate);
  const events = [];
  const observer = new PerformanceObserver((list) => events.push(...list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  const heapBeforeBytes = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const startUptimeMs = process.uptime() * 1000;
  const start = performance.now();
  sliceTasks.length = 0;
  sliceStarted = start;
  result = await execute();
  const end = performance.now();
  const endUptimeMs = process.uptime() * 1000;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAtReturnBytes = process.memoryUsage().heapUsed;
  if (request.kind === 'domains-sliced') sliceTasks.push(end - sliceStarted);
  await new Promise(setImmediate);
  events.push(...observer.takeRecords());
  observer.disconnect();
  global.gc();
  const retainedHeapBytes = process.memoryUsage().heapUsed - heapBeforeBytes;
  const gc = events.filter((entry) => entry.startTime >= start && entry.startTime < end);
  fs.writeSync(3, JSON.stringify({
    elapsedMs: end - start, cpuMs: (cpu.user + cpu.system) / 1000,
    startUptimeMs, endUptimeMs,
    heapBeforeBytes, heapAtReturnBytes, retainedHeapBytes,
    gcEvents: gc.length, gcDurationMs: gc.reduce((sum, entry) => sum + entry.duration, 0),
    gcKinds: gc.map((entry) => entry.detail.kind), outputSha256: outputHash(result),
    sliceCount: sliceTasks.length, longestSliceMs: sliceTasks.length ? Math.max(...sliceTasks) : null,
    counts: request.kind === 'cosmetics' ? countCosmetics(result) : { emitted: result.reduce((sum, rows) => sum + rows.length, 0) },
  }));
}

function runSample(request) {
  const child = spawnSync(process.execPath, ['--expose-gc', '--trace-gc-nvp', __filename, '--worker'], {
    cwd: ROOT, input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  if (child.status !== 0) throw new Error('Parser worker failed: ' + (child.error || child.stderr || child.stdout));
  if (!child.output[3]) throw new Error('Parser worker returned no result');
  const sample = JSON.parse(child.output[3]);
  const trace = traceMetrics(child.stdout, sample.startUptimeMs, sample.endUptimeMs);
  if (sample.gcEvents && !trace.tracedGcEvents) throw new Error('No GC heap counters in the measured window');
  return { ...sample, ...trace,
    observedPeakHeapBytes: Math.max(sample.heapBeforeBytes, sample.heapAtReturnBytes, trace.gcHeapHighWaterBytes),
  };
}

function summarize(samples) {
  const median = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return Object.fromEntries(['elapsedMs', 'cpuMs', 'retainedHeapBytes', 'observedPeakHeapBytes', 'gcEvents', 'gcDurationMs']
    .map((key) => [key, median(key)]));
}

async function main(options) {
  const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const parse = makeParser(background).parseCosmeticFilters;
  const packaged = JSON.parse(fs.readFileSync(path.join(ROOT, 'cosmetic-rules.json'), 'utf8'));
  const report = {
    node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0].model, backgroundSha256: sha256(background),
    toolSha256: sha256(fs.readFileSync(__filename)), runs: options.runs, corpora: [], measurements: [],
    notes: [
      'Offline source bytes are verified against the recorded snapshot; no feeds are fetched or rewritten.',
      'Isolated warmed Node processes; parser setup, input loading, coverage accounting and output hashing are outside timings.',
      'Observed peak is a lower bound from V8 GC counters and heap at return; transient peaks between observations may be missed. GC trace windows use millisecond process uptime.',
      'Retained heap excludes already-loaded inputs and includes one live result after forced GC. GC pause time is included in elapsed time.',
      'Standalone line acceptance ignores aggregate budgets and deduplication; non-emitting records include unsupported and other filter types.',
      'Network output is parser output at the runtime per-source cap, before source authority, merging, global budgets or native DNR validation.',
      'Sliced domain wall time includes Node timer waits. Longest slice includes parser work between yields, not browser responsiveness.',
    ],
  };
  for (const cacheDir of [null, ...(options.cacheDir ? [options.cacheDir] : [])]) {
    const corpus = loadCorpus(cacheDir);
    const texts = corpus.sources.map((source) => source.text);
    const parsed = parse(texts);
    if (outputHash(parsed) !== outputHash(parse(texts.join('\n')))) throw new Error('Chunked/combined cosmetic output differs');
    if (outputHash(parsed.scriptlets) !== outputHash(packaged.scriptlets)
        || outputHash(parsed.procedural) !== outputHash(packaged.procedural)) throw new Error('Packaged command output differs');
    const label = cacheDir ? 'full-cached-sources' : 'packaged-source-subset';
    report.corpora.push({ name: label, builtAt: corpus.builtAt,
      sources: corpus.sources.map(({ text, ...record }) => record),
      cosmeticLineCoverage: lineCoverage(corpus.sources, parse), cosmeticOutput: countCosmetics(parsed),
      cosmeticOutputSha256: outputHash(parsed), packagedCommandsMatch: true,
    });
    const workloads = [{ kind: 'cosmetics', joined: true }, { kind: 'cosmetics', joined: false }];
    if (cacheDir) workloads.push({ kind: 'domains' }, { kind: 'domains-sliced' }, { kind: 'network' });
    let domainsHash = null;
    for (const workload of workloads) {
      const samples = [];
      for (let i = 0; i < options.runs; i++) samples.push(runSample({ ...workload, cacheDir }));
      if (new Set(samples.map((sample) => sample.outputSha256)).size !== 1) throw new Error('Unstable parser output');
      if (workload.kind === 'cosmetics' && samples[0].outputSha256 !== outputHash(parsed)) throw new Error('Measured output differs');
      if (workload.kind === 'domains') domainsHash = samples[0].outputSha256;
      if (workload.kind === 'domains-sliced' && samples[0].outputSha256 !== domainsHash) throw new Error('Sliced domain output differs');
      report.measurements.push({ corpus: label, ...workload, summary: summarize(samples), samples });
      process.stderr.write(label + ' ' + workload.kind + (workload.kind === 'cosmetics' ? workload.joined ? ' joined' : ' chunks' : '') + ' complete\n');
    }
  }
  const text = JSON.stringify(report, null, 2) + '\n';
  if (options.out) { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, text); }
  else process.stdout.write(text);
  return report;
}

module.exports = { parseArgs, loadCorpus, loadNetworkParser, countCosmetics, lineCoverage, traceMetrics, runSample, summarize };
if (require.main === module) {
  const run = process.argv[2] === '--worker' ? () => worker(JSON.parse(fs.readFileSync(0, 'utf8'))) : () => main(parseArgs(process.argv.slice(2)));
  Promise.resolve().then(run).catch((error) => { console.error(error); process.exitCode = 1; });
}
