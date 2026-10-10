'use strict';

var fs = require('fs');
var path = require('path');

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function resolveSafeAppPath(appRoot, urlPath) {
  var decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '').split('?')[0]);
  } catch (e) {
    return { ok: false, error: 'bad_path' };
  }
  if (!decoded || decoded.indexOf('\0') >= 0) return { ok: false, error: 'bad_path' };
  if (decoded.indexOf('..') >= 0) return { ok: false, error: 'bad_path' };
  var rel = decoded.replace(/^\/+/, '');
  if (!rel || rel === '') rel = 'index.html';
  var candidate = path.resolve(appRoot, rel);
  var rootReal = fs.realpathSync(appRoot);
  var candReal;
  try {
    candReal = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  } catch (e) {
    return { ok: false, error: 'not_found' };
  }
  if (candReal !== rootReal && candReal.indexOf(rootReal + path.sep) !== 0) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, filePath: candidate, rel: rel };
}

function contentTypeFor(filePath) {
  var ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function serveAppFile(appRoot, urlPath, res) {
  var resolved = resolveSafeAppPath(appRoot, urlPath);
  if (!resolved.ok) {
    var code = resolved.error === 'forbidden' || resolved.error === 'bad_path' ? 403 : 404;
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(code === 403 ? '禁止访问' : '未找到');
    return;
  }
  var filePath = resolved.filePath;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('未找到');
    return;
  }
  var body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

module.exports = {
  resolveSafeAppPath: resolveSafeAppPath,
  serveAppFile: serveAppFile,
  contentTypeFor: contentTypeFor
};
