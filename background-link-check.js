/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

const MANUAL_LINK_REPORTS = new Map();
const MANUAL_LINK_REPORT_TTL_MS = 10 * 60 * 1000;
const MANUAL_LINK_CHECK_TIMEOUT_MS = 30000;

function manualLinkReportPurge() {
  for (const [id, record] of MANUAL_LINK_REPORTS) {
    if (Date.now() - record.at >= MANUAL_LINK_REPORT_TTL_MS) MANUAL_LINK_REPORTS.delete(id);
  }
}

function manualLinkEraseReports(site) {
  for (const [id, record] of MANUAL_LINK_REPORTS) {
    let source = '';
    try { source = new URL(record.model.page).hostname; } catch (_) {}
    if (!site || hostMatchesSite(record.model.host, site) || hostMatchesSite(source, site)) {
      record.raw = '';
      MANUAL_LINK_REPORTS.delete(id);
    }
  }
}

function manualLinkDisplayUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!/^https?:$/.test(url.protocol)) return '';
    url.username = ''; url.password = ''; url.hash = '';
    for (const name of [...url.searchParams.keys()]) url.searchParams.set(name, '[hidden]');
    return url.href.slice(0, 2048);
  } catch (_) { return ''; }
}

function manualLinkFacts(info, tab) {
  const raw = String(info?.linkUrl || info?.frameUrl || info?.pageUrl || tab?.url || tab?.pendingUrl || '').slice(0, 8193);
  const page = String(info?.pageUrl || tab?.url || tab?.pendingUrl || '');
  const model = {
    target: '', host: '', page: manualLinkDisplayUrl(page), frame: manualLinkDisplayUrl(info?.frameUrl),
    pageTitle: info?.pageUrl && tab?.url && info.pageUrl !== tab.url ? '' : String(tab?.title || '').slice(0, 160), selection: info?.linkUrl ? 'link' : 'page',
    relation: '', facts: [], checks: [], state: 'checking', summary: 'Checking this address…',
    note: 'The destination has not been opened and its files have not been downloaded or scanned.',
  };
  let url;
  try { if (raw.length > 8192) throw Error(); url = new URL(raw); } catch (_) {}
  if (!url || !/^https?:$/.test(url.protocol)) {
    model.state = 'unavailable'; model.summary = 'This is not a web link WardenOne can check.';
    model.note = 'Choose an HTTP or HTTPS link, or run the check on a normal web page.';
    return { raw: '', model };
  }
  model.target = manualLinkDisplayUrl(url.href); model.host = url.hostname;
  try {
    const source = new URL(info?.frameUrl || page);
    const same = sameSiteIdentity(source.hostname, url.hostname);
    model.relation = source.href.split('#')[0] === url.href.split('#')[0]
      ? 'This points to the page you are already viewing.'
      : same ? 'This stays on the same site as the page where you clicked.'
        : 'This leaves ' + source.hostname + ' and goes to ' + url.hostname + '.';
  } catch (_) { model.relation = 'Destination: ' + url.hostname + '.'; }
  const add = (level, title, detail) => model.facts.push({ level, title, detail });
  add(url.protocol === 'https:' ? 'info' : 'caution', url.protocol === 'https:' ? 'HTTPS address' : 'Unencrypted HTTP address',
    url.protocol === 'https:' ? 'HTTPS encrypts the connection. It does not verify the site’s claims or its downloads.'
      : 'This address does not request an encrypted connection. Avoid entering passwords or payment details.');
  if (url.username || url.password) add('caution', 'Credentials before the real hostname', 'The actual destination is ' + url.hostname + '. Text before @ is not the website’s name. Credentials are hidden in this report.');
  if (/(^|\.)xn--/i.test(url.hostname)) add('info', 'Internationalized domain name', 'The encoded hostname is shown above so you can check its exact spelling.');
  if (url.port) add('info', 'Uses port ' + url.port, 'A nonstandard port is part of this address; it does not establish whether the service is trustworthy.');
  if (url.search || url.hash) add('info', 'Private link details hidden', 'Query values, fragments and embedded credentials are omitted from the displayed addresses. Provider lookups use WardenOne’s existing URL minimization.');
  const file = url.pathname.split('/').pop() || '';
  if (/\.(exe|msi|msix|bat|cmd|ps1|scr|jar|apk|dmg|pkg|deb|rpm)$/i.test(file)) {
    add('caution', 'Appears to link to software', 'The filename ends in ' + file.split('.').pop().toLowerCase() + '. This address check cannot inspect or approve that file.');
  } else if (/\.(zip|7z|rar|iso|img|tar|gz)$/i.test(file)) {
    add('info', 'Appears to link to an archive or disk image', 'An address alone cannot reveal the contents. Use File Shield to inspect a file you choose to download.');
  }
  return { raw: url.href, model };
}

