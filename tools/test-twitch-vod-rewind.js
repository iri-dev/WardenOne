// Pure-logic tests for twitch-vod-rewind.js (channel parsing, VOD selection,
// seek-offset math, URL building). No network, no DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const vodr = require(path.join('..', 'twitch-vod-rewind.js'));

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; console.log('[ok] ' + name); }
  else { failures.push(name); console.error('[FAIL] ' + name); }
}
function eq(name, actual, expected) { check(name + ' (=> ' + JSON.stringify(actual) + ')', actual === expected); }

// --- parseChannelLogin ---
eq('login: /shroud', vodr.parseChannelLogin('/shroud'), 'shroud');
eq('login: /Shroud lowercased', vodr.parseChannelLogin('/Shroud'), 'shroud');
eq('login: /some_user/about', vodr.parseChannelLogin('/some_user/about'), 'some_user');
eq('login: trailing slash', vodr.parseChannelLogin('/pokimane/'), 'pokimane');
eq('login: root is null', vodr.parseChannelLogin('/'), null);
eq('login: empty string null', vodr.parseChannelLogin(''), null);
eq('login: /directory null', vodr.parseChannelLogin('/directory/game/Slots'), null);
eq('login: /videos/123 null', vodr.parseChannelLogin('/videos/123456789'), null);
eq('login: /settings null', vodr.parseChannelLogin('/settings/profile'), null);
eq('login: /u null', vodr.parseChannelLogin('/u/whoever'), null);
eq('login: bad chars null', vodr.parseChannelLogin('/na-me!'), null);
eq('login: too long null', vodr.parseChannelLogin('/' + 'a'.repeat(26)), null);
eq('login: non-string null', vodr.parseChannelLogin(null), null);

// --- formatVodTime ---
eq('time: 0', vodr.formatVodTime(0), '0h0m0s');
eq('time: 90', vodr.formatVodTime(90), '0h1m30s');
eq('time: 3661', vodr.formatVodTime(3661), '1h1m1s');
eq('time: negative clamps', vodr.formatVodTime(-500), '0h0m0s');
eq('time: floors fractions', vodr.formatVodTime(59.9), '0h0m59s');
eq('time: NaN -> zero', vodr.formatVodTime('x'), '0h0m0s');

// --- isoDiffSeconds ---
check('diff: equal', vodr.isoDiffSeconds('2026-07-24T10:00:00Z', '2026-07-24T10:00:00Z') === 0);
check('diff: 5 min', vodr.isoDiffSeconds('2026-07-24T10:00:00Z', '2026-07-24T10:05:00Z') === 300);
check('diff: unparseable -> Infinity', vodr.isoDiffSeconds('nope', '2026-07-24T10:00:00Z') === Infinity);

// --- pickLiveVod ---
const now = '2026-07-24T12:00:00Z';
function resp(over) {
  return { user: Object.assign({
    id: '1', login: 'x',
    stream: { id: 's1', createdAt: now },
    videos: { edges: [{ node: { id: 'v123', lengthSeconds: 5400, createdAt: now } }] }
  }, over) };
}
(function () {
  const r = vodr.pickLiveVod(resp());
  check('vod: available when live + matching archive', r.available === true);
  eq('vod: id', r.id, 'v123');
  eq('vod: lengthSeconds', r.lengthSeconds, 5400);
})();
check('vod: offline -> unavailable', vodr.pickLiveVod(resp({ stream: null })).available === false);
eq('vod: offline reason', vodr.pickLiveVod(resp({ stream: null })).reason, 'offline');
check('vod: no edges -> unavailable', vodr.pickLiveVod(resp({ videos: { edges: [] } })).available === false);
eq('vod: no-vod reason', vodr.pickLiveVod(resp({ videos: { edges: [] } })).reason, 'no-vod');
check('vod: missing user -> unavailable', vodr.pickLiveVod({}).available === false);
(function () {
  // Newest archive is from a broadcast 3 days ago => streamer isn't saving this one.
  const stale = resp({ videos: { edges: [{ node: { id: 'old', lengthSeconds: 100, createdAt: '2026-07-21T12:00:00Z' } }] } });
  const r = vodr.pickLiveVod(stale);
  check('vod: stale archive -> unavailable', r.available === false);
  eq('vod: stale reason', r.reason, 'stale-vod');
})();
(function () {
  // Archive 3 min after stream start is within tolerance => still the live VOD.
  const close = resp({
    stream: { id: 's1', createdAt: '2026-07-24T12:00:00Z' },
    videos: { edges: [{ node: { id: 'v9', lengthSeconds: 200, createdAt: '2026-07-24T12:03:00Z' } }] }
  });
  check('vod: within tolerance available', vodr.pickLiveVod(close).available === true);
})();

