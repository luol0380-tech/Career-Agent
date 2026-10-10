#!/usr/bin/env node
// 第十二阶段后端逻辑校验：不启动项目服务、不读真实密钥、不外呼。
// 用法：node server/tests/handlers-check.js
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var handlersFactory = require('../lib/handlers');
var promptLoader = require('../lib/prompt');
var staticServe = require('../lib/static');
var deepseek = require('../lib/deepseek');
var env = require('../lib/env');

var ROOT = path.resolve(__dirname, '..', '..');
var APP_ROOT = path.join(ROOT, 'app');
var Prompt = promptLoader.loadRevisePrompt(APP_ROOT);
var results = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(function () {
      results.push({ name: name, ok: true });
      console.log('通过 ' + name);
    })
    .catch(function (err) {
      results.push({ name: name, ok: false, error: String(err && err.message ? err.message : err) });
      console.error('失败 ' + name + '：' + (err && err.stack ? err.stack : err));
    });
}

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead: function (code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end: function (body) {
      this.body = body;
    },
    json: function () {
      return JSON.parse(this.body || 'null');
    }
  };
}

function mockReq(opts) {
  opts = opts || {};
  var listeners = {};
  var req = {
    method: opts.method || 'GET',
    url: opts.url || '/',
    headers: opts.headers || {
      host: '127.0.0.1:8787',
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:8787'
    },
    on: function (ev, fn) {
      listeners[ev] = fn;
    },
    destroy: function () {}
  };
  req._emit = function (ev, arg) {
    if (listeners[ev]) listeners[ev](arg);
  };
  req._finishBody = function (raw) {
    if (raw) req._emit('data', Buffer.from(raw));
    req._emit('end');
  };
  return req;
}

function baseCfg(extra) {
  return Object.assign(
    {
      configured: true,
      apiKey: 'sk-test-handlers-not-real',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      host: '127.0.0.1',
      port: 8787,
      timeoutMs: 60000,
      maxBodyBytes: 256 * 1024
    },
    extra || {}
  );
}

