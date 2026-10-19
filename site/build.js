const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, 'src');
const output = path.join(root, 'dist');
const siteUrl = 'https://iri-dev.github.io/WardenOne/';
const data = JSON.parse(fs.readFileSync(path.join(source, 'data', 'catalogue.json'), 'utf8'));
const pages = [
  ['home', '', 'WardenOne — stop the risky page, see why', 'A free, open-source browser extension that interrupts scams, blocks known bad destinations and shows you why. No account, no telemetry, no WardenOne server.'],
  ['features', 'features/', `Features — all ${data.stats.protections} protections | WardenOne`, `Every WardenOne protection, control and tool, with what it does and whether it is on from the first run. Generated from the extension's own settings data.`],
  ['how-it-works', 'how-it-works/', 'How WardenOne works | WardenOne', 'How WardenOne splits its work across browser network rules, page checks, one extension worker and local pages you can inspect.'],
  ['privacy', 'privacy/', 'Privacy | WardenOne', 'What WardenOne keeps on your device, which outside requests it makes, and which optional lookups only run when you turn them on.'],
  ['download', 'download/', 'Download and install | WardenOne', 'Get the official WardenOne ZIP from GitHub and install it in Chrome, Edge, Brave or Opera in five steps.'],
  ['faq', 'faq/', 'Frequently asked questions | WardenOne', 'Answers about installing, updating, compatibility, privacy and troubleshooting WardenOne.'],
  ['about', 'about/', 'About WardenOne | WardenOne', 'WardenOne is an independent, open-source browser security extension made by iri. Why it exists, why it is called WardenOne, and how it is built.'],
  /* Kept at /stolen (stolen.html): the README, the extension and past notices all link to that address. */
  ['stolen', 'stolen', 'Someone stole WardenOne and used it to hand people malware | WardenOne', 'In August 2026 my privacy extension was republished by the GitHub account ajpc6338, with the download link on ajpc6338.github.io pointed at a trojan. What happened, how I proved the work was mine, and what to do if you ran the file.', {
    file: 'stolen.html',
    ogType: 'article',
    head: `<meta name="author" content="Iri">\n  <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: 'Someone stole WardenOne and used it to hand people malware', datePublished: '2026-08-14',
      url: 'https://iri-dev.github.io/WardenOne/stolen', mainEntityOfPage: 'https://iri-dev.github.io/WardenOne/stolen', inLanguage: 'en',
      about: { '@type': 'SoftwareApplication', name: 'WardenOne', url: 'https://iri-dev.github.io/WardenOne/' },
      author: { '@type': 'Person', name: 'Iri', alternateName: ['iri', 'iri-dev'], url: 'https://iri-dev.github.io/', sameAs: ['https://github.com/iri-dev', 'https://iri-dev.github.io/'] },
      publisher: { '@type': 'Person', name: 'Iri', url: 'https://iri-dev.github.io/' }
    })}</script>`
  }]
];

/* 24px stroke icons drawn for this site; inlined once per page and referenced with <use>. */
const icons = {
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  key: '<circle cx="8" cy="15.5" r="3.8"/><path d="m10.8 12.7 8.7-8.7M16.5 7 19 9.5M14 9.5l2 2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  'eye-off': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"/><path d="M18.5 15.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  alert: '<path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  activity: '<path d="M3 12h4l2.5-6.5 5 13L17 12h4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.2"/>',
  flask: '<path d="M9.5 3h5M10.5 3v6.2L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L13.5 9.2V3"/><path d="M7.5 15h9"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  code: '<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  'arrow-right': '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  'arrow-down': '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7.5 10 3 2.5-3 2.5M13 15h3.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  hub: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="12" cy="20" r="1.8"/><path d="m6.4 6.4 3.5 3.5M17.6 6.4l-3.5 3.5M12 15v3.2"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  browser: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10 8.8 5 3.2-5 3.2z"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7.5 8 6 8-6"/>',
  chat: '<path d="M20 11.5a7.5 7 0 0 1-11 6.2L4.5 19l1.3-3.9A7.5 7 0 1 1 20 11.5z"/>',
  coffee: '<path d="M4 8h11v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M15 9h2.6a2.4 2.4 0 0 1 0 4.8H15M7 2.8c-.5.9-.5 1.8 0 2.7M10.5 2.8c-.5.9-.5 1.8 0 2.7M4 20.5h11"/>'
};
const sprite = `<svg class="sprite" aria-hidden="true" focusable="false"><defs>${Object.entries(icons)
  .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`).join('')}</defs></svg>`;
function icon(name, extra = '') {
  if (!icons[name]) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="icon${extra ? ` ${extra}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(tag) {
  const kind = /^Default: on|default: on$/.test(tag) ? 'badge-on' : /Opt-in/.test(tag) ? 'badge-opt' : /Watch only/.test(tag) ? 'badge-watch' : '';
  return tag ? `<span class="badge${kind ? ` ${kind}` : ''}">${escapeHtml(tag)}</span>` : '';
}

