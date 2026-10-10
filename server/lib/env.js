'use strict';

var fs = require('fs');
var path = require('path');

var LOOPBACK_HOSTS = {
  '127.0.0.1': true,
  localhost: true,
  '::1': true
};

function parseEnvFile(filePath) {
  var out = {};
  if (!fs.existsSync(filePath)) return out;
  var text = fs.readFileSync(filePath, 'utf8');
  text.split(/\n/).forEach(function (line) {
    var s = line.trim();
    if (!s || s.charAt(0) === '#') return;
    var eq = s.indexOf('=');
    if (eq <= 0) return;
    var key = s.slice(0, eq).trim();
    var val = s.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  });
  return out;
}

function isLoopbackHost(host) {
  if (!host || typeof host !== 'string') return false;
  var h = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS[h]) return true;
  // 仅接受字面回环；拒绝 0.0.0.0、局域网与公网
  return false;
}

function resolveListenHost(raw) {
  if (raw == null || String(raw).trim() === '') return '127.0.0.1';
  var host = String(raw).trim();
  if (!isLoopbackHost(host)) {
    var err = new Error('服务仅允许监听本机回环地址（127.0.0.1／localhost／::1），已拒绝：' + host);
    err.code = 'invalid_host';
    throw err;
  }
  // 统一使用 IPv4 回环字面量，避免 localhost 解析歧义
  if (host.toLowerCase() === 'localhost' || host === '127.0.0.1') return '127.0.0.1';
  return '::1';
}

function loadConfig(rootDir) {
  rootDir = rootDir || path.resolve(__dirname, '..', '..');
  var fileVals = parseEnvFile(path.join(rootDir, '.env'));
  function pick(name, fallback) {
    if (process.env[name] != null && String(process.env[name]).trim() !== '') return String(process.env[name]).trim();
    if (fileVals[name] != null && String(fileVals[name]).trim() !== '') return String(fileVals[name]).trim();
    return fallback;
  }
  var apiKey = pick('DEEPSEEK_API_KEY', '');
  var hostRaw = pick('HOST', '127.0.0.1');
  return {
    rootDir: rootDir,
    apiKey: apiKey,
    configured: !!apiKey,
    baseUrl: pick('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/$/, ''),
    model: pick('DEEPSEEK_MODEL', 'deepseek-chat'),
    host: resolveListenHost(hostRaw),
    port: Math.min(Math.max(Number(pick('PORT', '8787')) || 8787, 1), 65535),
    timeoutMs: 60000,
    maxBodyBytes: 256 * 1024
  };
}

module.exports = {
  loadConfig: loadConfig,
  parseEnvFile: parseEnvFile,
  isLoopbackHost: isLoopbackHost,
  resolveListenHost: resolveListenHost
};
