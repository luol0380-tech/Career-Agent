#!/usr/bin/env node
'use strict';

/**
 * Career Agent 本机同源服务：托管 app/ 静态资源 + DeepSeek 代理 API。
 * 仅监听 127.0.0.1。启动前请确认用户已明确授权。
 * 用法（授权后）：node server/index.js
 */

var http = require('http');
var path = require('path');
var env = require('./lib/env');
var promptLoader = require('./lib/prompt');
var staticServe = require('./lib/static');
var handlersFactory = require('./lib/handlers');

var ROOT = path.resolve(__dirname, '..');
var APP_ROOT = path.join(ROOT, 'app');
var config = env.loadConfig(ROOT);
var Prompt = promptLoader.loadRevisePrompt(APP_ROOT);
var handlers = handlersFactory.createHandlers({
  config: config,
  prompt: Prompt
});

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('未找到');
}

function onRequest(req, res) {
  var url = String(req.url || '/');
  var pathname = url.split('?')[0];

  if (req.method === 'GET' && pathname === '/api/ai/status') {
    handlers.handleStatus(req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/ai/verify') {
    handlers.handleVerify(req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/ai/revise-suggestions') {
    handlers.handleRevise(req, res);
    return;
  }
  if (req.method === 'GET' && (pathname === '/' || pathname.indexOf('/api/') !== 0)) {
    var staticPath = pathname === '/' ? '/index.html' : pathname;
    staticServe.serveAppFile(APP_ROOT, staticPath, res);
    return;
  }
  notFound(res);
}

function start(opts) {
  opts = opts || {};
  var host = env.resolveListenHost(opts.host != null ? opts.host : config.host);
  var port = opts.port != null ? opts.port : config.port;
  var server = http.createServer(onRequest);
  server.listen(port, host, function () {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        status: 'listening',
        host: host,
        port: port,
        configured: !!config.configured,
        model: config.model,
        open: 'http://' + host + ':' + port + '/'
      })
    );
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  start: start,
  onRequest: onRequest,
  config: config,
  handlers: handlers
};
