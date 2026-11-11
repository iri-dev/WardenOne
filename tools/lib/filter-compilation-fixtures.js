/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const fs = require('fs');
const path = require('path');

/* The budgets fixture has to overshoot the real limits to prove they truncate and that parsing
   carries on afterwards. Reading them out of background.js keeps it doing that when a limit moves,
   instead of quietly testing a limit that is no longer there. */
function limits() {
  const background = fs.readFileSync(path.resolve(__dirname, '..', '..', 'background.js'), 'utf8');
  const read = (pattern, label) => {
    const found = Number((background.match(pattern) || [])[1]);
    if (!Number.isFinite(found) || found <= 0) throw new Error('cannot read ' + label + ' from background.js');
    return found;
  };
  return {
    passive: read(/const ADSHIELD_COSMETIC_MAX = (\d+)/, 'ADSHIELD_COSMETIC_MAX'),
    procedural: read(/proceduralLimit: (\d+)/, 'proceduralLimit'),
    scriptlet: read(/scriptletLimit: (\d+)/, 'scriptletLimit'),
  };
}

function fixtures() {
  const cap = limits();
  return [
    { name: 'mixed', chunks: [
      '! fixture\r\n##.global\nsite.example##.banner\nsite.example#@#.banner',
      'site.example,child.example#?#.sponsor:has-text(ad)\nsite.example#$#.style { display: none; }',
      'site.example##+js(aopr, key)\nsite.example#%#//scriptlet("set", "key", "true")',
      '@@||www.site.example^$generichide\n@@||other.example^$ghide\nsite.example##+js(set-cookie, consent, yes)',
    ] },
    { name: 'separators', chunks: [
      'site.example##[data-label="#?#"]\nsite.example##[data-label="#$#"]\nsite.example##[data-label="#%#"]',
      'site.example#@#.ad:has-text(ad)\n~excluded.example##.ad\n##.duplicate\n##.duplicate',
      'site.example#$# log\nsite.example#^#script\nsite.example#@?#.ad\nsite.example##<script>',
      '##.ad:remove()\nsite.example##+js(unknown-scriptlet, key)\nsite.example##+js(aopr, a, b, c, d, e, f, g)',
    ] },
    { name: 'budgets', chunks: [
      Array.from({ length: cap.passive + 4 }, (_, i) => 'site.example##.p' + i).join('\n'),
      Array.from({ length: cap.procedural + 2 }, (_, i) => 'site.example##.proc' + i + ':has-text(ad)').join('\n'),
      Array.from({ length: cap.scriptlet + 2 }, (_, i) => 'site.example##+js(aopr, key' + i + ')').join('\n'),
      '@@||after-budgets.example^$generichide\nsite.example#@#.after-budget',
    ] },
    { name: 'chunks', chunks: ['', '\n##.one\r\nsite.example,~except.example##.two\n', '',
      'site.example#@#.two\nsite.example##+js(aopr, key\\,value)\r\n', ''] },
  ];
}

module.exports = { fixtures };
