/* WardenOne Download Guard review window */

const params = new URLSearchParams(location.search);
const reviewId = params.get('id') || '';
let currentReview = null;
let busy = false;
let advancedTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function setResult(text, color) {
  const el = byId('result');
  el.textContent = text || '';
  el.style.color = color || 'var(--soft)';
}

function setBusy(on) {
  busy = on;
  ['cancel', 'continue', 'trust-continue', 'advanced', 'continue-anyway'].forEach((id) => {
    const btn = byId(id);
    if (btn && !btn.dataset.counting) btn.disabled = on;
  });
}

function renderReasons(reasons) {
  const list = byId('reasons');
  list.textContent = '';
  const items = Array.isArray(reasons) && reasons.length ? reasons : ['No specific warning reason was provided.'];
  items.forEach((reason) => {
    const li = document.createElement('li');
    li.textContent = reason;
    list.appendChild(li);
  });
}

function formatAge(days) {
  if (typeof days !== 'number') return '';
  if (days >= 365) return Math.floor(days / 365) + 'y ' + (days % 365) + 'd';
  return days + ' day' + (days === 1 ? '' : 's');
}

function formatExternalReputation(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((item) => {
    if (item.provider === 'VirusTotal' && item.ok === false) {
      return item.status === 429
        ? 'VirusTotal: rate limited'
        : 'VirusTotal: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'VirusTotal' && item.stats) {
      return 'VirusTotal: ' + (item.stats.malicious || 0) + ' malicious, ' + (item.stats.suspicious || 0) + ' suspicious';
    }
    if (item.provider === 'VirusTotal' && item.notFound) {
      return 'VirusTotal: no URL report yet';
    }
    if (item.provider === 'VirusTotal file hash' && item.stats) {
      return 'VirusTotal URL-content hash: ' + (item.stats.malicious || 0) + ' malicious, ' + (item.stats.suspicious || 0) + ' suspicious';
    }
    if (item.provider === 'Google Safe Browsing' && item.ok === false) {
      return 'Google Safe Browsing: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'Google Safe Browsing' && item.threats && item.threats.length) {
      return 'Google Safe Browsing: ' + item.threats.join(', ');
    }
    if (item.provider === 'Google Safe Browsing' && item.ok) {
      return 'Google Safe Browsing: clear';
    }
    if (item.provider === 'PhishTank' && item.ok === false) {
      return item.rateLimited ? 'PhishTank: rate limited' : 'PhishTank: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'PhishTank' && item.hit) {
      return 'PhishTank: verified phishing' + (item.phishId ? ' #' + item.phishId : '');
    }
    if (item.provider === 'PhishTank' && item.ok) {
      return item.inDatabase ? 'PhishTank: listed, not current/verified' : 'PhishTank: clear';
    }
    if (item.provider === 'OpenPhish' && item.ok === false) {
      return 'OpenPhish: feed lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'OpenPhish' && item.hit) {
      return 'OpenPhish: phishing feed match';
    }
    if (item.provider === 'OpenPhish' && item.ok) {
      return item.stale ? 'OpenPhish: clear (stale feed)' : 'OpenPhish: clear';
    }
    if (item.provider === 'AbuseIPDB' && item.ok === false) {
      return item.rateLimited ? 'AbuseIPDB: rate limited' : 'AbuseIPDB: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'AbuseIPDB' && (item.hit || item.warning)) {
      return 'AbuseIPDB: ' + (item.score || 0) + '% abuse confidence' + (item.totalReports ? ', ' + item.totalReports + ' reports' : '');
    }
    if (item.provider === 'AbuseIPDB' && item.ok) {
      return 'AbuseIPDB: clear';
    }
    if (item.provider === 'URLhaus' && item.ok === false) {
      return item.rateLimited ? 'URLhaus: rate limited' : 'URLhaus: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'URLhaus' && item.hit) {
      const scope = item.hostOnly ? 'malware host' : 'malware URL';
      const payloads = item.payloadCount ? ', ' + item.payloadCount + ' payload' + (item.payloadCount === 1 ? '' : 's') : '';
      return 'URLhaus: ' + scope + (item.threat ? ' - ' + item.threat : '') + (item.signatures && item.signatures.length ? ' / ' + item.signatures.join(', ') : '') + payloads;
    }
    if (item.provider === 'URLhaus' && item.ok) {
      return 'URLhaus: clear';
    }
    if (item.provider === 'WhoisXML Domain Reputation' && item.ok === false) {
      return item.rateLimited ? 'WhoisXML reputation: rate limited' : 'WhoisXML reputation: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'WhoisXML Domain Reputation' && (item.hit || item.warning)) {
      return 'WhoisXML reputation: ' + (item.reputationScore != null ? Math.round(Number(item.reputationScore)) + '/100' : 'warning');
    }
    if (item.provider === 'WhoisXML Domain Reputation' && item.ok) {
      return 'WhoisXML reputation: clear';
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && item.ok === false) {
      return item.rateLimited ? 'WhoisXML threat intel: rate limited' : 'WhoisXML threat intel: lookup failed' + (item.status ? ' (HTTP ' + item.status + ')' : '');
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && (item.hit || item.warning)) {
      return 'WhoisXML threat intel: ' + (item.total || 0) + ' IoC match' + ((item.total || 0) === 1 ? '' : 'es') + (item.threatTypes && item.threatTypes.length ? ' / ' + item.threatTypes.join(', ') : '');
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && item.ok) {
      return 'WhoisXML threat intel: clear';
    }
    if (item.provider === 'WhoisXML API' && item.warning) {
      return 'WhoisXML domain age: ' + (item.ageDays != null ? item.ageDays + ' days' : 'warning');
    }
    if (item.provider === 'WhoisXML API' && item.ok) {
      return 'WhoisXML domain age: clear';
    }
    return item.provider || 'External reputation';
  }).join(' · ');
}

