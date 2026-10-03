/* Onboarding and the popup must use the same saved site-card layout. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const onboarding = fs.readFileSync(path.join(root, 'onboarding.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'onboarding.html'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const onboardingKey = /const SITE_CARD_LAYOUT_KEY = '([^']+)'/.exec(onboarding)?.[1];
const popupKey = /const SITE_CARD_LAYOUT_KEY = '([^']+)'/.exec(popup)?.[1];
assert.equal(onboardingKey, popupKey, 'onboarding and popup share the layout preference');

const welcome = html.match(/<section class="scene" data-scene="welcome"[\s\S]*?<\/section>/)?.[0] || '';
const explore = html.match(/<section class="scene" data-scene="explore"[\s\S]*?<\/section>/)?.[0] || '';
assert(!welcome.includes('data-site-card-layout'), 'the first page does not ask about an unseen card');
assert(/data-site-card-layout="A"[^>]*>[\s\S]*?<strong>One line<\/strong>/.test(explore));
assert(/data-site-card-layout="B"[^>]*>[\s\S]*?<strong>Counts<\/strong>/.test(explore));
assert.equal((explore.match(/class="site-layout-preview/g) || []).length, 2, 'both choices show previews');
assert(explore.includes('Example numbers.'), 'sample activity is marked as illustrative');
assert(onboarding.includes('storageSet({ [SITE_CARD_LAYOUT_KEY]: layout })'), 'choice is saved');
assert(onboarding.includes('wardenone_onboarding_done_at\', SITE_CARD_LAYOUT_KEY]'), 'saved choice is read on return');

const start = onboarding.indexOf('function paintSiteCardLayout(value) {');
const end = onboarding.indexOf('\n  }\n\n  // ---- apply recommended', start);
assert(start >= 0 && end > start, 'layout painter is available');
const buttons = ['A', 'B'].map((layout) => ({
  dataset: { siteCardLayout: layout },
  setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; },
}));
const context = { siteCardButtons: buttons, String };
vm.createContext(context);
vm.runInContext(onboarding.slice(start, end + 4), context);
for (const [stored, expected] of [['A', ['true', 'false']], ['B', ['false', 'true']], ['invalid', ['true', 'false']]]) {
  vm.runInContext(`paintSiteCardLayout(${JSON.stringify(stored)})`, context);
  assert.deepEqual(buttons.map((button) => button.pressed), expected, `saved ${stored} selects the right button`);
}

console.log('[ok] onboarding site card choice');
