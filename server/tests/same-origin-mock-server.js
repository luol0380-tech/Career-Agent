'use strict';

/**
 * 测试用同源 mock：托管 app/ 静态资源并模拟 /api/ai/*。
 * 仅供验收脚本临时监听 127.0.0.1:0，不是项目正式服务（勿与 node server/index.js 混淆）。
 */

var http = require('http');
var path = require('path');
var staticServe = require('../lib/static');

var ROOT = path.resolve(__dirname, '..', '..');
var APP_ROOT = path.join(ROOT, 'app');

function readBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function buildSuggestions(resumeText) {
  var lines = String(resumeText || '')
    .split(/\n+/)
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);
  var a = lines[0] || '产品助理';
  var b = lines[1] || a;
  var c = lines[2] || b;
  return [
    {
      id: '1',
      title: '对齐岗位表述',
      reason: '基于原文与岗位要求（同源 mock，非真实模型）',
      targetExcerpt: a,
      proposedReplacement: a + '（补充岗位关键词）',
      needsUserConfirm: false
    },
    {
      id: '2',
      title: '强化项目协作',
      reason: '基于原文',
      targetExcerpt: b,
      proposedReplacement: b + '（补充协作与评测）',
      needsUserConfirm: false
    },
    {
      id: '3',
      title: '待你确认的补充',
      reason: '需要用户确认',
      targetExcerpt: c,
      proposedReplacement: c + '（如需补充量化结果请你确认）',
      needsUserConfirm: true
    }
  ];
}

function startSameOriginMock(opts) {
  opts = opts || {};
  var state = {
    failNextRevise: !!opts.failNextRevise,
    reviseCalls: 0,
    verifyCalls: 0,
    statusCalls: 0
  };

  var server = http.createServer(function (req, res) {
    var pathname = String(req.url || '/').split('?')[0];

    if (req.method === 'GET' && pathname === '/api/ai/status') {
      state.statusCalls += 1;
      json(res, 200, {
        configured: true,
        providerId: 'deepseek',
        model: 'deepseek-chat',
        willCallExternal: true,
        source: 'server'
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/verify') {
      state.verifyCalls += 1;
      readBody(req, 256 * 1024)
        .then(function () {
          json(res, 200, {
            ok: true,
            providerId: 'deepseek',
            model: 'deepseek-chat',
            message: '连接验证成功（同源 mock，非真实外呼）。'
          });
        })
        .catch(function () {
          json(res, 400, { ok: false, code: 'bad_request', message: '请求无效。' });
        });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/ai/revise-suggestions') {
      state.reviseCalls += 1;
      readBody(req, 256 * 1024)
        .then(function (raw) {
          var body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch (e) {
            json(res, 400, { ok: false, code: 'bad_request', message: '请使用 JSON 提交。' });
            return;
          }
          if (state.failNextRevise) {
            state.failNextRevise = false;
            json(res, 502, {
              ok: false,
              code: 'upstream',
              message: '模拟上游失败，请重试'
            });
            return;
          }
          if (!body.resumeText || !body.job || !body.job.title || !body.job.jdText) {
            json(res, 400, { ok: false, code: 'bad_request', message: '请检查简历正文与岗位要求。' });
            return;
          }
          json(res, 200, {
            ok: true,
            providerId: 'deepseek',
            model: 'deepseek-chat',
            suggestions: buildSuggestions(body.resumeText)
          });
        })
        .catch(function () {
          json(res, 400, { ok: false, code: 'bad_request', message: '请求无效。' });
        });
      return;
    }

    if (req.method === 'GET') {
      var staticPath = pathname === '/' ? '/index.html' : pathname;
      staticServe.serveAppFile(APP_ROOT, staticPath, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('未找到');
  });

  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () {
      var addr = server.address();
      resolve({
        server: server,
        host: '127.0.0.1',
        port: addr.port,
        baseUrl: 'http://127.0.0.1:' + addr.port,
        state: state,
        close: function () {
          return new Promise(function (resClose) {
            server.close(function () {
              resClose();
            });
          });
        }
      });
    });
  });
}

module.exports = { startSameOriginMock: startSameOriginMock };