function formatBytes(n) {
  const size = Number(n || 0);
  if (!size) return '';
  if (size >= 1024 * 1024) return Math.round(size / 1024 / 1024) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

function shortHash(hash) {
  const h = String(hash || '');
  if (h.length <= 24) return h;
  return h.slice(0, 12) + '...' + h.slice(-8);
}

function hashIsExactFile(review) {
  const fileHash = review && review.fileHash;
  const hashRep = review && review.hashReputation;
  return !!((fileHash && fileHash.exactFile === true) || (hashRep && hashRep.exactFile === true));
}

function hashSourceFromReview(review) {
  const fileHash = review && review.fileHash;
  const hashRep = review && review.hashReputation;
  return (fileHash && (fileHash.hashSource || fileHash.source))
    || (hashRep && hashRep.source)
    || null;
}

function hashSourceLabel(source, exactFile) {
  if (source && typeof source === 'object' && source.label) return String(source.label);
  const kind = String((source && (source.kind || source.method)) || source || '').toLowerCase();
  if (kind === 'native-file-hash') return 'Native file hash';
  if (kind === 'server-header') return 'Server-provided hash';
  if (kind === 'not-available') return 'Hash not available';
  if (kind === 'url-refetch') return 'URL re-fetch';
  return exactFile ? 'File hash' : 'URL re-fetch';
}

function formatHashReputation(review) {
  const fileHash = review && review.fileHash;
  const hashRep = review && review.hashReputation;
  const parts = [];
  const exactFile = hashIsExactFile(review);
  const source = hashSourceFromReview(review);
  if (fileHash && fileHash.sha256) {
    parts.push(hashSourceLabel(source, exactFile) + ' SHA-256 ' + shortHash(fileHash.sha256));
    if (fileHash.bytes) parts.push(formatBytes(fileHash.bytes));
    if (source && typeof source === 'object' && source.caveat) parts.push(source.caveat);
    else if (!exactFile) parts.push('not guaranteed to match the saved file');
  }
  if (hashRep) {
    if (hashRep.local && hashRep.checked && hashRep.ok && hashRep.hit) {
      parts.push('Local malware URL-content database: known-malicious match');
    } else if (hashRep.local && hashRep.checked && hashRep.ok) {
      parts.push('Local malware URL-content database: no match');
    } else if (hashRep.skipped) {
      parts.push(hashRep.reason || 'Hash check skipped');
    } else if (hashRep.checked && hashRep.ok && hashRep.hit && hashRep.stats) {
      parts.push('VirusTotal URL-content hash: ' + (hashRep.stats.malicious || 0) + ' malicious, ' + (hashRep.stats.suspicious || 0) + ' suspicious');
    } else if (hashRep.checked && hashRep.ok && hashRep.notFound) {
      parts.push('VirusTotal has no file report for this URL-content hash');
    } else if (hashRep.checked && hashRep.ok && hashRep.stats) {
      parts.push('VirusTotal URL-content hash: 0 malicious, 0 suspicious');
    } else if (hashRep.checked === false) {
      parts.push(hashRep.reason || 'Hash check could not run');
    } else if (hashRep.ok === false) {
      parts.push(hashRep.status ? ('VirusTotal hash lookup failed (HTTP ' + hashRep.status + ')') : 'VirusTotal hash lookup failed');
    }
  }
  return parts.filter(Boolean).join(' - ');
}

function formatChromeDanger(value) {
  const danger = String(value || '').toLowerCase();
  const labels = {
    file: 'Chrome: suspicious filename',
    url: 'Chrome: known malicious URL',
    content: 'Chrome: known malicious file',
    uncommon: 'Chrome: uncommon download',
    host: 'Chrome: malicious download host',
    unwanted: 'Chrome: potentially unwanted or unsafe',
    passwordprotected: 'Chrome: password-protected file',
    blockedtoolarge: 'Chrome: too large for full scanning',
    sensitivecontentwarning: 'Chrome: sensitive-content warning',
    sensitivecontentblock: 'Chrome: sensitive-content block',
    deepscannedfailed: 'Chrome: deep scan failed',
    deepscannedopeneddangerous: 'Chrome: dangerous after deep scan',
    blockedscanfailed: 'Chrome: scan failed',
    accountcompromise: 'Chrome: account-compromise risk',
    asyncscanning: 'Chrome: safety scan pending',
    asynclocalpasswordscanning: 'Chrome: local password scan pending',
    promptforscanning: 'Chrome: scan prompt pending',
    promptforlocalpasswordscanning: 'Chrome: local password scan prompt pending',
  };
  return labels[danger] || '';
}

function startCriticalCountdown() {
  const advanced = byId('advanced');
  const panel = byId('advanced-panel');
  const continueAnyway = byId('continue-anyway');
  let remaining = 5;
  advanced.hidden = false;
  advanced.disabled = true;
  advanced.dataset.counting = '1';
  advanced.textContent = 'Advanced available in ' + remaining;
  continueAnyway.hidden = false;
  continueAnyway.disabled = true;

  advancedTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      advanced.textContent = 'Advanced available in ' + remaining;
      return;
    }
    clearInterval(advancedTimer);
    advancedTimer = null;
    delete advanced.dataset.counting;
    advanced.disabled = busy;
    advanced.textContent = 'Advanced';
  }, 1000);

  advanced.onclick = () => {
    if (advanced.disabled) return;
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) continueAnyway.disabled = busy;
  };
}

