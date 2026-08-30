/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Extension Security Centre. All extension-supplied strings are rendered with textContent. */
'use strict';

const $ = (id) => document.getElementById(id);
const centreState = { report: null, filter: 'all', query: '', busy: false };

function sendLocalMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) { reject(new Error(runtimeError.message || 'WardenOne service worker did not respond.')); return; }
        if (!response || response.ok === false) { reject(new Error((response && response.error) || 'The local operation failed.')); return; }
        resolve(response);
      });
    } catch (error) { reject(error); }
  });
}

function cleanError(error) {
  return String((error && error.message) || error || 'Unknown error').replace(/^Error:\s*/, '');
}

function setScanStatus(text, error) {
  const status = $('scan-status');
  const alert = $('scan-error');
  if (error) {
    status.classList.remove('show');
    alert.textContent = text;
    alert.classList.add('show');
  } else {
    alert.textContent = '';
    alert.classList.remove('show');
    status.textContent = text;
    status.classList.toggle('show', !!text);
  }
}

function formatAge(timestamp) {
  const time = Number(timestamp) || 0;
  if (!time) return 'time unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

function friendlyInstallType(type) {
  return ({
    normal: 'Normal Chrome installation',
    admin: 'Installed by administrator',
    development: 'Loaded unpacked (developer mode)',
    sideload: 'Sideloaded',
    other: 'Unclassified install source',
  })[type] || 'Install source unavailable';
}

function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function safeHttpsReference(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.href.length <= 2048 ? url.href : '';
  } catch (_) { return ''; }
}

function makeFact(text) {
  const fact = document.createElement('span');
  fact.className = 'fact';
  fact.textContent = text;
  return fact;
}

/* A count is not a finding. "1" under "Need attention" is a number; "1 can do
   something its kind normally doesn't" is the thing that decides whether anyone
   clicks. These lines are written from the actual assessments rather than from
   the counts, so they name what is there instead of restating the total. */
function summaryWhy(report) {
  const items = Array.isArray(report.extensions) ? report.extensions : [];
  const summary = report.summary || {};
  const count = (fn) => items.filter(fn).length;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  const unexpected = count((i) => i.verdict && i.verdict.code === 'unexpected_capability');
  const incidents = count((i) => i.reputation
    && ['known_harmful', 'reported_harmful', 'historical_incident'].indexOf(i.reputation.status) >= 0);
  const unknownPowerful = count((i) => i.verdict && i.verdict.code === 'powerful_access');
  const cataloguePowerful = count((i) => i.verdict && i.verdict.code === 'catalogued_powerful');
  const sourceMismatch = count((i) => i.verdict && i.verdict.code === 'identity_source_mismatch');
  const accessChanged = count((i) => i.verdict && i.verdict.code === 'access_changed');
  const unknown = Number(summary.unknown) || 0;
  const recognized = Number(summary.recognized) || 0;
  const verified = Number(summary.verifiedIdentities) || 0;
  const catalogued = Number(summary.catalogued) || 0;
  const disabled = count((i) => !i.enabled);

  const attention = [];
  if (incidents) attention.push(plural(incidents, 'has a documented incident', 'have documented incidents'));
  if (unexpected) attention.push(plural(unexpected, 'can do something its kind normally does not',
    'can do things their kind normally does not'));
  if (unknownPowerful) attention.push(plural(unknownPowerful, 'is unidentified and powerful', 'are unidentified and powerful'));
  if (cataloguePowerful) attention.push(plural(cataloguePowerful,
    'has only catalogue identity evidence for powerful access', 'have only catalogue identity evidence for powerful access'));
  if (sourceMismatch) attention.push(plural(sourceMismatch,
    'was loaded from a non-standard source', 'were loaded from non-standard sources'));
  if (accessChanged) attention.push(plural(accessChanged,
    'has an unreviewed access change', 'have unreviewed access changes'));
  const describedAttention = incidents + unexpected + unknownPowerful + cataloguePowerful + sourceMismatch + accessChanged;
  const otherAttention = Math.max(0, (Number(summary.attention) || 0) - describedAttention);
  if (otherAttention) attention.push(plural(otherAttention, 'needs an access decision', 'need access decisions'));

  return {
    'sum-installed': [verified ? verified + ' publisher-verified' : '', catalogued ? catalogued + ' catalogue-only' : '',
      unknown ? unknown + ' with no record' : ''].filter(Boolean).join(' · '),
    'sum-attention': attention.length ? attention.join('; ') : 'Nothing is asking anything of you',
    'sum-matches': incidents
      ? 'Evidence-backed, exact ID — worth acting on'
      : 'No installed extension matches a recorded incident',
    'sum-changed': (Number(summary.changed) || 0)
      ? 'Material access or install-source state moved since the last local snapshot'
      : 'Nothing has changed since the last snapshot',
    'sum-reviewed': (Number(summary.reviewed) || 0)
      ? 'Re-opens automatically if permissions change'
      : 'Marking one reviewed silences it until its access changes',
    disabled,
  };
}

