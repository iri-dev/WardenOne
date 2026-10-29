/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

function fixtures() {
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
      Array.from({ length: 50004 }, (_, i) => 'site.example##.p' + i).join('\n'),
      Array.from({ length: 12002 }, (_, i) => 'site.example##.proc' + i + ':has-text(ad)').join('\n'),
      Array.from({ length: 12002 }, (_, i) => 'site.example##+js(aopr, key' + i + ')').join('\n'),
      '@@||after-budgets.example^$generichide\nsite.example#@#.after-budget',
    ] },
    { name: 'chunks', chunks: ['', '\n##.one\r\nsite.example,~except.example##.two\n', '',
      'site.example#@#.two\nsite.example##+js(aopr, key\\,value)\r\n', ''] },
  ];
}

module.exports = { fixtures };