function render(review) {
  currentReview = review;
  const grade = String(review.grade || '?').toUpperCase();
  document.body.className = 'grade-' + grade.toLowerCase() + (grade === 'C' ? ' compact' : '');
  byId('title').textContent = review.autoBlocked ? 'Download blocked and removed'
    : (grade === 'C' ? 'Review recommended' : 'Download paused for review');
  byId('grade').textContent = grade;
  byId('status').textContent = grade + ' - ' + (review.status || 'Review');
  byId('score').textContent = typeof review.score === 'number' ? 'Local risk score: ' + review.score : '';
  byId('file').textContent = review.file || '(unknown file)';
  byId('source').textContent = review.source || '(unknown source)';
  byId('mime').textContent = review.mime || 'Unknown';
  if (!review.mime) byId('mime-row').style.display = 'none';
  const scannerRow = byId('scanner-row');
  const scannerValue = byId('scanner');
  const scannerText = formatChromeDanger(review.chromeDanger);
  if (scannerText) {
    scannerRow.style.display = 'grid';
    scannerValue.textContent = scannerText;
  } else {
    scannerRow.style.display = 'none';
  }
  const ageRow = byId('domain-age-row');
  const ageValue = byId('domain-age');
  if (review.domainAge && typeof review.domainAge.ageDays === 'number') {
    ageRow.style.display = 'grid';
    ageValue.textContent = formatAge(review.domainAge.ageDays) + ' old'
      + (review.domainAge.domain ? ' · ' + review.domainAge.domain : '')
      + (review.domainAge.risk ? ' · ' + review.domainAge.risk + ' age risk' : '');
  } else {
    ageRow.style.display = 'none';
  }
  if (review.domainAge && typeof review.domainAge.ageDays === 'number') {
    const ageClues = [
      review.domainAge.provider || '',
      review.domainAge.registrar ? 'Registrar: ' + review.domainAge.registrar : '',
      review.domainAge.registrantOrg && !review.domainAge.privacy ? 'Org: ' + review.domainAge.registrantOrg : '',
      review.domainAge.registrantCountry ? 'Country: ' + review.domainAge.registrantCountry : '',
      review.domainAge.privacy ? 'Ownership privacy/redaction detected' : '',
    ].filter(Boolean);
    if (ageClues.length) ageValue.textContent += ' - ' + ageClues.join(' - ');
  }
  const externalRow = byId('external-row');
  const externalValue = byId('external');
  const externalText = formatExternalReputation(review.externalReputation);
  if (externalText) {
    externalRow.style.display = 'grid';
    externalValue.textContent = externalText;
  } else {
    externalRow.style.display = 'none';
  }
  const hashRow = byId('file-hash-row');
  const hashValue = byId('file-hash');
  const hashText = formatHashReputation(review);
  if (hashText) {
    hashRow.style.display = 'grid';
    const hashLabel = hashRow.querySelector('.label');
    if (hashLabel) hashLabel.textContent = hashSourceLabel(hashSourceFromReview(review), hashIsExactFile(review));
    hashValue.textContent = hashText;
  } else {
    hashRow.style.display = 'none';
  }
  renderReasons(review.reasons);
  byId('recommendation').textContent = review.recommendation || 'Review this download before continuing.';

  const pauseNote = byId('pause-note');
  if (review.autoBlocked) {
    pauseNote.textContent = 'WardenOne blocked this critical download and removed it from your computer. No further action is needed.';
  } else if (review.paused) {
    pauseNote.textContent = 'This download is paused until you choose Continue or Cancel.';
  } else {
    pauseNote.textContent = 'Chrome could not pause this download. Cancel may still stop it if it has not finished.';
  }

  const continueBtn = byId('continue');
  const cancelBtn = byId('cancel');
  const trustBtn = byId('trust-continue');
  const advancedBtn = byId('advanced');
  const continueAnyway = byId('continue-anyway');
  if (advancedTimer) {
    clearInterval(advancedTimer);
    advancedTimer = null;
  }
  continueBtn.hidden = false;
  advancedBtn.hidden = true;
  advancedBtn.disabled = false;
  advancedBtn.textContent = 'Advanced';
  advancedBtn.onclick = null;
  delete advancedBtn.dataset.counting;
  continueAnyway.hidden = true;
  continueAnyway.disabled = false;
  byId('advanced-panel').classList.remove('show');

  if (grade === 'C') {
    cancelBtn.className = 'quiet';
    continueBtn.textContent = 'Continue';
  } else {
    cancelBtn.className = 'danger';
    continueBtn.textContent = 'Continue Download';
  }

  if (grade === 'F') {
    continueBtn.hidden = true;
    trustBtn.hidden = true;
    advancedBtn.hidden = true;
    continueAnyway.hidden = true;
    if (review.autoBlocked) {
      // File is already cancelled+deleted; "Cancel" would be a no-op, so present it as Close.
      cancelBtn.textContent = 'Close';
      cancelBtn.className = 'quiet';
    }
  } else if (grade === 'E') {
    continueBtn.hidden = true;
    trustBtn.hidden = true;
    startCriticalCountdown();
  } else {
    trustBtn.hidden = !(grade === 'C' && review.trustAllowed && !review.trusted && review.trustHost);
    if (!trustBtn.hidden) trustBtn.textContent = 'Trust ' + review.trustHost + ' & Continue';
  }
}

