/* Warden One activity log */

const DOWNLOAD_TRUSTED_KEY = 'webwarden_download_trusted_sites';
const ADSHIELD_ALLOWLIST_KEY = 'webwarden_adshield_allowlist';

const LABELS = {
  blocked_popup: 'Popup blocked',
  blocked_gestureless_nav: 'Forced redirect blocked',
  blocked_meta_refresh: 'Auto-redirect blocked',
  blocked_form_submit: 'Forced form-submit blocked',
  blocked_redirect_chain: 'Redirect chain stopped',
  detected_grabber_domain: 'IP-logger page',
  detected_thirdparty_tracker: 'Third-party tracker observed',
  learned_tracker_domain: 'Tracker learned locally',
  blocked_grabber_fetch: 'IP-grabber request blocked',
  blocked_grabber_xhr: 'IP-grabber request blocked',
  blocked_grabber_beacon: 'IP-grabber beacon blocked',
  blocked_grabber_pixel: 'Tracking pixel blocked',
  blocked_grabber_element: 'Grabber element removed',
  blocked_certificate: 'Bad certificate blocked',
  blocked_http_only: 'HTTP-only site blocked',
  blocked_safe_browsing_page: 'Dangerous page blocked',
  blocked_safe_browsing_link: 'Dangerous link blocked',
  blocked_safe_browsing_form: 'Dangerous form blocked',
  blocked_safe_browsing_paste: 'Dangerous paste target blocked',
  gated_adult_site: 'Adult-site warning',
  blocked_overlay: 'Overlay / nag hidden',
  detected_download_gate: 'Download-gate ad (left for you)',
  youtube_ad_diag: 'YouTube ad diagnostic',
  warned_shortener: 'Shortened link',
  warned_redirect_param: 'Redirecting link',
  warned_logger_api: 'Possible tracker request',
  warned_abuseipdb_server: 'Suspicious IP server',
  warned_url_reputation: 'Suspicious URL reputation',
  warned_phishing: 'Possible fake/phishing site',
  warned_new_domain_login: 'Login form on a brand-new domain',
  blocked_phishing: 'Blocked phishing look-alike',
  download_reputation: 'Download Guard checked',
  download_guard: 'Download Guard decision',
  blocked_clipboard_hijack: 'Blocked clipboard hijack',
  warned_clipboard_swap: 'Clipboard swap detected (crypto address)',
  warned_keystroke_pressure: 'Heavy keystroke monitoring',
  warned_honeytoken_read: 'Script read a decoy credential (honeytoken)',
  warned_techsupport_scam: 'Tech-support scam / browser-lock page',
  warned_command_paste: 'Blocked a command-paste scam (ClickFix)',
  warned_paste_protection: 'Warned before pasting a secret into a risky page',
  warned_form_trap: 'Flagged a suspicious (possibly fake) login form',
  warned_fake_update: 'Fake software-update scam',
  warned_browser_abuse: 'Browser abuse / resource exhaustion',
  warned_permission_chain: 'Risky permission chain',
  warned_oauth_grant: 'Risky OAuth grant',
  warned_script_drift: 'Third-party script changed',
  blocked_tracker_request: 'First-party tracker blocked',
  blocked_thirdparty_cookie: 'Third-party cookie blocked',
  session_token_exposed: 'Session token exposed (SessionShield)',
  login_thirdparty_scripts: 'Third-party scripts on login page',
  blocked_token_exfil: 'Sensitive request protected',
  session_token_written: 'New session token stored',
  skimmer_suspected: 'Possible form skimmer detected',
  blocked_skimmer_exfil: 'Blocked card/password theft',
  behavioral_risk: 'Site reputation warning',
  reload_loop_broken: 'Stopped a reload loop',
  memory_tab_slept: 'Slept an inactive tab (saved RAM)',
  memory_free_ram: 'Freed RAM on demand',
  memory_dupes_closed: 'Closed duplicate tabs',
  memory_group_slept: 'Slept an idle tab group',
  tab_limit_slept: 'Tab Limit slept a tab',
  tab_limit_closed: 'Tab Limit closed a tab',
  forget_me_wiped: 'Forgot a site on leaving',
  blocked_media_capture: 'Camera/mic access blocked',
  blocked_screen_capture: 'Screen capture blocked',
  blocked_autoplay_media: 'Autoplay media blocked',
  blocked_hidden_media: 'Hidden media blocked',
  blocked_suspicious_webrtc: 'Suspicious WebRTC blocked',
  warned_media_capture: 'Camera/mic requested',
  warned_hidden_media_capture: 'Hidden camera/mic request',
  warned_screen_capture: 'Screen capture requested',
  warned_hidden_screen_capture: 'Hidden screen request',
};

