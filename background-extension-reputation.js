/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne -- local installed-extension reputation and review engine.
 *
 * Runtime privacy boundary: the bundled database is read from a chrome-extension://
 * URL and extension assessments are stored in chrome.storage.local. No installed
 * extension ID, permission or review decision is sent to a server.
 *
 * Chrome does not expose another extension's source package or signing identity.
 * Reputation therefore uses exact 32-character extension IDs only. Capability
 * reach and inventory changes remain separate signals: powerful does not mean
 * malicious, and no database record does not mean safe.
 */

/* global chrome, localGet, localSet, localRemove, getAllExtensions, extPermSet,
   classifyExtensionRisk, reconcileExtensionChanges, EXT_ALERTS_KEY,
   EXT_WATCH_STATUS_KEY, makeExtensionEvent, notifyExtensionEvents,
   logExtensionEvents, refreshExtensionAttentionBadge, watcherEnabled */
'use strict';

var EXT_REPUTATION_DATABASE_PATH = 'extension-reputation.json';
var EXT_REPUTATION_CUSTOM_KEY = 'wardenone_ext_reputation_custom';
var EXT_REPUTATION_REVIEWS_KEY = 'wardenone_ext_reviews';
var EXT_REPUTATION_STATE_KEY = 'wardenone_ext_reputation_state';
var EXT_REPUTATION_SCHEMA = 1;
var EXT_REPUTATION_MAX_CUSTOM_ENTRIES = 2000;
var EXT_REPUTATION_MAX_IMPORT_BYTES = 2 * 1024 * 1024;
var EXTENSION_ID_RE = /^[a-p]{32}$/;
var EXT_REPUTATION_STATUSES = new Set([
  'known_harmful',
  'reported_harmful',
  'historical_incident',
  'recognized_identity',
  'catalogued_listing',
]);
var EXT_REPUTATION_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
var EXT_REPUTATION_STATUS_RANK = {
  no_record: 0,
  catalogued_listing: 0,
  recognized_identity: 1,
  historical_incident: 2,
  reported_harmful: 3,
  known_harmful: 4,
  database_unavailable: 0,
};
var EXT_ACCESS_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/* Stable ids for the facts produced by background-extension-watch.js. The
   purpose profiles used to see only hand-written database signatures, so an
   extension could gain a powerful Chrome permission that had no signature and
   still be called RECOGNIZED. Every base capability now enters the same
   comparison. A profile must account for it explicitly or it is unexpected. */
var EXT_BASE_CAPABILITY_IDS = Object.freeze({
  '<all_urls>': 'all-site-data',
  tabs: 'tab-metadata',
  history: 'history-access',
  cookies: 'cookie-access',
  webRequest: 'network-observation',
  webRequestBlocking: 'blocking-web-request',
  proxy: 'traffic-proxy',
  debugger: 'debugger-control',
  management: 'extension-management',
  nativeMessaging: 'native-program-bridge',
  clipboardRead: 'clipboard-read',
  declarativeNetRequestWithHostAccess: 'declarative-network-control',
  downloads: 'downloads-control',
  scripting: 'script-injection',
  'combination:broad-scripting': 'script-everywhere',
  'combination:broad-sensitive-data': 'session-data-everywhere',
  'scope:finite-hosts': 'wide-finite-host-set',
  'installType:development': 'nonstandard-install',
  'installType:sideload': 'nonstandard-install',
  'installType:other': 'nonstandard-install',
});
var EXT_BASE_CAPABILITY_SEVERITIES = Object.freeze({
  'all-site-data': 'high',
  'tab-metadata': 'medium',
  'history-access': 'high',
  'cookie-access': 'high',
  'network-observation': 'medium',
  'blocking-web-request': 'high',
  'declarative-network-control': 'high',
  'traffic-proxy': 'critical',
  'debugger-control': 'critical',
  'extension-management': 'high',
  'native-program-bridge': 'critical',
  'clipboard-read': 'high',
  'downloads-control': 'medium',
  'script-injection': 'medium',
  'script-everywhere': 'high',
  'session-data-everywhere': 'critical',
  'wide-finite-host-set': 'medium',
  'nonstandard-install': 'medium',
});

function extensionReputationText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 500);
}

function extensionReputationIsoDate(value) {
  const text = extensionReputationText(value, 40);
  return /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?$/.test(text) ? text : '';
}

function compareChromeVersions(left, right) {
  const a = String(left || '').split('.').map((part) => Number((part.match(/^\d+/) || ['0'])[0]));
  const b = String(right || '').split('.').map((part) => Number((part.match(/^\d+/) || ['0'])[0]));
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function sanitizeExtensionAffected(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'all_versions' };
  if (raw.kind === 'versions') {
    const versions = Array.from(new Set((Array.isArray(raw.versions) ? raw.versions : [])
      .map((value) => extensionReputationText(value, 40)).filter(Boolean))).slice(0, 100);
    return versions.length ? { kind: 'versions', versions } : null;
  }
  if (raw.kind === 'ranges') {
    const ranges = [];
    for (const value of (Array.isArray(raw.ranges) ? raw.ranges : []).slice(0, 100)) {
      if (!value || typeof value !== 'object') continue;
      const min = extensionReputationText(value.min, 40);
      const max = extensionReputationText(value.max, 40);
      if (!min && !max) continue;
      ranges.push({ min, max });
    }
    return ranges.length ? { kind: 'ranges', ranges } : null;
  }
  return raw.kind === 'all_versions' || !raw.kind ? { kind: 'all_versions' } : null;
}

function extensionVersionAffected(version, affected) {
  if (!affected || affected.kind === 'all_versions') return true;
  if (affected.kind === 'versions') return affected.versions.includes(String(version || ''));
  if (affected.kind === 'ranges') {
    return affected.ranges.some((range) => (!range.min || compareChromeVersions(version, range.min) >= 0)
      && (!range.max || compareChromeVersions(version, range.max) <= 0));
  }
  return false;
}

/* A broad kind-profile says what password managers generally need. An exact-ID
   contract records the extra capability that one verified product documents.
   Keeping those layers separate is important: Bitwarden declaring clipboard
   read must not silently excuse the same permission on every password manager. */
function sanitizeExtensionCapabilityContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const expected = Array.from(new Set((Array.isArray(raw.expected) ? raw.expected : [])
    .map((value) => extensionReputationText(value, 80))
    .filter((value) => /^[a-z0-9-]{2,80}$/.test(value)))).slice(0, 20);
  const needs = extensionReputationText(raw.needs, 400);
  const evidence = extensionReputationText(raw.evidence, 700);
  const reference = extensionReputationText(raw.reference, 500);
  /* Per-identity exceptions require a human-readable purpose and a cited HTTPS
     source. An undocumented allow-list entry is rejected instead of trusted. */
  if (!expected.length || !needs || !evidence || !/^https:\/\//i.test(reference)) return null;
  return { expected, needs, evidence, reference };
}

