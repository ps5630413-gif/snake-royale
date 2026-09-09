#!/usr/bin/env node
/* ==========================================================================
 * serve.js - Zero-dependency static server for local development.
 *
 *   npm run serve            -> http://localhost:8080
 *   PORT=3000 npm run serve
 *
 * It exists so you can play the game on your phone / emulator before
 * packaging it: no build step, no bundler, just the files in www/.
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const WWW = path.join(__dirname, '..', 'www');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  if (pathname === '/') pathname = '/index.html';

  // never serve anything outside www/
  const filePath = path.normalize(path.join(WWW, pathname));
  if (!filePath.startsWith(WWW)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('Snake Royale dev server');
  console.log('  local:   http://' + shown + ':' + PORT);
  console.log('  serving: ' + WWW);
  console.log('\nOn Android: open http://<your-computer-ip>:' + PORT + ' in Chrome.');
});