// category for the row icon: block (shield), warn (triangle), gate (eye)
function iconCategory(type) {
  if (/^warned_/.test(type) || type === 'session_token_exposed' || type === 'login_thirdparty_scripts' || type === 'session_token_written' || type === 'skimmer_suspected' || type === 'download_reputation' || type === 'behavioral_risk') return 'warn';
  if (/^gated_/.test(type) || type === 'download_guard' || type === 'detected_download_gate' || type === 'memory_tab_slept' || type === 'memory_free_ram' || type === 'memory_dupes_closed' || type === 'memory_group_slept' || type === 'tab_limit_slept' || type === 'tab_limit_closed' || type === 'forget_me_wiped' || type === 'reload_loop_broken') return 'gate';
  return 'block';
}
const ICON_CATEGORIES = new Set(['block', 'warn', 'gate']);

function makeIconSvg(category) {
  const safe = ICON_CATEGORIES.has(category) ? category : 'block';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  const add = (name, attrs) => {
    const node = document.createElementNS(ns, name);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    svg.appendChild(node);
  };
  if (safe === 'warn') {
    add('path', { d: 'M12 4l9 16H3l9-16z', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' });
    add('path', { d: 'M12 10v4M12 17v.5', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' });
  } else if (safe === 'gate') {
    add('path', { d: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' });
    add('circle', { cx: '12', cy: '12', r: '2.6', stroke: 'currentColor', 'stroke-width': '2' });
  } else {
    add('path', { d: 'M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' });
    add('path', { d: 'M9.5 12l1.8 1.8L15 10', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  }
  return svg;
}

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? h + 'h ' + r + 'm' : h + 'h';
}

function detailText(e) {
  const d = e.detail || {};
  if (e.type === 'download_reputation' || e.type === 'download_guard') {
    const parts = [];
    if (d.grade || d.status) parts.push([d.grade, d.status].filter(Boolean).join(' - '));
    if (d.decision) parts.push('Decision: ' + d.decision);
    if (d.file) parts.push(d.file);
    if (d.source) parts.push(d.source);
    if (d.chromeDanger) {
      const dangerText = chromeDangerText(d.chromeDanger);
      if (dangerText) parts.push(dangerText);
    }
    if (d.domainAge && typeof d.domainAge.ageDays === 'number') {
      const ageParts = ['Domain age: ' + d.domainAge.ageDays + 'd'];
      if (d.domainAge.provider) ageParts.push(d.domainAge.provider);
      if (d.domainAge.registrar) ageParts.push('Registrar: ' + d.domainAge.registrar);
      if (d.domainAge.registrantOrg && !d.domainAge.privacy) ageParts.push('Org: ' + d.domainAge.registrantOrg);
      if (d.domainAge.privacy) ageParts.push('ownership privacy/redaction');
      parts.push(ageParts.join(' / '));
    }
    if (d.externalReputation && d.externalReputation.length) parts.push(externalReputationText(d.externalReputation));
    if (d.fileHash && d.fileHash.sha256) parts.push('SHA-256 ' + shortHash(d.fileHash.sha256));
    if (d.hashReputation) {
      const hashText = hashReputationText(d.hashReputation);
      if (hashText) parts.push(hashText);
    }
    if (d.reasons && d.reasons.length) parts.push(d.reasons.join(', '));
    return parts.join(' - ');
  }
  if (e.type === 'warned_honeytoken_read') {
    return [d.token, d.where && ('via ' + d.where)].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_techsupport_scam') {
    return d.reason || '';
  }
  if (e.type === 'warned_new_domain_login') {
    const age = typeof d.ageDays === 'number' ? ('registered ' + (d.ageDays <= 1 ? 'today' : d.ageDays + 'd ago')) : '';
    return [d.domain, age].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_keystroke_pressure') {
    const bits = [];
    if (d.global != null) bits.push(d.global + ' global');
    if (d.total != null) bits.push(d.total + ' total input listeners');
    return bits.join(' - ');
  }
  if (e.type === 'warned_clipboard_swap') {
    const k = d.kind ? d.kind.toUpperCase() + ' ' : '';
    return k + 'copied ' + shortHash(d.copied) + ' -> pasted ' + shortHash(d.pasted);
  }
  if (e.type === 'warned_permission_chain') {
    const perms = Array.isArray(d.permissions) && d.permissions.length ? d.permissions.join(', ') : '';
    const allowed = Array.isArray(d.allowed) && d.allowed.length ? 'Allowed: ' + d.allowed.join(', ') : '';
    return [d.risk, perms, allowed, d.why].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_oauth_grant') {
    const scopes = Array.isArray(d.riskyScopes) && d.riskyScopes.length ? d.riskyScopes.join(', ') : '';
    const app = d.appName ? 'App: ' + d.appName : '';
    const provider = d.providerName || d.provider;
    const redirect = d.redirectHost ? 'Redirect: ' + d.redirectHost : '';
    return [d.risk, provider, app, scopes, redirect].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_script_drift') {
    const bits = [];
    if (d.risk) bits.push(d.risk);
    if (d.scriptHost) bits.push(d.scriptHost);
    if (d.newIndicators && d.newIndicators.length) bits.push('New: ' + d.newIndicators.join(', '));
    if (d.newHosts && d.newHosts.length) bits.push('Hosts: ' + d.newHosts.slice(0, 3).join(', '));
    if (d.newHash) bits.push('Hash ' + shortHash(d.previousHash) + ' -> ' + shortHash(d.newHash));
    return bits.join(' - ');
  }
  if (e.type === 'forget_me_wiped') {
    const bits = [];
    if (d.domain) bits.push(d.domain);
    bits.push(d.history ? 'cleared cookies, storage & history' : 'cleared cookies & storage');
    return bits.join(' - ');
  }
  if (e.type === 'tab_limit_slept' || e.type === 'tab_limit_closed') {
    const parts = [];
    if (d.host) parts.push(d.host);
    if (typeof d.idleMin === 'number') parts.push('inactive ' + fmtMinutes(d.idleMin));
    if (d.count && d.max) parts.push(d.count + '/' + d.max + ' tabs');
    return parts.join(' - ');
  }
  if (e.type === 'behavioral_risk' && d.score) {
    const level = d.level || (d.score >= 100 ? 'Dangerous' : (d.score >= 60 ? 'Suspicious' : (d.score >= 30 ? 'Caution' : 'Safe')));
    return level + ' (' + d.score + '): ' + ((d.reasons && d.reasons.length) ? d.reasons.join(', ') : d.host || '');
  }
  if (e.type === 'blocked_certificate' || e.type === 'blocked_http_only') {
    return [d.problem || d.why, d.error, d.host].filter(Boolean).join(' - ');
  }
  if (/^blocked_safe_browsing_/.test(e.type || '')) {
    const threats = Array.isArray(d.threats) ? d.threats.join(', ') : '';
    return [d.provider, d.why, threats, d.matched || d.host].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_abuseipdb_server') {
    const score = d.score != null ? 'Score: ' + d.score + '%' : '';
    return [d.provider || 'AbuseIPDB', score, d.ip, d.why, d.matched || d.host].filter(Boolean).join(' - ');
  }
  if (e.type === 'warned_url_reputation') {
    const score = d.reputationScore != null ? 'Reputation: ' + Math.round(Number(d.reputationScore)) + '/100' : '';
    const age = d.ageDays != null ? 'Domain age: ' + d.ageDays + 'd' : '';
    const registrar = d.registrar ? 'Registrar: ' + d.registrar : '';
    const host = d.hostOnly && d.urlCount ? 'URLhaus host URLs: ' + d.urlCount : '';
    const threats = Array.isArray(d.threatTypes) && d.threatTypes.length ? d.threatTypes.join(', ') : '';
    return [d.provider || 'URL reputation', score, age, registrar, host, threats, d.why, d.matched || d.host].filter(Boolean).join(' - ');
  }
  if (d.risk && (d.action || d.why)) return d.risk + ': ' + [d.action, d.why].filter(Boolean).join(' - ');
  if (d.matched && d.brand) return d.matched + ' (looks like ' + d.brand + ')';
  if (d.matched) return d.matched;
  if (d.dest) return d.dest;
  if (d.url) return d.url;
  if (d.action) return d.action;
  if (d.reasons && d.reasons.length) return d.reasons.join(', ');
  return '';
}

function externalReputationText(items) {
  return (items || []).map((item) => {
    if (item.provider === 'VirusTotal' && item.ok === false) {
      return item.status === 429 ? 'VirusTotal rate limited' : 'VirusTotal failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'VirusTotal' && item.stats) {
      return 'VirusTotal ' + (item.stats.malicious || 0) + 'M/' + (item.stats.suspicious || 0) + 'S';
    }
    if (item.provider === 'VirusTotal' && item.notFound) {
      return 'VirusTotal no report';
    }
    if (item.provider === 'VirusTotal file hash' && item.stats) {
      return 'VT hash ' + (item.stats.malicious || 0) + 'M/' + (item.stats.suspicious || 0) + 'S';
    }
    if (item.provider === 'Google Safe Browsing' && item.ok === false) {
      return 'Google Safe Browsing failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'Google Safe Browsing' && item.threats && item.threats.length) {
      return 'Google Safe Browsing ' + item.threats.join(',');
    }
    if (item.provider === 'Google Safe Browsing' && item.ok) {
      return 'Google Safe Browsing clear';
    }
    if (item.provider === 'PhishTank' && item.ok === false) {
      if (item.rateLimited) return 'PhishTank rate limited';
      if (item.cloudflare) return 'PhishTank browser challenge';
      return 'PhishTank failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'PhishTank' && item.hit) {
      return 'PhishTank phishing' + (item.phishId ? ' #' + item.phishId : '');
    }
    if (item.provider === 'PhishTank' && item.ok) {
      return item.inDatabase ? 'PhishTank listed, not current/verified' : 'PhishTank clear';
    }
    if (item.provider === 'OpenPhish' && item.ok === false) {
      return 'OpenPhish failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'OpenPhish' && item.hit) {
      return 'OpenPhish phishing feed match';
    }
    if (item.provider === 'OpenPhish' && item.ok) {
      return item.stale ? 'OpenPhish clear (stale feed)' : 'OpenPhish clear';
    }
    if (item.provider === 'AbuseIPDB' && item.ok === false) {
      return item.rateLimited ? 'AbuseIPDB rate limited' : 'AbuseIPDB failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'AbuseIPDB' && (item.hit || item.warning)) {
      return 'AbuseIPDB ' + (item.score || 0) + '% abuse confidence' + (item.totalReports ? ' / ' + item.totalReports + ' reports' : '');
    }
    if (item.provider === 'AbuseIPDB' && item.ok) {
      return 'AbuseIPDB clear';
    }
    if (item.provider === 'URLhaus' && item.ok === false) {
      return item.rateLimited ? 'URLhaus rate limited' : 'URLhaus failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'URLhaus' && item.hit) {
      const scope = item.hostOnly ? 'malware host' : 'malware URL';
      const fam = item.signatures && item.signatures.length ? ' / ' + item.signatures.slice(0, 3).join(', ') : '';
      return 'URLhaus ' + scope + (item.threat ? ' ' + item.threat : '') + fam;
    }
    if (item.provider === 'URLhaus' && item.ok) {
      return 'URLhaus clear';
    }
    if (item.provider === 'WhoisXML Domain Reputation' && item.ok === false) {
      return item.rateLimited ? 'WhoisXML reputation rate limited' : 'WhoisXML reputation failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'WhoisXML Domain Reputation' && (item.hit || item.warning)) {
      return 'WhoisXML reputation ' + (item.reputationScore != null ? Math.round(Number(item.reputationScore)) + '/100' : 'warning');
    }
    if (item.provider === 'WhoisXML Domain Reputation' && item.ok) {
      return 'WhoisXML reputation clear';
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && item.ok === false) {
      return item.rateLimited ? 'WhoisXML threat intel rate limited' : 'WhoisXML threat intel failed' + (item.status ? ' HTTP ' + item.status : '');
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && (item.hit || item.warning)) {
      return 'WhoisXML threat intel ' + (item.total || 0) + ' match' + ((item.total || 0) === 1 ? '' : 'es');
    }
    if (item.provider === 'WhoisXML Threat Intelligence' && item.ok) {
      return 'WhoisXML threat intel clear';
    }
    if (item.provider === 'WhoisXML API' && item.warning) {
      return 'WhoisXML age ' + (item.ageDays != null ? item.ageDays + 'd' : 'warning');
    }
    if (item.provider === 'WhoisXML API' && item.ok) {
      return 'WhoisXML age clear';
    }
    return item.provider || 'External reputation';
  }).join(' - ');
}

function shortHash(hash) {
  const h = String(hash || '');
  if (h.length <= 20) return h;
  return h.slice(0, 10) + '...' + h.slice(-6);
}

function hashReputationText(hashRep) {
  if (!hashRep) return '';
  if (hashRep.skipped) return 'Hash skipped: ' + (hashRep.reason || 'too large or unavailable');
  if (hashRep.checked && hashRep.ok && hashRep.notFound) return 'VT hash: no report';
  if (hashRep.checked && hashRep.ok && hashRep.stats) {
    return 'VT hash ' + (hashRep.stats.malicious || 0) + 'M/' + (hashRep.stats.suspicious || 0) + 'S';
  }
  if (hashRep.ok === false) return 'VT hash failed';
  return '';
}

function chromeDangerText(value) {
  const danger = String(value || '').toLowerCase();
  const labels = {
    file: 'Chrome: suspicious filename',
    url: 'Chrome: known malicious URL',
    content: 'Chrome: known malicious file',
    uncommon: 'Chrome: uncommon download',
    host: 'Chrome: malicious host',
    unwanted: 'Chrome: unwanted/unsafe',
    passwordprotected: 'Chrome: password-protected',
    blockedtoolarge: 'Chrome: too large to scan',
    sensitivecontentwarning: 'Chrome: sensitive-content warning',
    sensitivecontentblock: 'Chrome: sensitive-content block',
    deepscannedfailed: 'Chrome: deep scan failed',
    deepscannedopeneddangerous: 'Chrome: dangerous after deep scan',
    blockedscanfailed: 'Chrome: scan failed',
    accountcompromise: 'Chrome: account-compromise risk',
    asyncscanning: 'Chrome: scan pending',
    asynclocalpasswordscanning: 'Chrome: local scan pending',
    promptforscanning: 'Chrome: scan prompt pending',
    promptforlocalpasswordscanning: 'Chrome: local scan prompt pending',
  };
  return labels[danger] || '';
}

function shortUrl(u) {
  if (!u) return '';
  try { const x = new URL(u); return x.hostname + (x.pathname.length > 1 ? x.pathname.slice(0, 24) : ''); }
  catch { return u.slice(0, 40); }
}

function render(hist) {
  const rows = document.getElementById('rows');
  const total = hist.length;
  const blocked = hist.filter((e) => /^blocked_|^detected_|^gated_/.test(e.type)).length;
  const warned = hist.filter((e) => /^warned_/.test(e.type)).length;
  document.getElementById('s-total').textContent = total;
  document.getElementById('s-blocked').textContent = blocked;
  document.getElementById('s-warned').textContent = warned;

  rows.textContent = '';
  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = 'All clear';
    empty.appendChild(big);
    empty.appendChild(document.createTextNode('Nothing to report yet. Warden One will log blocks and warnings here as they happen.'));
    rows.appendChild(empty);
    return;
  }
  hist.forEach((e) => {
    const label = LABELS[e.type] || e.type;
    const rawCat = iconCategory(e.type);
    const cat = ICON_CATEGORIES.has(rawCat) ? rawCat : 'block';
    const detail = detailText(e);
    const page = shortUrl(e.url);
    const row = document.createElement('div');
    row.className = 'row';

    const icon = document.createElement('div');
    icon.className = 'ricon ' + cat;
    icon.appendChild(makeIconSvg(cat));
    row.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'rmain';
    const title = document.createElement('div');
    title.className = 'rtitle';
    title.textContent = label;
    main.appendChild(title);

    if (detail || page) {
      const metaNode = document.createElement('div');
      metaNode.className = 'rmeta';
      if (detail) metaNode.appendChild(document.createTextNode(detail));
      if (page) {
        if (detail) metaNode.appendChild(document.createTextNode(' - '));
        const pg = document.createElement('span');
        pg.className = 'pg';
        pg.textContent = page;
        metaNode.appendChild(pg);
      }
      main.appendChild(metaNode);
    }
    row.appendChild(main);

    const when = document.createElement('div');
    when.className = 'rwhen';
    when.textContent = fmtWhen(e.at);
    row.appendChild(when);

    rows.appendChild(row);
  });
}

function load() {
  chrome.storage.local.get('webwarden_history', (x) => {
    render((x && x.webwarden_history) || []);
  });
}

function checkedLocalSet(obj, done) {
  try {
    chrome.storage.local.set(obj, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        try { alert('Warden One could not save this change: ' + (err.message || String(err))); } catch (_) {}
        if (done) done(err);
        return;
      }
      if (done) done(null);
    });
  } catch (e) {
    try { alert('Warden One could not save this change: ' + String(e)); } catch (_) {}
    if (done) done(e);
  }
}

document.getElementById('clear').addEventListener('click', () => {
  if (confirm('Clear all Warden One activity history? This cannot be undone.')) {
    checkedLocalSet({ webwarden_history: [] }, (err) => { if (!err) load(); });
  }
});

// ---- Learned bad sites ----
function loadLearned() {
  chrome.runtime.sendMessage({ kind: 'list-learned' }, (res) => {
    const box = document.getElementById('learned-rows');
    if (!box) return;
    box.textContent = '';
    if (!res || !res.ok || !res.items || !res.items.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'None yet - Warden One learns these as you browse.';
      box.appendChild(e);
      return;
    }
    res.items.forEach((it) => {
      const row = document.createElement('div'); row.className = 'row';
      const left = document.createElement('div');
      const title = document.createElement('div'); title.className = 'rtitle';
      title.textContent = it.domain;
      const meta = document.createElement('div'); meta.className = 'rmeta';
      meta.textContent = (it.reason || 'suspicious behavior') + ' - seen ' + (it.hits || 1) + 'x - ' + fmtWhen(it.firstSeen);
      left.appendChild(title); left.appendChild(meta);
      const btn = document.createElement('button'); btn.className = 'btn';
      btn.style.cssText = 'flex:none;padding:6px 12px;font-size:11px;';
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => {
        btn.disabled = true; btn.textContent = 'Removing...';
        chrome.runtime.sendMessage({ kind: 'remove-learned', domain: it.domain }, () => loadLearned());
      });
      row.appendChild(left); row.appendChild(btn);
      box.appendChild(row);
    });
  });
}
document.getElementById('clear-learned').addEventListener('click', () => {
  if (confirm('Forget ALL learned bad sites? They will no longer be blocked on future visits unless re-detected.')) {
    chrome.runtime.sendMessage({ kind: 'clear-learned' }, () => loadLearned());
  }
});

function allowedItemsFromStore(store) {
  const cfg = (store && store.webwarden_config) || {};
  const items = [];
  (Array.isArray(cfg.allowlist) ? cfg.allowlist : []).forEach((host) => {
    items.push({
      kind: 'main',
      host,
      title: host,
      category: 'Warden One allowlist',
      detail: 'All Warden One protections stay passive on this site after reload.',
    });
  });
  (Array.isArray(store && store[DOWNLOAD_TRUSTED_KEY]) ? store[DOWNLOAD_TRUSTED_KEY] : []).forEach((host) => {
    items.push({
      kind: 'download',
      host,
      title: host,
      category: 'Trusted download site',
      detail: 'Download Shield grades normal downloads from this source more gently.',
    });
  });
  (Array.isArray(store && store[ADSHIELD_ALLOWLIST_KEY]) ? store[ADSHIELD_ALLOWLIST_KEY] : []).forEach((host) => {
    items.push({
      kind: 'adshield',
      host,
      title: host,
      category: 'AdShield off',
      detail: 'AdShield cosmetic/network hiding is disabled on this site.',
    });
  });
  return items.filter((item) => item.host).sort((a, b) => String(a.host).localeCompare(String(b.host)) || String(a.kind).localeCompare(String(b.kind)));
}

function removeAllowedItem(item, done) {
  if (!item || !item.host) { if (done) done(); return; }
  if (item.kind === 'main') {
    chrome.storage.local.get('webwarden_config', (store) => {
      const cfg = Object.assign({}, (store && store.webwarden_config) || {});
      cfg.allowlist = (Array.isArray(cfg.allowlist) ? cfg.allowlist : []).filter((host) => host !== item.host);
      checkedLocalSet({ webwarden_config: cfg }, () => { if (done) done(); });
    });
    return;
  }
  if (item.kind === 'download') {
    chrome.storage.local.get(DOWNLOAD_TRUSTED_KEY, (store) => {
      const list = (Array.isArray(store && store[DOWNLOAD_TRUSTED_KEY]) ? store[DOWNLOAD_TRUSTED_KEY] : []).filter((host) => host !== item.host);
      checkedLocalSet({ [DOWNLOAD_TRUSTED_KEY]: list }, () => { if (done) done(); });
    });
    return;
  }
  if (item.kind === 'adshield') {
    chrome.storage.local.get(ADSHIELD_ALLOWLIST_KEY, (store) => {
      const list = (Array.isArray(store && store[ADSHIELD_ALLOWLIST_KEY]) ? store[ADSHIELD_ALLOWLIST_KEY] : []).filter((host) => host !== item.host);
      checkedLocalSet({ [ADSHIELD_ALLOWLIST_KEY]: list }, () => { if (done) done(); });
    });
    return;
  }
  if (done) done();
}

function renderAllowed(items) {
  const box = document.getElementById('allowed-rows');
  if (!box) return;
  box.textContent = '';
  if (!items || !items.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'No allowed or trusted sites yet.';
    box.appendChild(e);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div'); row.className = 'row';
    const main = document.createElement('div'); main.className = 'rmain';
    const title = document.createElement('div'); title.className = 'rtitle';
    title.textContent = item.title;
    const meta = document.createElement('div'); meta.className = 'rmeta';
    meta.textContent = item.detail;
    const pill = document.createElement('span'); pill.className = 'pill';
    pill.textContent = item.category;
    main.appendChild(title);
    main.appendChild(meta);
    main.appendChild(pill);
    const btn = document.createElement('button'); btn.className = 'btn';
    btn.style.cssText = 'padding:6px 12px;font-size:11px;';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Removing...';
      removeAllowedItem(item, loadAllowed);
    });
    row.appendChild(main);
    row.appendChild(btn);
    box.appendChild(row);
  });
}