function sanitizeExtensionReputationRecord(id, raw, sources, origin) {
  if (!EXTENSION_ID_RE.test(String(id || '')) || !raw || typeof raw !== 'object') return null;
  const status = extensionReputationText(raw.status, 40);
  if (!EXT_REPUTATION_STATUSES.has(status)) return null;
  const reason = extensionReputationText(raw.reason, 700);
  const reviewedAt = extensionReputationIsoDate(raw.reviewedAt);
  const affected = sanitizeExtensionAffected(raw.affected);
  if (!reason || !reviewedAt || !affected) return null;
  const sourceId = extensionReputationText(raw.source, 100);
  const sourceRaw = sourceId && sources && sources[sourceId] && typeof sources[sourceId] === 'object'
    ? sources[sourceId] : {};
  const source = {
    id: sourceId,
    label: extensionReputationText(sourceRaw.label || raw.sourceLabel || (origin === 'custom' ? 'Imported local intelligence' : ''), 180),
    reference: extensionReputationText(sourceRaw.reference || raw.reference, 500),
    retrievedAt: extensionReputationIsoDate(sourceRaw.retrievedAt || raw.retrievedAt),
  };
  if (!source.label) return null;
  return {
    id: String(id),
    name: extensionReputationText(raw.name, 180),
    status,
    reason,
    categories: Array.from(new Set((Array.isArray(raw.categories) ? raw.categories : [])
      .map((value) => extensionReputationText(value, 80)).filter(Boolean))).slice(0, 20),
    /* A category describes an extension. It does not grant permission. Only a
       bundled record may deliberately bind this exact id to a capability
       profile; imported intelligence cannot turn a category into an allowlist. */
    capabilityProfile: origin === 'custom' || status !== 'recognized_identity'
      ? '' : extensionReputationText(raw.capabilityProfile, 80),
    capabilityContract: origin === 'custom' || status !== 'recognized_identity'
      ? null : sanitizeExtensionCapabilityContract(raw.capabilityContract),
    affected,
    source,
    reviewedAt,
    origin: origin === 'custom' ? 'custom' : 'bundled',
  };
}

function sanitizeCapabilitySignature(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = extensionReputationText(raw.id, 80);
  const severity = extensionReputationText(raw.severity, 20);
  const label = extensionReputationText(raw.label, 300);
  if (!/^[a-z0-9-]{2,80}$/.test(id) || !EXT_REPUTATION_SEVERITIES.has(severity) || !label) return null;
  const cleanList = (list, max) => Array.from(new Set((Array.isArray(list) ? list : [])
    .map((value) => extensionReputationText(value, max || 160)).filter(Boolean))).slice(0, 30);
  const signature = {
    id,
    severity,
    label,
    allOf: cleanList(raw.allOf),
    anyPrefix: cleanList(raw.anyPrefix),
    installTypes: cleanList(raw.installTypes, 40),
  };
  if (!signature.allOf.length && !signature.anyPrefix.length && !signature.installTypes.length) return null;
  return signature;
}

/* What each KIND of extension is expected to be able to do. Only bundled data
   defines these: an imported local database may add evidence about identities,
   but letting an import declare that some category is allowed to hold the
   debugger would turn a reputation import into a permission allowlist. */
function sanitizeCapabilityProfiles(raw, signatures) {
  const known = new Set((signatures || []).map((signature) => signature.id)
    .concat(Object.values(EXT_BASE_CAPABILITY_IDS)));
  const out = {};
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const name of Object.keys(source).slice(0, 200)) {
    const profile = source[name];
    if (!profile || typeof profile !== 'object') continue;
    const label = extensionReputationText(profile.label, 120);
    const needs = extensionReputationText(profile.needs, 300);
    /* A capability id that matches no signature would silently be treated as
       unexpected, putting a trusted extension back in the attention list. */
    const expected = Array.from(new Set((Array.isArray(profile.expected) ? profile.expected : [])
      .map((value) => extensionReputationText(value, 80)).filter((value) => known.has(value)))).slice(0, 40);
    if (!label || !needs || !expected.length) continue;
    const evidence = extensionReputationText(profile.evidence, 700);
    const reference = extensionReputationText(profile.reference, 500);
    out[extensionReputationText(name, 80)] = { label, needs, expected, evidence, reference };
  }
  return out;
}

function extensionKnownCapabilityIds(signatures) {
  return new Set((signatures || []).map((signature) => signature.id)
    .concat(Object.values(EXT_BASE_CAPABILITY_IDS)));
}

function validateExtensionReputationDatabase(raw, options) {
  const origin = options && options.origin === 'custom' ? 'custom' : 'bundled';
  const maxEntries = origin === 'custom' ? EXT_REPUTATION_MAX_CUSTOM_ENTRIES : 100000;
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Database must be a JSON object.'], database: null };
  }
  if (Number(raw.schema) !== EXT_REPUTATION_SCHEMA) errors.push('Unsupported database schema.');
  const entriesRaw = raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {};
  const ids = Object.keys(entriesRaw);
  if (ids.length > maxEntries) errors.push('Database contains too many entries.');
  const entries = {};
  let ignoredEntries = 0;
  for (const id of ids.slice(0, maxEntries)) {
    const record = sanitizeExtensionReputationRecord(id, entriesRaw[id], raw.sources || {}, origin);
    if (!record) { ignoredEntries++; continue; }
    entries[id] = record;
  }
  if (ignoredEntries) errors.push(ignoredEntries + ' malformed entr' + (ignoredEntries === 1 ? 'y was' : 'ies were') + ' ignored.');
  const signatures = [];
  const signatureIds = new Set();
  if (origin === 'bundled') {
    for (const rawSignature of (Array.isArray(raw.capabilitySignatures) ? raw.capabilitySignatures : [])) {
      const signature = sanitizeCapabilitySignature(rawSignature);
      if (!signature || signatureIds.has(signature.id)) {
        errors.push('A malformed or duplicate capability signature was ignored.');
        continue;
      }
      signatureIds.add(signature.id);
      signatures.push(signature);
    }
    const knownCapabilities = extensionKnownCapabilityIds(signatures);
    Object.values(entries).forEach((record) => {
      if (!record.capabilityContract) return;
      const filtered = record.capabilityContract.expected.filter((id) => knownCapabilities.has(id));
      if (filtered.length !== record.capabilityContract.expected.length) {
        errors.push('An unknown per-identity capability was ignored for ' + record.id + '.');
      }
      record.capabilityContract = filtered.length
        ? Object.assign({}, record.capabilityContract, { expected: filtered }) : null;
    });
  }
  const fatal = Number(raw.schema) !== EXT_REPUTATION_SCHEMA || ids.length > maxEntries;
  return {
    ok: !fatal,
    errors,
    database: fatal ? null : {
      schema: EXT_REPUTATION_SCHEMA,
      datasetVersion: extensionReputationText(raw.datasetVersion || (origin === 'custom' ? 'local-import' : ''), 80),
      generatedAt: extensionReputationIsoDate(raw.generatedAt),
      description: extensionReputationText(raw.description, 500),
      entries,
      capabilitySignatures: signatures,
      capabilityProfiles: origin === 'custom' ? {} : sanitizeCapabilityProfiles(raw.capabilityProfiles, signatures),
      ignoredEntries,
      origin,
    },
  };
}

var extensionReputationBundledPromise = null;

async function loadExtensionReputationDatabase(options) {
  if (options && options.reload) extensionReputationBundledPromise = null;
  if (!extensionReputationBundledPromise) {
    extensionReputationBundledPromise = (async () => {
      try {
        const localUrl = chrome.runtime.getURL('extension-reputation.json');
        if (!String(localUrl).startsWith('chrome-extension://')) throw new Error('Unexpected database URL scheme.');
        const response = await fetch(localUrl, { cache: 'no-store', credentials: 'omit' });
        if (!response || !response.ok) throw new Error('Bundled database could not be read.');
        const raw = await response.json();
        const checked = validateExtensionReputationDatabase(raw, { origin: 'bundled' });
        if (!checked.ok || !checked.database) throw new Error(checked.errors.join(' ') || 'Bundled database failed validation.');
        return { available: true, error: '', warnings: checked.errors, database: checked.database };
      } catch (error) {
        return {
          available: false,
          error: extensionReputationText((error && error.message) || error || 'Database unavailable', 300),
          warnings: [],
          database: {
            schema: EXT_REPUTATION_SCHEMA,
            datasetVersion: '',
            generatedAt: '',
            description: '',
            entries: {},
            capabilitySignatures: [],
            ignoredEntries: 0,
            origin: 'bundled',
          },
        };
      }
    })();
  }
  return extensionReputationBundledPromise;
}

