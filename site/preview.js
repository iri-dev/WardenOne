/* Local preview for the WardenOne GitHub Pages working copy.
   Serves dist/ like GitHub Pages does, and renders the Markdown documents (PRIVACY, CHANGELOG, CREDITS,
   SUPPORT) into dist/_layouts/default.html, the same layout Jekyll uses for them in production.
   The renderer here is for previewing only; on Pages, Jekyll's kramdown renders the documents. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);
const documents = new Set(['PRIVACY', 'SUPPORT', 'CHANGELOG', 'CREDITS']);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/* Escapes text but leaves existing entities such as &amp; alone, as Markdown does. */
function escapeHtml(value) {
  return value.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linkTarget(url) {
  if (/^(?:https?:|mailto:|#)/.test(url)) return url;
  const document = /^([A-Z]+)\.md(#.*)?$/.exec(url);
  if (document && documents.has(document[1])) return `./${document[1]}${document[2] || ''}`;
  return `https://github.com/iri-dev/WardenOne/blob/main/${url.replace(/^\.\//, '')}`;
}

function inline(text) {
  const spans = [];
  let html = text.replace(/`([^`]+)`/g, (_, code) => { spans.push(`<code>${escapeHtml(code)}</code>`); return `\u0000${spans.length - 1}\u0000`; });
  html = escapeHtml(html);
  html = html.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) => `<a href="${url}">${url}</a>`);
  html = html.replace(/!?\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, url) => `<a href="${linkTarget(url)}">${label}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => spans[index]);
}

const listItem = /^( {0,3})([-*+]|\d{1,9}[.)])( {1,4})(.*)$/;
const blank = line => !line.trim();
const indentOf = line => /^ */.exec(line)[0].length;
const startsBlock = line => /^ {0,3}(?:#{1,6}\s|```|>|(?:-{3,}|\*{3,}|_{3,})\s*$|\|)/.test(line) || listItem.test(line);

function renderBlocks(lines, context, tight = false) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let match;
    if (blank(line)) { i++; continue; }
    if (/^ {0,3}```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^ {0,3}```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if ((match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
      const level = match[1].length;
      out.push(`<h${level} id="${context.id(match[2])}">${inline(match[2])}</h${level}>`);
      i++;
    } else if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (/^ {0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      out.push(`<blockquote>${renderBlocks(body, context)}</blockquote>`);
    } else if (/^ {0,3}\|/.test(line) && /^ {0,3}\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const rows = [];
      while (i < lines.length && /^ {0,3}\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => inline(cell.trim()));
      out.push(`<table><thead><tr>${cells(rows[0]).map(cell => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${cells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (listItem.test(line)) {
      i = renderList(lines, i, out, context);
    } else {
      const paragraph = [line.trim()];
      for (i++; i < lines.length && !blank(lines[i]) && !startsBlock(lines[i]); i++) paragraph.push(lines[i].trim());
      const html = inline(paragraph.join(' '));
      out.push(tight ? html : `<p>${html}</p>`);
    }
  }
  return out.join('\n');
}

function renderList(lines, start, out, context) {
  const first = listItem.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const base = first[1].length;
  const items = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const match = listItem.exec(lines[i]);
    if (!match || match[1].length !== base || /\d/.test(match[2]) !== ordered) break;
    const contentIndent = match[1].length + match[2].length + match[3].length;
    const body = [match[4]];
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (blank(line)) {
        let next = i + 1;
        while (next < lines.length && blank(lines[next])) next++;
        if (next < lines.length && indentOf(lines[next]) >= contentIndent) { body.push(''); loose = true; continue; }
        break;
      }
      if (indentOf(line) >= contentIndent) body.push(line.slice(contentIndent));
      else if (startsBlock(line)) break;
      else body.push(line.trim());
    }
    items.push(body);
    if (i < lines.length && blank(lines[i])) {
      let next = i;
      while (next < lines.length && blank(lines[next])) next++;
      const sibling = next < lines.length ? listItem.exec(lines[next]) : null;
      if (sibling && sibling[1].length === base && /\d/.test(sibling[2]) === ordered) { loose = true; i = next; continue; }
      break;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAt = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : '';
  out.push(`<${tag}${startAt}>${items.map(body => `<li>${renderBlocks(body, context, !loose)}</li>`).join('\n')}</${tag}>`);
  return i;
}

function markdownToHtml(markdown) {
  const used = new Map();
  const context = {
    id(text) {
      const base = text.toLowerCase().replace(/`/g, '').replace(/&[a-z]+;/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    }
  };
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\t/g, '    ').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  return renderBlocks(lines, context);
}

function documentPage(name) {
  const layout = fs.readFileSync(path.join(root, '_layouts', 'default.html'), 'utf8');
  const content = markdownToHtml(fs.readFileSync(path.join(root, `${name}.md`), 'utf8'));
  const heading = (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(content)?.[1] || 'WardenOne').replace(/<[^>]+>/g, '');
  const title = heading.includes('WardenOne') ? heading : `${heading} | WardenOne`;
  return layout
    .replaceAll('{{ page.title | default: "WardenOne" }}{% unless page.title contains "WardenOne" %} | WardenOne{% endunless %}', title)
    .replaceAll('{{ page.url | replace: ".html", "" }}', `/${name}`)
    .replaceAll('{{ page.path }}', `${name}.md`)
    .replace('{{ content }}', () => content);
}

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad URL'); return; }
  const name = pathname.slice(1).replace(/\.html$/, '');
  if (documents.has(name)) {
    response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
    response.end(documentPage(name));
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/stolen') pathname = '/stolen.html';
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filename = path.resolve(root, `.${pathname}`);
  const hidden = path.relative(root, filename).split(path.sep).some(part => part.startsWith('_'));
  if (hidden || !filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404, { 'Content-Type': types['.html'] }).end(fs.readFileSync(path.join(root, '404.html')));
    return;
  }
  response.writeHead(200, { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filename).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`WardenOne local preview: http://127.0.0.1:${port}/`);
});