function catalogueHtml() {
  return data.categories.map(category => `<section class="cat-section" id="cat-${category.id}" data-category="${category.id}" aria-labelledby="cat-${category.id}-title">
  <div class="cat-head"><span class="cap-icon">${icon(category.icon)}</span><div><h2 id="cat-${category.id}-title">${escapeHtml(category.title)}</h2><p>${escapeHtml(category.intro)}</p></div><span class="count">${category.count} entries</span></div>
  ${category.groups.map(group => `<div class="cat-group" data-group><h3>${escapeHtml(group.title)}</h3><ul class="cat-items">${group.items.map(item => `<li class="cat-item" data-item><div class="cat-item-head"><strong>${escapeHtml(item.name)}</strong>${badge(item.tag)}</div>${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ''}</li>`).join('')}</ul></div>`).join('\n  ')}
</section>`).join('\n');
}

function catalogueChips() {
  return `<button class="chip" type="button" data-filter="all" aria-pressed="true">All <small>${data.stats.catalogueEntries}</small></button>${data.categories
    .map(category => `<button class="chip" type="button" data-filter="${category.id}" aria-pressed="false">${escapeHtml(category.title)} <small>${category.count}</small></button>`).join('')}`;
}

const examples = {
  security: ['Detect fake / phishing sites', 'Block high-confidence look-alikes', 'Stop back-button traps', 'Watch installed-extension changes'],
  signin: ['Command paste guard', 'Detect & block form skimmers', 'Protect session tokens', 'Fake update detector'],
  downloads: ['Download Shield', 'File Shield', 'Check download domain age', 'Manual VirusTotal URL scanner'],
  privacy: ['Block trackers & ad analytics', 'Auto-reject cookie banners', 'Stop email tracking pixels', 'Anti-fingerprinting noise'],
  content: ['AdShield: YouTube', 'AdShield: Twitch', 'Element Zapper', 'Hide sponsored search results'],
  control: ['Activity Centre', 'Site Firewall', 'Privacy Self-Test', 'Sleep inactive tabs']
};
function capabilitiesHtml(prefix) {
  return data.categories.map(category => {
    const names = category.groups.flatMap(group => group.items.map(item => item.name));
    for (const name of examples[category.id]) if (!names.includes(name)) throw new Error(`Example "${name}" is not in the ${category.id} catalogue`);
    return `<a class="cap-card reveal" href="${prefix}features/#cat-${category.id}"><span class="cap-icon">${icon(category.icon)}</span><span class="count">${category.count} entries</span><h3>${escapeHtml(category.title)}</h3><p>${escapeHtml(category.intro)}</p><ul class="cap-examples">${examples[category.id].map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul><span class="text-link">Explore ${escapeHtml(category.title.toLowerCase())} ${icon('arrow-right')}</span></a>`;
  }).join('');
}

function render(fragment, prefix) {
  return fragment
    .replaceAll('{{catalogue}}', catalogueHtml())
    .replaceAll('{{catalogue-chips}}', catalogueChips())
    .replaceAll('{{capabilities}}', capabilitiesHtml(prefix))
    .replace(/\{\{icon:([a-z-]+)\}\}/g, (_, name) => icon(name))
    .replace(/\{\{stat:([a-zA-Z]+)\}\}/g, (_, key) => {
      if (!(key in data.stats)) throw new Error(`Unknown stat: ${key}`);
      return data.stats[key].toLocaleString('en-US');
    })
    .replace(/\{\{source:([a-z]+)\}\}/g, (_, key) => escapeHtml(data.source[key]))
    .replaceAll('{{root}}', prefix);
}

/* Apply a saved theme before CSS loads so either choice paints correctly on navigation. */
const themeBootstrap = `(()=>{const r=document.documentElement;r.classList.add('js');let t=null;try{t=localStorage.getItem('wardenone-site-theme')}catch(e){}if(t==='dark'||t==='light')r.dataset.theme=t;document.querySelector('meta[name="theme-color"]').content=r.dataset.theme==='dark'?'#110a16':'#fbf8fd'})()`;
/* Chromium prerenders a page of this site once the pointer rests on its link, so switching pages is instant.
   Only relative links match, so nothing outside the site is ever fetched ahead of a click. */