function chooseExtensionReputationRecord(bundled, custom) {
  if (!bundled) return custom || null;
  if (!custom) return bundled;
  const bundledRank = EXT_REPUTATION_STATUS_RANK[bundled.status] || 0;
  const customRank = EXT_REPUTATION_STATUS_RANK[custom.status] || 0;
  if (customRank !== bundledRank) return customRank > bundledRank ? custom : bundled;
  return bundled.origin === 'bundled' ? bundled : custom;
}

async function loadCombinedExtensionReputation(options) {
  const bundled = await loadExtensionReputationDatabase(options);
  let custom = null;
  try {
    const stored = await localGet(EXT_REPUTATION_CUSTOM_KEY);
    const rawCustom = stored && stored[EXT_REPUTATION_CUSTOM_KEY];
    if (rawCustom) {
      const checked = validateExtensionReputationDatabase(rawCustom, { origin: 'custom' });
      if (checked.ok) custom = checked.database;
    }
  } catch (_) {}
  const entries = Object.assign({}, bundled.database.entries);
  const entryCandidates = {};
  for (const id of Object.keys(bundled.database.entries)) {
    entryCandidates[id] = [bundled.database.entries[id]];
  }
  if (custom) {
    for (const id of Object.keys(custom.entries)) {
      if (!entryCandidates[id]) entryCandidates[id] = [];
      entryCandidates[id].push(custom.entries[id]);
      entries[id] = chooseExtensionReputationRecord(entries[id], custom.entries[id]);
    }
  }
  const bundledStatuses = Object.values(bundled.database.entries).reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {});
  return {
    available: bundled.available,
    error: bundled.error,
    warnings: bundled.warnings,
    schema: EXT_REPUTATION_SCHEMA,
    datasetVersion: bundled.database.datasetVersion,
    generatedAt: bundled.database.generatedAt,
    entries,
    entryCandidates,
    capabilitySignatures: bundled.database.capabilitySignatures,
    capabilityProfiles: bundled.database.capabilityProfiles || {},
    bundledRecordCount: Object.keys(bundled.database.entries).length,
    customRecordCount: custom ? Object.keys(custom.entries).length : 0,
    ignoredEntries: bundled.database.ignoredEntries + (custom ? custom.ignoredEntries : 0),
    bundledStatuses,
  };
}

function extensionReputationRecordDigest(record, capabilityProfile) {
  if (!record) return '';
  return JSON.stringify({
    id: record.id,
    status: record.status,
    reason: record.reason,
    categories: record.categories,
    capabilityProfile: record.capabilityProfile,
    capabilityContract: record.capabilityContract,
    affected: record.affected,
    source: record.source,
    reviewedAt: record.reviewedAt,
    origin: record.origin,
    /* Profile rules are security policy. Changing one must invalidate a saved
       access decision even when the extension and record did not change. */
    capabilityPolicy: capabilityProfile || null,
  });
}

function reputationLabel(status) {
  return ({
    known_harmful: 'Known harmful — exact ID match',
    reported_harmful: 'Reported harmful — exact ID match',
    historical_incident: 'Historical security incident — exact ID match',
    recognized_identity: 'Recognized identity — exact ID match',
    catalogued_listing: 'Catalogued Chrome Web Store listing — exact ID match',
    database_unavailable: 'Local reputation database unavailable',
    no_record: 'No local reputation record',
  })[status] || 'No local reputation record';
}

/* Does the installed extension call itself roughly what the catalogue expects?

   Deliberately loose. Publishers localise their names, append taglines and
   rename between releases -- "Bitwarden Password Manager" ships as "Bitwarden"
   in places, and demanding an exact string would withhold recognition from the
   very extensions this exists to reassure people about. One shared distinctive
   word is enough, which is a low bar for the real product and a high one for an
   unrelated extension that happens to share a mistyped ID. */
function extensionNameCorroborates(installedName, recordName) {
  const expected = extensionReputationText(recordName, 180).toLowerCase();
  if (!expected) return true;
  const actual = extensionReputationText(installedName, 180).toLowerCase();
  if (!actual) return false;
  const words = (text) => new Set(text.split(/[^a-z0-9]+/).filter((word) => word.length >= 3
    /* Words every second extension uses carry no evidence either way. */
    && ["the", "and", "for", "web", "app", "free", "new", "pro", "plus", "chrome", "browser",
      "extension", "tool", "tools", "manager", "password", "privacy", "security", "blocker",
      "search", "protection", "official", "legacy", "listing"].indexOf(word) < 0));
  const expectedWords = words(expected);
  /* A name with no [a-z0-9] words left after splitting is not a name with no
     content -- it is Chinese, Korean, Japanese, Russian or Arabic. Returning
     true here meant corroboration silently did nothing for every non-Latin
     extension in the catalogue, so a wrong ID on one of those would have been
     recognised rather than withheld. Compare the whole normalised string
     instead, which works for any script. */
  if (!expectedWords.size) {
    const squash = (text) => text.replace(/\s+/g, '');
    const a = squash(actual);
    const b = squash(expected);
    return !!(a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0));
  }
  const actualWords = words(actual);
  for (const word of expectedWords) {
    if (actualWords.has(word)) return true;
  }
  /* Fall back to substring either way, for one-word names and for the case
     where the installed name is a shortened form of the recorded one. */
  const squash = (text) => text.replace(/[^a-z0-9]+/g, "");
  const a = squash(actual);
  const b = squash(expected);
  return !!(a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0));
}
function lookupExtensionReputation(extension, database) {
  const id = String((extension && extension.id) || '');
  const fallbackRecord = database && database.entries && database.entries[id];
  const candidates = database && database.entryCandidates && Array.isArray(database.entryCandidates[id])
    ? database.entryCandidates[id] : (fallbackRecord ? [fallbackRecord] : []);
  const matching = candidates.filter((candidate) => extensionVersionAffected(extension && extension.version, candidate.affected));
  const record = matching.reduce((best, candidate) => chooseExtensionReputationRecord(best, candidate), null);
  /* An exact ID match is the strongest signal available, and it is only as good
     as the ID. A catalogue of hundreds of hand-recorded identities will
     eventually contain a wrong one, and a wrong ID in the RECOGNISED direction
     is the dangerous kind: it would tell someone an unknown extension is the
     official Bitwarden.
     So recognition additionally requires the installed extension's name to
     resemble the name on the record. Nothing else does -- a documented
     compromise still applies on ID alone, because an attacker renaming their
     copy must not shed its history. This makes a bad ID fail closed: the worst
     case becomes a missing reassurance rather than a false one. */
  if (record && (record.status === 'recognized_identity' || record.status === 'catalogued_listing')
      && !extensionNameCorroborates(extension && extension.name, record.name)) {
    return {
      status: 'no_record',
      label: reputationLabel('no_record'),
      exactMatch: false,
      reason: 'This extension ID is listed in the local catalogue as "' + record.name
        + '", but the installed extension calls itself something else. Recognition was withheld.',
      categories: [],
      source: null,
      reviewedAt: '',
      recordDigest: '',
      origin: '',
      capabilityProfile: '',
      capabilityContract: null,
      nameMismatch: true,
    };
  }
  if (record) {
    const profile = record.capabilityProfile && database && database.capabilityProfiles
      ? database.capabilityProfiles[record.capabilityProfile] : null;
    return {
      status: record.status,
      label: reputationLabel(record.status),
      exactMatch: true,
      reason: record.reason,
      categories: record.categories.slice(),
      capabilityProfile: record.capabilityProfile || '',
      capabilityContract: record.capabilityContract ? Object.assign({}, record.capabilityContract) : null,
      source: Object.assign({}, record.source),
      reviewedAt: record.reviewedAt,
      recordDigest: extensionReputationRecordDigest(record, profile),
      origin: record.origin,
    };
  }
  if (!database || !database.available) {
    return {
      status: 'database_unavailable',
      label: reputationLabel('database_unavailable'),
      exactMatch: false,
      reason: (database && database.error) || 'The bundled local database could not be read.',
      source: null,
      reviewedAt: '',
      recordDigest: '',
      origin: '',
      capabilityProfile: '',
      capabilityContract: null,
    };
  }
  return {
    status: 'no_record',
    label: reputationLabel('no_record'),
    exactMatch: false,
    reason: 'No exact ID and affected-version match exists in the local database. This is not proof that the extension is safe.',
    source: null,
    reviewedAt: '',
    recordDigest: '',
    origin: '',
    capabilityProfile: '',
    capabilityContract: null,
  };
}