function delayedBodyFetch(bodyDelayMs) {
  return function (url, opts) {
    opts = opts || {};
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () {
        return new Promise(function (resolve, reject) {
          var done = false;
          var timer = setTimeout(function () {
            if (done) return;
            done = true;
            resolve({
              choices: [{ message: { content: '验' } }]
            });
          }, bodyDelayMs);
          if (opts.signal) {
            if (opts.signal.aborted) {
              clearTimeout(timer);
              done = true;
              var early = new Error('The operation was aborted');
              early.name = 'AbortError';
              reject(early);
              return;
            }
            opts.signal.addEventListener('abort', function () {
              if (done) return;
              done = true;
              clearTimeout(timer);
              var e = new Error('The operation was aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }
        });
      }
    });
  };
}

function run() {
  return Promise.resolve()
    .then(function () {
      return test('S12-01 未配置 status／verify／revise', function () {
        var h = handlersFactory.createHandlers({
          config: baseCfg({ configured: false, apiKey: '' }),
          prompt: Prompt,
          chatCompletions: function () {
            throw new Error('不应外呼');
          }
        });
        var res = mockRes();
        h.handleStatus({}, res);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json().configured, false);
        assert.strictEqual(res.json().willCallExternal, false);
        assert.ok(!JSON.stringify(res.json()).includes('sk-'));

        var res2 = mockRes();
        var req2 = mockReq({ method: 'POST' });
        return h.handleVerify(req2, res2).then(function () {
          assert.strictEqual(res2.statusCode, 503);
          assert.strictEqual(res2.json().code, 'not_configured');
        });
      });
    })
    .then(function () {
      return test('S12-02 同源拒绝与坏请求', function () {
        var h = handlersFactory.createHandlers({
          config: baseCfg(),
          prompt: Prompt,
          chatCompletions: function () {
            throw new Error('不应外呼');
          }
        });
        var badOrigin = mockReq({
          headers: { host: '127.0.0.1:8787', 'content-type': 'application/json', origin: 'http://evil.example' }
        });
        var res = mockRes();
        return h.handleVerify(badOrigin, res).then(function () {
          assert.strictEqual(res.statusCode, 403);
          var checked = h.validateReviseInput({});
          assert.strictEqual(checked.ok, false);
          var checked2 = h.validateReviseInput({ resumeText: '正文', job: { title: '' } });
          assert.strictEqual(checked2.ok, false);
        });
      });
    })
    .then(function () {
      return test('S12-03 mock 成功生成建议', function () {
        var resumeText = '林小舟｜产品助理\n智能客服知识库问答\n与算法同事制定人工抽检规则';
        var suggestions = [
          {
            id: '1',
            title: '对齐岗位',
            reason: '基于原文',
            targetExcerpt: '智能客服知识库问答',
            proposedReplacement: '智能客服知识库问答（补充评测协作）',
            needsUserConfirm: false
          },
          {
            id: '2',
            title: '协作表述',
            reason: '基于原文',
            targetExcerpt: '与算法同事制定人工抽检规则',
            proposedReplacement: '与算法同事制定人工抽检规则（补充抽样口径）',
            needsUserConfirm: false
          },
          {
            id: '3',
            title: '标题微调',
            reason: '基于原文',
            targetExcerpt: '林小舟｜产品助理',
            proposedReplacement: '林小舟｜产品助理（AI 方向）',
            needsUserConfirm: true
          }
        ];
        var h = handlersFactory.createHandlers({
          config: baseCfg(),
          prompt: Prompt,
          chatCompletions: function () {
            return Promise.resolve({ content: JSON.stringify(suggestions) });
          }
        });
        var req = mockReq({ method: 'POST' });
        var res = mockRes();
        var p = h.handleRevise(req, res);
        req._finishBody(
          JSON.stringify({
            resumeText: resumeText,
            job: { id: 'job_001', title: 'AI 产品经理', companyName: '星河', jdText: '评测' }
          })
        );
        return p.then(function () {
          assert.strictEqual(res.statusCode, 200);
          var body = res.json();
          assert.strictEqual(body.ok, true);
          assert.strictEqual(body.suggestions.length, 3);
          assert.ok(!JSON.stringify(body).includes('sk-test-handlers-not-real'));
        });
      });
    })
    .then(function () {
      return test('S12-04 mock 401／格式失败', function () {
        var hAuth = handlersFactory.createHandlers({
          config: baseCfg(),
          prompt: Prompt,
          chatCompletions: function () {
            var err = new Error(deepseek.userFacingError('auth'));
            err.code = 'auth';
            return Promise.reject(err);
          }
        });
        var req = mockReq({ method: 'POST' });
        var res = mockRes();
        var p = hAuth.handleVerify(req, res);
        req._finishBody('{}');
        return p
          .then(function () {
            assert.strictEqual(res.statusCode, 502);
            assert.strictEqual(res.json().code, 'auth');
            assert.ok(!String(res.body).includes('sk-test'));
          })
          .then(function () {
            var resumeText = '正文一段足够长的简历';
            var hFmt = handlersFactory.createHandlers({
              config: baseCfg(),
              prompt: Prompt,
              chatCompletions: function () {
                return Promise.resolve({
                  content: JSON.stringify([
                    {
                      id: '1',
                      title: '坏',
                      reason: 'r',
                      targetExcerpt: '这段原文根本不存在XYZ',
                      proposedReplacement: '伪造',
                      needsUserConfirm: false
                    }
                  ])
                });
              }
            });
            var req2 = mockReq({ method: 'POST' });
            var res2 = mockRes();
            var p2 = hFmt.handleRevise(req2, res2);
            req2._finishBody(
              JSON.stringify({
                resumeText: resumeText,
                job: { id: 'job_001', title: '岗位', companyName: '公司', jdText: 'JD' }
              })
            );
            return p2.then(function () {
              assert.strictEqual(res2.statusCode, 502);
              assert.strictEqual(res2.json().code, 'format');
            });
          });
      });
    })
    .then(function () {
      return test('S12-05 静态路径白名单拒绝穿越', function () {
        var bad = staticServe.resolveSafeAppPath(APP_ROOT, '/../.env');
        assert.strictEqual(bad.ok, false);
        var bad2 = staticServe.resolveSafeAppPath(APP_ROOT, '/../../.git/config');
        assert.strictEqual(bad2.ok, false);
        var ok = staticServe.resolveSafeAppPath(APP_ROOT, '/index.html');
        assert.strictEqual(ok.ok, true);
        assert.ok(ok.filePath.indexOf(APP_ROOT) === 0);
      });
    })
    .then(function () {
      return test('R12-01 响应体延迟时超时仍生效', function () {
        var started = Date.now();
        return deepseek
          .chatCompletions(
            baseCfg({ timeoutMs: 15, apiKey: 'sk-test-timeout-not-real' }),
            [{ role: 'user', content: '验' }],
            { fetchImpl: delayedBodyFetch(80) }
          )
          .then(
            function () {
              throw new Error('响应体延迟时不应成功');
            },
            function (err) {
              assert.strictEqual(err.code, 'timeout');
              assert.ok(Date.now() - started < 70, '应在体读取完成前超时');
            }
          )
          .then(function () {
            return deepseek.chatCompletions(
              baseCfg({ timeoutMs: 200, apiKey: 'sk-test-timeout-not-real' }),
              [{ role: 'user', content: '验' }],
              { fetchImpl: delayedBodyFetch(30) }
            );
          })
          .then(function (ok) {
            assert.ok(ok && ok.content === '验', '超时窗口足够时应成功');
          });
      });
    })
    .then(function () {
      return test('R12-02 仅允许回环监听地址', function () {
        assert.strictEqual(env.resolveListenHost('127.0.0.1'), '127.0.0.1');
        assert.strictEqual(env.resolveListenHost('localhost'), '127.0.0.1');
        assert.strictEqual(env.resolveListenHost('::1'), '::1');
        assert.strictEqual(env.isLoopbackHost('0.0.0.0'), false);
        assert.strictEqual(env.isLoopbackHost('192.168.1.1'), false);
        var threw = false;
        try {
          env.resolveListenHost('0.0.0.0');
        } catch (e) {
          threw = true;
          assert.strictEqual(e.code, 'invalid_host');
        }
        assert.ok(threw, '0.0.0.0 应被拒绝');
        threw = false;
        try {
          env.resolveListenHost('10.0.0.2');
        } catch (e2) {
          threw = true;
        }
        assert.ok(threw, '局域网地址应被拒绝');
        var indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        assert.ok(indexSrc.indexOf('resolveListenHost') >= 0, 'start 须经 resolveListenHost 固定本机监听');
        assert.ok(indexSrc.indexOf('opts.host || config.host') < 0, '不得再直接使用任意 opts.host');
      });
    })
    .then(function () {
      return test('R12-03 严格字段类型／缺 JD 拒绝', function () {
        var h = handlersFactory.createHandlers({
          config: baseCfg(),
          prompt: Prompt,
          chatCompletions: function () {
            throw new Error('不应外呼');
          }
        });
        var badTitle = h.validateReviseInput({
          resumeText: '正文',
          job: { title: 123, jdText: '要求评测' }
        });
        assert.strictEqual(badTitle.ok, false);
        assert.ok(String(badTitle.message).indexOf('岗位名称') >= 0, '坏 title 类型');

        var badCompany = h.validateReviseInput({
          resumeText: '正文',
          job: { title: '岗', companyName: { x: 1 }, jdText: '要求评测' }
        });
        assert.strictEqual(badCompany.ok, false);

        var noJd = h.validateReviseInput({
          resumeText: '正文足够',
          job: { title: 'AI 产品经理', companyName: '星河', jdText: '' }
        });
        assert.strictEqual(noJd.ok, false);
        assert.ok(String(noJd.message).indexOf('岗位要求') >= 0 || String(noJd.message).indexOf('JD') >= 0, '缺 JD');

        var missingJd = h.validateReviseInput({
          resumeText: '正文足够',
          job: { title: 'AI 产品经理', companyName: '星河' }
        });
        assert.strictEqual(missingJd.ok, false);

        var badAssess = h.validateReviseInput({
          resumeText: '正文足够',
          job: { title: '岗', jdText: 'JD 文本' },
          assessment: 'not-object'
        });
        assert.strictEqual(badAssess.ok, false);

        var ok = h.validateReviseInput({
          resumeText: '正文足够',
          job: {
            id: 'job_001',
            title: 'AI 产品经理',
            companyName: '星河',
            location: '上海',
            salaryText: '面议',
            jdText: '负责评测与知识库'
          },
          assessment: {
            match: { level: '中', summary: '演示摘要' },
            gaps: [{ description: '缺口说明' }]
          }
        });
        assert.strictEqual(ok.ok, true);
        assert.strictEqual(ok.payload.job.jdText.indexOf('评测') >= 0, true);
        assert.strictEqual(ok.payload.assessment.match.level, '中');
      });
    })
    .then(function () {
      var failed = results.filter(function (r) {
        return !r.ok;
      });
      console.log(
        JSON.stringify({
          total: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
          failures: failed
        })
      );
      process.exit(failed.length ? 1 : 0);
    });
}

run();
