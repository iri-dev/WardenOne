/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* Round 5 P2-4 (2026-11-20). Two disguised trackers the CNAME catalog misses, measured in the Round 5 crawl: Amazon's
   own logging pixels (fls-*.amazon.*, a session id in every path) and ITV's display ad server on its own subdomain
   (tom.itv.com, CNAME to aimatch). The ITV rule names only the display tile sizes seen, so the player is untouched. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules-trackers.json'), 'utf8'));
const byId = id => rules.find(r => r.id === id);
const matches = (rule, url) => new RegExp(rule.condition.regexFilter).test(url);
let checks = 0;
const ok = (cond, what) => { assert.ok(cond, what); checks++; };

const amazon = byId(63), itv = byId(64);
ok(amazon && amazon.action.type === 'block' && !amazon.condition.domainType, 'Amazon logging is blocked on Amazon itself too');
for (const url of ['https://fls-na.amazon.com/1/batch/1/OP/ATVPDKIKX0DER:144-8275160-8015002:0H8RMS5',
  'https://fls-eu.amazon.co.uk/1/batch/1/OP/A1F83G8C2ARO7P:524-4286535-0089053:VM5B',
  'https://fls-fe.amazon.co.jp/1/batch/1/OE/']) ok(matches(amazon, url), 'Amazon logging pixel: ' + url);
for (const url of ['https://www.amazon.com/1/batch/1/OP/x', 'https://fls-na.amazon.com.evil.example/1/batch/', 'https://images-na.ssl-images-amazon.com/1/batch/',
  'https://fls-na.amazon.com/other', 'https://m.media-amazon.com/images/I/x.jpg']) ok(!matches(amazon, url), 'not Amazon logging: ' + url);
ok(JSON.stringify(amazon.condition.resourceTypes) === '["image","ping","xmlhttprequest","other"]', 'never a page, frame or script');

ok(itv && itv.action.type === 'block', 'ITV display ads are blocked');
/* xps is the home page's own display slot, with its impression counter at /itv/count/ (K6 recheck, 2026-11-20). */
for (const size of ['collectiontile', 'hubsponsorbutton', 'xbanner', 'xps']) {
  ok(matches(itv, 'https://tom.itv.com/itv/lserver/hserver/size=' + size + '/collection=loads.of/site=itv'), 'ITV display tile: ' + size);
  /* The same slots are also asked for without /lserver/. */
  ok(matches(itv, 'https://tom.itv.com/itv/hserver/size=' + size + '/collection=x/site=itv/area=itvplayer.homepage'), 'ITV display tile, short path: ' + size);
}
for (const url of ['https://tom.itv.com/itv/hserver/size=preroll/site=itv', 'https://tom.itv.com/itv/xserver/hserver/size=xbanner/', 'https://tom.itv.com/hserver/size=xbanner/'])
  ok(!matches(itv, url), 'not an ITV display slot path: ' + url);
for (const url of ['https://tom.itv.com/itv/lserver/hserver/size=preroll/site=itv', 'https://tom.itv.com/itv/lserver/hserver/size=midroll/',
  'https://tom.itv.com/vast/x', 'https://www.itv.com/itv/lserver/hserver/size=xbanner/', 'https://tom.itv.com.evil.example/itv/lserver/hserver/size=xbanner/'])
  ok(!matches(itv, url), 'ITV player and anything else untouched: ' + url);
ok(!itv.condition.resourceTypes.includes('media') && !itv.condition.resourceTypes.includes('sub_frame'), 'no media or frame is touched');

/* With the page-wide allow gone, Amazon's own event beacons and its ad system's identity sync frame still loaded. */
const events = byId(65), sync = byId(66);
for (const url of ['https://unagi.amazon.com/1/events/com.amazon.csm.csa.prod', 'https://unagi-na.amazon.com/1/events/com.amazon.eel.SponsoredProductsEventTracking',
  'https://unagi-eu.amazon.co.uk/1/events/com.amazon.csm.csa.prod']) ok(events && matches(events, url), 'Amazon event beacon: ' + url);
for (const url of ['https://unagi.amazon.com/other', 'https://www.amazon.com/1/events/x', 'https://unagi.amazon.com.evil.example/1/events/x'])
  ok(!matches(events, url), 'not an Amazon event beacon: ' + url);
ok(!events.condition.resourceTypes.includes('main_frame') && !events.condition.resourceTypes.includes('script'), 'no page or script is touched');
for (const url of ['https://s.amazon-adsystem.com/iu3?cm3ppd=1', 'https://s.amazon-adsystem.com/ecm3?id=x']) ok(sync && matches(sync, url), 'identity sync: ' + url);
for (const url of ['https://s.amazon-adsystem.com/iu3x', 'https://m.media-amazon.com/iu3', 'https://s.amazon-adsystem.com/other'])
  ok(!matches(sync, url), 'not identity sync: ' + url);
ok(!sync.condition.domainType, 'blocked whichever frame opens it, including Amazon\'s own ad frame');

/* Why Amazon's pixels still loaded: an older AdShield build turned EasyList's cosmetic-only
   "@@||amazon.com^$generichide" into allowAllRequests, which switched off every ad and tracker rule on 20 Amazon
   storefronts. Only a real $document exception may allow a whole page. */
const adshield = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules-adshield.json'), 'utf8'));
const pageWide = adshield.filter(r => r.action.type === 'allowAllRequests');
ok(!pageWide.some(r => /amazon\./.test(JSON.stringify(r.condition))), 'no AdShield rule allows a whole Amazon page');
/* EasyList revision 2106b87f dropped its bannersnack.com $document exception. */
ok(JSON.stringify(pageWide.map(r => r.condition.urlFilter).sort()) === JSON.stringify([
  '||jokerly.com/Okidak/adSelectorDirect.htm?id=', '||jokerly.com/Okidak/vastChecker.htm', '||optout.networkadvertising.org^',
  '||tab.gladly.io/newtab/|'].sort()), 'the page-wide allows are the four $document exceptions EasyList has: ' + pageWide.map(r => r.condition.urlFilter).join(' '));
for (const file of ['rules-ubo-filters.json', 'rules-privacy-filters.json', 'rules-badware-filters.json']) {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  ok(!rules.some(r => r.action.type === 'allowAllRequests'), file + ' allows a whole page');
}

console.log('[ok] measured CNAME trackers: ' + checks + ' checks (Amazon logging, ITV display ads, no Amazon page-wide allow)');