function extensionSignatureMatches(signature, tokens, installType) {
  if (signature.allOf.length && !signature.allOf.every((token) => tokens.has(token))) return false;
  if (signature.anyPrefix.length && !signature.anyPrefix.some((prefix) => Array.from(tokens).some((token) => token.startsWith(prefix)))) return false;
  if (signature.installTypes.length && !signature.installTypes.includes(String(installType || 'unknown'))) return false;
  return true;
}

function mergeExtensionAccessRisk(extension, database) {
  const base = classifyExtensionRisk(extension);
  const tokens = new Set(base.permissions || Array.from(extPermSet(extension)));
  const matchMap = new Map();
  let level = base.level;
  const addMatch = (id, severity, label) => {
    if (!id || !EXT_REPUTATION_SEVERITIES.has(severity) || !label) return;
    const current = matchMap.get(id);
    if (!current || (EXT_ACCESS_RANK[severity] || 0) > (EXT_ACCESS_RANK[current.severity] || 0)) {
      matchMap.set(id, { id, severity, label });
    }
  };
  for (const signature of (database && database.capabilitySignatures) || []) {
    if (!extensionSignatureMatches(signature, tokens, extension && extension.installType)) continue;
    addMatch(signature.id, signature.severity, signature.label);
    if ((EXT_ACCESS_RANK[signature.severity] || 0) > (EXT_ACCESS_RANK[level] || 0)) level = signature.severity;
  }
  /* Do not let a missing database signature make a Chrome capability vanish
     from the contract comparison. classifyExtensionRisk already gives every
     material fact a stable permission token, which is mapped here. */
  for (const capability of (base.capabilities || [])) {
    const id = EXT_BASE_CAPABILITY_IDS[String(capability.permission || '')];
    if (!id) continue;
    const severity = EXT_BASE_CAPABILITY_SEVERITIES[id]
      || ((Number(capability.weight) || 0) >= 5 ? 'high' : ((Number(capability.weight) || 0) >= 2 ? 'medium' : 'low'));
    addMatch(id, severity, String(capability.label || id));
  }
  const finiteHosts = Array.from(tokens).filter((token) => token.startsWith('host:') && token !== 'host:file:///*').length;
  if (finiteHosts >= 25) {
    const hostLevel = finiteHosts >= 100 ? 'high' : 'medium';
    addMatch('wide-finite-host-set', hostLevel, 'Can access ' + finiteHosts + ' separately listed site patterns');
    if ((EXT_ACCESS_RANK[hostLevel] || 0) > (EXT_ACCESS_RANK[level] || 0)) level = hostLevel;
  }
  const matches = Array.from(matchMap.values()).sort((a, b) => (EXT_ACCESS_RANK[b.severity] || 0)
    - (EXT_ACCESS_RANK[a.severity] || 0) || a.label.localeCompare(b.label));
  const reasons = Array.from(new Set(matches.map((item) => item.label).concat(base.flags || [])));
  if (!reasons.length) reasons.push('No high-impact Chrome permission combination was found');
  return {
    level,
    score: base.score,
    reasons,
    signatures: matches,
    permissions: Array.from(tokens).sort(),
    finiteHostCount: finiteHosts,
    chromeWarnings: [],
  };
}

function extensionReviewSnapshot(extension, reputation, access) {
  return {
    id: String((extension && extension.id) || ''),
    name: extensionReputationText(extension && extension.name, 180),
    version: extensionReputationText(extension && extension.version, 80),
    installType: extensionReputationText(extension && extension.installType || 'unknown', 40),
    permissions: ((access && access.permissions) || Array.from(extPermSet(extension))).slice().sort(),
    reputationRecord: String((reputation && reputation.recordDigest) || ''),
    reputationStatus: String((reputation && reputation.status) || 'no_record'),
  };
}

/* What actually invalidates a review.
 *
 * The snapshot records the name and version too, and comparing those was making
 * every routine auto-update re-open a review that had already been done. Chrome
 * updates extensions constantly, so "Needs attention" refilled with REVIEW
 * UPDATE cards for things nobody had touched -- including extensions with no
 * meaningful access at all, which is how a low-risk utility ended up sitting in
 * a warning list.
 *
 * A version bump on its own tells you nothing: the question a review answers is
 * "am I happy with what this can reach", and that answer only changes when what
 * it can reach changes. So the version is kept for display and for the change
 * timeline -- which reports version moves separately and does it better -- and
 * is not compared here.
 *
 * The name stays material, which is not an inconsistency. Versions move on their
 * own, constantly, without anyone deciding anything. A rename is somebody's
 * decision, it is rare, and a quiet one is a known shape of extension hijack, so
 * it is worth asking about exactly once. */
var EXT_REVIEW_MATERIAL_FIELDS = ['id', 'name', 'installType', 'permissions', 'reputationRecord', 'reputationStatus'];

function materialExtensionReviewSnapshot(snapshot) {
  const out = {};
  if (!snapshot || typeof snapshot !== 'object') return out;
  EXT_REVIEW_MATERIAL_FIELDS.forEach((field) => {
    out[field] = Array.isArray(snapshot[field]) ? snapshot[field].slice().sort() : (snapshot[field] || '');
  });
  return out;
}

/* stored first, current second -- the direction matters below. */
function sameExtensionReviewSnapshot(stored, current) {
  if (!stored || !current) return false;
  const before = materialExtensionReviewSnapshot(stored);
  const after = materialExtensionReviewSnapshot(current);
  /* The evidence record changing is usually a reason to look again -- but not
     when it changed in the reassuring direction. Adding an extension to the
     catalogue made its record digest move from nothing to something, which
     re-opened review on everything newly recognised: an extension people had
     already looked at, with no meaningful access, reappeared in "Needs
     attention" because WardenOne had learned who it was. Learning something
     good about an extension must not read as a change in the extension. */
  /* Not a rank comparison: the scale puts no_record at 0 and recognized_identity
     at 1, so "we learned what this is" looks like an increase while being the
     most reassuring thing that can happen. What matters is whether the NEW
     record says something adverse -- an incident or worse. Anything below that
     is either no information or good information, and neither is a reason to ask
     someone to look again. */
  const gainedIdentityContext = (before.reputationStatus === 'no_record'
      && (after.reputationStatus === 'catalogued_listing' || after.reputationStatus === 'recognized_identity'))
    || (before.reputationStatus === 'catalogued_listing' && after.reputationStatus === 'recognized_identity');
  if (before.reputationRecord !== after.reputationRecord && gainedIdentityContext) {
    before.reputationRecord = after.reputationRecord;
    before.reputationStatus = after.reputationStatus;
  }
  return JSON.stringify(before) === JSON.stringify(after);
}

