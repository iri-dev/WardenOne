/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
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

// ---------------------------------------------------------------------------
// The heuristic half: what the gate decides when a host is NOT on the list.
//
// Reported from live use: searching for an explicit word put the gate on the search results page,
// before going anywhere. The title check was worth the whole threshold on its own, so any page
// whose TITLE carried one of those words was gated -- and a results page is titled with whatever
// was typed into the box.
//
// The real scoring block is lifted out of src/content.js and run against hostname/title pairs, so
// this measures the shipped decision rather than a restatement of it.
const SRC = fs.readFileSync('src/content.js', 'utf8');

/* Which hosts count as a results page is declared once, near the top of the runtime, and the
   page-text detectors read the same list. Lifted from the source like the scoring block, so the
   list tested is the list shipped. */
const SEARCH_RESULTS_HOST = (() => {
  const at = SRC.indexOf('searchResultsHost=/');
  const end = SRC.indexOf('.test(location.hostname)', at);
  if (at < 0 || end <= at) throw new Error('search-results host list not found');
  return vm.runInNewContext(SRC.slice(at + 'searchResultsHost='.length, end));
})();

/* The domain scoring and the document_start veil decision are top-level, before the runtime starts. */
const HOST_SCORE_SRC = (() => {
  const at = SRC.indexOf('  const __woAdultHostScore=');
  const end = SRC.indexOf('\n  const __woAdultVeil=(', at);
  if (at < 0 || end <= at) throw new Error('adult host scoring source markers not found');
  return SRC.slice(at, end);
})();

function decide(hostname, title, onResults) {
  const from = SRC.indexOf('      if(WO.adultHeuristics&&!onList){');
  const to = SRC.indexOf('\n      let adultReaskForceHeuristic', from);
  if (from < 0 || to <= from) throw new Error('adult heuristic source markers not found');
  const body = SRC.slice(SRC.indexOf('{', from) + 1, to).replace(/\}\s*$/, '');
  const sandbox = {
    WO: { adultHeuristics: true, __adultGateShown: false },
    onList: false,
    here: String(hostname).replace(/^www\./, ''),
    heuristicHit: false,
    heuristicReasons: [],
    location: { hostname },
    searchResultsHost: onResults === undefined ? SEARCH_RESULTS_HOST.test(hostname) : !!onResults,
    document: { title },
    maybeGateAdult() { sandbox.heuristicHit = true; },   // the deferred path gates too
    woOn(_target, _type, fn) { sandbox.__deferred = fn; },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext('const ADULT_DOMAINS=[];' + HOST_SCORE_SRC + 'let heuristicHit=false;const heuristicReasons=[];' + body
    + '\nthis.__hit = heuristicHit; this.__run = () => { if (this.__deferred) this.__deferred(); };',
  sandbox, { filename: 'src/content.js' });
  if (sandbox.__hit) return true;
  sandbox.__run();                       // whatever DOMContentLoaded would have done
  return !!sandbox.__hit || !!sandbox.heuristicHit;
}

check('a search results page is never gated, whatever was searched for', () => {
  [
    ['www.google.com', 'porn - Google Search'],
    ['www.google.co.uk', 'free porn videos - Google Search'],
    ['duckduckgo.com', 'xxx at DuckDuckGo'],
    ['search.brave.com', 'nsfw - Brave Search'],
    ['www.bing.com', 'hentai - Bing'],
  ].forEach(([host, title]) => assert(!decide(host, title), host + ' should not gate a results page'));
});

check('a results page stays exempt even when its own domain scores', () => {
  // Constructed to reach the exemption rather than to describe a real deployment: the TLD rule
  // scores any host ending in .cam, so a search engine on such a TLD would otherwise clear the
  // bar with an explicit query in its title. This is the case that makes the exemption
  // load-bearing rather than a second way of saying "the title cannot decide alone". The list
  // holds exact engine hosts now, and google.cam is not one, so the exemption is handed in.
  assert(decide('google.cam', 'porn - Google Search', false), 'the control did not score, so the exemption is not exercised');
  assert(!decide('google.cam', 'porn - Google Search', true), 'a results page must never be gated');
});

