const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dist = path.join(__dirname, 'dist');
const routes = ['', 'features/', 'how-it-works/', 'privacy/', 'download/', 'faq/', 'about/', 'changelog/'].map(route => route + 'index.html').concat('stolen.html');
const siteScript = fs.readFileSync(path.join(dist, 'assets', 'site.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'catalogue.json'), 'utf8'));
let checkedLinks = 0;
let checkedFileLinks = 0;
let checkedImages = 0;

/* Reads the pixel size of the WebP and PNG files the site ships, so width/height attributes cannot drift. */
function imageSize(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 1, 4) === 'PNG') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `Unsupported image format: ${file}`);
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (chunk === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  throw new Error(`Unknown WebP chunk ${chunk} in ${file}`);
}

/* Runs the real site.js as if the page were opened from disk and returns the rewritten links. */
function hrefsOpenedFromDisk(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(([, href]) => ({
    href, getAttribute() { return this.href; }, setAttribute(name, value) { this.href = value; }
  }));
  const inert = { addEventListener() {} };
  const context = {
    location: { protocol: 'file:' },
    document: {
      documentElement: { classList: { add() {} }, dataset: {} },
      querySelector: () => null,
      querySelectorAll: selector => selector === 'a[href]' ? anchors : [],
      addEventListener() {}
    },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, ...inert }),
    addEventListener() {},
    scrollY: 0
  };
  context.window = context;
  vm.runInNewContext(siteScript, context);
  return anchors.map(anchor => anchor.href);
}