function extensionChangeView(item) {
  if (!item) return null;
  return {
    eventId: item.eventId,
    kind: item.kind,
    severity: item.severity,
    summary: item.summary,
    reasons: Array.isArray(item.reasons) ? item.reasons.slice() : [],
    fromVersion: item.fromVersion || '',
    toVersion: item.toVersion || '',
    when: Number(item.when) || 0,
    reviewed: !!item.reviewedAt,
    gainedPermissions: Array.isArray(item.gainedPermissions) ? item.gainedPermissions.slice() : [],
    removedPermissions: Array.isArray(item.removedPermissions) ? item.removedPermissions.slice() : [],
    accessChanged: !!item.accessChanged,
    installType: extensionReputationText(item.installType || 'unknown', 40),
  };
}

function latestExtensionChange(id, alerts) {
  const item = (Array.isArray(alerts) ? alerts : []).find((event) => event && event.id === id && event.kind !== 'removed');
  return extensionChangeView(item);
}

/* A quiet new event must not hide an older permission gain that still needs a
   decision. Prefer the strongest unreviewed event, then the newest one. */
function pendingActionableExtensionChange(id, alerts) {
  const items = (Array.isArray(alerts) ? alerts : []).filter((event) => event && event.id === id
    && event.kind !== 'removed' && !event.reviewedAt
    && (EXT_ACCESS_RANK[event.severity] || 0) >= EXT_ACCESS_RANK.medium);
  items.sort((a, b) => (EXT_ACCESS_RANK[b.severity] || 0) - (EXT_ACCESS_RANK[a.severity] || 0)
    || (Number(b.when) || 0) - (Number(a.when) || 0));
  return extensionChangeView(items[0]);
}

/* What this extension is expected to be able to do, given what it is.
 *
 * The catalogue could previously only say "powerful", and everything worth
 * recognising is powerful: a password manager that cannot read the page cannot
 * fill anything in. So an exactly-matched official Bitwarden was recognised and
 * then flagged REVIEW ACCESS for the single capability that makes it a password
 * manager -- which trains people to dismiss the warning, and a warning everyone
 * dismisses protects nobody.
 *
 * With a profile the question stops being "is this powerful" and becomes "is
 * this powerful in the way this kind of extension is powerful". A password
 * manager reaching a desktop app is a password manager. A password manager that
 * can suddenly route your traffic through a proxy is a story.
 */
function extensionCapabilityProfile(reputation, database) {
  const profiles = (database && database.capabilityProfiles) || {};
  /* Categories are display metadata. Only an explicit binding on a bundled
     exact-id record may grant an expected-capability contract. */
  if (!reputation || reputation.status !== 'recognized_identity' || reputation.origin !== 'bundled') return null;
  const profileName = String(reputation.capabilityProfile || '');
  const profile = profileName && profiles[profileName];
  if (!profile) return null;
  const contract = reputation.capabilityContract && typeof reputation.capabilityContract === 'object'
    ? reputation.capabilityContract : null;
  return {
    category: profileName,
    label: String(profile.label || profileName),
    needs: String((contract && contract.needs) || profile.needs || ''),
    expected: Array.from(new Set((Array.isArray(profile.expected) ? profile.expected : [])
      .concat(contract && Array.isArray(contract.expected) ? contract.expected : []))),
    evidence: String((contract && contract.evidence) || profile.evidence || ''),
    reference: String((contract && contract.reference) || profile.reference || ''),
    identitySpecific: !!contract,
  };
}

/* Split what the extension can do into "this is what it is for" and "this is
   not". Only an exactly recognised identity earns the split: for anything else
   there is no claim about what it is, so no claim about what it should need. */
function splitExtensionCapabilities(reputation, access, database) {
  const signatures = (access && Array.isArray(access.signatures)) ? access.signatures : [];
  const recognised = reputation && reputation.status === 'recognized_identity' && reputation.origin === 'bundled';
  const profile = recognised ? extensionCapabilityProfile(reputation, database) : null;
  if (!profile) {
    return { profile: null, expected: [], unexpected: [], allExpected: false };
  }
  const expected = [];
  const unexpected = [];
  signatures.forEach((signature) => {
    /* Medium capabilities remain visible but do not interrupt. Install source
       is judged separately because it changes whether the exact-id identity
       claim can be relied upon at all. */
    if ((EXT_ACCESS_RANK[signature.severity] || 0) < EXT_ACCESS_RANK.high) return;
    (profile.expected.indexOf(signature.id) >= 0 ? expected : unexpected).push(signature);
  });
  return {
    profile,
    expected,
    unexpected,
    allExpected: unexpected.length === 0,
  };
}