function renderSummary(report) {
  const summary = report.summary || {};
  $('sum-installed').textContent = String(Number(summary.installed) || 0);
  $('sum-attention').textContent = String(Number(summary.attention) || 0);
  $('sum-matches').textContent = String((Number(summary.knownHarmful) || 0) + (Number(summary.reportedOrHistorical) || 0));
  $('sum-changed').textContent = String(Number(summary.changed) || 0);
  $('sum-reviewed').textContent = String(Number(summary.reviewed) || 0);
  $('ack-changes').disabled = (Number(summary.changed) || 0) === 0;

  const why = summaryWhy(report);
  ['sum-installed', 'sum-attention', 'sum-matches', 'sum-changed', 'sum-reviewed'].forEach((id) => {
    const element = $(id + '-why');
    if (element) element.textContent = why[id] || '';
  });

  const banner = $('health-banner');
  const title = $('health-title');
  const copy = $('health-copy');
  const mark = $('health-mark');
  const attention = Number(summary.attention) || 0;
  const incidents = (Number(summary.knownHarmful) || 0) + (Number(summary.reportedOrHistorical) || 0);
  banner.classList.toggle('danger', incidents > 0);
  banner.classList.toggle('warning', !incidents && attention > 0);
  title.textContent = incidents
    ? incidents + ' documented incident match' + (incidents === 1 ? '' : 'es')
    : (attention ? attention + ' decision' + (attention === 1 ? ' needs' : 's need') + ' you' : 'No action needed');
  mark.textContent = attention ? '!' : '✓';
  copy.textContent = attention
    ? why['sum-attention'] + '. Each item below says what changed and why it matters.'
    : ((Number(summary.recognized) || 0)
      ? (Number(summary.recognized) || 0) + ' verified extension' + ((Number(summary.recognized) || 0) === 1 ? '' : 's')
        + ' match their evidence-backed access contract. Changes continue to be watched locally.'
      : 'No incident, unexpected powerful capability, or unreviewed risky change was found.');

  const database = report.database || {};
  const dbCopy = $('db-copy');
  const facts = $('db-facts');
  facts.textContent = '';
  if (!database.available) {
    dbCopy.textContent = 'The bundled local database could not be validated. Permission and change analysis still works, but WardenOne will not imply that an empty match result is reassuring.';
    dbCopy.style.color = 'var(--danger)';
    facts.appendChild(makeFact('Database unavailable'));
    if (database.error) facts.appendChild(makeFact(database.error));
  } else {
    dbCopy.style.color = '';
    /* The long "what this can and cannot prove" panel at the bottom of the page
       is gone, but the honest part of it is not: Chrome will not let one
       extension read another's code or signature, so "no record" means nobody
       has written one down, not that it is safe. Said once, here, in a sentence,
       rather than in a block nobody reaches. */
    dbCopy.textContent = 'Exact extension IDs only — names, icons and publisher-looking text never establish identity. '
      + 'Chrome does not let WardenOne read another extension’s code or signature, so "no local record" means '
      + 'nothing is written down about it, not that it is safe.';
    facts.appendChild(makeFact('Dataset ' + (database.datasetVersion || 'version unknown')));
    facts.appendChild(makeFact((Number(database.verifiedIdentityRecordCount) || 0) + ' publisher-verified identities'));
    facts.appendChild(makeFact((Number(database.cataloguedListingRecordCount) || 0) + ' catalogue-only listings'));
    facts.appendChild(makeFact((Number(database.incidentRecordCount) || 0) + ' incident records'));
    facts.appendChild(makeFact((Number(database.capabilitySignatureCount) || 0) + ' capability signature(s)'));
    facts.appendChild(makeFact((Number(database.customRecordCount) || 0) + ' imported local record(s)'));
    if (database.generatedAt) facts.appendChild(makeFact('Reviewed data: ' + database.generatedAt.slice(0, 10)));
  }
}



