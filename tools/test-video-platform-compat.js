/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Video platforms must stay reachable. A feed or EasyList refresh that starts blocking a player
   host, its media CDN, or its API leaves a dead player rather than an ad-free one, and the
   symptom is easy to miss: the page renders, the <video> element exists, and it simply never
   leaves readyState 0.

   Measured 2026-11-07 in a real browser with a trusted click: vimeo.com and
   player.vimeo.com both reach readyState 4 and advance under WardenOne, matching an
   extension-free profile. This suite pins the rule-corpus conditions that have to hold for
   that to stay true. Live playback itself is covered by tools/browser-media-security.js. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.exitCode = 1;
const ROOT = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

/* Page host, player/embed host, and the media or API host each platform streams from. A block on
   any one of the three is enough to kill playback. */
const PLATFORMS = {
  vimeo: ['vimeo.com', 'player.vimeo.com', 'f.vimeocdn.com', 'i.vimeocdn.com', 'vod-progressive.akamaized.net'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 's.ytimg.com', 'rr1---sn-ab5l6nr6.googlevideo.com'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'static.twitchcdn.net', 'video-weaver.lhr03.hls.ttvnw.net'],
  dailymotion: ['dailymotion.com', 'geo.dailymotion.com', 'static.dmcdn.net'],
};
const ALL_HOSTS = Object.values(PLATFORMS).flat();

const RULE_FILES = ['rules.json', 'rules-adshield.json', 'rules-trackers.json',
  'rules-easyprivacy.json', 'rules-badger.json', 'rules-cname.json'];

/* True when `host` is `entry` or a subdomain of it: a requestDomains entry covers its
   subdomains, which is exactly how a parent listing silently takes out a player host. */
function covers(entry, host) {
  const e = String(entry || '').toLowerCase().replace(/^\.+|\.+$/g, '');
  const h = String(host || '').toLowerCase();
  return !!e && (h === e || h.endsWith('.' + e));
}

/* An initiator-scoped rule only fires when one of those sites embedded the player, which is a
   per-site decision upstream makes deliberately -- EasyList and AdGuard both carry
   `||geo.dailymotion.com^$script,domain=wol.gg`. What must never exist is a rule that blocks a
   platform host with no initiator restriction, or one that fires on the platform's own pages. */
function initiatorScopeIsElsewhere(condition, platformHosts) {
  const scope = condition.initiatorDomains || [];
  if (!scope.length) return false;
  return !scope.some((entry) => platformHosts.some((host) => covers(entry, host) || covers(host, entry)));
}

function blockRuleHits(rule, host, platformHosts) {
  if (!rule || !rule.action || rule.action.type !== 'block') return null;
  const condition = rule.condition || {};
  if (initiatorScopeIsElsewhere(condition, platformHosts)) return null;
  for (const entry of condition.requestDomains || []) {
    if (covers(entry, host)) return 'requestDomains:' + entry;
  }
  const anchored = /^\|\|([a-z0-9._-]+)\^?$/i.exec(String(condition.urlFilter || ''));
  if (anchored && covers(anchored[1], host)) return 'urlFilter:' + condition.urlFilter;
  return null;
}

function set(name) {
  const start = background.indexOf('const ' + name + ' = ');
  const end = background.indexOf('];', start);
  assert(start >= 0 && end > start, 'could not lift const ' + name);
  return background.slice(start, end + 2);
}
function lift(name) {
  const start = background.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  const end = background.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, 'could not lift ' + name);
  return background.slice(start, end + 3);
}

(() => {
  // 1. No shipped static rule may block a video platform's page, player or media host.
  const offenders = [];
  for (const file of RULE_FILES) {
    const rules = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const rule of rules) {
      for (const [platform, hosts] of Object.entries(PLATFORMS)) {
        for (const host of hosts) {
          const why = blockRuleHits(rule, host, hosts);
          if (why) offenders.push(file + ' rule ' + rule.id + ' blocks ' + platform + ' host ' + host + ' via ' + why);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'shipped rules block video platform hosts:\n  ' + offenders.join('\n  '));

  // 2. Smart mode must not have to guess about player infrastructure. These hosts serve the
  //    player bundle; a Smart-mode block there leaves the element at readyState 0.
  const box = {};
  vm.createContext(box);
  vm.runInContext(set('SCRIPT_SHIELD_PLAYER_INFRA_HOSTS'), box);
  const infra = vm.runInContext('Array.from(SCRIPT_SHIELD_PLAYER_INFRA_HOSTS)', box);
  for (const host of ['player.vimeo.com', 'f.vimeocdn.com', 'www.youtube.com', 's.ytimg.com']) {
    assert(infra.includes(host), 'Smart mode no longer exempts the player host ' + host);
  }

  // 3. The media-compat filter still recognises the streaming CDNs, so an ad/tracker
  //    exception can never be applied to a media request on these platforms.
  const mediaBox = {};
  vm.createContext(mediaBox);
  vm.runInContext(lift('isMediaCompatFilter'), mediaBox);
  for (const pattern of ['||googlevideo.com^', '||ttvnw.net^', '||ytimg.com^', '||twitchcdn.net^']) {
    assert(mediaBox.isMediaCompatFilter(pattern) === true,
      'isMediaCompatFilter no longer covers ' + pattern);
  }
  assert(mediaBox.isMediaCompatFilter('||doubleclick.net^') === false,
    'isMediaCompatFilter must not cover an ad host');

  // 4. The video-platform helper must keep recognising the platforms whose protections are
  //    deliberately paused; a silent narrowing here re-arms guards on the player.
  const platformBox = {};
  vm.createContext(platformBox);
  vm.runInContext(lift('isVideoPlatformHost'), platformBox);
  for (const host of ['youtube.com', 'www.youtube.com', 'youtu.be', 'twitch.tv', 'www.twitch.tv']) {
    assert(platformBox.isVideoPlatformHost(host) === true,
      'isVideoPlatformHost no longer recognises ' + host);
  }
  assert(platformBox.isVideoPlatformHost('example.com') === false,
    'isVideoPlatformHost matched an unrelated host');

  console.log('[ok] video platform pages, players and media CDNs are not blocked by shipped rules');
  process.exitCode = 0;
})();
