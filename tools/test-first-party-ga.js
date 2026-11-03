/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const rules = JSON.parse(fs.readFileSync('rules-trackers.json', 'utf8'));
const candidates = rules.filter(rule => rule.condition.domainType === 'firstParty' && rule.condition.regexFilter);
assert.equal(candidates.length, 1, 'one reviewed first-party collection signature');
const rule = candidates[0], condition = rule.condition;
assert.equal(rule.action.type, 'block');
assert.equal(rule.priority, 1000, 'site pauses and established compatibility allowances retain priority');
assert.equal(new Set(rules.map(entry => entry.id)).size, rules.length, 'static rule IDs are unique');
assert.deepEqual(condition.resourceTypes, ['xmlhttprequest', 'ping', 'image', 'other']);
assert.deepEqual(condition.requestMethods, ['get', 'post']);
assert.equal(condition.isUrlFilterCaseSensitive, true);
assert(!condition.requestDomains, 'the rule blocks an analytics endpoint, not its host');
const match = new RegExp(condition.regexFilter);
for (const url of [
  'https://publisher.example/g/collect?tid=G-TEST123',
  'https://publisher.example/g/collect?v=2&tid=G-TEST123&en=page_view',
  'https://publisher.example/g/collect?tid=G-TEST123&v=2',
  'https://publisher.example/metrics/g/collect?v=2&tid=G-TEST123',
  'https://metrics.publisher.example/g/collect?v=2&cid=123.456&tid=G-abc123',
  'http://publisher.example:8080/g/collect?v=2&tid=G-TEST123',
  'https://[::1]:8443/g/collect?tid=G-TEST123',
]) assert(match.test(url), 'GA4 hit missed: ' + url);
for (const url of [
  'https://publisher.example/',
  'https://publisher.example/collect?tid=G-TEST123',
  'https://publisher.example/api/collect?tid=G-TEST123',
  'https://publisher.example/g/collect?tid=UA-123-1',
  'https://publisher.example/g/collect?tid=G-',
  'https://publisher.example/g/collect?tid=G-TEST123/file',
  'https://publisher.example/g/collect?v=2&not_tid=G-TEST123',
  'https://publisher.example/g/collect?note=tid=G-TEST123',
  'https://publisher.example/g/collect?next=%26tid%3DG-TEST123',
  'https://publisher.example/g/collect?TID=G-TEST123',
  'https://publisher.example/g/collect?tid=g-TEST123',
  'https://publisher.example/g/collect?v=2',
  'https://publisher.example/g/collect',
  'https://publisher.example/g/collector?tid=G-TEST123',
  'https://publisher.example/g/collect.js?tid=G-TEST123',
  'https://publisher.example/g/collect/file?tid=G-TEST123',
  'https://publisher.example/G/collect?tid=G-TEST123',
  'https://publisher.example/gtag/js?id=G-TEST123',
  'https://publisher.example/api/data?next=/g/collect?tid=G-TEST123',
  'https://publisher.example/?next=https://tracker.example/g/collect?tid=G-TEST123',
  'https://publisher.example/#/g/collect?tid=G-TEST123',
]) assert(!match.test(url), 'unrelated endpoint blocked: ' + url);
const background = fs.readFileSync('background.js', 'utf8');
assert(/const trackersOn = on && cfg\.blockTrackers !== false/.test(background));
assert(/\(trackersOn \? enableRulesetIds : disableRulesetIds\)\.push\(TRACKERS_STATIC_RULESET_ID\)/.test(background),
  'the native rule follows both the tracker and master switches');
const observations = require('./build-tracker-network-data.js').build();
assert(!observations.trackerHosts.includes('publisher.example'), 'the collector does not promote a publisher into a tracker domain');
console.log('[ok] first-party GA4 signature: path/query boundaries, custom prefixes, methods/types, native switch ownership and no whole-host learning');