function manualLinkWithin(task, fallback, delay = MANUAL_LINK_CHECK_TIMEOUT_MS) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const failed = reason => finish(typeof fallback === 'function' ? fallback(reason) : fallback);
    const timer = setTimeout(() => failed('timeout'), delay);
    Promise.resolve().then(task).then(finish, () => failed('error'));
  });
}

function manualLinkSummary(model) {
  const rows = model.facts.concat(model.checks);
  if (rows.some(row => row.level === 'danger')) {
    model.state = 'danger'; model.summary = 'A known warning was found. Review it before opening this link.';
  } else if (rows.some(row => row.level === 'caution')) {
    model.state = 'caution'; model.summary = 'There are details worth checking before you continue.';
  } else if (model.checking) {
    model.state = 'checking'; model.summary = 'Checking this address… Completed results appear below.';
  } else if (rows.some(row => row.level === 'unavailable')) {
    model.state = 'partial'; model.summary = 'Some checks were unavailable. The address remains unverified.';
  } else {
    model.state = 'complete'; model.summary = 'No warning found in the checks that ran. This does not establish safety.';
  }
}

async function manualLinkLocalChecks(host) {
  const blocked = await locallyBlockedReputationHost(host);
  const domain = registrableDomainBg(host) || host;
  const matches = set => set.has(host) || set.has(domain);
  const rows = [];
  if (matches(GRABBER_PACKAGED_DOMAINS) || matches(GRABBER_FEED_DOMAINS)) rows.push({ level: 'danger', title: 'Known IP-logger domain', detail: 'Opening this destination can expose your IP address to whoever created the link.' });
  if (blocked === 'security' || matches(SECURITY_DOMAINS)) rows.push({ level: 'danger', title: 'Local malware or scam list match', detail: 'The destination matches a security rule loaded on this device.' });
  if (blocked === 'user') rows.push({ level: 'info', title: 'You blocked this site', detail: 'This is your saved decision, rather than an independent malware verdict.' });
  const learned = LEARNED[host] || LEARNED[domain];
  if (learned && !learned.userBlocked) rows.push({ level: 'caution', title: 'Previously blocked for suspicious behavior', detail: 'WardenOne retained a local behavior-based finding for this destination.' });
  if (!rows.length) rows.push(SECURITY_DOMAINS.size || GRABBER_PACKAGED_DOMAINS.size || GRABBER_FEED_DOMAINS.size
    ? { level: 'info', title: 'No local security-list match', detail: 'No match in the loaded local checks. New or unlisted threats can still be missed.' }
    : { level: 'unavailable', title: 'Local security lists are not ready', detail: 'No usable local security list was available for this check.' });
  return rows;
}