check('a host that only starts with an engine\'s name is not a results page', () => {
  // The gate's old copy of the list matched google\.[a-z.]+, so an adult site at google.<anything>
  // skipped the heuristic entirely.
  assert(decide('www.google.porn', 'home'), 'www.google.porn skipped the gate as a search engine');
  assert(decide('google.freeporn.example', 'home'), 'google.freeporn.example skipped the gate as a search engine');
});

check('an ordinary page is not gated just for its title', () => {
  [
    ['en.wikipedia.org', 'Pornography - Wikipedia'],
    ['www.bbc.co.uk', 'The porn industry, explained - BBC News'],
    ['www.reddit.com', 'nsfw thread : r/AskReddit'],
  ].forEach(([host, title]) => assert(!decide(host, title), host + ' should not gate on title alone'));
});

check('an explicit domain is still gated', () => {
  [
    ['xvideos.example', 'home'],
    ['some-hentai-site.example', 'home'],
    ['freeporn.example', 'home'],
  ].forEach(([host, title]) => assert(decide(host, title), host + ' should still gate'));
});

check('a suggestive domain plus an explicit title still reaches the bar together', () => {
  assert(decide('cam-girls.example', 'live cams'), 'corroborated signal should still gate');
});

check('a suggestive domain with an innocent title does not gate on its own', () => {
  // 'adult-' is a soft signal worth 1, nowhere near the bar by itself. (A domain containing
  // 'camgirl' is a STRONG term and does gate alone, which is why it is not the example here.)
  assert(!decide('adult-learning.example', 'Adult learning courses'), 'soft host alone should not gate');
});