function buildExtensionAssessment(extension, database, reviews, alerts, permissionWarnings) {
  const reputation = lookupExtensionReputation(extension, database);
  const access = mergeExtensionAccessRisk(extension, database);
  access.chromeWarnings = Array.isArray(permissionWarnings) ? permissionWarnings.map(String).slice(0, 20) : [];
  const snapshot = extensionReviewSnapshot(extension, reputation, access);
  const storedReview = reviews && reviews[extension.id];
  const reviewed = !!(storedReview && sameExtensionReviewSnapshot(storedReview.snapshot, snapshot));
  const reviewStale = !!storedReview && !reviewed;
  const change = latestExtensionChange(extension.id, alerts);
  const pendingChange = pendingActionableExtensionChange(extension.id, alerts);
  const unreadChange = !!pendingChange;
  const capabilities = splitExtensionCapabilities(reputation, access, database);
  const reputationRank = EXT_REPUTATION_STATUS_RANK[reputation.status] || 0;
  const accessRank = EXT_ACCESS_RANK[access.level] || 0;
  let verdict = { code: 'no_known_warning', label: 'NO KNOWN WARNING', tone: 'calm', needsAttention: false };
  let recommendedAction = 'Keep monitoring for meaningful changes';
  if (reputation.status === 'known_harmful') {
    verdict = { code: 'known_harmful', label: 'KNOWN HARMFUL', tone: 'danger', needsAttention: true };
    recommendedAction = 'Remove this extension';
  } else if (reputation.status === 'reported_harmful') {
    verdict = { code: 'reported_harmful', label: 'REPORTED HARMFUL', tone: 'danger', needsAttention: true };
    recommendedAction = 'Keep it disabled and investigate the evidence';
  } else if (reputation.status === 'historical_incident') {
    verdict = { code: 'historical_incident', label: 'SECURITY INCIDENT', tone: 'danger', needsAttention: true };
    recommendedAction = 'Remove the legacy or compromised extension';
  } else if (reputation.status === 'recognized_identity' && reputation.origin === 'bundled'
      && !['normal', 'admin'].includes(String(extension.installType || 'unknown'))) {
    verdict = { code: 'identity_source_mismatch', label: 'SOURCE DOES NOT MATCH', tone: 'danger', needsAttention: true };
    recommendedAction = 'This official identity is loaded outside Chrome\'s normal or administrator-managed install flow; reinstall it from the cited official listing';
  } else if (capabilities.unexpected.length) {
    const first = capabilities.unexpected[0];
    verdict = {
      code: 'unexpected_capability',
      label: 'UNEXPECTED ACCESS',
      tone: first.severity === 'critical' ? 'danger' : 'warning',
      needsAttention: true,
    };
    recommendedAction = 'Check why ' + capabilities.profile.label + ' needs this: ' + String(first.label || '').toLowerCase();
  } else if (unreadChange && reputation.status === 'recognized_identity' && capabilities.profile
      && (pendingChange.kind === 'installed' || pendingChange.kind === 'enabled')) {
    /* The watcher scores a first install or re-enable from the extension's
       entire capability set. When every powerful capability is covered by this
       exact identity's contract, keep the event in the timeline without turning
       the normal install itself into an access alarm. */
    verdict = { code: 'expected_install_change', label: 'EXPECTED INSTALL EVENT', tone: 'info', needsAttention: false };
    recommendedAction = 'The install event is recorded; its current powerful access matches the verified purpose for ' + capabilities.profile.label;
  } else if (unreadChange) {
    verdict = { code: 'access_changed', label: 'ACCESS CHANGED', tone: pendingChange.severity === 'critical' ? 'danger' : 'warning', needsAttention: true };
    recommendedAction = 'Review the new access before continuing to use it';
  } else if (reviewStale) {
    verdict = { code: 'review_stale', label: 'REVIEW UPDATE', tone: 'warning', needsAttention: true };
    recommendedAction = 'Review its current access, identity and install source';
  } else if (reputation.status === 'recognized_identity' && capabilities.profile) {
    /* Recognised, and everything it can do is what this kind of extension is for.
       This is the branch Bitwarden belongs in, and it used to be unreachable:
       the powerful-access test sat above it, so an exactly-matched official
       password manager was flagged for being able to fill in passwords. Every
       extension worth recognising is powerful, so recognition bought nothing and
       the warning list filled with things nobody should act on. */
    verdict = { code: 'recognized_expected', label: 'RECOGNIZED', tone: 'calm', needsAttention: false };
    recommendedAction = capabilities.expected.length
      ? 'Normal for ' + capabilities.profile.label + ': it needs to ' + capabilities.profile.needs
      : 'Nothing here needs your attention';
  } else if (reputation.status === 'catalogued_listing' && !reviewed && accessRank >= EXT_ACCESS_RANK.high) {
    verdict = { code: 'catalogued_powerful', label: 'VERIFY THIS LISTING', tone: 'warning', needsAttention: true };
    recommendedAction = 'The exact ID matches a catalogued Chrome Web Store listing, but its publisher and powerful access are not yet verified';
  } else if (!reviewed && accessRank >= EXT_ACCESS_RANK.high) {
    /* Powerful, and we cannot say what it is. That combination is the one that
       genuinely deserves a look -- which is what this verdict was always trying
       to say, and could not, while it was also firing on everything known. */
    verdict = { code: 'powerful_access', label: 'REVIEW ACCESS', tone: 'warning', needsAttention: true };
    recommendedAction = reputation.status === 'recognized_identity'
      ? 'The identity record has no verified capability contract yet; check that this powerful access matches what it does'
      : 'This is not in the local catalogue and has powerful access; check you meant to install it';
  } else if (reputation.status === 'database_unavailable') {
    verdict = { code: 'database_unavailable', label: 'DATABASE UNAVAILABLE', tone: 'info', needsAttention: false };
    recommendedAction = 'Restore or reload WardenOne before relying on local reputation results';
  } else if (reputation.status === 'recognized_identity') {
    verdict = { code: 'recognized_identity', label: 'RECOGNIZED IDENTITY', tone: 'info', needsAttention: false };
    recommendedAction = reviewed ? 'Continue monitoring this reviewed snapshot' : 'Review its access; recognition is not a safety guarantee';
  } else if (reputation.status === 'catalogued_listing') {
    verdict = { code: 'catalogued_listing', label: 'CATALOGUED LISTING', tone: 'info', needsAttention: false };
    recommendedAction = 'The listing name is known locally; publisher identity and safety have not been verified';
  } else if (reviewed) {
    verdict = { code: 'reviewed_snapshot', label: 'REVIEWED SNAPSHOT', tone: 'calm', needsAttention: false };
    recommendedAction = 'WardenOne will re-open review if this snapshot changes';
  } else if (accessRank >= EXT_ACCESS_RANK.medium) {
    verdict = { code: 'review_recommended', label: 'REVIEW RECOMMENDED', tone: 'info', needsAttention: true };
    recommendedAction = 'Check that the listed access matches what the extension does';
  }
  /* Last word: an extension with no adverse record, no unreviewed change and no
     meaningful reach has nothing interesting about it, and must never appear in
     "Needs attention" whatever the branches above concluded. A low-access
     utility sitting in a warning list next to a compromised extension is how the
     list stops being read -- and the branches above have now twice found a way
     to put one there, once through a version bump and once through the database
     learning the extension's name. This is the floor under both. */
  if (verdict.needsAttention
      /* Not "=== 0". That meant the floor only caught extensions nothing was
         known about, so a RECOGNISED extension with no meaningful access -- the
         least interesting thing in the list -- could not reach it, because being
         recognised raises the rank to 1. What matters is that nothing ADVERSE is
         recorded. */
      && reputationRank < EXT_REPUTATION_STATUS_RANK.historical_incident
      && accessRank <= EXT_ACCESS_RANK.low
      && !unreadChange
      && !capabilities.unexpected.length) {
    verdict = { code: 'nothing_of_note', label: 'NOTHING OF NOTE', tone: 'calm', needsAttention: false };
    /* Careful with this wording: something may well have changed -- a rename is
       one of the ways to arrive here. What is true is that it cannot reach
       anything and nothing is recorded against it. */
    recommendedAction = 'It cannot reach anything sensitive and nothing is recorded against it';
  }
  if (!extension.enabled && reputationRank < EXT_REPUTATION_STATUS_RANK.reported_harmful) {
    recommendedAction += '; it is currently disabled';
  }
  return {
    capabilities: {
      profile: capabilities.profile,
      expected: capabilities.expected,
      unexpected: capabilities.unexpected,
    },
    id: String(extension.id),
    name: extensionReputationText(extension.name || '(unknown extension)', 180),
    description: extensionReputationText(extension.description, 500),
    version: extensionReputationText(extension.version, 80),
    enabled: !!extension.enabled,
    disabledReason: extensionReputationText(extension.disabledReason, 80),
    mayDisable: extension.mayDisable !== false,
    installType: extensionReputationText(extension.installType || 'unknown', 40),
    homepageUrl: extensionReputationText(extension.homepageUrl, 500),
    reputation,
    access,
    latestChange: change,
    pendingChange,
    review: {
      reviewed,
      stale: reviewStale,
      reviewedAt: reviewed ? Number(storedReview.reviewedAt) || 0 : 0,
      snapshot,
    },
    verdict,
    recommendedAction,
  };
}

/* Bands, not a weighted sum.
 *
 * The old score multiplied reputation rank by 100, and recognized_identity is
 * rank 1 -- so a recognised, entirely quiet extension scored 100 and sorted
 * above an unrecognised one that needed attention. Recognition outweighed the
 * finding, which is backwards: knowing what something is should decide how it is
 * JUDGED, never whether it is shown first.
 *
 * What someone opening this page wants, in order: the things asking something of
 * them worst-first, then the things nobody has identified, then the quiet ones
 * they do not need to read. */
var EXT_SORT_BAND = {
  documentedIncident: 60,
  unexpectedOrChanged: 50,
  otherAttention: 40,
  unidentified: 20,
  quiet: 10,
};

function extensionAssessmentSortBand(item) {
  const verdict = item.verdict || {};
  const reputation = item.reputation || {};
  if (verdict.needsAttention) {
    if ((EXT_REPUTATION_STATUS_RANK[reputation.status] || 0)
        >= EXT_REPUTATION_STATUS_RANK.historical_incident) return EXT_SORT_BAND.documentedIncident;
    if (verdict.code === 'unexpected_capability' || verdict.code === 'access_changed') {
      return EXT_SORT_BAND.unexpectedOrChanged;
    }
    return EXT_SORT_BAND.otherAttention;
  }
  /* Not a warning, but nobody has written down what it is. Worth being above the
     extensions we can account for. */
  if (reputation.status === 'no_record') return EXT_SORT_BAND.unidentified;
  return EXT_SORT_BAND.quiet;
}