function manualLinkProviderRow(result) {
  const status = Number(result.status || 0);
  let failure = 'The service could not return a verdict. Check your connection and try again.';
  if (status === 401 || status === 403) failure = 'The service refused access. Check this provider’s API key and account access in Settings.';
  if (status === 429 || result.rateLimited) failure = 'The provider’s request limit was reached. Wait before trying again.';
  if (result.cloudflare) failure = 'The provider requires a browser challenge and cannot answer this background check.';
  if (status >= 500) failure = 'The provider is temporarily unavailable, including after an automatic retry.';
  return {
    level: result.ok === false ? 'unavailable' : result.hit ? 'danger' : result.warning ? 'caution' : 'info',
    title: String(result.provider || 'URL reputation').slice(0, 80),
    detail: result.ok === false ? failure
      : result.hit ? 'Flagged this destination' + (result.threats?.length ? ': ' + result.threats.slice(0, 4).map(value => String(value).replace(/_/g, ' ').slice(0, 50)).join(', ') : '.')
        : result.warning ? 'Returned a warning for this destination. Review its reputation before continuing.'
          : result.provider === 'WhoisXML API' ? 'Domain information returned. Domain age alone does not establish safety.'
            : 'No match reported in this check. Unlisted threats and harmful downloads can still be missed.',
    cached: result.cached === true,
  };
}

async function manualLinkReputation(raw, progress) {
  if (isLocalOrPrivateHost(new URL(raw).hostname)) return [{ level: 'unavailable', title: 'Private or local address', detail: 'This destination is not sent to external reputation services.' }];
  const state = await urlReputationConfig(true);
  if (!state.enabled) return [{ level: 'unavailable', title: state.cfg?.enabled === false ? 'External checks paused with WardenOne' : 'External reputation not configured',
    detail: state.cfg?.enabled === false ? 'WardenOne is switched off. Local address and security-list checks still run for this requested report.'
      : 'No available reputation provider is enabled. Local address and security-list checks still run.' }];
  let rows = [];
  const verdict = await urlReputationLookupUrl(normalizeSafeBrowsingUrl(raw), Object.assign({ context: 'manual', retryTransient: true,
    onStart: providers => {
      rows = providers.map(provider => ({ level: 'pending', title: provider, detail: 'Waiting for this provider…' }));
      if (progress) progress(rows.slice());
    },
    onResult: (result, index) => {
      rows[index] = manualLinkProviderRow(result);
      if (progress) progress(rows.slice());
    },
  }, state));
  if (!verdict || verdict.enabled === false) return [{ level: 'unavailable', title: 'No provider could check this address', detail: 'The enabled providers could not check this type of destination.' }];
  if (verdict.trusted) return [{ level: 'info', title: 'Covered by an existing compatibility policy', detail: 'No external verdict was requested for this address. A compatibility exception is not a safety certification.' }];
  const results = Array.isArray(verdict.results) && verdict.results.length ? verdict.results : [verdict];
  return results.slice(0, 10).map(manualLinkProviderRow);
}

async function manualLinkDomainAge(host, cfg) {
  const age = await lookupDomainAge(host, cfg);
  if (!age || !age.ok || !Number.isFinite(age.ageDays)) {
    let detail = 'The registration service could not be reached or returned an unusable response.';
    if (age?.unsupported) detail = 'Public registration data is not available for this type of address.';
    else if (age?.status === 429) detail = 'The registration service’s request limit was reached. Wait before trying again.';
    else if (age?.status === 404) detail = 'The registration service has no public record for this domain.';
    else if (age?.noDate) detail = 'The public registration record did not include a usable registration date.';
    else if (age?.status >= 500) detail = 'The registration service is temporarily unavailable, including after an automatic retry.';
    return [{ level: 'unavailable', title: 'Domain age unavailable', detail }];
  }
  const days = Math.max(0, Math.floor(age.ageDays));
  const created = /^\d{4}-\d{2}-\d{2}/.exec(String(age.created || ''))?.[0];
  return [{ level: days < 60 ? 'caution' : 'info', title: 'Domain registered ' + days.toLocaleString() + ' day' + (days === 1 ? '' : 's') + ' ago',
    detail: (created ? 'Registration date: ' + created + '. ' : '') + (days < 60 ? 'This is a recently registered domain; new legitimate sites and short-lived scams can look alike.' : 'An older domain can still host harmful content.'), cached: age.cached === true }];
}