/* 2026-10-31: the page painted for 50-140 ms before the card, because settings reach the page after the
   site starts drawing. A style from document_start hides it until the gate decides. */
{
  const box = { URL };
  vm.createContext(box);
  vm.runInContext('const ADULT_DOMAINS=' + JSON.stringify(domains) + ';' + HOST_SCORE_SRC + ';this.wanted=__woAdultVeilWanted;', box);
  const wanted = (host, ref = '', pending = false, rapid = false) => box.wanted(host, ref, pending, rapid);
  check('a listed or explicit adult domain is hidden from its first frame', () => {
    assert(wanted('chaturbate.com'), 'a typed visit to a listed site');
    assert(wanted('www.stripchat.com', 'https://www.google.com/'), 'a visit from another site');
    assert(wanted('xvideos.example'), 'an explicit term in an unlisted domain');
    assert(domains.every(d => wanted(d)), 'every listed domain');
  });
  check('the veil holds back only where the gate would ask', () => {
    assert(!wanted('chaturbate.com', 'https://chaturbate.com/tag/x'), 'moving around inside the site is not asked about');
    assert(!wanted('en.chaturbate.com', 'https://chaturbate.com/'), 'a subdomain of the same site');
    assert(!wanted('adult-learning.example'), 'a suggestive domain waits for its title instead');
    assert(!wanted('www.bbc.co.uk') && !wanted(''), 'ordinary pages');
  });
  /* 2026-10-31: the card went away untouched. The site moved to another of its pages behind the card, and the
     same-site referrer read as browsing a site the reader had accepted. */
  check('a site that moves itself behind an unanswered card is asked about again', () => {
    assert(wanted('chaturbate.com', 'https://chaturbate.com/', true), 'same-site arrival with the card unanswered');
    assert(!wanted('chaturbate.com', 'https://chaturbate.com/', false), 'same-site arrival after continuing');
    const gateIf = /if\(!0!==WO\.__adultGateAllowedThisPage&&!__woAdultResumed&&!__woAdultAccepted\(\)&&\(cameFromElsewhere\|\|!refHost\|\|__woAdultPending\(\)\|\|__woAdultVeil\.rapid\(\)\)\)/;
    assert(gateIf.test(SRC), 'the gate asks again while its card is unanswered, and over a reload loop');
    const mount = SRC.slice(SRC.indexOf('const stopAdultGate=mountBlocker('), SRC.indexOf('log("gated_adult_site"'));
    assert(/__woAdultSetPending\(!0\)/.test(mount), 'showing the card marks it unanswered');
    const go = SRC.slice(SRC.indexOf('"I\'m sure, continue"'), SRC.indexOf('"WardenOne asks before every adult site, so'));
    assert(/__woAdultSetPending\(!1\)/.test(go) && /resumeMedia\(\)/.test(go), 'only continue clears the mark and resumes media');
    const back = SRC.slice(SRC.indexOf('"<- Take me back"'), SRC.indexOf('"I\'m sure, continue"'));
    assert(!/__woAdultSetPending|resumeMedia/.test(back), 'going back leaves the mark and the media alone');
  });
  /* 2026-10-31: a cookie-starved site reloaded itself every second, and each reload rebuilt the card. */
  check('nothing more of the site loads while its card waits', () => {
    const veil = SRC.slice(SRC.indexOf('const __woAdultVeil=('), SRC.indexOf('let __woToken=null'));
    assert(/isReload\(\)&&stopLoad\(\)/.test(veil), 'a reload of a site the reader has not accepted is stopped at once');
    assert(/"reload"===nav\.type/.test(veil), 'only a reload, so a first visit still loads behind the card');
    assert(/now-prev<3000/.test(veil) && /__WO_ADULT_SEEN_KEY/.test(veil), 'loads seconds apart are measured, not inferred from the referrer');
    // A site that reloads itself hands in its own address as the referrer, so before this the loop read
    // as the reader browsing a site they had accepted, and nothing held it still.
    assert(wanted('chaturbate.com', 'https://chaturbate.com/', false, true), 'a rapid self-reload is still asked about');
    assert(!wanted('chaturbate.com', 'https://chaturbate.com/', false, false), 'an ordinary same-site load is not');
    assert(!wanted('www.bbc.co.uk', '', false, true), 'and only on an adult site');
    assert(/window\.stop\(\)/.test(veil), 'stopping the load is what holds the site still');
    const mount = SRC.slice(SRC.indexOf('const stopAdultGate=mountBlocker('), SRC.indexOf('log("gated_adult_site"'));
    assert(/__woAdultVeil\.stopLoad\(\)/.test(mount), 'showing the card stops the load it paused');
    const go = SRC.slice(SRC.indexOf('"I\'m sure, continue"'), SRC.indexOf('"WardenOne asks before every adult site, so'));
    assert(/__woAdultVeil\.stopped\(\)/.test(go) && /REAL\.reload\(\)/.test(go), 'continuing starts the page the card stopped');
    assert(/__WO_ADULT_OK_KEY/.test(go), 'and the answer is kept, so that reload is not gated again');
    assert(/!__woAdultResumed&&!__woAdultAccepted\(\)&&__woAdultVeilWanted\(/.test(SRC), 'an accepted site is not veiled again either');
  });

  check('the card never says the reader came from the site they are on', () => {
    const redirect = SRC.slice(SRC.indexOf('"redirect"===res.how'), SRC.indexOf('"chosen"===res.how'));
    assert(/cameFromElsewhere&&\(appendText\(msg,\s*" from "\)/.test(redirect), 'a same-site reload names no other site');
  });

  check('nothing plays behind the card', () => {
    const hold = SRC.slice(SRC.indexOf('let holdingMedia=!0;'), SRC.indexOf('const stopAdultGate=mountBlocker('));
    assert(/woOn\(document,"play",e=>holdMedia\(e\.target\),!0\)/.test(hold), 'media that starts later is paused');
    assert(/querySelectorAll\("video,audio"\)\.forEach\(holdMedia\)/.test(hold), 'media already playing is paused');
    const box2 = {}; vm.createContext(box2);
    vm.runInContext('let holdingMedia=true;const heldMedia=new Set;' + hold.slice(hold.indexOf('holdMedia=m=>'), hold.indexOf('woOn(document')).replace(/^holdMedia=/, 'var holdMedia=').replace(/,\s*resumeMedia=/, ';var resumeMedia=').replace(/;\s*$/, '') + ';this.hold=holdMedia;this.resume=resumeMedia;', box2);
    const media = (paused) => ({ tagName: 'VIDEO', paused, isConnected: true, pauses: 0, plays: 0, pause() { this.paused = true; this.pauses++; }, play() { this.paused = false; this.plays++; return Promise.resolve(); } });
    const playing = media(false); const stopped = media(true);
    box2.hold(playing); box2.hold(stopped); box2.hold({ tagName: 'DIV', paused: false });
    assert.strictEqual(playing.pauses, 1, 'playing video paused');
    assert.strictEqual(stopped.pauses, 0, 'a paused video is left alone');
    box2.resume();
    assert.strictEqual(playing.plays, 1, 'what the card paused plays again on continue');
    assert.strictEqual(stopped.plays, 0, 'what was never playing stays paused');
    const late = media(false); box2.hold(late);
    assert.strictEqual(late.pauses, 0, 'after continuing, nothing is held');
  });
  check('the veil goes up before the runtime and comes down after the gate decides', () => {
    const veil = SRC.indexOf('const __woAdultVeil=(');
    assert(veil > 0 && veil < SRC.indexOf('const __woStartRuntime='), 'the veil is applied at document_start, not when settings arrive');
    const gate = SRC.indexOf('(onList||heuristicHit)&&maybeGateAdult(');
    const release = SRC.indexOf('__woAdultVeil.release()', gate);
    assert(gate > 0 && release > gate && release < SRC.indexOf('---- hyperlink auditing', gate), 'the gate mounts its own blocker before the veil is released');
    assert(/__wardenOneReadyVersion===__WO_RUNTIME_VERSION\)return void __woAdultVeil\.release\(\)/.test(SRC), 'a second copy that stands down still lifts its own veil');
    const style = SRC.slice(veil, SRC.indexOf('let __woToken=null', veil));
    assert(/:not\(#rg-adult-gate\)/.test(style) && /buildOverlay\("rg-adult-gate"/.test(SRC), 'the card itself stays visible');
    assert(/\},\s*5000\)/.test(style) && /release\(\)/.test(style), 'the page is never hidden for good if the runtime fails');
    assert(/if\(stopped\)\{[\s\S]*__WO_ADULT_RESUME_KEY[\s\S]*location\.reload\(\)/.test(style),
      'and a page it stopped is started again rather than left blank');
  });
}

/* 2026-10-31: the card shows on every adult site and says whether a redirect brought the reader there. */
{
  const BG = fs.readFileSync('background.js', 'utf8');
  const fn = (name) => { const s = BG.indexOf('\nfunction ' + name + '('); return BG.slice(s, BG.indexOf('\n}\n', s) + 3); };
  const box = { URL };
  vm.runInNewContext('const TAB_ARRIVAL = Object.create(null);' + fn('noteTabArrival') + fn('tabArrivalKind')
    + 'this.note = noteTabArrival; this.kind = tabArrivalKind;', box);
  const url = 'https://stripchat.com/';
  const ask = (tabUrl = url, frameId = 0, documentId) => box.kind({ tab: { id: 7 }, frameId, url: tabUrl, documentId });
  const arrive = (transitionQualifiers) => box.note({ tabId: 7, url, transitionQualifiers });
  check('a typed address is a visit the reader chose, even when the site redirects it', () => {
    arrive(['from_address_bar', 'server_redirect']);
    assert.strictEqual(ask(), 'chosen');
  });
  check('a clicked link is a visit the reader chose', () => { arrive([]); assert.strictEqual(ask(), 'chosen'); });
  check('a script or server redirect from another page is named as a redirect', () => {
    arrive(['client_redirect']);
    assert.strictEqual(ask(), 'redirect');
    arrive(['server_redirect']);
    assert.strictEqual(ask(), 'redirect');
  });
  check('a single-page site that changes its path keeps its answer', () => {
    arrive([]);
    assert.strictEqual(ask('https://stripchat.com/girls'), 'chosen');
    box.note({ tabId: 7, url, documentId: 'doc-a', transitionQualifiers: ['client_redirect'] });
    assert.strictEqual(ask('https://stripchat.com/girls', 0, 'doc-a'), 'redirect');
    assert.strictEqual(ask(url, 0, 'doc-b'), 'unknown', 'a later document in the tab is not this one');
  });
  check('another page or a frame gets no answer about this one', () => {
    arrive(['client_redirect']);
    assert.strictEqual(ask('https://chaturbate.com/'), 'unknown');
    assert.strictEqual(ask(url, 3), 'unknown');
  });
  check('the bridge passes the read-only question and the card words both cases', () => {
    assert(/if \(msg\.kind === 'adult-arrival'\) return \{ kind: 'adult-arrival' \};/.test(fs.readFileSync('bridge.js', 'utf8')));
    const card = MIN.slice(MIN.indexOf('"Adult site ahead"'), MIN.indexOf('"WardenOne adult-site warning"'));
    assert(/kind:"adult-arrival"/.test(card), 'the card asks the worker how the tab arrived');
    assert(/A redirect brought you here/.test(card) && /You are opening an adult \(18\+\) site/.test(card), 'redirect and chosen wording');
  });
}

check('the pre-body adult gate waits for the real body and a painted frame before stopping Chromium', () => {
  const source = fs.readFileSync('src/content.js', 'utf8');
  const from = source.indexOf('const __woAdultVeil=(');
  const until = source.indexOf('let __woToken=null', from);
  assert(from >= 0 && until > from);
  for (const existing of [false, true]) {
    let stops = 0;
    const frames = [], observers = [];
    const body = existing ? { tagName: 'BODY', children: ['existing content'] } : null;
    const doc = { body, documentElement: {} };
    const box = { document: doc, location: { hostname: 'chaturbate.com' },
      window: { stop() { assert(doc.body, 'a body exists before native stop'); stops++; } },
      __woAdultHost: () => false, __woAdultResumed: true, __woAdultAccepted: () => false, __woConfigStore: {},
      requestAnimationFrame: callback => frames.push(callback),
      __woObserver(callback) { const observer = { callback, observe() {}, disconnect() {} }; observers.push(observer); return observer; } };
    vm.runInNewContext(source.slice(from, until) + ';__woAdultVeil.stopLoad();__woAdultVeil.stopLoad();', box);
    assert.equal(stops, 0, 'the parser must not stop synchronously');
    if (!existing) {
      assert.equal(doc.body, null, 'do not insert a synthetic body that could break page initialization');
      doc.body = { tagName: 'BODY' }; observers[0].callback();
    }
    frames.shift()(); assert.equal(stops, 0, 'give the warning a paint opportunity');
    frames.shift()();
    assert.equal(stops, 1);
    if (existing) assert.equal(doc.body, body);
  }
});

check('continuing, disabling the gate or its recovery timeout cancels a deferred parser stop', () => {
  const from = SRC.indexOf('const __woAdultVeil=('), until = SRC.indexOf('let __woToken=null', from);
  for (const reason of ['accepted', 'master off', 'gate off', 'timeout']) {
    let stops = 0, accepted = false, watchdog;
    const frames = [], config = {}, style = { remove() {} };
    const box = { document: { body: {}, documentElement: { appendChild() {} }, createElement: () => style },
      location: { hostname: 'chaturbate.com' }, window: { stop() { stops++; } },
      __woAdultHost: () => false, __woAdultResumed: false, __woAdultAccepted: () => accepted,
      __woAdultPending: () => false, __woAdultVeilWanted: () => true, __woConfigStore: config,
      requestAnimationFrame: callback => frames.push(callback),
      setTimeout(callback) { watchdog = callback; return 1; }, clearTimeout() {} };
    vm.runInNewContext(SRC.slice(from, until) + ';__woAdultVeil.stopLoad();', box);
    frames.shift()();
    if (reason === 'accepted') accepted = true;
    else if (reason === 'timeout') watchdog();
    else Object.assign(config, { __configReady: true, [reason === 'master off' ? 'enabled' : 'gateAdultSites']: false });
    frames.shift()();
    assert.equal(stops, 0, reason + ' must not strand a page that has already resumed');
  }
});

if (check.fail) {
  console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
  process.exit(1);
}
console.log('\n' + check.pass + ' passed, 0 failed');
