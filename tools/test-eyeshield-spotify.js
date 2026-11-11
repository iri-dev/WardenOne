/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function loadThemeCSS() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'eyeshield.js'), 'utf8');
  const start = source.indexOf('  function spotifyThemeCSS(mode) {');
  const end = source.indexOf('\n  }', start) + 4;
  assert(start >= 0 && end > start, 'Spotify theme builder exists');
  const box = {};
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);
  return box.spotifyThemeCSS;
}
function run() {
  const theme = loadThemeCSS();
  for (const mode of ['light', 'dark', 'ultra']) {
    const css = theme(mode);
    const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), match => ({ selector: match[1], body: match[2] }));
    for (const scope of ['.encore-inverted-light-set', '.encore-inverted-dark-set', '.encore-bright-accent-set']) {
      const scoped = rules.filter(rule => rule.selector.includes(scope) && !rule.selector.includes(':not('));
      const text = scoped.filter(rule => /(?:^|;)color:/.test(rule.body));
      assert(text.length >= 2, mode + ': text and nested icons are covered for ' + scope);
      assert(text.every(rule => /color:var\(--text-base,/.test(rule.body)), mode + ': scoped foreground must use the site token');
      assert(text.every(rule => /-webkit-text-fill-color:currentColor/.test(rule.body)), mode + ': text fill follows the foreground');
      assert(scoped.some(rule => !/:hover|:active/.test(rule.selector) && /background-color:var\(--background-base\)/.test(rule.body)));
      for (const [state, token] of [[':hover', '--background-highlight'], [':active', '--background-press']]) {
        assert(scoped.some(rule => rule.selector.includes(state) && rule.body.includes('background-color:var(' + token + ',')), mode + ': native ' + state + ' surface is preserved');
      }
      assert(text.some(rule => /svg,path,use/.test(rule.selector) && /fill:currentColor/.test(rule.body)), mode + ': icon paint follows the contrast set');
    }
    assert(!/pointer-events\s*:|cursor\s*:|opacity\s*:/.test(rules.filter(rule => rule.selector.includes('.encore-inverted-light-set')).map(rule => rule.body).join('')),
      mode + ': theme rules do not alter control interaction or disabled opacity');

    /* Spotify's list rows put a full-size role="button" overlay ON TOP of the row, so an opaque hover
       colour paints out the playlist name and subtitle underneath it. The highlight must be a tint. */
    const hovered = rules.filter(rule => rule.selector.includes(':where(:hover,[aria-expanded="true"]'));
    assert(hovered.length, mode + ': the control hover/selected rule is present');
    for (const rule of hovered) {
      const paint = /background-color:(#[0-9a-f]+)/i.exec(rule.body);
      assert(paint, mode + ': the control hover rule paints a background');
      assert(paint[1].length === 9, mode + ': the control hover background is translucent, not an opaque fill (' + paint[1] + ')');
    }

    /* entityTitle is the page's heading text, not a surface. A panel background on it drew an opaque
       box across the playlist header artwork. */
    const titled = rules.filter(rule => rule.selector.includes('entityTitle'));
    assert(titled.length, mode + ': the entity title is styled');
    for (const rule of titled) {
      assert(!/background-color:#/i.test(rule.body), mode + ': the entity title is never given a panel colour');
      assert(/background-color:transparent/.test(rule.body), mode + ': the entity title keeps the header behind it');
    }
  }
  /* The page load re-theme ran the general remap on Spotify, stacked a second theme element and
     started the readability pass, which wrote inline colours onto Spotify's own buttons. */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'eyeshield.js'), 'utf8');
    const own = /function hasOwnThemePath\(\) \{[\s\S]*?\n  \}/.exec(src);
    assert(own, 'hasOwnThemePath is where the check expects it');
    for (const [host, want] of [['open.spotify.com', true], ['www.spotify.com', true], ['discord.com', true], ['www.tiktok.com', true],
      ['example.com', false], ['notspotify.com.example', false]]) {
      const box = { location: { hostname: host }, String };
      vm.createContext(box);
      vm.runInContext('const SPOTIFY_HOST_RE=/(^|\\.)spotify\\.com$/i;function isSpotifyHost(){return SPOTIFY_HOST_RE.test(String(location.hostname||"").toLowerCase());}'
        + 'const DISCORD_HOST_RE=' + /const DISCORD_HOST_RE = ([^;]+);/.exec(src)[1] + ';function isDiscordHost(){return DISCORD_HOST_RE.test(String(location.hostname||"").toLowerCase());}'
        + own[0] + ';this.r=hasOwnThemePath();', box);
      assert.equal(box.r, want, host + ' owns its theme path: ' + want);
    }
    assert(/rebuildTimer = 0;\s*if \(!activeRemap \|\| hasOwnThemePath\(\)\) return;/.test(src), 'a scheduled rebuild skips sites with their own theme path');
    assert(/if \(!activeRemap \|\| isTwitchHost\(\) \|\| hasOwnThemePath\(\)\) return;\s*pendingSheet = true;/.test(src), 'the page load re-theme skips them too');
    assert(/function scheduleContrastGuard\(mode\) \{\s*if \(!mode \|\| mode === 'off' \|\| hasOwnThemePath\(\)\) return;/.test(src), 'and so does the readability pass');
  }
  console.log('[ok] Spotify contrast-set text, icon, surface and interaction contracts across all EyeShield themes');
}
module.exports = { loadThemeCSS };
if (require.main === module) run();
