'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

http.createServer((request, response) => {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); } catch (_) {}
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
    response.end(data);
  });
}).listen(8765, '127.0.0.1');