function loadReview() {
  if (!reviewId) {
    setResult('No download review id was provided.', 'var(--red)');
    setTimeout(() => window.close(), 1200);
    return;
  }
  chrome.runtime.sendMessage({ kind: 'download-review-get', id: reviewId }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      setResult(((res && res.error) || err || 'Could not load this download review.') + ' Closing...', 'var(--red)');
      byId('cancel').disabled = true;
      byId('continue').disabled = true;
      byId('trust-continue').disabled = true;
      setTimeout(() => window.close(), 1400);
      return;
    }
    render(res.review);
  });
}

function decide(decision) {
  if (busy || !currentReview) return;
  setBusy(true);
  setResult(decision === 'cancel'
    ? 'Cancelling download...'
    : decision === 'trust-continue'
      ? 'Trusting this site and continuing...'
      : 'Continuing download...');
  chrome.runtime.sendMessage({ kind: 'download-review-decision', id: reviewId, decision }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      setBusy(false);
      setResult((res && res.error) || err || 'Could not apply that decision.', 'var(--red)');
      return;
    }
    setResult(decision === 'cancel'
      ? 'Download cancelled.'
      : decision === 'trust-continue'
        ? 'Site trusted. Download continued.'
        : 'Download continued.', decision === 'cancel' ? 'var(--red)' : 'var(--green)');
    setTimeout(() => window.close(), 900);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  byId('cancel').addEventListener('click', () => decide('cancel'));
  byId('continue').addEventListener('click', () => decide('continue'));
  byId('trust-continue').addEventListener('click', () => decide('trust-continue'));
  byId('continue-anyway').addEventListener('click', () => decide('continue'));
  loadReview();
});

try {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.kind === 'download-review-updated' && String(msg.id || '') === reviewId) {
      if (msg.review) render(msg.review);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
} catch (_) {}
