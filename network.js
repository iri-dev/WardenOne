/* Warden One — DNS filtering verification.
 *
 * How the test works: most family/security DNS filters block known adult or
 * malware test domains by refusing to resolve them (the request fails fast or
 * returns a block page). We attempt to load a tiny resource from a domain that
 * filters commonly block. If the request fails to resolve/connect, filtering is
 * likely active; if it connects normally, it's likely NOT being filtered.
 *
 * This is a heuristic, not proof -- network errors can have other causes -- so
 * the result is worded as "likely", and we test a couple of domains.
 */

// Test domains: well-known adult sites that family DNS filters block. We only
// no-cors HEAD-style probes, never rendered. We test ACROSS categories so the
// result can say WHICH kind of filtering is active, and use TWO controls to be
// sure the network itself is up before interpreting a "blocked".
const TESTS = {
  adult: ['https://www.pornhub.com/favicon.ico', 'https://xvideos.com/favicon.ico'],
  // domains that malware/phishing filters (Quad9, CleanBrowsing, NextDNS) block.
  // testsafebrowsing is Google's own test host; the others are long-known bad.
  malware: ['https://testsafebrowsing.appspot.com/favicon.ico'],
};
const CONTROLS = ['https://www.google.com/favicon.ico', 'https://www.cloudflare.com/favicon.ico'];

function probe(url, timeoutMs) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => { ctrl.abort(); resolve('timeout'); }, timeoutMs || 5000);
    fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
      .then(() => { clearTimeout(t); resolve('reachable'); })
      .catch(() => { clearTimeout(t); resolve('blocked'); });
  });
}

async function probeAll(list) {
  const r = await Promise.all(list.map((u) => probe(u, 5000)));
  return { blocked: r.filter((x) => x === 'blocked' || x === 'timeout').length, total: r.length };
}

async function runTest() {
  const btn = document.getElementById('run');
  const res = document.getElementById('result');
  btn.disabled = true; btn.textContent = 'Testing…';
  res.className = 'result'; res.classList.remove('show');

  // Confirm the network is up first: BOTH controls must be reachable, else we
  // can't tell "filtering" apart from "connection problem".
  const ctrl = await probeAll(CONTROLS);
  if (ctrl.blocked > 0) {
    res.textContent = 'Could not reach control sites — check your internet connection and try again. (The test needs a working connection to tell filtering apart from no connection.)';
    res.className = 'result err show';
    btn.disabled = false; btn.textContent = 'Test my DNS filtering';
    return;
  }

  const adult = await probeAll(TESTS.adult);
  const malware = await probeAll(TESTS.malware);
  btn.disabled = false; btn.textContent = 'Test again';

  const adultBlocked = adult.blocked === adult.total;
  const adultPartial = adult.blocked > 0 && !adultBlocked;
  const malwareBlocked = malware.blocked === malware.total;

  let lines = [];
  lines.push(adultBlocked ? 'Adult content: filtering looks ACTIVE'
        : adultPartial ? 'Adult content: partially filtered'
        : 'Adult content: not filtered');
  lines.push(malwareBlocked ? 'Malware/phishing test domain: blocked'
        : 'Malware/phishing test domain: reachable');

  const anyOn = adultBlocked || adultPartial || malwareBlocked;
  const allOn = adultBlocked && malwareBlocked;

  res.textContent = '';
  const title = document.createElement('b');
  title.textContent = 'Result';
  res.appendChild(title);
  lines.forEach((line) => {
    res.appendChild(document.createElement('br'));
    res.appendChild(document.createTextNode(line));
  });
  res.appendChild(document.createElement('br'));
  res.appendChild(document.createElement('br'));
  const note = document.createElement('span');
  note.style.fontSize = '11px';
  note.style.opacity = '.85';
  note.textContent = (allOn ? 'Both categories appear filtered on this device - good.'
    : anyOn ? 'Some filtering is active but not complete. If you expected full coverage, a browser "Secure DNS" (DoH) setting may be bypassing your network DNS, or the filter category is not enabled.'
    : 'No filtering detected on this device/browser. Follow Steps 1-2 to set a family/security DNS.')
    + ' This is a heuristic, not proof: filters that return a block page (rather than refusing to resolve) can read as "reachable", and a VPN or browser Secure DNS changes results.';
  res.appendChild(note);
  res.className = 'result ' + (allOn ? 'on' : anyOn ? 'off' : 'off') + ' show';
}

document.getElementById('run').addEventListener('click', runTest);
document.getElementById('back').addEventListener('click', (e) => {
  e.preventDefault();
  location.href = chrome.runtime.getURL('history.html');
});