function fileTargetFor(file, url) {
  if (/^https:\/\/github\.com\/iri-dev\/WardenOne\/blob\/main\/(PRIVACY|CHANGELOG|CREDITS|SUPPORT)\.md$/.test(url)) {
    checkedFileLinks++;
    return;
  }
  if (/^(https?:|mailto:|tel:|#)/.test(url)) return;
  const target = path.resolve(path.dirname(file), url.split('#')[0]);
  assert(fs.existsSync(target) && fs.statSync(target).isFile(), `Opened from disk, ${url} in ${file} is not a file`);
  checkedFileLinks++;
}

function targetFor(file, url) {
  const [relative, fragment] = url.split('#');
  if (/^(https?:|mailto:|tel:)/.test(relative)) return null;
  const route = path.relative(dist, path.dirname(file)).replaceAll(path.sep, '/');
  const deployed = new URL(url, `https://preview.invalid/WardenOne/${route ? route + '/' : ''}`);
  assert(deployed.pathname.startsWith('/WardenOne/'), `Link breaks the Pages base path: ${url}`);
  let target = relative ? path.resolve(path.dirname(file), relative) : file;
  assert(target === dist || target.startsWith(dist + path.sep), `Link escapes build: ${url}`);
  if (relative && relative.endsWith('/')) target = path.join(target, 'index.html');
  if (!path.extname(target) && !fs.existsSync(target)) {
    if (fs.existsSync(target + '.md')) target += '.md';
    else if (fs.existsSync(target + '.html')) target += '.html';
  }
  assert(fs.existsSync(target), `Missing target: ${url} from ${file}`);
  if (fragment && target.endsWith('.html')) {
    const html = fs.readFileSync(target, 'utf8');
    assert(html.includes(`id="${fragment}"`), `Missing #${fragment} in ${target}`);
  }
  checkedLinks++;
}

for (const route of routes) {
  const file = path.join(dist, route);
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/iri-dev\.github\.io\/WardenOne\//);
  assert.match(html, /<meta property="og:image" content="https:\/\/iri-dev\.github\.io\/WardenOne\/images\/og-card\.png">/, `${route} needs the social card`);
  assert(!/\{\{[^}]*\}\}/.test(html), `Unfilled build placeholder in ${route}`);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${route} needs one h1`);
  assert.equal((html.match(/<main\b/g) || []).length, 1, `${route} needs one main`);
  assert.match(html, /<html lang="en"/, `${route} needs a language`);
  assert.match(html, /class="skip-link" href="#main"/, `${route} needs a skip link`);
  assert.match(html, /<nav\b[^>]*aria-label="Main navigation"/, `${route} needs a named navigation`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, `Duplicate ID in ${route}`);
  for (const [, reference] of html.matchAll(/\baria-(?:labelledby|controls)="([^"]+)"/g)) {
    for (const id of reference.split(/\s+/)) assert(ids.includes(id), `Missing accessibility reference #${id} in ${route}`);
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) targetFor(file, match[1]);
  for (const href of hrefsOpenedFromDisk(html)) fileTargetFor(file, href);
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /\balt="[^"]*"/, `Missing image alt in ${route}`);
    const width = Number(/\bwidth="(\d+)"/.exec(match[0])?.[1]);
    const height = Number(/\bheight="(\d+)"/.exec(match[0])?.[1]);
    assert(width && height, `Missing image width or height in ${route}`);
    const source = /\bsrc="([^"]+)"/.exec(match[0])[1];
    const [realWidth, realHeight] = imageSize(path.resolve(path.dirname(file), source));
    assert(Math.abs(width / height - realWidth / realHeight) < 0.015, `${source} is ${realWidth}x${realHeight} but marked ${width}x${height} in ${route}`);
    checkedImages++;
  }
  assert.equal((html.match(/<figure\b/g) || []).length, (html.match(/<figcaption\b/g) || []).length, `Figure caption mismatch in ${route}`);
  for (const [, tag, content] of html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)) {
    assert(/\baria-label="[^"]+"/.test(tag) || content.replace(/<[^>]*>/g, '').trim(), `Unnamed button in ${route}`);
  }
  for (const [, tag] of html.matchAll(/(<input\b[^>]*>)/g)) {
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    assert(/\baria-label="[^"]+"/.test(tag) || (id && html.includes(`for="${id}"`)), `Unlabelled input in ${route}`);
  }
}
for (const asset of ['assets/site.css', 'assets/site.js', 'icons/icon128.png', 'images/og-card.png', 'PRIVACY.md', 'CHANGELOG.md', 'CREDITS.md', 'SUPPORT.md', 'THIRD_PARTY_NOTICES.html', 'LICENSE', 'permissions.html', 'sitemap.xml', 'robots.txt', 'stolen.html']) {
  assert(fs.existsSync(path.join(dist, asset)), `Missing ${asset}`);
}
const layout = fs.readFileSync(path.join(dist, '_layouts', 'default.html'), 'utf8');
for (const name of ['THIRD_PARTY_NOTICES.html', 'permissions.html']) {
  const file = path.join(dist, name);
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    targetFor(file, match[1]);
    fileTargetFor(file, match[1]);
  }
  assert(!/not yet verified|terms under review|blank licence/.test(html), name + ' has obsolete rights labels');
}
assert(layout.includes('{{ content }}') && layout.includes('data-doc') && layout.includes('aria-label="Main navigation"'), 'Document layout lost its content slot or site shell');
assert(fs.statSync(path.join(dist, 'assets/site.css')).size < 60_000, 'CSS bundle exceeds 60 KB');
assert(fs.statSync(path.join(dist, 'assets/site.js')).size < 12_000, 'JavaScript bundle exceeds 12 KB');
assert(fs.statSync(path.join(dist, 'images/14-clickfix-warning.webp')).size < 100_000, 'Hero image exceeds 100 KB');
assert(fs.statSync(path.join(dist, 'images/hero-popup.webp')).size < 60_000, 'Hero popup crop exceeds 60 KB');
assert.deepEqual(imageSize(path.join(dist, 'images/og-card.png')), [1200, 630], 'Social card must be 1200x630');
const features = fs.readFileSync(path.join(dist, 'features', 'index.html'), 'utf8');
assert.equal((features.match(/\bdata-item\b/g) || []).length, data.stats.catalogueEntries, 'Feature catalogue does not list every synced entry');
assert.equal(data.categories.reduce((total, category) => total + category.count, 0), data.stats.catalogueEntries, 'Catalogue category counts disagree');
assert.match(fs.readFileSync(path.join(dist, 'download', 'index.html'), 'utf8'), /https:\/\/github\.com\/iri-dev\/WardenOne\/releases\/latest\/download\/WardenOne-latest\.zip/, 'Official download link changed');
console.log(`Checked ${routes.length} pages, ${checkedLinks} local links/assets, ${checkedFileLinks} links opened from disk, ${checkedImages} image sizes, ${data.stats.catalogueEntries} catalogue entries, accessible markup, Pages paths and asset budgets`);
