/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* File Shield — the manual scanner.

   Download Shield can only judge files it watched arrive, and even then it cannot
   read the saved bytes: Chrome gives an extension no access to the file on disk,
   so its hash is a re-fetch of the URL, which differs for anything signed,
   authenticated, one-time or personalised. A file the reader picks here is the
   opposite: these are the real bytes. That makes this the only place in WardenOne
   that can state a true hash of an actual file.

   Everything below runs locally, in this page, with no permission of any kind. The
   single network step -- looking a hash up at VirusTotal -- is a separate button
   that says what leaves the machine before it does.

   What it will not do: tell you a file is safe. It can say a file is not what its
   name claims, or that an archive carries a script, or that a shortcut runs a
   shell. It cannot say the opposite, and copy here never implies it can. */
'use strict';

const $ = (id) => document.getElementById(id);

/* Reading the whole file is only needed for the hash. Structure comes from the
   head and the tail, so a 6 GB disk image is still inspectable. */
const HEAD_BYTES = 65536;
const TAIL_BYTES = 131072;
/* crypto.subtle.digest has no streaming form, so the whole file must sit in
   memory to be hashed. Past this we say so rather than hanging the tab. */
const HASH_MAX_BYTES = 768 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 4000;
/* A ratio past this is the shape of a decompression bomb. Ordinary text and
   installers land far below it; the pathological cases are 1000:1 and up. */
const BOMB_RATIO = 250;
const BOMB_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/* Windows treats these as "run me". Kept in step with DANGEROUS_EXT in
   background-downloads.js -- the same list Download Shield grades against. */
const DANGEROUS_EXT = /\.(exe|scr|msi|msix|bat|cmd|com|pif|cpl|jar|vbs|vbe|js|jse|wsf|wsh|ws|ps1|ps2|psc1|ps1xml|hta|reg|dll|sys|apk|dmg|pkg|app|deb|rpm|gadget|inf|lnk|msc|msp|msu|diagcab|ade|adp|chm|mht|mhtml|url|scf|application|appref-ms|jnlp|xll|settingcontent-ms|library-ms|iqy|slk|desktop|crx|xpi)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tar|cab|ace|arj|tgz|bz2|xz|lzh|iso|img|vhd|vhdx)$/i;
const MACRO_DOC_EXT = /\.(docm|xlsm|pptm|dotm|xlam|xltm|xlsb)$/i;
/* The decoy half of a double extension: what the file pretends to be. */
const DOUBLE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|bmp|tiff?|ico|heic|docx?|xlsx?|csv|tsv|pptx?|txt|rtf|md|json|xml|html?|odt|ods|epub|mp4|mkv|mov|avi|webm|wmv|m4v|mp3|wav|flac|ogg|m4a|aac|zip|rar|7z)\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|jar|msi|msix|cpl|hta|ps1|lnk|wsf|reg|msc|scf)$/i;
/* Text-direction overrides and zero-width characters: "photo‮gnp.exe"
   renders as "photoexe.png". Any of these in a name is deliberate. */
const HIDDEN_CHARS = /[‪-‮⁦-⁩​-‏]/;

/* offset, byte signature, what it is, and the class that drives the verdict.
   Order matters: the first match wins, so longer and more specific signatures
   come before the prefixes they would collide with. */
const SIGNATURES = [
  [0, [0x4D, 0x5A], 'Windows program (PE/DOS executable)', 'executable', 'exe'],
  [0, [0x7F, 0x45, 0x4C, 0x46], 'Linux program (ELF)', 'executable', 'elf'],
  [0, [0xCF, 0xFA, 0xED, 0xFE], 'macOS program (Mach-O 64-bit)', 'executable', 'macho'],
  [0, [0xCE, 0xFA, 0xED, 0xFE], 'macOS program (Mach-O 32-bit)', 'executable', 'macho'],
  [0, [0xCA, 0xFE, 0xBA, 0xBE], 'macOS universal binary or Java class', 'executable', 'macho'],
  [0, [0x4C, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00], 'Windows shortcut (.lnk)', 'shortcut', 'lnk'],
  [0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 'Microsoft compound file (old Office, .msi)', 'ole', 'ole'],
  [0, [0x50, 0x4B, 0x03, 0x04], 'ZIP container', 'archive', 'zip'],
  [0, [0x50, 0x4B, 0x05, 0x06], 'ZIP container (empty)', 'archive', 'zip'],
  [0, [0x50, 0x4B, 0x07, 0x08], 'ZIP container (spanned)', 'archive', 'zip'],
  [0, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], 'RAR archive', 'archive', 'rar'],
  [0, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], '7-Zip archive', 'archive', '7z'],
  [0, [0x1F, 0x8B], 'gzip archive', 'archive', 'gz'],
  [0, [0x42, 0x5A, 0x68], 'bzip2 archive', 'archive', 'bz2'],
  [0, [0xFD, 0x37, 0x7A, 0x58, 0x5A], 'xz archive', 'archive', 'xz'],
  [0, [0x4D, 0x53, 0x43, 0x46], 'Windows cabinet (.cab)', 'archive', 'cab'],
  [0, [0x78, 0x61, 0x72, 0x21], 'macOS installer archive (.pkg)', 'archive', 'xar'],
  [0, [0x21, 0x3C, 0x61, 0x72, 0x63, 0x68, 0x3E], 'Debian package or ar archive', 'archive', 'deb'],
  [0, [0xED, 0xAB, 0xEE, 0xDB], 'RPM package', 'archive', 'rpm'],
  [257, [0x75, 0x73, 0x74, 0x61, 0x72], 'tar archive', 'archive', 'tar'],
  [0, [0x25, 0x50, 0x44, 0x46], 'PDF document', 'document', 'pdf'],
  [0, [0x7B, 0x5C, 0x72, 0x74, 0x66], 'Rich Text document', 'document', 'rtf'],
  [0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'PNG image', 'image', 'png'],
  [0, [0xFF, 0xD8, 0xFF], 'JPEG image', 'image', 'jpg'],
  [0, [0x47, 0x49, 0x46, 0x38], 'GIF image', 'image', 'gif'],
  [0, [0x42, 0x4D], 'BMP image', 'image', 'bmp'],
  [0, [0x00, 0x00, 0x01, 0x00], 'Windows icon', 'image', 'ico'],
  [0, [0x49, 0x49, 0x2A, 0x00], 'TIFF image', 'image', 'tif'],
  [0, [0x4D, 0x4D, 0x00, 0x2A], 'TIFF image', 'image', 'tif'],
  [4, [0x66, 0x74, 0x79, 0x70], 'MP4 / MOV / HEIC media', 'media', 'mp4'],
  [0, [0x1A, 0x45, 0xDF, 0xA3], 'Matroska / WebM video', 'media', 'mkv'],
  [0, [0x49, 0x44, 0x33], 'MP3 audio', 'media', 'mp3'],
  [0, [0x4F, 0x67, 0x67, 0x53], 'Ogg media', 'media', 'ogg'],
  [0, [0x66, 0x4C, 0x61, 0x43], 'FLAC audio', 'media', 'flac'],
  [0, [0x3C, 0x3F, 0x78, 0x6D, 0x6C], 'XML text', 'text', 'xml'],
  [0, [0x23, 0x21], 'Script with an interpreter line (#!)', 'script', 'sh'],
  [32769, [0x43, 0x44, 0x30, 0x30, 0x31], 'ISO disc image', 'archive', 'iso'],
];
/* RIFF needs a second signature four bytes later to tell WAV from WebP from AVI. */
const RIFF_KINDS = { WEBP: ['WebP image', 'image', 'webp'], WAVE: ['WAV audio', 'media', 'wav'], 'AVI ': ['AVI video', 'media', 'avi'] };

/* Which real formats an extension legitimately implies. Anything not listed is
   not judged -- an unknown extension is not evidence of anything. */