const speculationRules = JSON.stringify({ prerender: [{ where: { selector_matches: 'a[href^="./"], a[href^="../"]' }, eagerness: 'moderate' }] });

function navigation(current, prefix) {
  const links = [['features', 'Features'], ['how-it-works', 'How it works'], ['privacy', 'Privacy'], ['download', 'Download'], ['faq', 'FAQ'], ['about', 'About']];
  return links.map(([slug, label]) => `<a href="${prefix}${slug}/"${current === slug ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}

/* Every page, the article and the Jekyll document layout share this shell. `raw` passes Liquid
   expressions through unescaped for the layout. */
function shell({ page, prefix, canonical, title, description, ogType = 'website', head = '', main, raw = false }) {
  const text = raw ? value => value : escapeHtml;
  const structuredData = page === 'home' ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'WardenOne',
    applicationCategory: 'BrowserApplication', operatingSystem: 'Chrome, Edge, Brave, Opera',
    url: siteUrl, codeRepository: 'https://github.com/iri-dev/WardenOne',
    downloadUrl: 'https://github.com/iri-dev/WardenOne/releases/latest/download/WardenOne-latest.zip',
    license: 'https://www.gnu.org/licenses/gpl-3.0.html', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: 'iri', url: 'https://github.com/iri-dev' }
  })}</script>` : head;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#110a16">
  <meta name="color-scheme" content="light dark">
  <script>${themeBootstrap}</script>
  <script type="speculationrules">${speculationRules}</script>
  <title>${text(title)}</title>
  <meta name="description" content="${text(description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="${prefix}icons/icon128.png" type="image/png">
  <link rel="apple-touch-icon" href="${prefix}icons/icon128.png">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="WardenOne">
  <meta property="og:title" content="${text(title)}">
  <meta property="og:description" content="${text(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}images/og-card.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="WardenOne: stop the risky page, see why. A free, open-source browser extension.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${siteUrl}images/og-card.png">
  <link rel="stylesheet" href="${prefix}assets/site.css">
  ${structuredData}
  <script src="${prefix}assets/site.js" defer></script>
</head>
<body data-page="${page}">
  ${sprite}
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="wordmark" href="${prefix}" aria-label="WardenOne home"><img src="${prefix}icons/icon128.png" alt="" width="32" height="32"><span>WardenOne</span></a>
      <nav class="main-nav" id="primary-nav" aria-label="Main navigation">${navigation(page, prefix)}</nav>
      <div class="header-actions">
        <a class="icon-button github-link" href="https://github.com/iri-dev/WardenOne" aria-label="WardenOne source code on GitHub">${icon('code')}</a>
        <button class="icon-button theme-toggle" type="button" aria-label="Switch to light theme" data-theme-toggle>${icon('moon', 'icon-moon')}${icon('sun', 'icon-sun')}</button>
        <button class="icon-button menu-toggle" type="button" aria-label="Menu" aria-controls="primary-nav" aria-expanded="false" data-menu-toggle>${icon('menu')}</button>
        <a class="button button-primary button-small header-cta" href="${prefix}download/">Download</a>
      </div>
    </div>
  </header>
  <main id="main">${main}</main>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-top">
        <div><a class="wordmark footer-brand" href="${prefix}"><img src="${prefix}icons/icon128.png" alt="" width="32" height="32"><span>WardenOne</span></a><p>Browser protection that shows its working. Free, open source, and made by one person who cares how software treats you.</p></div>
        <div class="footer-nav">
          <div><strong>Product</strong><a href="${prefix}features/">Features</a><a href="${prefix}how-it-works/">How it works</a><a href="${prefix}download/">Download</a></div>
          <div><strong>Trust</strong><a href="${prefix}privacy/">Privacy overview</a><a href="${prefix}PRIVACY">Full privacy policy</a><a href="${prefix}CREDITS">Credits</a><a href="${prefix}stolen">Fake download warning</a></div>
          <div><strong>Project</strong><a href="${prefix}about/">About</a><a href="${prefix}about/#contact">Contact me</a><a href="${prefix}faq/">FAQ</a><a href="https://github.com/iri-dev/WardenOne">Source on GitHub</a><a href="https://github.com/iri-dev/WardenOne/issues/new/choose">Report a problem</a></div>
        </div>
      </div>
      <div class="footer-bottom"><p>© 2026 iri · Made with 💜 · Open source under the GNU GPL v3 or later · <a href="https://buymeacoffee.com/iri.dev">Buy me a coffee</a></p><p>Official downloads come only from <a href="https://github.com/iri-dev/WardenOne">github.com/iri-dev/WardenOne</a></p></div>
    </div>
  </footer>
</body>
</html>`;
}

if (path.resolve(output) !== path.resolve(root, 'dist') || !path.resolve(output).startsWith(path.resolve(root) + path.sep)) {
  throw new Error('Refusing to remove output outside this project');
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(root, 'public'), output, { recursive: true });
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
fs.copyFileSync(path.join(source, 'site.css'), path.join(output, 'assets', 'site.css'));
fs.copyFileSync(path.join(source, 'site.js'), path.join(output, 'assets', 'site.js'));
for (const [page, route, title, description, options = {}] of pages) {
  const fragment = fs.readFileSync(path.join(source, 'pages', `${page}.html`), 'utf8');
  const destination = path.join(output, options.file || path.join(route, 'index.html'));
  const prefix = options.file || !route ? './' : '../';
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, shell({ page, prefix, canonical: siteUrl + route, title, description, ogType: options.ogType, head: options.head, main: render(fragment, prefix) }));
}

/* The policy, credits and support documents stay Markdown so Jekyll keeps rendering them at
   /PRIVACY, /CREDITS and /SUPPORT (the Web Store listing links to /PRIVACY). This layout gives
   them the site's header, footer and reading column. Jekyll ignores folders starting with "_" when
   publishing, and preview.js fills the same placeholders locally. */
const documentLayout = shell({
  page: 'document',
  prefix: './',
  canonical: `${siteUrl.slice(0, -1)}{{ page.url | replace: ".html", "" }}`,
  title: '{{ page.title | default: "WardenOne" }}{% unless page.title contains "WardenOne" %} | WardenOne{% endunless %}',
  description: 'A WardenOne project document: the privacy policy, credits or support guide, published from the official repository.',
  raw: true,
  main: `<div class="container doc-layout doc-page">
    <nav class="doc-toc" aria-label="On this page" data-doc-toc hidden></nav>
    <article class="doc" data-doc>
      <p class="eyebrow">WardenOne · Project document</p>
{{ content }}
      <p class="doc-source"><a class="text-link" href="https://github.com/iri-dev/WardenOne/blob/main/{{ page.path }}">${icon('code')} Read this document on GitHub</a></p>
    </article>
  </div>`
});
const liquid = documentLayout.match(/\{\{[^}]*\}\}|\{%[^%]*%\}/g) || [];
const allowedLiquid = ['{{ page.url | replace: ".html", "" }}', '{{ page.title | default: "WardenOne" }}', '{% unless page.title contains "WardenOne" %}', '{% endunless %}', '{{ content }}', '{{ page.path }}'];
for (const token of liquid) if (!allowedLiquid.includes(token)) throw new Error(`Unexpected Liquid in the document layout: ${token}`);
fs.mkdirSync(path.join(output, '_layouts'), { recursive: true });
fs.writeFileSync(path.join(output, '_layouts', 'default.html'), documentLayout);
fs.writeFileSync(path.join(output, '404.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | WardenOne</title><link rel="icon" href="${siteUrl}icons/icon128.png"><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#140b1b radial-gradient(60% 70% at 85% 10%,rgba(164,59,114,.4),transparent 60%);color:#f8f1fc;font:18px/1.55 "Segoe UI",system-ui,sans-serif}main{width:min(100% - 40px,720px)}small{color:#e8b8f6;text-transform:uppercase;letter-spacing:.14em;font-weight:700;font-size:.8rem}h1{font-size:clamp(2.6rem,7vw,4.6rem);line-height:1.02;letter-spacing:-.045em;margin:20px 0}p{color:#cdbfd8;max-width:560px}a{display:inline-block;margin:28px 12px 0 0;padding:13px 20px;border-radius:12px;color:#fff;font-weight:650;text-decoration:none;border:1px solid rgba(255,255,255,.25)}a:first-of-type{background:linear-gradient(135deg,#7a3996,#a43b72);border-color:transparent}a:focus-visible{outline:3px solid #e8b8f6;outline-offset:3px}</style></head><body><main><small>404 · Page not found</small><h1>This page isn't here.</h1><p>The link may be out of date. You can head back to WardenOne, or find everything in the project repository.</p><a href="${siteUrl}">Back to WardenOne</a><a href="https://github.com/iri-dev/WardenOne">Visit GitHub ↗</a></main></body></html>`);
fs.writeFileSync(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`);
fs.writeFileSync(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(([, route]) => `  <url><loc>${siteUrl}${route}</loc></url>`).join('\n')}\n  <url><loc>${siteUrl}PRIVACY</loc></url>\n</urlset>\n`);
console.log(`Built ${pages.length} pages in ${output}`);