function extensionAssessmentSortScore(item) {
  /* Within a band, more reach first, and a disabled extension last -- it cannot
     do anything until someone turns it back on. */
  let score = extensionAssessmentSortBand(item);
  score += (EXT_ACCESS_RANK[(item.access || {}).level] || 0) * 0.5;
  if (!item.enabled) score -= 5;
  return score;
}

function extensionPermissionWarnings(id) {
  return new Promise((resolve) => {
    if (!chrome.management || typeof chrome.management.getPermissionWarningsById !== 'function') { resolve([]); return; }
    let settled = false;
    const done = (warnings) => { if (!settled) { settled = true; resolve(Array.isArray(warnings) ? warnings : []); } };
    try {
      const result = chrome.management.getPermissionWarningsById(id, done);
      if (result && typeof result.then === 'function') result.then(done, () => done([]));
    } catch (_) { done([]); }
  });
}

function makeReputationChangeEvent(assessment, previous, now) {
  const status = assessment.reputation.status;
  const from = previous ? previous.status : 'no_record';
  let severity = 'low';
  let summary = 'Local extension reputation changed';
  let reasons = [assessment.reputation.reason];
  if (status === 'known_harmful') {
    severity = 'critical';
    summary = 'Exact ID now matches a known-harmful local record';
  } else if (status === 'reported_harmful') {
    severity = 'high';
    summary = 'Exact ID now matches a reported-harmful local record';
  } else if (status === 'historical_incident') {
    severity = 'high';
    summary = 'Exact ID matches a documented historical security incident';
  } else if (status === 'recognized_identity') {
    summary = 'Exact ID now has recognized-identity context';
  } else {
    summary = 'A previous local reputation record no longer matches';
    reasons = ['This does not prove the extension is safe; it now has no exact local reputation record.'];
  }
  const current = {
    id: assessment.id,
    name: assessment.name,
    version: assessment.version,
    enabled: assessment.enabled,
    installType: assessment.installType,
    permissions: assessment.access.permissions,
  };
  const event = makeExtensionEvent('reputation_changed', current, null, {
    when: now,
    severity,
    summary,
    reasons,
    reputationFrom: from,
    reputationTo: status,
  });
  event.eventId = assessment.id + '-' + now + '-reputation';
  return event;
}

async function persistExtensionReputationState(assessments) {
  const now = Date.now();
  const stored = await localGet([EXT_REPUTATION_STATE_KEY, EXT_ALERTS_KEY]);
  const rawState = stored && stored[EXT_REPUTATION_STATE_KEY];
  const previousMap = rawState && rawState.extensions && typeof rawState.extensions === 'object' ? rawState.extensions : {};
  const nextMap = {};
  const events = [];
  for (const assessment of assessments) {
    const previous = previousMap[assessment.id];
    if (assessment.reputation.status === 'database_unavailable') {
      /* A transient read failure is not a reputation change. Preserve the last
         validated state instead of filling the real change ledger with an outage
         event for every installed extension (and another wave on recovery). */
      if (previous && previous.status !== 'database_unavailable') nextMap[assessment.id] = previous;
      continue;
    }
    const state = {
      status: assessment.reputation.status,
      recordDigest: assessment.reputation.recordDigest,
      name: assessment.name,
      version: assessment.version,
    };
    nextMap[assessment.id] = state;
    const comparablePrevious = previous && previous.status !== 'database_unavailable' ? previous : null;
    const currentActionable = (EXT_REPUTATION_STATUS_RANK[state.status] || 0) >= EXT_REPUTATION_STATUS_RANK.historical_incident;
    const previousActionable = comparablePrevious
      && (EXT_REPUTATION_STATUS_RANK[comparablePrevious.status] || 0) >= EXT_REPUTATION_STATUS_RANK.historical_incident;
    const changed = comparablePrevious
      && (comparablePrevious.status !== state.status || comparablePrevious.recordDigest !== state.recordDigest);
    if ((!comparablePrevious && currentActionable) || (changed && (currentActionable || previousActionable))) {
      events.push(makeReputationChangeEvent(assessment, comparablePrevious, now));
    }
  }
  const update = {
    [EXT_REPUTATION_STATE_KEY]: { schema: EXT_REPUTATION_SCHEMA, checkedAt: now, extensions: nextMap },
  };
  if (events.length) {
    const oldAlerts = Array.isArray(stored && stored[EXT_ALERTS_KEY]) ? stored[EXT_ALERTS_KEY] : [];
    update[EXT_ALERTS_KEY] = events.concat(oldAlerts).slice(0, 60);
  }
  await localSet(update);
  if (events.length) {
    try { logExtensionEvents(events); } catch (_) {}
    try { await notifyExtensionEvents(events); } catch (_) {}
  }
  return events;
}

var extensionSecurityReportQueue = Promise.resolve(null);

async function buildExtensionSecurityReportNow(options) {
  const trigger = extensionReputationText(options && options.trigger || 'report', 80);
  if (!options || options.reconcileWatch !== false) {
    try { await reconcileExtensionChanges(trigger); } catch (_) {}
  }
  const database = await loadCombinedExtensionReputation(options && options.reloadDatabase ? { reload: true } : null);
  const all = await getAllExtensions();
  const installed = all.filter((extension) => extension && extension.type === 'extension' && extension.id !== chrome.runtime.id);
  const stored = await localGet([EXT_REPUTATION_REVIEWS_KEY, EXT_ALERTS_KEY, EXT_WATCH_STATUS_KEY]);
  const reviews = stored && stored[EXT_REPUTATION_REVIEWS_KEY] && typeof stored[EXT_REPUTATION_REVIEWS_KEY] === 'object'
    ? stored[EXT_REPUTATION_REVIEWS_KEY] : {};
  let alerts = Array.isArray(stored && stored[EXT_ALERTS_KEY]) ? stored[EXT_ALERTS_KEY] : [];
  const includeWarnings = !options || options.includePermissionWarnings !== false;
  const warnings = includeWarnings
    ? await Promise.all(installed.map((extension) => extensionPermissionWarnings(extension.id)))
    : installed.map(() => []);
  const assessments = installed.map((extension, index) => buildExtensionAssessment(extension, database, reviews, alerts, warnings[index]));
  const reputationEvents = await persistExtensionReputationState(assessments);
  if (reputationEvents.length) {
    alerts = reputationEvents.concat(alerts).slice(0, 60);
    for (const assessment of assessments) {
      const newest = latestExtensionChange(assessment.id, reputationEvents);
      if (newest) assessment.latestChange = newest;
    }
  }
  assessments.sort((a, b) => extensionAssessmentSortScore(b) - extensionAssessmentSortScore(a)
    || a.name.localeCompare(b.name));
  const summary = {
    installed: assessments.length,
    attention: assessments.filter((item) => item.verdict.needsAttention).length,
    knownHarmful: assessments.filter((item) => item.reputation.status === 'known_harmful').length,
    reportedOrHistorical: assessments.filter((item) => item.reputation.status === 'reported_harmful' || item.reputation.status === 'historical_incident').length,
    changed: assessments.filter((item) => item.latestChange && !item.latestChange.reviewed).length,
    unknown: assessments.filter((item) => item.reputation.status === 'no_record').length,
    catalogued: assessments.filter((item) => item.reputation.status === 'catalogued_listing').length,
    verifiedIdentities: assessments.filter((item) => item.reputation.status === 'recognized_identity').length,
    reviewed: assessments.filter((item) => item.review.reviewed).length,
    /* Named separately from "reviewed" because they answer different questions.
       Reviewed means you looked at it. Recognised means the catalogue knows what
       it is, and everything it can do is what that kind of extension does -- the
       reassuring count, and the one worth showing when nothing needs attention. */
    recognized: assessments.filter((item) => item.verdict.code === 'recognized_expected').length,
  };
  return {
    ok: true,
    scannedAt: Date.now(),
    localOnly: true,
    watcher: (stored && stored[EXT_WATCH_STATUS_KEY]) || null,
    database: {
      available: database.available,
      local: true,
      error: database.error,
      warnings: database.warnings,
      schema: database.schema,
      datasetVersion: database.datasetVersion,
      generatedAt: database.generatedAt,
      bundledRecordCount: database.bundledRecordCount,
      customRecordCount: database.customRecordCount,
      capabilitySignatureCount: database.capabilitySignatures.length,
      ignoredEntries: database.ignoredEntries,
      verifiedIdentityRecordCount: Number(database.bundledStatuses && database.bundledStatuses.recognized_identity) || 0,
      cataloguedListingRecordCount: Number(database.bundledStatuses && database.bundledStatuses.catalogued_listing) || 0,
      incidentRecordCount: ['known_harmful', 'reported_harmful', 'historical_incident']
        .reduce((total, status) => total + (Number(database.bundledStatuses && database.bundledStatuses[status]) || 0), 0),
    },
    summary,
    extensions: assessments,
    recentChanges: alerts.slice(0, 20),
  };
}