const EXT_EXPECTS = {
  exe: ['exe'], dll: ['exe'], scr: ['exe'], com: ['exe'], sys: ['exe'], msi: ['ole'], cpl: ['exe'],
  zip: ['zip'], docx: ['zip'], xlsx: ['zip'], pptx: ['zip'], docm: ['zip'], xlsm: ['zip'], pptm: ['zip'],
  odt: ['zip'], ods: ['zip'], odp: ['zip'], epub: ['zip'], jar: ['zip'], apk: ['zip'], crx: ['zip'], xpi: ['zip'],
  doc: ['ole'], xls: ['ole'], ppt: ['ole'], msg: ['ole'],
  rar: ['rar'], '7z': ['7z'], gz: ['gz'], tgz: ['gz'], bz2: ['bz2'], xz: ['xz'], tar: ['tar'], cab: ['cab'],
  iso: ['iso'], deb: ['deb'], rpm: ['rpm'], pkg: ['xar'], lnk: ['lnk'],
  pdf: ['pdf'], rtf: ['rtf'],
  png: ['png'], jpg: ['jpg'], jpeg: ['jpg'], gif: ['gif'], bmp: ['bmp'], ico: ['ico'],
  tif: ['tif'], tiff: ['tif'], webp: ['webp'], heic: ['mp4'],
  mp4: ['mp4'], m4v: ['mp4'], mov: ['mp4'], mkv: ['mkv'], webm: ['mkv'], avi: ['avi'],
  mp3: ['mp3'], ogg: ['ogg'], flac: ['flac'], wav: ['wav'],
};

let CURRENT = null;

/* ---- byte helpers ------------------------------------------------------- */
const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