function changeTitle(item) {
  const change = item.latestChange;
  if (!change) return 'No recorded change';
  return change.summary || 'Extension changed';
}

function changeDetail(item) {
  const change = item.latestChange;
  if (!change) return 'WardenOne will flag a version, access, source or state change.';
  return (change.reviewed ? 'Reviewed' : 'Unreviewed') + ' · ' + formatAge(change.when)
    + (change.fromVersion && change.toVersion && change.fromVersion !== change.toVersion
      ? ' · ' + change.fromVersion + ' → ' + change.toVersion : '');
}

function makeExtensionCard(item) {
  const card = document.createElement('article');
  card.className = 'extension-card tone-' + (item.verdict && item.verdict.tone || 'calm');
  card.dataset.extensionId = item.id;

  const top = document.createElement('div');
  top.className = 'card-top';
  const titleWrap = document.createElement('div');
  appendText(titleWrap, 'h3', item.name || '(unknown extension)', 'ext-name');
  appendText(titleWrap, 'div', 'Version ' + (item.version || 'unknown') + ' · '
    + friendlyInstallType(item.installType) + ' · ' + (item.enabled ? 'Enabled' : 'Disabled'), 'meta');
  appendText(titleWrap, 'div', 'ID ' + item.id, 'meta');
  top.appendChild(titleWrap);
  const verdictText = String(item.verdict && item.verdict.label || 'No known warning').toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
  const verdict = appendText(top, 'span', verdictText,
    'verdict ' + (item.verdict && item.verdict.tone || 'calm'));
  verdict.setAttribute('aria-label', 'Assessment: ' + verdict.textContent);
  card.appendChild(top);

  /* The answer first, in a sentence.
     This card used to open with three labelled rows -- Reputation, Access,
     Change -- and then a list of Chrome's permission strings. Every one of them
     was true and none of them was the point: it made the reader re-derive the
     conclusion the engine had already reached, and it read as alarming whatever
     it said, because "Access: CRITICAL" looks the same on a password manager
     doing its job as on something that should be uninstalled. */
  appendText(card, 'p', item.recommendedAction || item.reputation.label, 'ext-answer');

  /* Then what it can actually do, said plainly and framed by whether it is
     expected. The same capability is reassuring or alarming depending only on
     what the extension is, so the framing is the information. */
  const caps = item.capabilities || {};
  const expected = Array.isArray(caps.expected) ? caps.expected : [];
  const unexpected = Array.isArray(caps.unexpected) ? caps.unexpected : [];
  /* Compare by id, not by object identity: these arrays cross a sendMessage
     boundary and arrive as separate instances, so an identity check put every
     expected capability under 'Also has' as well and printed the whole list
     twice. */
  const claimed = new Set(expected.concat(unexpected).map((s) => s.id));
  const others = (item.access && Array.isArray(item.access.signatures) ? item.access.signatures : [])
    .filter((s) => !claimed.has(s.id));

  if (unexpected.length || expected.length || others.length) {
    const what = document.createElement('div');
    what.className = 'ext-capabilities';
    const group = (list, kind, heading) => {
      if (!list.length) return;
      appendText(what, 'div', heading, 'cap-heading');
      const ul = document.createElement('ul');
      ul.className = 'cap-list ' + kind;
      list.slice(0, 6).forEach((signature) => appendText(ul, 'li', signature.label || signature.id));
      what.appendChild(ul);
    };
    /* Unexpected first: it is the only part that asks anything of the reader. */
    group(unexpected, 'cap-unexpected', caps.profile
      ? 'Not what ' + caps.profile.label + ' would normally need'
      : 'Worth a look');
    group(expected, 'cap-expected', caps.profile
      ? 'Expected for ' + caps.profile.label
      : 'What it can reach');
    /* "Also has" only makes sense when something came before it. For an
       extension with no profile this is the whole list, not an addendum. */
    group(others, 'cap-other', (expected.length || unexpected.length) ? 'Also has' : 'What it can reach');
    card.appendChild(what);
  } else {
    appendText(card, 'p', ['high', 'critical'].includes(String(item.access && item.access.level))
      ? 'Chrome reports powerful access that has not yet been mapped to a named capability.'
      : 'No high-impact Chrome permission combination.', 'ext-quiet');
  }

  if (item.latestChange) {
    appendText(card, 'p', changeTitle(item) + (changeDetail(item) ? ' — ' + changeDetail(item) : ''), 'ext-change');
  }

  if (item.reputation.exactMatch || (item.access.chromeWarnings && item.access.chromeWarnings.length)) {
    /* Folded away by default. The source record, the review date and Chrome's
       own permission strings are worth having and worth checking -- and printing
       all of them on every card is what turned a list of twelve extensions into
       a page nobody scrolls to the bottom of. Anyone who wants the evidence is
       one click from it; everyone else gets a card they can read. */
    const evidence = document.createElement('details');
    evidence.className = 'evidence';
    const summary = document.createElement('summary');
    summary.className = 'evidence-summary';
    summary.textContent = 'Evidence and Chrome’s own warnings';
    evidence.appendChild(summary);
    if (item.reputation.exactMatch) {
      appendText(evidence, 'b', 'Database evidence');
      const source = item.reputation.source || {};
      appendText(evidence, 'div', (source.label || 'Local exact-ID record')
        + (item.reputation.reviewedAt ? ' · reviewed ' + item.reputation.reviewedAt.slice(0, 10) : '')
        + (item.reputation.origin === 'custom' ? ' · imported by you' : ' · bundled with WardenOne'));
      const reference = safeHttpsReference(source.reference);
      if (reference) {
        const link = appendText(evidence, 'a', 'View evidence source', 'evidence-link');
        link.href = reference;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
    if (caps.profile && (caps.profile.evidence || caps.profile.reference)) {
      appendText(evidence, 'b', 'Why this access is expected');
      if (caps.profile.evidence) appendText(evidence, 'div', caps.profile.evidence);
      const profileReference = safeHttpsReference(caps.profile.reference);
      if (profileReference) {
        const profileLink = appendText(evidence, 'a', 'View capability evidence', 'evidence-link');
        profileLink.href = profileReference;
        profileLink.target = '_blank';
        profileLink.rel = 'noopener noreferrer';
      }
    }
    if (item.access.chromeWarnings && item.access.chromeWarnings.length) {
      appendText(evidence, 'b', 'Chrome permission warnings');
      const list = document.createElement('ul');
      list.className = 'reason-list';
      item.access.chromeWarnings.slice(0, 8).forEach((warning) => appendText(list, 'li', warning));
      evidence.appendChild(list);
    }
    card.appendChild(evidence);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (item.reputation.status !== 'known_harmful'
      && (item.verdict.needsAttention || item.review.reviewed || item.reputation.status !== 'recognized_identity')) {
    const review = appendText(actions, 'button', item.review.reviewed ? 'Forget access decision' : 'Accept current access', 'btn small');
    review.type = 'button';
    review.dataset.action = item.review.reviewed ? 'forget-review' : 'review';
    review.dataset.id = item.id;
  }
  if (item.verdict.needsAttention && item.enabled && item.mayDisable) {
    const disable = appendText(actions, 'button', 'Disable', 'btn small danger');
    disable.type = 'button';
    disable.dataset.action = 'disable';
    disable.dataset.id = item.id;
  }
  if (item.verdict.needsAttention && item.mayDisable) {
    const remove = appendText(actions, 'button', 'Remove…', 'btn small danger');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.id = item.id;
  }
  const details = appendText(actions, 'button', 'Open Chrome details', 'btn small');
  details.type = 'button';
  details.dataset.action = 'details';
  details.dataset.id = item.id;
  card.appendChild(actions);
  return card;
}

function itemMatchesFilter(item) {
  if (centreState.filter === 'attention' && !item.verdict.needsAttention) return false;
  if (centreState.filter === 'changed' && !(item.latestChange && !item.latestChange.reviewed)) return false;
  if (centreState.filter === 'verified' && item.reputation.status !== 'recognized_identity') return false;
  if (centreState.filter === 'catalogued' && item.reputation.status !== 'catalogued_listing') return false;
  if (centreState.filter === 'unknown' && item.reputation.status !== 'no_record') return false;
  if (centreState.query) {
    const haystack = [item.name, item.id, item.version, item.reputation.label, item.access.level]
      .join(' ').toLowerCase();
    if (!haystack.includes(centreState.query)) return false;
  }
  return true;
}

function renderExtensionList() {
  const list = $('extension-list');
  list.textContent = '';
  if (!centreState.report) return;
  const installed = Array.isArray(centreState.report.extensions) ? centreState.report.extensions : [];
  const visible = installed.filter(itemMatchesFilter);
  if (!visible.length) {
    appendText(list, 'div', installed.length
      ? 'No installed extension matches this filter.'
      : 'Chrome did not report any other installed extensions.', 'empty');
    /* The count moved below the fold decision, so this branch has to set it
       itself or it keeps whatever the previous render left behind. */
    $('result-count').textContent = '0 of ' + installed.length + ' shown';
    return;
  }
  /* Most of this page is cards nobody needs to read. An extension that is
     recognised, doing only what its kind does, and unchanged since the last
     snapshot has nothing in its card worth the scroll -- and burying the two
     that DO matter under nine that do not is how the page stops being read.
     They fold into one row instead, still one click from the full card.
     Only when the reader has not narrowed the list themselves: if they picked a
     filter or typed a search, they asked for these specifically. */
  const quiet = (item) => item.verdict && item.verdict.code === 'recognized_expected'
    && !(item.latestChange && !item.latestChange.reviewed);
  const foldable = centreState.filter === 'all' && !centreState.query;
  const loud = foldable ? visible.filter((item) => !quiet(item)) : visible;
  const calm = foldable ? visible.filter(quiet) : [];

  /* Counted after the fold is decided, not before. "3 of 3 shown" above a page
     showing one card and a folded row is a true sentence that describes
     something the reader cannot see. */
  $('result-count').textContent = calm.length
    ? loud.length + ' shown, ' + calm.length + ' folded, of ' + installed.length
    : visible.length + ' of ' + installed.length + ' shown';

  if (foldable) {
    const decisions = loud.filter((item) => item.verdict && item.verdict.needsAttention);
    const recent = loud.filter((item) => !(item.verdict && item.verdict.needsAttention)
      && item.latestChange && !item.latestChange.reviewed);
    const used = new Set(decisions.concat(recent).map((item) => item.id));
    const other = loud.filter((item) => !used.has(item.id));
    const addSection = (heading, description, items) => {
      if (!items.length) return;
      const section = document.createElement('section');
      section.className = 'list-section';
      appendText(section, 'h3', heading, 'section-heading');
      if (description) appendText(section, 'p', description, 'section-copy');
      items.forEach((item) => section.appendChild(makeExtensionCard(item)));
      list.appendChild(section);
    };
    addSection('Needs your decision', 'Unexpected access, identity evidence or a risky unreviewed change.', decisions);
    addSection('Recent changes', 'Visible here without being dressed as an emergency.', recent);
    addSection('Other installed extensions', 'Known listing context or access that has not been fully modelled yet.', other);
  } else {
    loud.forEach((item) => list.appendChild(makeExtensionCard(item)));
  }

  if (calm.length) {
    const fold = document.createElement('details');
    fold.className = 'quiet-fold';
    const summary = document.createElement('summary');
    summary.className = 'quiet-summary';
    summary.textContent = calm.length + ' publisher-verified, expected access'
      + (loud.length ? '' : ' — nothing here needs you');
    fold.appendChild(summary);
    /* The names are worth showing without expanding: someone scanning for one
       extension should not have to open a fold to find out it is in there. */
    appendText(fold, 'div', calm.map((item) => item.name).join(' · '), 'quiet-names');
    calm.forEach((item) => fold.appendChild(makeExtensionCard(item)));
    list.appendChild(fold);
  }
}

function renderReport(report) {
  centreState.report = report;
  renderSummary(report);
  renderExtensionList();
  const watcher = report.watcher || {};
  const summary = report.summary || {};
  const checked = watcher.lastChecked ? ' Inventory checked ' + formatAge(watcher.lastChecked) + '.' : '';
  const decisions = Number(summary.attention) || 0;
  setScanStatus('Local scan complete. ' + decisions + ' decision' + (decisions === 1 ? ' needs' : 's need') + ' you.' + checked, false);
}

async function scanExtensions(manual) {
  if (centreState.busy) return;
  centreState.busy = true;
  const button = $('rescan');
  button.disabled = true;
  button.textContent = 'Scanning locally…';
  setScanStatus('Reading Chrome\'s inventory, local change ledger and bundled exact-ID database…', false);
  try {
    const report = await sendLocalMessage({
      kind: 'extension-security-report',
      trigger: manual ? 'manual' : 'page-open',
      reloadDatabase: manual === true,
    });
    renderReport(report);
  } catch (error) {
    centreState.report = null;
    $('extension-list').textContent = '';
    appendText($('extension-list'), 'div', 'No reassuring result is shown because the local assessment failed.', 'empty');
    $('result-count').textContent = 'Scan failed';
    $('health-banner').classList.add('danger');
    $('health-title').textContent = 'Assessment unavailable';
    $('health-copy').textContent = 'No reassuring result is assumed. Reload WardenOne and run the local scan again.';
    $('health-mark').textContent = '!';
    setScanStatus('Could not build the local extension report: ' + cleanError(error), true);
  } finally {
    centreState.busy = false;
    button.disabled = false;
    button.textContent = 'Scan locally now';
  }
}

async function runCardAction(button) {
  const id = String(button.dataset.id || '');
  const action = button.dataset.action;
  const item = centreState.report && centreState.report.extensions.find((extension) => extension.id === id);
  if (!item) return;
  button.disabled = true;
  try {
    if (action === 'review') await sendLocalMessage({ kind: 'review-extension-snapshot', id });
    else if (action === 'forget-review') await sendLocalMessage({ kind: 'forget-extension-review', id });
    else if (action === 'details') { await sendLocalMessage({ kind: 'open-installed-extension-details', id }); return; }
    await scanExtensions(false);
  } catch (error) {
    setScanStatus('Could not complete that action: ' + cleanError(error), true);
  } finally { button.disabled = false; }
}

function runManagementActionFromGesture(button) {
  const id = String(button.dataset.id || '');
  const action = button.dataset.action;
  const item = centreState.report && centreState.report.extensions.find((extension) => extension.id === id);
  if (!item || !/^[a-p]{32}$/.test(id) || item.mayDisable === false) return;
  button.disabled = true;
  const done = () => {
    const runtimeError = chrome.runtime.lastError;
    button.disabled = false;
    if (runtimeError) {
      if (/cancel/i.test(String(runtimeError.message || ''))) {
        setScanStatus('Removal was cancelled. No extension was changed.', false);
      } else {
        setScanStatus('Could not ' + (action === 'remove' ? 'remove' : 'disable') + ' that extension: '
          + String(runtimeError.message || 'Chrome refused the request.'), true);
      }
      return;
    }
    scanExtensions(false);
  };
  try {
    /* These management calls require a user gesture. Keep them directly in the
       trusted extension-page click stack; sending them through the worker or
       awaiting inventory first would lose Chrome's activation token. */
    if (action === 'disable') chrome.management.setEnabled(id, false, done);
    else chrome.management.uninstall(id, { showConfirmDialog: true }, done);
  } catch (error) {
    button.disabled = false;
    setScanStatus('Could not ' + (action === 'remove' ? 'remove' : 'disable') + ' that extension: ' + cleanError(error), true);
  }
}

$('rescan').addEventListener('click', () => scanExtensions(true));
$('ack-changes').addEventListener('click', async () => {
  try {
    await sendLocalMessage({ kind: 'ack-extension-alerts' });
    await scanExtensions(false);
  } catch (error) { setScanStatus('Could not mark the change timeline reviewed: ' + cleanError(error), true); }
});
$('extension-search').addEventListener('input', (event) => {
  centreState.query = String(event.target.value || '').trim().toLowerCase();
  renderExtensionList();
});
document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    centreState.filter = button.dataset.filter || 'all';
    document.querySelectorAll('[data-filter]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    renderExtensionList();
  });
});
$('extension-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'disable' || button.dataset.action === 'remove') {
    runManagementActionFromGesture(button);
  } else {
    runCardAction(button);
  }
});
$('intel-file').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setScanStatus('That local intelligence file is larger than the 2 MB safety limit.', true);
    event.target.value = '';
    return;
  }
  try {
    const database = JSON.parse(await file.text());
    const result = await sendLocalMessage({ kind: 'import-extension-reputation', database });
    setScanStatus('Imported ' + (Number(result.imported) || 0) + ' exact-ID record(s) into local storage.', false);
    await scanExtensions(false);
  } catch (error) {
    setScanStatus('Could not import that local intelligence file: ' + cleanError(error), true);
  } finally { event.target.value = ''; }
});
$('clear-intel').addEventListener('click', async () => {
  if (!confirm('Clear all extension-reputation records that you imported locally? The bundled database is not affected.')) return;
  try {
    await sendLocalMessage({ kind: 'clear-imported-extension-reputation' });
    await scanExtensions(false);
  } catch (error) { setScanStatus('Could not clear imported records: ' + cleanError(error), true); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wardenone_ext_alerts || changes.wardenone_ext_reviews
      || changes.wardenone_ext_reputation_custom) {
    scanExtensions(false);
  }
});

scanExtensions(false);