function loadAllowed() {
  chrome.storage.local.get(['webwarden_config', DOWNLOAD_TRUSTED_KEY, ADSHIELD_ALLOWLIST_KEY], (store) => {
    renderAllowed(allowedItemsFromStore(store || {}));
  });
}

document.getElementById('refresh-allowed')?.addEventListener('click', loadAllowed);

function renderTrackerLearner() {
  const box = document.getElementById('tracker-learner-list');
  const status = document.getElementById('tracker-learner-status');
  if (!box || !status) return;
  box.textContent = '';
  const placeholder = document.createElement('div');
  placeholder.className = 'empty';
  placeholder.textContent = 'Open a website to manage local tracker decisions.';
  box.appendChild(placeholder);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = (tabs && tabs[0] && tabs[0].url) || '';
    if (!/^https?:/.test(url)) return;
    chrome.runtime.sendMessage({ kind: 'tracker-learner-status', url }, (res) => {
      const err = chrome.runtime.lastError;
      const items = (res && res.ok && Array.isArray(res.items)) ? res.items : [];
      box.textContent = '';
      if (err || !res || !res.ok) {
        status.textContent = 'Tracker learner is available on normal web pages.';
        const row = document.createElement('div');
        row.className = 'empty';
        row.textContent = 'Open a website to manage local tracker decisions.';
        box.appendChild(row);
        return;
      }
      const learnedCount = Number(res.learnedCount || 0);
      const site = res.site ? ' for ' + res.site : '';
      status.textContent = (res.enabled === false ? 'Paused' : 'Active') + site + '. ' + learnedCount + ' tracker domain' + (learnedCount === 1 ? '' : 's') + ' learned locally.';
      if (!items.length) {
        const row = document.createElement('div');
        row.className = 'empty';
        row.textContent = 'No tracker-like third-party requests seen for this site yet.';
        box.appendChild(row);
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'row';
        const main = document.createElement('div');
        main.className = 'rmain';
        const siteHits = Number(item.siteHits || 0);
        const siteText = siteHits ? siteHits + ' hit' + (siteHits === 1 ? '' : 's') + ' here' : 'manual rule';
        const title = document.createElement('div');
        title.className = 'rtitle';
        title.textContent = item.domain + ' - ' + (item.state === 'learned' ? 'Auto block' : 'Learning');
        main.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'rmeta';
        meta.textContent = siteText;
        main.appendChild(meta);
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:4px;flex:none;';
        [
          ['auto', 'Auto'],
          ['allow', 'Allow'],
          ['block', 'Block'],
        ].forEach(([value, text]) => {
          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.style.cssText = 'padding:5px 8px;font-size:10px;';
          const on = (item.mode || 'auto') === value;
          if (on) btn.style.cssText += 'background:linear-gradient(135deg,var(--grad-a),var(--grad-b));color:#fff;border-color:transparent;';
          btn.textContent = text;
          btn.addEventListener('click', () => {
            if (on) return;
            chrome.runtime.sendMessage({ kind: 'tracker-learner-set-site', url, domain: item.domain, mode: value }, () => renderTrackerLearner());
          });
          actions.appendChild(btn);
        });
        row.appendChild(main);
        row.appendChild(actions);
        box.appendChild(row);
      });
    });
  });
}

load();
renderTrackerLearner();
loadLearned();
loadAllowed();
// live refresh if new events arrive while the page is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.webwarden_history) load();
  if (area === 'local' && changes.webwarden_learned) loadLearned();
  if (area === 'local' && (changes.webwarden_config || changes[DOWNLOAD_TRUSTED_KEY] || changes[ADSHIELD_ALLOWLIST_KEY])) loadAllowed();
});