function startsWith(bytes, offset, sig) {
  if (offset + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes, offset, length) {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function humanSize(n) {
  if (n < 1024) return n + ' bytes';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + units[i];
}

function extensionOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return m ? m[1] : '';
}

/* ---- format detection --------------------------------------------------- */
function detectFormat(head, size, isoProbe) {
  for (const [offset, sig, label, cls, id] of SIGNATURES) {
    /* The ISO signature sits at 32 KB, past the head slice on a small file. */
    if (offset === 32769) {
      if (isoProbe && startsWith(isoProbe, 0, sig)) return { label, cls, id };
      continue;
    }
    if (startsWith(head, offset, sig)) {
      if (id === 'ico' && size > 32 * 1024 * 1024) continue;
      return { label, cls, id };
    }
  }
  if (startsWith(head, 0, [0x52, 0x49, 0x46, 0x46])) {
    const kind = RIFF_KINDS[ascii(head, 8, 4)];
    if (kind) return { label: kind[0], cls: kind[1], id: kind[2] };
    return { label: 'RIFF container', cls: 'media', id: 'riff' };
  }
  /* Only claim "text" when the bytes really are text: no NULs and mostly
     printable. Otherwise say unknown, which is an honest answer. */
  const probe = Math.min(head.length, 4096);
  if (probe > 0) {
    let printable = 0;
    let nul = 0;
    for (let i = 0; i < probe; i++) {
      const b = head[i];
      if (b === 0) nul++;
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
    }
    if (!nul && printable / probe > 0.95) return { label: 'Plain text', cls: 'text', id: 'text' };
  }
  return { label: 'Not a format WardenOne recognises', cls: 'unknown', id: '' };
}

/* ---- ZIP central directory ---------------------------------------------- */
/* Read from the central directory only. Nothing is decompressed, so a bomb
   cannot go off while being measured -- the sizes are metadata. That also
   means an archive can lie about them, and the report says "claims". */
async function readZip(file, tail, findings) {
  const size = file.size;
  let eocd = -1;
  for (let i = tail.bytes.length - 22; i >= 0; i--) {
    if (tail.bytes[i] === 0x50 && tail.bytes[i + 1] === 0x4B
      && tail.bytes[i + 2] === 0x05 && tail.bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const tv = new DataView(tail.bytes.buffer, tail.bytes.byteOffset, tail.bytes.byteLength);
  let entryCount = u16(tv, eocd + 10);
  let cdSize = u32(tv, eocd + 12);
  let cdOffset = u32(tv, eocd + 16);

  /* ZIP64: the 32-bit fields saturate and the real values live in a separate
     record the locator points at. Without this a large archive reads as empty. */
  if (cdOffset === 0xFFFFFFFF || entryCount === 0xFFFF || cdSize === 0xFFFFFFFF) {
    const locator = eocd - 20;
    if (locator >= 0 && tail.bytes[locator] === 0x50 && tail.bytes[locator + 1] === 0x4B
      && tail.bytes[locator + 2] === 0x06 && tail.bytes[locator + 3] === 0x07) {
      const z64At = Number(new DataView(tail.bytes.buffer, tail.bytes.byteOffset, tail.bytes.byteLength).getBigUint64(locator + 8, true));
      const z64 = new Uint8Array(await file.slice(z64At, z64At + 56).arrayBuffer());
      if (startsWith(z64, 0, [0x50, 0x4B, 0x06, 0x06])) {
        const zv = new DataView(z64.buffer);
        entryCount = Number(zv.getBigUint64(32, true));
        cdSize = Number(zv.getBigUint64(40, true));
        cdOffset = Number(zv.getBigUint64(48, true));
      }
    }
  }
  if (!(cdOffset >= 0) || !(cdSize > 0) || cdOffset + cdSize > size) return { entries: [], truncated: true, count: entryCount };

  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cv = new DataView(cd.buffer);
  const entries = [];
  let p = 0;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let encrypted = 0;
  let worstRatio = 0;

  while (p + 46 <= cd.length && entries.length < ZIP_MAX_ENTRIES) {
    if (!(cd[p] === 0x50 && cd[p + 1] === 0x4B && cd[p + 2] === 0x01 && cd[p + 3] === 0x02)) break;
    const flags = u16(cv, p + 8);
    const comp = u32(cv, p + 20);
    const uncomp = u32(cv, p + 24);
    const nameLen = u16(cv, p + 28);
    const extraLen = u16(cv, p + 30);
    const commentLen = u16(cv, p + 32);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    /* Bit 11 says the name is UTF-8. Without it ZIP is officially CP437; UTF-8
       is what everything actually writes, so decode as UTF-8 either way but
       never throw on a malformed name. */
    let name = '';
    try { name = new TextDecoder('utf-8', { fatal: false }).decode(rawName); }
    catch (_) { name = ascii(rawName, 0, rawName.length); }

    const isDir = /\/$/.test(name);
    if (!isDir) {
      totalCompressed += comp;
      totalUncompressed += uncomp;
      if (comp > 0 && uncomp / comp > worstRatio) worstRatio = uncomp / comp;
    }
    if (flags & 0x1) encrypted++;
    entries.push({ name, size: uncomp, compressed: comp, dir: isDir, encrypted: !!(flags & 0x1) });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const files = entries.filter((e) => !e.dir);
  const named = (re) => files.filter((e) => re.test(e.name.replace(/^.*\//, '')));

  const executables = named(DANGEROUS_EXT);
  if (executables.length) {
    findings.push({
      level: 'danger',
      title: 'The archive contains files Windows will run',
      detail: executables.slice(0, 8).map((e) => e.name).join(', ')
        + (executables.length > 8 ? ' and ' + (executables.length - 8) + ' more' : ''),
    });
  }
  const doubles = files.filter((e) => DOUBLE_EXT.test(e.name.replace(/^.*\//, '')));
  if (doubles.length) {
    findings.push({
      level: 'danger',
      kind: 'disguise',
      title: 'An entry uses a double extension to look like a document',
      detail: doubles.slice(0, 6).map((e) => e.name).join(', '),
    });
  }
  const hidden = files.filter((e) => HIDDEN_CHARS.test(e.name));
  if (hidden.length) {
    findings.push({
      level: 'danger',
      kind: 'disguise',
      title: 'An entry name contains hidden text-direction characters',
      detail: 'These reverse how the name is displayed, so the extension you see is not the one that runs.',
    });
  }
  const traversal = entries.filter((e) => /(^|\/)\.\.(\/|$)/.test(e.name) || /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(e.name));
  if (traversal.length) {
    findings.push({
      level: 'danger',
      title: 'An entry would write outside the folder you extract into',
      detail: traversal.slice(0, 6).map((e) => e.name).join(', '),
    });
  }
  const nested = named(ARCHIVE_EXT);
  if (nested.length) {
    findings.push({
      level: 'caution',
      title: 'The archive contains more archives',
      detail: nested.slice(0, 6).map((e) => e.name).join(', ')
        + '. WardenOne does not open these; what is inside them is unknown.',
    });
  }
  if (encrypted) {
    findings.push({
      level: 'caution',
      title: encrypted + ' of ' + files.length + ' entries are password-protected',
      detail: 'Nothing can read them without the password, including scanners. That is sometimes privacy and'
        + ' sometimes how malware is delivered past a mail filter.',
    });
  }
  if (files.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) {
    findings.push({
      level: 'caution',
      title: 'This document carries macros',
      detail: 'It contains vbaProject.bin, which holds VBA code. A document that needs macros to be useful is rare.',
    });
  }
  if (worstRatio > BOMB_RATIO || totalUncompressed > BOMB_TOTAL_BYTES) {
    findings.push({
      level: 'caution',
      title: 'The archive claims to expand enormously',
      detail: 'It says it holds ' + humanSize(totalUncompressed) + ' compressed into ' + humanSize(totalCompressed)
        + ' (up to ' + Math.round(worstRatio) + ':1). That is the shape of a decompression bomb, though a legitimate'
        + ' archive of highly repetitive data can look the same.',
    });
  }

  return {
    entries,
    files: files.length,
    count: entryCount,
    totalUncompressed,
    totalCompressed,
    worstRatio,
    ooxml: files.some((e) => e.name === '[Content_Types].xml'),
    truncated: entries.length >= ZIP_MAX_ENTRIES,
  };
}

/* ---- Windows shortcut --------------------------------------------------- */
/* A .lnk is a tiny program: it names a target and a command line. That is what
   makes it a favourite delivery format, and it is fully readable here -- so the
   report can show the actual command rather than warning about the extension. */
function readLnk(bytes) {
  if (bytes.length < 76) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = u32(v, 20);
  const unicode = !!(flags & 0x80);
  let p = 76;
  if (flags & 0x1) {
    if (p + 2 > bytes.length) return null;
    p += 2 + u16(v, p);
  }
  if (flags & 0x2) {
    if (p + 4 > bytes.length) return null;
    p += u32(v, p) || 0;
  }
  const read = () => {
    if (p + 2 > bytes.length) return '';
    const count = u16(v, p);
    p += 2;
    const byteLen = unicode ? count * 2 : count;
    if (p + byteLen > bytes.length) { p = bytes.length; return ''; }
    let out = '';
    if (unicode) for (let i = 0; i < count; i++) out += String.fromCharCode(u16(v, p + i * 2));
    else out = ascii(bytes, p, count);
    p += byteLen;
    return out;
  };
  const out = {};
  if (flags & 0x4) out.name = read();
  if (flags & 0x8) out.target = read();
  if (flags & 0x10) out.workingDir = read();
  if (flags & 0x20) out.args = read();
  return out;
}

/* ---- Windows executables ------------------------------------------------ */
/* "This is a program" is not information. What matters about an executable is
   whether anyone signed it, what it is able to do, and whether its code is
   hidden from inspection. All three are readable from the file, and none of it
   requires running anything.

   Capabilities are reported as what the program CAN do, never as a verdict.
   Installers legitimately download, elevate and write to the registry; the point
   is to let someone see the gap between what a file claims to be and what it is
   equipped for. */
/* Matched as EXACT names (after dropping the A/W/Ex suffixes), not as prefixes.
   The prefix version was worse than useless: /^send/ matched SendMessage, so
   every windowed program "reached the network"; GetTickCount64 made notepad
   "notice it is being examined"; GetDC made it "capture the screen". A tool that
   says something alarming about Notepad has taught the reader to ignore it.

   Anything common enough to appear in most programs has been dropped even where
   it is technically relevant -- OpenProcess, FindFirstFile, RegSetValue. A
   capability listed here has to mean something when it appears. */
const PE_CAPABILITIES = [
  ['Reach the network', ['URLDownloadToFile', 'URLDownloadToCacheFile', 'InternetOpenUrl', 'InternetReadFile',
    'InternetConnect', 'HttpSendRequest', 'HttpOpenRequest', 'WinHttpSendRequest', 'WinHttpOpenRequest',
    'WSAStartup', 'socket', 'connect', 'getaddrinfo', 'gethostbyname']],
  ['Start other programs', ['WinExec', 'ShellExecute', 'CreateProcess', 'CreateProcessAsUser', 'system', '_wsystem']],
  ['Write into another running program', ['VirtualAllocEx', 'WriteProcessMemory', 'CreateRemoteThread',
    'NtUnmapViewOfSection', 'QueueUserAPC', 'SetThreadContext', 'NtWriteVirtualMemory', 'RtlCreateUserThread']],
  ['Record what you type', ['SetWindowsHookEx', 'GetAsyncKeyState', 'GetKeyboardState', 'RegisterRawInputDevices']],
  ['Install itself as a Windows service', ['CreateService', 'OpenSCManager', 'StartService', 'ChangeServiceConfig']],
  ['Notice it is being examined', ['IsDebuggerPresent', 'CheckRemoteDebuggerPresent', 'NtQueryInformationProcess']],
  ['Encrypt or decrypt data', ['CryptEncrypt', 'CryptDecrypt', 'BCryptEncrypt', 'BCryptDecrypt', 'CryptGenKey']],
  ['List everything else running', ['CreateToolhelp32Snapshot', 'Process32First', 'Process32Next', 'EnumProcesses']],
  ['Take administrator privileges', ['AdjustTokenPrivileges', 'LookupPrivilegeValue']],
  ['Read or replace your clipboard', ['GetClipboardData', 'SetClipboardData']],
  ['Capture the screen, microphone or camera', ['capCreateCaptureWindow', 'waveInOpen', 'waveInStart', 'PrintWindow']],
];
/* CreateProcessW, CreateProcessA and CreateProcess are the same call. */
function normalizeApi(name) {
  return String(name).replace(/(?:Ex)?[AW]$/, '').replace(/Ex$/, '').toLowerCase();
}
/* Built through normalizeApi as well. Keying it on the raw lowercase name while
   looking up a normalised one meant every entry written with an Ex suffix --
   SetWindowsHookEx among them -- could never match anything. */
const PE_CAPABILITY_INDEX = (() => {
  const index = new Map();
  for (const [label, names] of PE_CAPABILITIES) {
    for (const n of names) index.set(normalizeApi(n), label);
  }
  return index;
})();

function shannon(bytes) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / bytes.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/* Certificate common names, pulled straight out of the DER by their OID rather
   than by parsing the whole of PKCS#7. Enough to say WHO the file claims to come
   from; not enough -- ever -- to say the signature is valid. */
function certNames(bytes) {
  const names = [];
  for (let i = 0; i + 7 < bytes.length && names.length < 8; i++) {
    /* OID 2.5.4.3 (commonName) = 06 03 55 04 03 */
    if (bytes[i] !== 0x06 || bytes[i + 1] !== 0x03 || bytes[i + 2] !== 0x55
      || bytes[i + 3] !== 0x04 || bytes[i + 4] !== 0x03) continue;
    const tag = bytes[i + 5];
    if (tag !== 0x0C && tag !== 0x13 && tag !== 0x16) continue;
    const len = bytes[i + 6];
    if (len < 2 || len > 100 || i + 7 + len > bytes.length) continue;
    let s = '';
    for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[i + 7 + j]);
    if (/^[\x20-\x7E]+$/.test(s) && !names.includes(s)) names.push(s);
  }
  /* DER order lists the issuers first, so the useful name -- who actually signed
     it -- came last: node.exe led with "Microsoft Identity Verification Root
     Certificate Authority 2020" instead of "OpenJS Foundation". Anything that
     reads as a certificate authority goes to the back. */
  /* \bCA\b alone missed "…RSA4096 SHA384 2021 CA1", which is why Chrome's own
     binary listed a DigiCert intermediate ahead of "Google LLC". */
  const isAuthority = (s) => /certificate authority|\broot\b|\bCA\d*\b|\bPCA\b|code signing|verification|timestamp|time stamp|signer/i.test(s);
  return names.filter((s) => !isAuthority(s)).concat(names.filter(isAuthority));
}

async function readPE(file, head, findings) {
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 0x40) return null;
  const peAt = u32(hv, 0x3C);
  if (peAt <= 0 || peAt + 120 > head.length) return null;
  if (!(head[peAt] === 0x50 && head[peAt + 1] === 0x45 && head[peAt + 2] === 0 && head[peAt + 3] === 0)) return null;

  const coff = peAt + 4;
  const sectionCount = u16(hv, coff + 2);
  const timestamp = u32(hv, coff + 8);
  const optSize = u16(hv, coff + 16);
  const characteristics = u16(hv, coff + 18);
  const opt = coff + 20;
  const magic = u16(hv, opt);
  const plus = magic === 0x20B;
  const subsystem = u16(hv, opt + 68);
  const dirAt = opt + (plus ? 112 : 96);
  const dirCount = u32(hv, opt + (plus ? 108 : 92));
  const dir = (i) => (i < dirCount && dirAt + i * 8 + 8 <= head.length
    ? { rva: u32(hv, dirAt + i * 8), size: u32(hv, dirAt + i * 8 + 4) }
    : { rva: 0, size: 0 });

  const secAt = opt + optSize;
  const sections = [];
  for (let i = 0; i < sectionCount && secAt + i * 40 + 40 <= head.length; i++) {
    const p = secAt + i * 40;
    sections.push({
      name: ascii(head, p, 8).replace(/\0+$/, ''),
      virtualSize: u32(hv, p + 8),
      virtualAddress: u32(hv, p + 12),
      rawSize: u32(hv, p + 16),
      rawOffset: u32(hv, p + 20),
    });
  }
  const toOffset = (rva) => {
    for (const s of sections) {
      if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize)) {
        return s.rawOffset + (rva - s.virtualAddress);
      }
    }
    return -1;
  };

  const pe = {
    bits: plus ? 64 : 32,
    dll: !!(characteristics & 0x2000),
    subsystem: subsystem === 2 ? 'a window' : subsystem === 3 ? 'a console' : 'other',
    dotnet: dir(14).size > 0,
    timestamp: timestamp > 0 && timestamp < 4102444800 ? timestamp * 1000 : 0,
    sections: sections.map((s) => s.name).filter(Boolean),
    signed: false,
    signerNames: [],
    imports: [],
    capabilities: [],
    packed: null,
  };

  /* ---- Authenticode ---- */
  /* The certificate directory holds a FILE offset, not an RVA -- the one entry
     that does. Treating it as an RVA reads the wrong bytes and reports every
     signed binary as unsigned. */
  const cert = dir(4);
  if (cert.rva > 0 && cert.size > 8 && cert.rva + cert.size <= file.size) {
    pe.signed = true;
    pe.signatureBytes = cert.size;
    try {
      const blob = new Uint8Array(await file.slice(cert.rva, cert.rva + Math.min(cert.size, 96 * 1024)).arrayBuffer());
      pe.signerNames = certNames(blob);
    } catch (_) { /* the signature is still present; only the names are missing */ }
  }

  /* ---- imports ---- */
  const imp = dir(1);
  const impAt = imp.rva ? toOffset(imp.rva) : -1;
  if (impAt > 0 && impAt < file.size) {
    try {
      const span = Math.min(64 * 1024, file.size - impAt);
      const table = new Uint8Array(await file.slice(impAt, impAt + span).arrayBuffer());
      const tv = new DataView(table.buffer);
      const seen = new Set();
      /* A name outside the pre-read span costs a separate read of the file. In a
         real binary the import names sit beside the descriptors and land inside
         the span, so this almost never happens -- but the RVAs are attacker
         chosen, and a crafted 200 KB executable that points every one of ~16,000
         thunks somewhere far away made this issue 11,241 reads. In the page each
         of those is an async Blob read, which is seconds of unresponsiveness.
         Budgeted rather than unbounded; the analysis is already capped elsewhere
         and losing the tail of the names costs nothing. */
      let farReads = 0;
      const FAR_READ_BUDGET = 256;
      const readStringAtRva = async (rva) => {
        const off = toOffset(rva);
        if (off < 0 || off >= file.size) return '';
        if (off >= impAt && off < impAt + span) {
          let s = '';
          for (let i = off - impAt; i < table.length && table[i]; i++) s += String.fromCharCode(table[i]);
          return s;
        }
        if (farReads >= FAR_READ_BUDGET) return '';
        farReads++;
        const b = new Uint8Array(await file.slice(off, Math.min(off + 128, file.size)).arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]);
        return s;
      };
      for (let d = 0; d + 20 <= table.length && pe.imports.length < 40; d += 20) {
        const intRva = u32(tv, d);
        const nameRva = u32(tv, d + 12);
        const iatRva = u32(tv, d + 16);
        if (!nameRva && !intRva && !iatRva) break;
        const dllName = await readStringAtRva(nameRva);
        if (!dllName || !/^[\x20-\x7E]{3,64}$/.test(dllName)) continue;
        pe.imports.push(dllName.toLowerCase());
        /* Walk the name table for this DLL, bounded: the function names are what
           carry meaning, the DLL alone rarely does. */
        const thunkRva = intRva || iatRva;
        const thunkAt = thunkRva ? toOffset(thunkRva) : -1;
        if (thunkAt < 0) continue;
        const step = plus ? 8 : 4;
        const chunk = new Uint8Array(await file.slice(thunkAt, Math.min(thunkAt + step * 400, file.size)).arrayBuffer());
        const cv = new DataView(chunk.buffer);
        for (let t = 0; t + step <= chunk.length && seen.size < 600; t += step) {
          const lo = u32(cv, t);
          const hi = plus ? u32(cv, t + 4) : 0;
          if (!lo && !hi) break;
          if (plus ? (hi & 0x80000000) : (lo & 0x80000000)) continue; /* imported by ordinal */
          const fnName = await readStringAtRva(lo + 2);
          if (fnName && /^[A-Za-z_][A-Za-z0-9_@]{2,63}$/.test(fnName)) seen.add(fnName);
        }
      }
      const matched = new Map();
      for (const fn of seen) {
        const label = PE_CAPABILITY_INDEX.get(normalizeApi(fn));
        if (!label) continue;
        if (!matched.has(label)) matched.set(label, []);
        const list = matched.get(label);
        if (list.length < 4) list.push(fn);
      }
      pe.capabilities = [...matched].map(([label, examples]) => ({ label, examples }));
      pe.importedFunctions = seen.size;
    } catch (_) { /* a malformed import table is not worth failing the whole scan over */ }
  }

  /* ---- packing ---- */
  const code = sections.find((s) => /^(\.text|CODE)$/i.test(s.name)) || sections[0];
  if (code && code.rawSize > 4096 && code.rawOffset + code.rawSize <= file.size) {
    const sample = new Uint8Array(await file.slice(code.rawOffset, code.rawOffset + Math.min(code.rawSize, 256 * 1024)).arrayBuffer());
    pe.entropy = shannon(sample);
    pe.packed = pe.entropy > 7.2;
  }
  const packerNames = sections.filter((s) => /^(UPX|\.aspack|\.themida|\.vmp|\.enigma|\.petite|\.nsp)/i.test(s.name));

  /* ---- what any of that means ---- */
  if (!pe.signed) {
    /* NOT "nobody signed this". Windows' own binaries are catalog-signed -- the
       signature lives in a separate .cat file, not in the executable -- so
       notepad.exe has no embedded signature and is perfectly signed. Saying
       otherwise about a system file is the kind of false alarm that teaches
       someone to ignore the tool. */
    findings.push({
      level: 'caution',
      title: 'There is no signature inside this file',
      detail: 'Nothing embedded in it says who wrote it. That is not the same as unsigned: Windows signs its own'
        + ' files through a separate catalog, so system files legitimately look like this. For something you'
        + ' downloaded, though, an embedded signature is what you would expect, and its absence is worth a pause.',
    });
  } else {
    findings.push({
      level: 'info',
      title: pe.signerNames.length ? 'Signed, and the certificate names: ' + pe.signerNames.slice(0, 3).join(', ')
        : 'It carries a signature, but no readable name',
      detail: 'WardenOne can see the signature is there and read the names in it. It cannot check that the signature'
        + ' is valid, unrevoked, or actually belongs to that company -- a browser page has no way to do that. Treat'
        + ' the name as a claim.',
    });
  }
  if (packerNames.length) {
    findings.push({
      level: 'caution',
      title: 'The code is packed (' + packerNames.map((s) => s.name).join(', ') + ')',
      detail: 'Packing compresses or encrypts the program so its contents cannot be read until it runs. Some'
        + ' commercial software does this to deter copying; malware does it to hide.',
    });
  } else if (pe.packed) {
    findings.push({
      level: 'caution',
      title: 'The code looks compressed or encrypted',
      detail: 'The main code section has an entropy of ' + pe.entropy.toFixed(2) + ' out of 8, which means it does'
        + ' not read as ordinary machine code. That usually means packing. It is not proof of anything on its own.',
    });
  }
  if (pe.capabilities.length) {
    findings.push({
      level: 'info',
      title: 'What this program is equipped to do',
      detail: pe.capabilities.map((c) => c.label).join(' · ')
        + '. This is taken from the functions it imports -- what it CAN do, not what it will. An installer'
        + ' legitimately needs several of these.',
    });
  }
  return pe;
}

/* ---- scripts ------------------------------------------------------------- */
/* A script is the one file type where the whole thing is readable and says
   exactly what it will do. Reporting "Plain text" and stopping was the largest
   gap in the scanner: .bat, .ps1, .vbs and .js are what actually arrives in a
   chat message, and they need no installer and no exploit -- a double-click is
   the whole attack.

   Same principle as the shortcut panel: show the reader the actual lines rather
   than a warning about the extension. */
const SCRIPT_EXT = {
  ps1: 'PowerShell', psm1: 'PowerShell', bat: 'Batch', cmd: 'Batch', vbs: 'VBScript', vbe: 'VBScript',
  js: 'JavaScript', jse: 'JavaScript', wsf: 'Windows Script', hta: 'HTML Application',
  sh: 'Shell', py: 'Python', pl: 'Perl', rb: 'Ruby', ahk: 'AutoHotkey', reg: 'Registry script',
};
/* Each entry is what the line DOES, in the reader's terms. Deliberately not a
   score: one of these on its own can be ordinary, and the reader can see the
   line it came from. */
const SCRIPT_SIGNALS = [
  [/(?:FromBase64String|::FromBase64|atob\s*\(|base64\s+-d|certutil[^\n]*-decode)/i,
    'Decodes something hidden before running it'],
  [/(?:-e(?:nc|ncodedcommand)\b|-\bec\b)/i, 'Runs a command that has been encoded to be unreadable'],
  [/(?:Invoke-Expression|\bIEX\b|\beval\s*\(|Function\s*\(\s*\)\s*\{\s*return\s+eval)/i,
    'Builds code while running and executes it'],
  [/(?:DownloadString|DownloadFile|Invoke-WebRequest|\biwr\b|Start-BitsTransfer|bitsadmin|curl\s|wget\s|urlmon|XMLHTTP|WinHttp)/i,
    'Downloads something from the internet'],
  [/(?:-w(?:indowstyle)?\s+hidden|-nop\b|-noprofile|-executionpolicy\s+bypass|-ep\s+bypass|\bvbhide\b|CreateObject\s*\(\s*["']WScript\.Shell)/i,
    'Hides its own window or bypasses execution rules'],
  [/(?:Add-MpPreference|Set-MpPreference|-ExclusionPath|Disable-WindowsOptionalFeature|netsh\s+advfirewall|sc\s+stop\s+wuauserv)/i,
    'Turns off or excludes itself from security software'],
  [/(?:vssadmin[^\n]*delete\s+shadows|wbadmin[^\n]*delete|bcdedit[^\n]*recoveryenabled|cipher\s+\/w)/i,
    'Destroys backups or recovery options'],
  [/(?:schtasks[^\n]*\/create|New-ScheduledTask|reg(?:\.exe)?\s+add[^\n]*\\Run|CurrentVersion\\Run|New-ItemProperty[^\n]*\\Run)/i,
    'Sets itself to run again automatically'],
  [/(?:String\.fromCharCode|\[char\]\d|Chr\s*\(\s*\d|\-join\s*\(|\[convert\]::)/i,
    'Assembles text character by character, which hides what it says'],
  [/(?:Get-Clipboard|Set-Clipboard|clip\.exe)/i, 'Reads or replaces the clipboard'],
  [/(?:Add-Type[^\n]*user32|VirtualAlloc|CreateRemoteThread|WriteProcessMemory|Reflection\.Assembly)/i,
    'Loads code straight into memory'],
];

function readScript(text, name, ext, format, findings) {
  const kind = SCRIPT_EXT[ext] || (/^#!/.test(text) ? 'Shell' : '');
  /* Only treat it as a script when the NAME says so, or it opens with a
     shebang. Guessing from content would call every README with the word
     "eval" in it a script. */
  if (!kind) return null;

  const lines = text.split(/\r?\n/);
  const signals = [];
  for (const [re, label] of SCRIPT_SIGNALS) {
    const hit = lines.find((l) => re.test(l));
    if (hit) signals.push({ label, line: hit.trim().slice(0, 300) });
  }
  /* One enormous line is how an obfuscated script looks from a distance. */
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  const obfuscated = longest > 1200 || /[A-Za-z0-9+/]{200,}={0,2}/.test(text);
  if (obfuscated) {
    signals.push({
      label: 'Written to be unreadable',
      line: longest > 1200 ? 'One line is ' + longest.toLocaleString() + ' characters long.'
        : 'It contains a long run of encoded text.',
    });
  }

  findings.push({
    level: signals.length ? 'danger' : 'caution',
    title: signals.length
      ? 'This ' + kind + ' script does things worth reading before you run it'
      : 'This is a ' + kind + ' script',
    detail: signals.length
      ? signals.map((s) => s.label).join('. ') + '. The lines are below, exactly as written.'
      : 'Nothing in it matched the things WardenOne looks for, but a script is instructions for your'
        + ' computer and running one hands it whatever you can do. The whole file is below -- it is short'
        + ' enough to read.',
  });
  return {
    kind,
    lines: lines.length,
    signals,
    /* Enough to read, not so much that the page becomes the file. */
    preview: lines.slice(0, 60).join('\n').slice(0, 6000),
    truncated: lines.length > 60 || text.length > 6000,
  };
}

/* ---- PDFs ---------------------------------------------------------------- */
/* A PDF is a document format that can also run scripts, open programs and carry
   other files. Those are keywords in the file, so they are readable without a
   renderer -- and a PDF that has none of them cannot do any of it. */
async function readPdf(file, findings) {
  const span = Math.min(file.size, 4 * 1024 * 1024);
  const text = ascii(new Uint8Array(await file.slice(0, span).arrayBuffer()), 0, span);
  const has = (needle) => text.includes(needle);
  const active = [];
  if (has('/JavaScript') || has('/JS')) active.push('runs JavaScript');
  if (has('/OpenAction') || has('/AA')) active.push('does something the moment it opens');
  if (has('/Launch')) active.push('can start another program');
  if (has('/EmbeddedFile') || has('/Filespec')) active.push('carries another file inside it');
  if (has('/SubmitForm')) active.push('can send data somewhere');
  if (!active.length) {
    return { active: [], scanned: span };
  }
  findings.push({
    level: active.some((a) => /start another program|the moment it opens/.test(a)) ? 'danger' : 'caution',
    title: 'This PDF is not just a document',
    detail: 'It ' + active.join(', it ') + '. Most PDFs contain none of this'
      + (span < file.size ? ' (checked the first ' + humanSize(span) + ')' : '') + '.',
  });
  return { active, scanned: span };
}

/* ---- legacy Office ------------------------------------------------------- */
/* .doc/.xls are OLE2 compound files, so the modern "look for vbaProject.bin in
   the zip" check cannot see them. The stream names live in the directory as
   UTF-16, which is enough to find a macro project without parsing the FAT. */
async function readOle(file, findings) {
  const span = Math.min(file.size, 2 * 1024 * 1024);
  const bytes = new Uint8Array(await file.slice(0, span).arrayBuffer());
  let utf16 = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    utf16 += (c >= 32 && c < 127) ? String.fromCharCode(c) : '\n';
  }
  const macro = /_VBA_PROJECT|VBA\n|Macros/.test(utf16);
  if (macro) {
    findings.push({
      level: 'caution',
      title: 'This document carries macros',
      detail: 'It contains a VBA project. In an old-format Office document that code can run when the file is'
        + ' opened, if macros are enabled. A document that genuinely needs them is rare.',
    });
  }
  return { macro };
}

/* ---- hashing ------------------------------------------------------------ */
async function hashFile(file) {
  if (file.size > HASH_MAX_BYTES) {
    return { skipped: true, reason: 'This file is ' + humanSize(file.size) + '. Hashing needs the whole file in'
      + ' memory at once, and past ' + humanSize(HASH_MAX_BYTES) + ' that would hang the tab, so the hash was not'
      + ' computed. Everything else on this page was still checked.' };
  }
  const buf = await file.arrayBuffer();
  const hex = (d) => Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const [sha256, sha1] = await Promise.all([
    crypto.subtle.digest('SHA-256', buf),
    crypto.subtle.digest('SHA-1', buf),
  ]);
  return { sha256: hex(sha256), sha1: hex(sha1) };
}

/* ---- the scan ----------------------------------------------------------- */
async function analyse(file, onStage) {
  const findings = [];
  const name = file.name || '(no name)';
  const ext = extensionOf(name);

  onStage('Reading the file…');
  const head = new Uint8Array(await file.slice(0, Math.min(HEAD_BYTES, file.size)).arrayBuffer());
  const tailStart = Math.max(0, file.size - TAIL_BYTES);
  const tailBytes = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
  const tail = { start: tailStart, bytes: tailBytes };
  let isoProbe = null;
  if (file.size > 32774) isoProbe = new Uint8Array(await file.slice(32769, 32774).arrayBuffer());

  const format = detectFormat(head, file.size, isoProbe);

  /* ---- name tricks: the same checks Download Shield grades URLs with ---- */
  if (DOUBLE_EXT.test(name)) {
    findings.push({
      level: 'danger',
      kind: 'disguise',
      title: 'Double extension',
      detail: 'The name ends in something that runs, with a document extension in front of it to make it look'
        + ' harmless.',
    });
  }
  if (HIDDEN_CHARS.test(name)) {
    findings.push({
      level: 'danger',
      kind: 'disguise',
      title: 'The name contains hidden text-direction characters',
      detail: 'These reverse how part of the name is drawn on screen, so the extension you can see is not the'
        + ' extension the system uses.',
    });
  }
  if (/\s{6,}\.[a-z0-9]{2,5}$/i.test(name) || /_{8,}\.[a-z0-9]{2,5}$/i.test(name)) {
    findings.push({ level: 'caution', title: 'The name is padded to push its extension out of sight', detail: name.slice(0, 120) });
  }

  /* ---- extension against actual content ---- */
  const expected = EXT_EXPECTS[ext];
  let mismatch = null;
  if (expected && format.id && !expected.includes(format.id)) {
    mismatch = { ext, is: format.label };
    /* The direction matters. Something harmless stored under an odd extension
       is a curiosity; a program wearing a document's name is an attack. */
    const dangerous = format.cls === 'executable' || format.cls === 'shortcut' || format.cls === 'script';
    findings.push({
      level: dangerous ? 'danger' : 'caution',
      kind: 'disguise',
      /* The format label keeps its own capitals. Lowercasing it to fit a sentence
         turned "Windows program (PE/DOS executable)" into "windows program
         (pe/dos executable)", which reads like a typo in the one line that has
         to be believed. */
      title: dangerous
        ? 'Named .' + ext + ', but it is really this: ' + format.label
        : 'The extension does not match the contents',
      detail: dangerous
        ? 'Opening it would not open a .' + ext + ' file. It would run a program.'
        : 'A .' + ext + ' file normally holds something else. This is: ' + format.label
          + '. That is often harmless -- a renamed file, or an extension used loosely.',
    });
  }

  /* ---- what the content itself is ---- */
  if (format.cls === 'executable' && !mismatch) {
    findings.push({
      level: 'caution',
      title: 'This is a program',
      detail: 'It is honestly named, so nothing here is disguised. Running it gives it the same access to this'
        + ' computer that you have.',
    });
  }
  if (MACRO_DOC_EXT.test(name)) {
    findings.push({
      level: 'caution',
      title: 'A macro-enabled document format',
      detail: 'The extension .' + ext + ' exists specifically to carry code alongside the document.',
    });
  }

  /* ---- containers ---- */
  let zip = null;
  let lnk = null;
  if (format.id === 'zip') {
    onStage('Reading the archive index…');
    zip = await readZip(file, tail, findings);
  }
  if (format.id === 'lnk') {
    lnk = readLnk(head);
    const command = ((lnk && lnk.target) || '') + ' ' + ((lnk && lnk.args) || '');
    const shell = /(powershell|pwsh|cmd\.exe|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|curl|msiexec)/i.test(command);
    const encoded = /-enc|-e\s+[A-Za-z0-9+/]{40,}|FromBase64String|hidden|bypass|-nop|IEX|Invoke-Expression/i.test(command);
    findings.push({
      level: shell || encoded ? 'danger' : 'caution',
      title: shell ? 'This shortcut runs a command interpreter' : 'This is a shortcut, not the file it appears to be',
      detail: shell
        ? 'A shortcut that launches ' + (command.match(/(powershell|pwsh|cmd\.exe|wscript|cscript|mshta|rundll32|regsvr32|certutil|bitsadmin|msiexec)/i) || [''])[0]
          + ' is how a single click becomes an arbitrary command.' + (encoded ? ' The command also looks obfuscated.' : '')
        : 'A .lnk carries a target and a command line. The full command is below -- read it before opening.',
    });
  }

  /* ---- appended payload ---- */
  /* A file whose declared format ends long before the file does, with an archive
     footer at the tail, is the classic "image with a ZIP glued on" smuggle. */
  if ((format.cls === 'image' || format.cls === 'document' || format.cls === 'media') && file.size > 512) {
    let zipAtTail = false;
    for (let i = tailBytes.length - 22; i >= 0 && !zipAtTail; i--) {
      if (tailBytes[i] === 0x50 && tailBytes[i + 1] === 0x4B && tailBytes[i + 2] === 0x05 && tailBytes[i + 3] === 0x06) zipAtTail = true;
    }
    if (zipAtTail) {
      findings.push({
        level: 'caution',
        title: 'There is an archive attached to the end of this file',
        detail: 'It opens as what it claims (' + format.label + '), but a ZIP end-marker sits at the tail. Appending an'
          + ' archive to an image is a known way to move files past a filter that only checks the first few bytes.',
      });
    }
  }

  let pe = null;
  let pdf = null;
  let ole = null;
  if (format.id === 'exe') {
    onStage('Reading the program header…');
    try { pe = await readPE(file, head, findings); } catch (_) { pe = null; }
  }
  if (format.id === 'pdf') {
    onStage('Looking for active content…');
    try { pdf = await readPdf(file, findings); } catch (_) { pdf = null; }
  }
  if (format.id === 'ole') {
    onStage('Reading the document streams…');
    try { ole = await readOle(file, findings); } catch (_) { ole = null; }
  }
  let script = null;
  if (SCRIPT_EXT[ext] || format.id === 'sh' || (format.cls === 'text' && SCRIPT_EXT[ext])) {
    onStage('Reading the script…');
    try {
      const span = Math.min(file.size, 512 * 1024);
      const text = new TextDecoder('utf-8', { fatal: false })
        .decode(await file.slice(0, span).arrayBuffer());
      script = readScript(text, name, ext, format, findings);
    } catch (_) { script = null; }
  }

  onStage('Hashing…');
  const hash = await hashFile(file);

  /* The one check that can say a file IS bad rather than merely odd, and it
     needs no key and no network: WardenOne ships a known-malware hash set.
     Download Shield can only match it against a URL re-fetch; this is the real
     file, so a match here means this exact file. */
  let known = null;
  if (!hash.skipped) {
    onStage('Checking the known-malware list…');
    known = await new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      setTimeout(() => done(null), 4000);
      try {
        chrome.runtime.sendMessage({ kind: 'file-scan-known', sha256: hash.sha256 }, (res) => {
          void chrome.runtime.lastError;
          done(res && res.ok ? res : null);
        });
      } catch (_) { done(null); }
    });
    if (known && known.hit) {
      findings.unshift({
        level: 'danger',
        title: 'This exact file is on WardenOne\'s known-malware list',
        detail: 'Its SHA-256 matches an entry in the list bundled with WardenOne. This is the real file you picked,'
          + ' not a guess from its name. Delete it rather than opening it.',
      });
    }
  }

  return {
    name,
    ext,
    size: file.size,
    lastModified: file.lastModified || 0,
    declaredType: file.type || '',
    format,
    mismatch,
    findings,
    zip,
    lnk,
    pe,
    pdf,
    ole,
    script,
    hash,
    known,
  };
}

/* ---- verdict ------------------------------------------------------------ */
/* Three states, and none of them is "safe". The best available answer is that
   nothing checked here came back wrong, which is a statement about the checks,
   not about the file. */
function verdictFor(report) {
  const dangers = report.findings.filter((f) => f.level === 'danger');
  if (dangers.length) {
    /* Two different accusations, and using one headline for both was wrong: an
       archive named documents.zip that really is a zip, but carries an .exe and a
       path-traversal entry, was announced as "not what its name says". The name
       was honest; the contents were not. Say which. */
    const disguised = dangers.some((f) => f.kind === 'disguise');
    return {
      level: 'danger',
      headline: disguised
        ? 'This file is not what its name says.'
        : 'The name is honest. What is inside is the problem.',
      copy: 'Everything below is what WardenOne found by reading the bytes. Do not open it to find out more.',
    };
  }
  if (report.findings.some((f) => f.level === 'caution')) {
    return {
      level: 'caution',
      headline: 'Nothing is disguised, but there are things worth knowing.',
      copy: 'The name matches the contents. The points below are about what the file is, not about it lying.',
    };
  }
  return {
    level: 'plain',
    headline: 'Nothing here is disguised.',
    copy: 'The name matches the contents and none of the tricks WardenOne checks for are present. That is not the'
      + ' same as safe: a file can be exactly what it claims and still be harmful, and nothing on this page opens'
      + ' or runs it to find out.',
  };
}

/* ---- rendering ---------------------------------------------------------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function row(dl, key, value) {
  if (value === '' || value === undefined || value === null) return;
  dl.appendChild(el('dt', null, key));
  dl.appendChild(el('dd', null, String(value)));
}

function render(report) {
  const v = verdictFor(report);
  $('result').hidden = false;
  $('empty').hidden = true;

  const verdict = $('verdict');
  verdict.className = 'fs-verdict is-' + v.level;
  verdict.textContent = '';
  verdict.appendChild(el('div', 'fs-verdict-head', v.headline));
  verdict.appendChild(el('p', 'fs-verdict-copy', v.copy));

  const facts = $('facts');
  facts.textContent = '';
  row(facts, 'Name', report.name);
  row(facts, 'Size', humanSize(report.size) + ' (' + report.size.toLocaleString() + ' bytes)');
  row(facts, 'Actually is', report.format.label);
  row(facts, 'Extension says', report.ext ? '.' + report.ext : 'no extension');
  if (report.declaredType) row(facts, 'Browser reported', report.declaredType);
  if (report.lastModified) row(facts, 'Modified', new Date(report.lastModified).toLocaleString());
  if (report.hash.skipped) row(facts, 'SHA-256', 'not computed');
  else {
    row(facts, 'SHA-256', report.hash.sha256);
    row(facts, 'SHA-1', report.hash.sha1);
  }

  const list = $('findings');
  list.textContent = '';
  if (!report.findings.length) {
    list.appendChild(el('p', 'fs-note', 'No name tricks, no extension mismatch, no disguised content.'));
  }
  for (const f of report.findings) {
    const item = el('div', 'fs-finding is-' + f.level);
    item.appendChild(el('div', 'fs-finding-title', f.title));
    item.appendChild(el('div', 'fs-finding-detail', f.detail));
    list.appendChild(item);
  }
  if (report.hash.skipped) {
    const item = el('div', 'fs-finding is-info');
    item.appendChild(el('div', 'fs-finding-title', 'The hash was not computed'));
    item.appendChild(el('div', 'fs-finding-detail', report.hash.reason));
    list.appendChild(item);
  }
  /* Say the list was checked even when it matches nothing. A check that only
     speaks up when it fires leaves the reader unable to tell "checked and clear"
     from "never ran". */
  if (report.known && !report.known.hit) {
    const item = el('div', 'fs-finding is-info');
    item.appendChild(el('div', 'fs-finding-title', 'Not on the known-malware list'));
    item.appendChild(el('div', 'fs-finding-detail',
      'Checked against the ' + (report.known.listSize || 0).toLocaleString()
      + ' hashes bundled with WardenOne, offline. That list is small and specific — missing from it means very'
      + ' little on its own.'));
    list.appendChild(item);
  }

  /* ---- what the program is ---- */
  const peBox = $('pe-box');
  peBox.hidden = !report.pe;
  if (report.pe) {
    const p = report.pe;
    const dl = $('pe-facts');
    dl.textContent = '';
    row(dl, 'Kind', (p.bits === 64 ? '64-bit ' : '32-bit ') + (p.dll ? 'library (DLL)' : 'program')
      + (p.dotnet ? ', written for .NET' : '') + ', runs as ' + p.subsystem);
    row(dl, 'Signed by', p.signed
      ? (p.signerNames.length ? p.signerNames.slice(0, 4).join(', ') : 'a certificate with no readable name')
      : 'no signature inside the file (Windows signs its own through a catalog)');
    if (p.timestamp) row(dl, 'Built', new Date(p.timestamp).toLocaleDateString());
    if (typeof p.entropy === 'number') row(dl, 'Code entropy', p.entropy.toFixed(2) + ' / 8' + (p.packed ? ' (packed)' : ''));
    if (p.sections.length) row(dl, 'Sections', p.sections.join(', '));
    if (p.imports.length) row(dl, 'Uses', p.imports.slice(0, 12).join(', ')
      + (p.imports.length > 12 ? ' and ' + (p.imports.length - 12) + ' more' : ''));

    const caps = $('pe-caps');
    caps.textContent = '';
    for (const c of p.capabilities) {
      const item = el('div', 'fs-cap');
      item.appendChild(el('div', 'fs-cap-label', c.label));
      item.appendChild(el('div', 'fs-cap-why', c.examples.join(', ')));
      caps.appendChild(item);
    }
    $('pe-caps-empty').hidden = p.capabilities.length > 0;
  }

  /* ---- what the script actually says ---- */
  const scriptBox = $('script-box');
  scriptBox.hidden = !report.script;
  if (report.script) {
    const s = report.script;
    $('script-title').textContent = s.kind + ' script, ' + s.lines.toLocaleString()
      + ' line' + (s.lines === 1 ? '' : 's');
    const sig = $('script-signals');
    sig.textContent = '';
    for (const item of s.signals) {
      const row2 = el('div', 'fs-sig');
      row2.appendChild(el('div', 'fs-sig-label', item.label));
      row2.appendChild(el('div', 'fs-sig-line', item.line));
      sig.appendChild(row2);
    }
    $('script-clean').hidden = s.signals.length > 0;
    $('script-source').textContent = s.preview + (s.truncated ? '\n\n… (shortened for display)' : '');
  }

  /* ---- the shortcut's actual command ---- */
  const lnkBox = $('lnk-box');
  lnkBox.hidden = !report.lnk;
  if (report.lnk) {
    const dl = $('lnk-facts');
    dl.textContent = '';
    row(dl, 'Runs', report.lnk.target || '(not recorded in the shortcut)');
    row(dl, 'Arguments', report.lnk.args || '(none)');
    row(dl, 'Working folder', report.lnk.workingDir || '');
    row(dl, 'Description', report.lnk.name || '');
  }

  /* ---- archive contents ---- */
  const zipBox = $('zip-box');
  zipBox.hidden = !report.zip;
  if (report.zip) {
    $('zip-summary').textContent = report.zip.files + ' file' + (report.zip.files === 1 ? '' : 's')
      + ', ' + humanSize(report.zip.totalUncompressed) + ' when expanded'
      + (report.zip.truncated ? ' (first ' + ZIP_MAX_ENTRIES + ' entries listed)' : '')
      + '. Read from the archive index; nothing was extracted.';
    const tbody = $('zip-rows');
    tbody.textContent = '';
    for (const e of report.zip.entries.filter((x) => !x.dir).slice(0, 300)) {
      const base = e.name.replace(/^.*\//, '');
      const risky = DANGEROUS_EXT.test(base) || DOUBLE_EXT.test(base) || HIDDEN_CHARS.test(e.name);
      const tr = el('tr', risky ? 'is-risky' : '');
      tr.appendChild(el('td', 'fs-mono', e.name));
      tr.appendChild(el('td', null, humanSize(e.size)));
      tr.appendChild(el('td', null, e.encrypted ? 'locked' : ''));
      tbody.appendChild(tr);
    }
  }

  /* ---- the one network step ---- */
  const vt = $('vt-box');
  vt.hidden = false;
  $('vt-result').textContent = '';
  $('vt-run').disabled = !!report.hash.skipped;
  $('vt-hash').textContent = report.hash.skipped ? '(no hash to send)' : report.hash.sha256;
}

/* ---- VirusTotal, only when asked --------------------------------------- */
$('vt-run').addEventListener('click', () => {
  if (!CURRENT || !CURRENT.hash || CURRENT.hash.skipped) return;
  const out = $('vt-result');
  const button = $('vt-run');
  button.disabled = true;
  out.textContent = 'Asking VirusTotal about this hash…';
  chrome.runtime.sendMessage({ kind: 'file-scan-vt', sha256: CURRENT.hash.sha256 }, (res) => {
    void chrome.runtime.lastError;
    button.disabled = false;
    if (!res || !res.ok) {
      out.textContent = (res && res.error) || 'That did not work, and WardenOne cannot tell you why.';
      return;
    }
    if (res.noKey) {
      out.textContent = 'No VirusTotal key is set. Add one in the popup under API keys, then try again. Without a'
        + ' key this step cannot run — and everything else on this page already ran without one.';
      return;
    }
    if (res.notFound) {
      out.textContent = 'VirusTotal has never seen this file. That is normal for anything personal, freshly built,'
        + ' or rare — and it is also true of brand new malware. It is not a clean result; it is no result.';
      return;
    }
    const s = res.stats || {};
    const flagged = Number(s.malicious || 0) + Number(s.suspicious || 0);
    const total = flagged + Number(s.harmless || 0) + Number(s.undetected || 0);
    out.textContent = flagged
      ? flagged + ' of ' + total + ' engines flag this file'
        + (res.typeDescription ? ' (VirusTotal calls it ' + res.typeDescription + ')' : '') + '.'
      : 'No engine flags this file, out of ' + total + '. Engines disagree and lag behind new malware, so this'
        + ' lowers suspicion rather than settling it.';
  });
});

/* ---- picking files ------------------------------------------------------ */
/* Several at once, because the situation this exists for is rarely one file --
   it is a folder off a USB stick, or everything someone sent in a chat. Scanned
   in sequence rather than in parallel: hashing is the slow part and running six
   at once would just make each of them slower. */
let BATCH = [];
/* Scanning is async and slow, and nothing stops someone dropping a second set of
   files while the first is still hashing. Without this the two runs interleave:
   the newer one clears BATCH and the older one keeps pushing into it, so the
   summary ends up a mixture of both. A run token means the stale scan notices it
   has been superseded and stops touching the page. */
let SCAN_RUN = 0;

async function scan(files) {
  const list = [...(files || [])].slice(0, 50);
  if (!list.length) return;
  const run = ++SCAN_RUN;
  $('empty').hidden = true;
  $('result').hidden = true;
  $('progress').hidden = false;
  const batch = [];

  for (let i = 0; i < list.length; i++) {
    if (run !== SCAN_RUN) return;
    const prefix = list.length > 1 ? '(' + (i + 1) + ' of ' + list.length + ') ' + list[i].name + ' — ' : '';
    try {
      const report = await analyse(list[i], (stage) => {
        if (run === SCAN_RUN) $('progress').textContent = prefix + stage;
      });
      batch.push(report);
    } catch (e) {
      batch.push({
        name: list[i].name || '(no name)',
        failed: String(e && e.message ? e.message : e).slice(0, 200),
      });
    }
  }
  if (run !== SCAN_RUN) return;
  BATCH = batch;
  $('progress').hidden = true;

  renderBatch();
  const first = BATCH.find((r) => !r.failed);
  if (first) { CURRENT = first; render(first); }
  else {
    $('empty').hidden = false;
    $('empty').textContent = BATCH.length === 1
      ? 'That file could not be read: ' + BATCH[0].failed
      : 'None of those files could be read.';
  }
}

/* The summary list only earns its space when there is more than one file. */
function renderBatch() {
  const box = $('batch');
  box.hidden = BATCH.length < 2;
  if (BATCH.length < 2) return;
  const rows = $('batch-rows');
  rows.textContent = '';
  for (const r of BATCH) {
    const tr = el('tr', 'log-row');
    tr.tabIndex = 0;
    const v = r.failed ? { level: 'plain', headline: 'Could not be read' } : verdictFor(r);
    const c1 = el('td');
    const badge = el('span', 'fs-badge is-' + v.level,
      v.level === 'danger' ? 'look' : v.level === 'caution' ? 'note' : 'plain');
    c1.appendChild(badge);
    const c2 = el('td', 'fs-mono', r.name);
    const c3 = el('td', null, r.failed ? r.failed : v.headline);
    tr.append(c1, c2, c3);
    if (!r.failed) {
      const open = () => { CURRENT = r; render(r); renderBatch(); $('result').scrollIntoView({ block: 'start' }); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
      if (CURRENT === r) tr.classList.add('is-open');
    }
    rows.appendChild(tr);
  }
  $('batch-count').textContent = BATCH.length + ' files scanned. Click one to see it in full.';
}

$('picker').addEventListener('change', (ev) => {
  scan(ev.target.files);
  ev.target.value = '';
});
$('pick').addEventListener('click', () => $('picker').click());

const drop = $('drop');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (ev) => { ev.preventDefault(); drop.classList.remove('is-over'); });
}
drop.addEventListener('drop', (ev) => {
  scan(ev.dataTransfer && ev.dataTransfer.files);
});

/* ---- taking the answer with you ---------------------------------------- */
/* So the reader can paste it to whoever sent them the file, or keep it. Built
   from the same report the page shows -- already-redacted values only. */
$('copy-report').addEventListener('click', async () => {
  if (!CURRENT) return;
  const r = CURRENT;
  const v = verdictFor(r);
  const out = [
    'WardenOne File Shield',
    v.headline,
    '',
    'Name:        ' + r.name,
    'Size:        ' + humanSize(r.size),
    'Actually is: ' + r.format.label,
    r.hash.skipped ? 'SHA-256:     not computed' : 'SHA-256:     ' + r.hash.sha256,
  ];
  if (r.pe) {
    out.push('Signed by:   ' + (r.pe.signed
      ? (r.pe.signerNames[0] || 'a certificate with no readable name')
      : 'no signature inside the file'));
  }
  if (r.findings.length) {
    out.push('', 'What WardenOne found:');
    for (const f of r.findings) out.push('  - ' + f.title);
  }
  out.push('', 'Structure only. This does not say the file is safe.');
  const button = $('copy-report');
  try {
    await navigator.clipboard.writeText(out.join('\n'));
    button.textContent = 'Copied';
  } catch (_) { button.textContent = 'Could not copy'; }
  setTimeout(() => { button.textContent = 'Copy report'; }, 1600);
});
