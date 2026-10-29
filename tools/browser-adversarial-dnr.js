/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const identity = require('./lib/privacy-baseline.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');
const root = path.resolve(__dirname, '..');
const options = { extension: root, browser: process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), out: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--extension': 'extension', '--browser': 'browser', '--out': 'out' }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw Error('Expected --extension path --browser path --out path');
  options[key] = path.resolve(process.argv[i + 1]);
}

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-adversarial-dnr-'));
  let cdp;
  const report = { createdAt: new Date().toISOString(), complete: false,
    extensionFingerprint: options.extension === root ? null : identity.fingerprint(options.extension).sha256,
    backgroundSha256: identity.sha256(fs.readFileSync(path.join(options.extension, 'background.js'))) };
  try {
    const browser = await profile.launch(options.browser, 'on', options.extension, port, dir,
      ['--host-resolver-rules=MAP * ~NOTFOUND']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    report.browser = browser.Browser;
    report.browserSha256 = identity.sha256(fs.readFileSync(options.browser));
    const version = JSON.parse(fs.readFileSync(path.join(options.extension, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, extension.attachedSession);
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const result = await evaluate(`(async()=>{
      const dnr=chrome.declarativeNetRequest;
      const deadline=Date.now()+30000;
      let security;
      while(Date.now()<deadline){
        const rules=await dnr.getDynamicRules({ruleIds:[740000,741000,741001,742000]});
        security=rules.find(rule=>rule.action.type==='block'&&rule.priority>=2000);
        if(security)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!security)throw Error('No installed security feed rule for atomic replacement probe');
      const other={id:19000000,priority:1,action:{type:'block'},
        condition:{requestDomains:['adversarial-fixture.example'],resourceTypes:['script']}};
      const read=async()=>{
        const rules=await dnr.getDynamicRules({ruleIds:[security.id,other.id]});
        return {security:rules.find(rule=>rule.id===security.id),other:rules.find(rule=>rule.id===other.id)};
      };
      const before=await read();
      if(before.other)throw Error('Fixture rule ID was already occupied');
      let invalidRejected=false,collisionRejected=false;
      try{
        await dnr.updateDynamicRules({removeRuleIds:[security.id],addRules:[
          {...security,condition:{resourceTypes:['not-a-resource-type']}},other]});
      }catch(_){invalidRejected=true;}
      const afterInvalid=await read();
      try{await dnr.updateDynamicRules({removeRuleIds:[],addRules:[security,other]});}
      catch(_){collisionRejected=true;}
      const afterCollision=await read();
      await dnr.updateDynamicRules({removeRuleIds:[],addRules:[other]});
      const afterIndependent=await read();
      await dnr.updateDynamicRules({removeRuleIds:[other.id],addRules:[]});
      return {securityId:security.id,securityPriority:security.priority,invalidRejected,collisionRejected,
        invalidAtomic:JSON.stringify(afterInvalid.security)===JSON.stringify(before.security)&&!afterInvalid.other,
        collisionAtomic:JSON.stringify(afterCollision.security)===JSON.stringify(before.security)&&!afterCollision.other,
        independentApplied:!!afterIndependent.other&&JSON.stringify(afterIndependent.security)===JSON.stringify(before.security),
        cleaned:!(await read()).other};
    })()`);
    assert.equal(result.invalidRejected, true, 'browser rejects invalid DNR conditions');
    assert.equal(result.collisionRejected, true, 'browser rejects duplicate rule IDs');
    assert.equal(result.invalidAtomic, true, 'invalid transaction retains the installed security rule');
    assert.equal(result.collisionAtomic, true, 'collision retains the installed security rule');
    assert.equal(result.independentApplied, true, 'unrelated owner can still write');
    assert.equal(result.cleaned, true, 'fixture rule removed');
    report.result = result;
    assert.equal(identity.sha256(fs.readFileSync(path.join(options.extension, 'background.js'))), report.backgroundSha256);
    if (report.extensionFingerprint) assert.equal(identity.fingerprint(options.extension).sha256, report.extensionFingerprint);
    report.complete = true;
    console.log('[ok] native invalid conditions, ID collisions, atomic security retention and isolated owner recovery');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    await new Promise(resolve => setTimeout(resolve, 2000));
    cleanupProfile(dir, 'wo-adversarial-dnr-');
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n');
    }
  }
}

profile.mustFinish(run, 'browser-adversarial-dnr').catch(error => { console.error(error.stack || error); process.exitCode = 1; });