async function manualLinkRun(record) {
  if (record.running || !record.raw) return;
  record.running = true;
  const model = record.model;
  model.checking = true;
  model.state = 'checking'; model.summary = 'Checking this address…';
  const pending = [
    { level: 'pending', title: 'Local security lists', detail: 'Checking rules already on this device…' },
    { level: 'pending', title: 'External reputation', detail: 'Checking the available providers…' },
    { level: 'pending', title: 'Domain registration', detail: 'Looking up the registration date…' },
  ];
  const groups = pending.map(row => [row]);
  const refresh = () => { model.checks = groups.flat(); manualLinkSummary(model); };
  refresh();
  const config = manualLinkWithin(async () => (await localGet('wardenone_config'))?.wardenone_config || {}, {});
  const work = [() => manualLinkLocalChecks(model.host), progress => manualLinkReputation(record.raw, progress),
    async () => manualLinkDomainAge(model.host, Object.assign({}, DEFAULT_CONFIG, await config))];
  await Promise.all(work.map(async (task, index) => {
    let active = true;
    groups[index] = await manualLinkWithin(() => task(rows => {
      if (active && record.raw) { groups[index] = rows; refresh(); }
    }), reason => groups[index].map(row => row.level !== 'pending' ? row : {
      level: 'unavailable', title: row.title + ' unavailable',
      detail: reason === 'timeout' ? 'This check did not finish within thirty seconds. Other completed results are kept. You can try again.'
        : 'This check could not finish. Other completed results are kept. Check your connection and try again.',
    }));
    active = false;
    refresh();
  }));
  model.checking = false;
  manualLinkSummary(model); record.running = false;
}

async function runWardenLinkCheck(info, tab) {
  manualLinkReportPurge();
  while (MANUAL_LINK_REPORTS.size >= 20) MANUAL_LINK_REPORTS.delete(MANUAL_LINK_REPORTS.keys().next().value);
  const { raw, model } = manualLinkFacts(info, tab);
  const id = crypto.randomUUID();
  const record = { id, raw, model, at: Date.now(), viewTabId: null, sourceTabId: tab?.id, running: false, runs: 1 };
  MANUAL_LINK_REPORTS.set(id, record);
  try {
    const options = { url: chrome.runtime.getURL('link-check.html') + '?id=' + encodeURIComponent(id), active: true };
    if (Number.isInteger(tab?.windowId)) options.windowId = tab.windowId;
    const view = await chrome.tabs.create(options);
    record.viewTabId = view.id;
    await manualLinkRun(record);
  } catch (_) {
    MANUAL_LINK_REPORTS.delete(id);
    await wardenManualNotice('Link check could not open', 'WardenOne could not open its result tab. Please try the link check again.', tab);
  }
}

function manualLinkRecord(id, sender) {
  if (!messageSenderIsExtensionPath(sender, 'link-check.html') || sender.frameId !== 0 || typeof id !== 'string'
      || !/^[a-f0-9-]{36}$/.test(id)) return null;
  try { if (new URL(sender.url).searchParams.get('id') !== id) return null; } catch (_) { return null; }
  manualLinkReportPurge();
  const record = MANUAL_LINK_REPORTS.get(id);
  return record && sender.tab?.id === record.viewTabId ? record : null;
}

function manualLinkCheckRead(id, sender, retry) {
  const record = manualLinkRecord(id, sender);
  if (!record) return { ok: false, error: 'This check expired or was interrupted when WardenOne restarted. Run Check this link again from the original page.' };
  if (retry && !record.running && record.raw) {
    if (record.runs >= 4) return { ok: false, error: 'This report has reached its retry limit. Start a new check from the original link.' };
    record.runs++; void manualLinkRun(record);
  }
  return { ok: true, id: record.id, sourceTabId: record.sourceTabId, report: record.model };
}