// --- computeSeekSeconds ---
const V = { lengthSeconds: 5400 }; // joined 90 min in
eq('seek: join = joinLen - lead', vodr.computeSeekSeconds('join', V, 0), 5310);
eq('seek: join clamps at 0', vodr.computeSeekSeconds('join', { lengthSeconds: 30 }, 0), 0);
eq('seek: start = 0', vodr.computeSeekSeconds('start', V, 999), 0);
eq('seek: back30 from live edge', vodr.computeSeekSeconds('back30', V, 600), (5400 + 600) - 1800);
eq('seek: back10 from live edge', vodr.computeSeekSeconds('back10', V, 600), (5400 + 600) - 600);
eq('seek: back60 clamps at 0', vodr.computeSeekSeconds('back60', { lengthSeconds: 100 }, 0), 0);
eq('seek: unknown kind -> join behavior', vodr.computeSeekSeconds('???', V, 0), 5310);

// --- vodUrl ---
eq('url: builds VOD link with time', vodr.vodUrl('v123', 5310), 'https://www.twitch.tv/videos/v123?t=1h28m30s');
eq('url: encodes id', vodr.vodUrl('a/b', 0), 'https://www.twitch.tv/videos/a%2Fb?t=0h0m0s');

function deferred() {
  var resolve, reject;
  var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
  return { promise: promise, resolve: resolve, reject: reject };
}

function runtimeHarness(initialPath) {
  var source = fs.readFileSync(path.join(__dirname, '..', 'twitch-vod-rewind.js'), 'utf8');
  var now = 1000;
  var intervalCallback = null;
  var nextTimer = 1;
  var timers = new Map();
  var requests = [];
  var location = { pathname: initialPath || '/alpha' };
  var fakeWindow = {};
  fakeWindow.top = fakeWindow;
  fakeWindow.addEventListener = function () {};
  class FakeDate extends Date { static now() { return now; } }

  var document = {
    body: { appendChild: function () {} },
    documentElement: { appendChild: function () {} },
    querySelector: function () { return null; },
    addEventListener: function () {},
    removeEventListener: function () {},
    createElement: function () {
      return {
        classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
        appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {},
        click: function () {}, parentNode: null
      };
    },
    createElementNS: function () { return { setAttribute: function () {}, appendChild: function () {} }; }
  };

  function controlledFetch(_url, init) {
    var gate = deferred();
    var body = JSON.parse(init.body);
    var request = {
      login: body.variables.login,
      signal: init.signal,
      reject: gate.reject,
      resolveJson: function (json, status) {
        var code = status == null ? 200 : status;
        gate.resolve({
          ok: code >= 200 && code < 300,
          status: code,
          json: function () { return Promise.resolve(json); }
        });
      }
    };
    requests.push(request);
    if (init.signal && typeof init.signal.addEventListener === 'function') {
      init.signal.addEventListener('abort', function () {
        var error = new Error('aborted');
        error.name = 'AbortError';
        gate.reject(error);
      }, { once: true });
    }
    return gate.promise;
  }

  var context = {
    window: fakeWindow,
    location: location,
    document: document,
    fetch: controlledFetch,
    AbortController: AbortController,
    Date: FakeDate,
    JSON: JSON,
    Promise: Promise,
    Map: Map,
    console: { info: function () {} },
    setTimeout: function (callback, delay) {
      var id = nextTimer++;
      timers.set(id, { callback: callback, delay: delay });
      return id;
    },
    clearTimeout: function (id) { timers.delete(id); },
    setInterval: function (callback) { intervalCallback = callback; return 1; },
    clearInterval: function () {},
    chrome: {
      storage: {
        local: { get: function (_key, callback) {
          callback({ wardenone_config: { enabled: true, twitchVodRewind: true } });
        } },
        onChanged: { addListener: function () {} }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'twitch-vod-rewind.js:runtime' });

  return {
    requests: requests,
    scan: function () { intervalCallback(); },
    navigate: function (pathname) { location.pathname = pathname; intervalCallback(); },
    advance: function (milliseconds) { now += milliseconds; },
    timers: timers
  };
}

function flushAsync() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

async function runtimeRaceTests() {
  var nav = runtimeHarness('/alpha');
  eq('runtime: initial channel starts one request', nav.requests.length, 1);
  eq('runtime: initial request is for alpha', nav.requests[0].login, 'alpha');
  nav.navigate('/beta');
  eq('runtime: navigation starts beta immediately', nav.requests.length, 2);
  eq('runtime: replacement request is for beta', nav.requests[1].login, 'beta');
  check('runtime: navigation aborts alpha', nav.requests[0].signal.aborted === true);
  nav.requests[1].resolveJson({ data: { user: { stream: null } } });
  await flushAsync();

  var retry = runtimeHarness('/retryme');
  retry.requests[0].reject(new Error('temporary network failure'));
  await flushAsync();
  retry.scan();
  eq('runtime: transient failure does not tight-loop', retry.requests.length, 1);
  retry.advance(14999);
  retry.scan();
  eq('runtime: retry waits for the backoff', retry.requests.length, 1);
  retry.advance(1);
  retry.scan();
  eq('runtime: transient failure retries after backoff', retry.requests.length, 2);
  eq('runtime: retry stays on the current channel', retry.requests[1].login, 'retryme');
  retry.requests[1].resolveJson({ data: { user: { stream: null } } });
  await flushAsync();
}

runtimeRaceTests().then(function () {
  console.log('\n' + passed + ' checks passed, ' + failures.length + ' failed.');
  if (failures.length) process.exit(1);
}).catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