function buildExtensionSecurityReport(options) {
  const run = () => buildExtensionSecurityReportNow(options || {});
  extensionSecurityReportQueue = extensionSecurityReportQueue.catch(() => null).then(run);
  return extensionSecurityReportQueue;
}

async function findInstalledExtension(id) {
  if (!EXTENSION_ID_RE.test(String(id || '')) || id === chrome.runtime.id) throw new Error('Invalid extension ID.');
  const all = await getAllExtensions();
  const extension = all.find((item) => item && item.type === 'extension' && item.id === id);
  if (!extension) throw new Error('That extension is no longer installed.');
  return extension;
}

async function reviewExtensionSnapshotById(id) {
  const extension = await findInstalledExtension(id);
  const database = await loadCombinedExtensionReputation();
  const reputation = lookupExtensionReputation(extension, database);
  if (reputation.status === 'known_harmful') throw new Error('A known-harmful exact match cannot be marked as trusted or reviewed.');
  const access = mergeExtensionAccessRisk(extension, database);
  const stored = await localGet(EXT_REPUTATION_REVIEWS_KEY);
  const reviews = stored && stored[EXT_REPUTATION_REVIEWS_KEY] && typeof stored[EXT_REPUTATION_REVIEWS_KEY] === 'object'
    ? Object.assign({}, stored[EXT_REPUTATION_REVIEWS_KEY]) : {};
  reviews[id] = { reviewedAt: Date.now(), snapshot: extensionReviewSnapshot(extension, reputation, access) };
  await localSet({ [EXT_REPUTATION_REVIEWS_KEY]: reviews });
  try {
    const alertStore = await localGet(EXT_ALERTS_KEY);
    const alerts = Array.isArray(alertStore && alertStore[EXT_ALERTS_KEY]) ? alertStore[EXT_ALERTS_KEY] : [];
    const reviewedAt = Date.now();
    let changed = false;
    const updated = alerts.map((event) => {
      if (!event || event.id !== id || event.reviewedAt) return event;
      changed = true;
      return Object.assign({}, event, { reviewedAt });
    });
    if (changed) {
      await localSet({ [EXT_ALERTS_KEY]: updated });
      await refreshExtensionAttentionBadge();
    }
  } catch (_) {}
  return reviews[id];
}

async function forgetExtensionReview(id) {
  if (!EXTENSION_ID_RE.test(String(id || ''))) throw new Error('Invalid extension ID.');
  const stored = await localGet(EXT_REPUTATION_REVIEWS_KEY);
  const reviews = stored && stored[EXT_REPUTATION_REVIEWS_KEY] && typeof stored[EXT_REPUTATION_REVIEWS_KEY] === 'object'
    ? Object.assign({}, stored[EXT_REPUTATION_REVIEWS_KEY]) : {};
  delete reviews[id];
  await localSet({ [EXT_REPUTATION_REVIEWS_KEY]: reviews });
  return true;
}

async function importExtensionReputationDatabase(raw) {
  let bytes = 0;
  try { bytes = JSON.stringify(raw).length; } catch (_) { throw new Error('The imported database is not valid JSON data.'); }
  if (bytes > EXT_REPUTATION_MAX_IMPORT_BYTES) throw new Error('The imported database is larger than 2 MB.');
  const checked = validateExtensionReputationDatabase(raw, { origin: 'custom' });
  if (!checked.ok || !checked.database) throw new Error(checked.errors.join(' ') || 'The imported database failed validation.');
  if (!Object.keys(checked.database.entries).length) throw new Error('The imported database contains no valid exact extension IDs.');
  const portable = {
    schema: EXT_REPUTATION_SCHEMA,
    datasetVersion: checked.database.datasetVersion || 'local-import',
    generatedAt: checked.database.generatedAt,
    description: checked.database.description,
    sources: {},
    entries: {},
  };
  for (const id of Object.keys(checked.database.entries)) {
    const record = checked.database.entries[id];
    const sourceId = 'imported-' + id;
    portable.sources[sourceId] = record.source;
    portable.entries[id] = {
      name: record.name,
      status: record.status,
      reason: record.reason,
      categories: record.categories,
      affected: record.affected,
      source: sourceId,
      reviewedAt: record.reviewedAt,
    };
  }
  await localSet({ [EXT_REPUTATION_CUSTOM_KEY]: portable });
  return {
    imported: Object.keys(portable.entries).length,
    ignored: checked.database.ignoredEntries,
    warnings: checked.errors,
  };
}

async function clearImportedExtensionReputation() {
  await localRemove(EXT_REPUTATION_CUSTOM_KEY);
  return true;
}

async function pruneExtensionReview(id) {
  try { await forgetExtensionReview(String(id || '')); } catch (_) {}
}

function scheduleExtensionSecurityReport(trigger) {
  try {
    setTimeout(async () => {
      try {
        if (typeof watcherEnabled === 'function' && !(await watcherEnabled())) return;
        await buildExtensionSecurityReport({ trigger, includePermissionWarnings: false });
      } catch (_) {}
    }, 650);
  } catch (_) {}
}

try {
  chrome.management.onInstalled.addListener(() => scheduleExtensionSecurityReport('installed'));
  chrome.management.onEnabled.addListener(() => scheduleExtensionSecurityReport('enabled'));
  chrome.management.onDisabled.addListener(() => scheduleExtensionSecurityReport('disabled'));
  chrome.management.onUninstalled.addListener((id) => {
    pruneExtensionReview(id);
    scheduleExtensionSecurityReport('removed');
  });
} catch (_) {}
try {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === 'wardenone-extension-watch') scheduleExtensionSecurityReport('alarm');
  });
} catch (_) {}
try { setTimeout(() => scheduleExtensionSecurityReport('worker-start'), 1250); } catch (_) {}

try {
  globalThis.__woExtensionReputationTest = {
    EXT_REPUTATION_CUSTOM_KEY,
    EXT_REPUTATION_REVIEWS_KEY,
    EXT_REPUTATION_STATE_KEY,
    compareChromeVersions,
    extensionVersionAffected,
    validateExtensionReputationDatabase,
    loadExtensionReputationDatabase,
    loadCombinedExtensionReputation,
    lookupExtensionReputation,
    mergeExtensionAccessRisk,
    extensionReviewSnapshot,
    sameExtensionReviewSnapshot,
    latestExtensionChange,
    pendingActionableExtensionChange,
    buildExtensionAssessment,
    extensionAssessmentSortScore,
    extensionAssessmentSortBand,
    buildExtensionSecurityReport,
    reviewExtensionSnapshotById,
    forgetExtensionReview,
    importExtensionReputationDatabase,
    clearImportedExtensionReputation,
    persistExtensionReputationState,
  };
} catch (_) {}
