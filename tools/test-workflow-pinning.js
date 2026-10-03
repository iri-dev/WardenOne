/* Every action a workflow runs is pinned to a full commit SHA, with the release it is beside it.

   A tag such as @v4 is a pointer the action's owner can move, so a workflow pinned to one runs
   whatever that tag points at on the day: a compromised or careless release would reach the
   publish job, which holds a token that can write releases. A commit SHA cannot be moved. The
   version in the comment says which release the SHA is, so an update is a readable diff. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', '.github', 'workflows');
let checks = 0;
const check = (label, ok) => { checks++; assert(ok === true, label); };

const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
check('there are workflows to check', files.length > 0);
const shaOf = new Map();
let uses = 0;
for (const file of files) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line);
    if (!m) return;
    uses++;
    const where = file + ':' + (i + 1);
    const ref = m[1];
    if (ref.startsWith('./')) return;
    const pinned = /^([\w.-]+\/[\w.-]+(?:\/[\w./-]+)?)@([0-9a-f]{40})$/.exec(ref);
    check(where + ' pins ' + ref + ' to a full commit SHA', !!pinned);
    check(where + ' names the release beside the SHA', /^\s+#\s+v\d+(?:\.\d+){1,2}\s*$/.test(m[2]));
    const action = pinned[1];
    if (shaOf.has(action)) check(action + ' is pinned to one SHA everywhere (' + where + ')', shaOf.get(action) === pinned[2]);
    else shaOf.set(action, pinned[2]);
  });
}
check('the workflows use actions at all (' + uses + ' found)', uses >= 10);

console.log('[ok] workflow pinning: ' + uses + ' action uses across ' + files.length + ' workflows, ' + shaOf.size + ' actions, all pinned');
