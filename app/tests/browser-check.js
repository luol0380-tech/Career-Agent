#!/usr/bin/env node
// 第一阶段浏览器验收脚本：以无头 Chrome（--remote-debugging-pipe，不监听端口、不启动任何服务）
// 直接加载 file:// 入口，按 A01–A12 执行操作并截图。临时浏览器配置目录用后删除。
// 用法：node app/tests/browser-check.js [Chrome 可执行文件路径]
// 输出：终端结果表；截图与结果 JSON 写入 assets/screenshots/phase1/。
'use strict';

var spawn = require('child_process').spawn;
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var ENTRY = 'file://' + path.join(ROOT, 'app', 'index.html');
var OUT = path.join(ROOT, 'assets', 'screenshots', 'phase1');
var CHROME = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var KEY = 'career-agent.demo.v1';

fs.mkdirSync(OUT, { recursive: true });
var profileDir = fs.mkdtempSync(path.join(ROOT, '.tmp-chrome-'));

var child = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-pipe', '--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
);
var chromeStderr = '';
child.stdio[2].on('data', function (d) {
  chromeStderr += d.toString();
});
child.on('exit', function (code) {
  if (code !== null && code !== 0) console.error('Chrome 已退出（' + code + '）：' + chromeStderr.slice(-800));
});
var toChrome = child.stdio[3];
var fromChrome = child.stdio[4];

var nextId = 1;
var pending = new Map();
var eventWaiters = [];
var buffer = '';
var sessionId = null;
var appErrors = [];
var networkErrors = [];
var dialogs = [];

fromChrome.on('data', function (chunk) {
  buffer += chunk.toString('utf8');
  var idx;
  while ((idx = buffer.indexOf('\0')) >= 0) {
    var raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    var msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      var p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      onEvent(msg);
    }
  }
});

function onEvent(msg) {
  var params = msg.params || {};
  if (msg.method === 'Runtime.exceptionThrown') {
    appErrors.push((params.exceptionDetails.exception && params.exceptionDetails.exception.description) || params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    appErrors.push('console.error: ' + params.args.map(function (a) { return a.value || a.description; }).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && params.entry.level === 'error') {
    networkErrors.push(params.entry.source + ': ' + params.entry.text + (params.entry.url ? ' ' + params.entry.url : ''));
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(params.type);
    send('Page.handleJavaScriptDialog', { accept: false });
  }
  eventWaiters = eventWaiters.filter(function (w) {
    if (w.method === msg.method) {
      w.resolve(params);
      return false;
    }
    return true;
  });
}

function send(method, params, useSession) {
  var id = nextId++;
  var msg = { id: id, method: method, params: params || {} };
  if (useSession !== false && sessionId) msg.sessionId = sessionId;
  toChrome.write(JSON.stringify(msg) + '\0');
  return new Promise(function (resolve, reject) {
    pending.set(id, { resolve: resolve, reject: reject });
  });
}

function waitEvent(method, timeout) {
  return new Promise(function (resolve, reject) {
    var w = { method: method, resolve: resolve };
    eventWaiters.push(w);
    setTimeout(function () {
      eventWaiters = eventWaiters.filter(function (x) { return x !== w; });
      reject(new Error('等待事件超时：' + method));
    }, timeout || 10000);
  });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function evaluate(expression) {
  var res = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error('页面求值出错：' + (res.exceptionDetails.exception ? res.exceptionDetails.exception.description : res.exceptionDetails.text));
  return res.result.value;
}

async function waitFor(expression, timeout, label) {
  var end = Date.now() + (timeout || 6000);
  while (Date.now() < end) {
    try {
      if (await evaluate('!!(' + expression + ')')) return true;
    } catch (e) {
      // 页面切换中，继续等待
    }
    await sleep(60);
  }
  throw new Error('等待超时：' + (label || expression));
}

var navCount = 0;
// 追加唯一查询参数，确保每次都是完整页面加载而不是同文档 hash 跳转。
function freshUrl(url) {
  navCount += 1;
  var i = url.indexOf('#');
  var base = i >= 0 ? url.slice(0, i) : url;
  var frag = i >= 0 ? url.slice(i) : '';
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + '_n=' + navCount + frag;
}

async function goto(url) {
  // loadEventFired 在 CDN 慢／偶发丢事件时可能超时；以应用启动为准，不把 load 事件当作唯一门槛。
  var loadWait = waitEvent('Page.loadEventFired', 30000).catch(function () {
    return null;
  });
  await send('Page.navigate', { url: freshUrl(url) });
  await loadWait;
  await waitFor(
    "window.CareerAgent && window.CareerAgent.booted && document.querySelector('#ca-view .ca-page, #ca-view .ca-state')",
    15000,
    '应用启动'
  );
  await sleep(120);
}

async function reload() {
  var loadWait = waitEvent('Page.loadEventFired', 30000).catch(function () {
    return null;
  });
  await send('Page.reload', {});
  await loadWait;
  await waitFor(
    "window.CareerAgent && window.CareerAgent.booted && document.querySelector('#ca-view .ca-page, #ca-view .ca-state--error, #ca-view .ca-state--info')",
    15000,
    '刷新后启动'
  );
  await sleep(120);
}

async function hash(h) {
  await evaluate('location.hash = ' + JSON.stringify(h));
  await sleep(200);
}

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: 1, mobile: width < 500 });
  await sleep(150);
}

async function shot(name, full) {
  var res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(res.data, 'base64'));
  return 'assets/screenshots/phase1/' + name + '.png';
}

async function key(name) {
  var codes = { Tab: 9, Enter: 13, Escape: 27, Space: 32 };
  var base = { key: name === 'Space' ? ' ' : name, code: name === 'Space' ? 'Space' : name, windowsVirtualKeyCode: codes[name], nativeVirtualKeyCode: codes[name] };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  if (name === 'Enter' || name === 'Space') await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: name === 'Enter' ? '\r' : ' ' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(80);
}

// 页面内辅助：按可见文字点击按钮或链接。
var HELPERS = [
  'window.__t = {',
  "  byText: function (sel, text) { return Array.prototype.find.call(document.querySelectorAll(sel), function (el) { return el.textContent.trim().indexOf(text) >= 0; }); },",
  "  click: function (sel, text) { var el = text ? this.byText(sel, text) : document.querySelector(sel); if (!el) throw new Error('找不到元素 ' + sel + ' ' + (text || '')); el.click(); return true; },",
  "  fill: function (sel, value) { var el = document.querySelector(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; },",
  "  text: function (sel) { var el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; },",
  "  all: function (sel) { return Array.prototype.map.call(document.querySelectorAll(sel), function (el) { return el.textContent.replace(/\\s+/g, ' ').trim(); }); },",
  "  stored: function () { var raw = (window.CareerAgentTest && CareerAgentTest.peekStored) ? CareerAgentTest.peekStored() : localStorage.getItem('" + KEY + "'); return raw ? JSON.parse(raw) : null; },",
  "  asset: function (id) { var s = this.stored(); return s && s.data.assets.filter(function (a) { return a.id === id; })[0]; }",
  '};',
  'true'
].join('\n');

async function helpers() {
  await evaluate(HELPERS);
}

var results = [];
function record(id, name, ok, evidence) {
  results.push({ id: id, name: name, ok: ok, evidence: evidence });
  console.log((ok ? '通过  ' : '失败  ') + id + ' ' + name + (evidence ? '\n      ' + evidence : ''));
}

async function check(id, name, fn) {
  try {
    var evidence = await fn();
    record(id, name, true, evidence || '');
  } catch (err) {
    record(id, name, false, err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await Promise.race([
    send('Target.setDiscoverTargets', { discover: true }, false),
    sleep(15000).then(function () {
      throw new Error('Chrome 15 秒内未响应，可能无法在当前环境启动。stderr：' + chromeStderr.slice(-800));
    })
  ]);
  var target = await send('Target.createTarget', { url: 'about:blank' }, false);
  var attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false);
  sessionId = attached.sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await viewport(1440, 900);

  // ---------- 正常模式（真实 localStorage，全新浏览器配置） ----------
  await goto(ENTRY + '#/home');
  await helpers();
  var cdnFailed = await evaluate('window.__caAssetFailures.slice()');

  await check('A01', '三页互通、刷新恢复、前进后退、未知路由', async function () {
    await helpers();
    assert((await evaluate("__t.text('.ca-page-title')")).indexOf('AI 产品经理') >= 0, '首页标题错误');
    await evaluate("__t.click('.ca-nav__link', '职业资产')");
    await sleep(200);
    assert((await evaluate("__t.text('.ca-page-title')")) === '职业资产', '未进入资产页');
    await evaluate("__t.click('.ca-nav__link', '岗位工作区')");
    await sleep(200);
    assert((await evaluate("__t.text('.ca-page-title')")) === '岗位工作区', '未进入岗位页');
    await hash('#/jobs/job_002?goal=goal_ai_pm');
    await reload();
    await helpers();
    assert((await evaluate("__t.text('#job-detail-title')")) === '大模型应用产品经理', '刷新后未恢复岗位详情');
    await evaluate('history.back()');
    await sleep(300);
    var back = await evaluate('location.hash');
    await evaluate('history.forward()');
    await sleep(300);
    var fwd = await evaluate('location.hash');
    assert(back === '#/jobs' && fwd.indexOf('#/jobs/job_002') === 0, '前进后退异常：' + back + ' / ' + fwd);
    var bad = [];
    var cases = [
      ['#/nope', '页面不存在'],
      ['#/jobs/job_999?goal=goal_ai_pm', '找不到这个岗位'],
      ['#/vault/asset_999', '找不到这项职业资产'],
      ['#/jobs/job_003?goal=goal_ai_pm', '不属于目标'],
      ['#/jobs/job_001?goal=goal_x', '目标无效'],
      ['#/prepare?job=job_003&goal=goal_ai_pm', '无法确定']
    ];
    for (var i = 0; i < cases.length; i++) {
      await hash(cases[i][0]);
      var txt = await evaluate("document.querySelector('#ca-view').textContent");
      var hasHome = await evaluate("!!document.querySelector('#ca-view a[href=\"#/home\"], #ca-view a[href=\"#/jobs\"], #ca-view a[href^=\"#/vault\"]')");
      var leaked = await evaluate("!!document.querySelector('#job-detail-title, #asset-detail-title')");
      if (txt.indexOf(cases[i][1]) < 0 || !hasHome || leaked) bad.push(cases[i][0]);
    }
    assert(!bad.length, '未知路由处理异常：' + bad.join('、'));
    await hash('#/');
    assert((await evaluate('location.hash')) === '#/home', '空路由未回到首页');
    return '首页→资产→岗位导航正常；刷新恢复 job_002 详情；后退=' + back + '，前进=' + fwd + '；6 种无效路径/ID 均显示可恢复提示且未打开其他对象';
  });

  await check('A02/A12', '目标切换过滤、持久化与初始指标', async function () {
    await hash('#/home');
    await helpers();
    var m1 = await evaluate("__t.all('.ca-metric__value')");
    var t1 = await evaluate("__t.all('.ca-task__title')");
    await shot('A02-home-goal1-desktop', true);
    assert(m1.join('/') === '2/1/1/1', '目标一指标 ' + m1.join('/'));
    var appsBefore = await evaluate('JSON.stringify(__t.stored().data.applications)');
    var eventsBefore = await evaluate('__t.stored().data.events.length');
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('.ca-page-title').textContent.indexOf('B 端') >= 0", 3000, '切换到目标二');
    var m2 = await evaluate("__t.all('.ca-metric__value')");
    var t2 = await evaluate("__t.all('.ca-task__title')");
    var jobs2 = await evaluate("__t.all('#home-jobs ~ ul .ca-row__title, .ca-section:last-child .ca-row__title')");
    await shot('A02-home-goal2-desktop', true);
    assert(m2.join('/') === '1/1/0/0', '目标二指标 ' + m2.join('/'));
    assert(!t2.some(function (t) { return t.indexOf('二面') >= 0; }), '目标二出现二面待办');
    await hash('#/jobs');
    var jl = await evaluate("__t.all('.ca-pane--list .ca-row__title')");
    assert(jl.length === 1 && jl[0].indexOf('B 端') >= 0, '目标二岗位列表错误 ' + jl.join('、'));
    await reload();
    await helpers();
    var persisted = await evaluate("document.querySelector('#ca-goal-select').value");
    assert(persisted === 'goal_b2b_pm', '刷新后目标未保持');
    var appsAfter = await evaluate('JSON.stringify(__t.stored().data.applications)');
    var eventsAfter = await evaluate('__t.stored().data.events.length');
    assert(appsAfter === appsBefore && eventsAfter === eventsBefore, '切换目标改变了 Application 或写入了事件');
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_ai_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('#ca-goal-select').value==='goal_ai_pm' && document.querySelector('.ca-pane--list .ca-row__title')", 3000, '切回目标一');
    var jl1 = await evaluate("__t.all('.ca-pane--list .ca-row__title')");
    assert(jl1.length === 2, '切回后岗位数量错误');
    return '目标一 2/1/1/1，待办 ' + t1.length + ' 项（含二面准备）；目标二 1/1/0/0，待办 ' + t2.length + ' 项、无二面；岗位列表 2→1→2；刷新保持 goal_b2b_pm；Application 与事件数不变（事件 ' + eventsBefore + '）';
  });

  await check('A03', '证据定位资产并返回原岗位', async function () {
    await hash('#/jobs/job_001?goal=goal_ai_pm');
    await helpers();
    await shot('A03-job-detail-desktop', true);
    var links = await evaluate("Array.prototype.map.call(document.querySelectorAll('.ca-evidence a.ca-btn'), function(a){return a.getAttribute('href');})");
    assert(links.length === 3, '证据链接数量 ' + links.length);
    await evaluate("document.querySelectorAll('.ca-evidence a.ca-btn')[1].click()");
    await sleep(250);
    var h = await evaluate('location.hash');
    var title = await evaluate("__t.text('#asset-detail-title')");
    assert(h.indexOf('#/vault/asset_003') === 0 && h.indexOf('fromJob=job_001') > 0 && h.indexOf('goal=goal_ai_pm') > 0, '定位地址错误 ' + h);
    assert(title.indexOf('产品助理') >= 0, '定位资产错误 ' + title);
    await shot('A03-vault-from-evidence-desktop', true);
    await evaluate("__t.click('a.ca-btn', '返回岗位：')");
    await sleep(250);
    var back = await evaluate('location.hash');
    assert(back === '#/jobs/job_001?goal=goal_ai_pm', '返回地址错误 ' + back);
    await evaluate("document.querySelectorAll('.ca-evidence a.ca-btn')[0].click()");
    await sleep(250);
    await evaluate('history.back()');
    await sleep(300);
    var back2 = await evaluate('location.hash');
    assert(back2 === '#/jobs/job_001?goal=goal_ai_pm', '浏览器返回错误 ' + back2);
    return '证据链接均带 assetId+rev+fromJob+goal；定位 asset_003 正确；“返回岗位”与浏览器后退都回到 ' + back;
  });

  await check('A05', '准备投递进入文档工作区，上下文正确且可返回', async function () {
    await hash('#/jobs/job_001?goal=goal_ai_pm');
    await helpers();
    await evaluate("__t.click('a.ca-btn', '准备投递材料')");
    await sleep(250);
    var text = await evaluate("document.querySelector('#ca-view').textContent");
    await shot('A05-prepare-workspace-desktop');
    assert(
      text.indexOf('准备投递材料') >= 0 &&
        text.indexOf('AI 产品经理') >= 0 &&
        text.indexOf('星河智能') >= 0 &&
        text.indexOf('不会自动投递') >= 0 &&
        text.indexOf('文档工作区将在下一阶段开放') < 0,
      '文档工作区内容不完整'
    );
    assert((await evaluate('location.hash')).indexOf('#/prepare?') === 0, '未进入 prepare 路由');
    await evaluate("__t.click('a.ca-btn', '返回岗位')");
    await sleep(250);
    var h = await evaluate('location.hash');
    assert(h === '#/jobs/job_001?goal=goal_ai_pm', '返回错误 ' + h);
    return '进入文档工作区显示目标/岗位/公司与本地保存声明；返回 ' + h;
  });

  await check('P2-A', '文档版本保存不可覆盖，投递引用版本 ID', async function () {
    await hash('#/prepare?job=job_001&goal=goal_ai_pm&doc=doc_base_resume');
    await helpers();
    await evaluate("__t.fill('#doc-body', '基础简历浏览器验收修订版')");
    await evaluate("document.querySelector('#doc-confirm').checked = true; document.querySelector('#doc-confirm').dispatchEvent(new Event('change', {bubbles:true}))");
    var verBefore = await evaluate("__t.stored().data.documentVersions.filter(function(v){return v.documentId==='doc_base_resume';}).length");
    await evaluate("__t.click('button', '保存为新版本')");
    await waitFor("__t.stored().data.documentVersions.filter(function(v){return v.documentId==='doc_base_resume';}).length > " + verBefore, 4000, '版本保存');
    var vers = await evaluate("__t.stored().data.documentVersions.filter(function(v){return v.documentId==='doc_base_resume';}).map(function(v){return v.versionNumber+':'+v.body.slice(0,8);})");
    assert(vers.length === verBefore + 1, '未新增版本 ' + JSON.stringify(vers));
    await shot('P2-doc-version-desktop', true);
    return 'doc_base_resume 版本数 ' + verBefore + '→' + (verBefore + 1) + '；旧版本仍在';
  });

  await check('P2-B', '多轮面试按 ID 打开；预置复盘标注；新笔记尚未分析', async function () {
    await hash('#/interview/interview_001');
    await helpers();
    var text = await evaluate("document.querySelector('#ca-view').textContent");
    assert(text.indexOf('演示预置复盘') >= 0 && text.indexOf('一面') >= 0, '预置复盘未标注');
    await evaluate("__t.fill('#iv-notes', '浏览器验收新笔记，应清空复盘')");
    await evaluate("__t.click('button', '保存笔记')");
    await waitFor("__t.stored().data.interviews.filter(function(i){return i.id==='interview_001';})[0].review===null", 4000, '笔记清空复盘');
    await helpers();
    var after = await evaluate("document.querySelector('#ca-view').textContent");
    assert(after.indexOf('尚未分析') >= 0 && after.indexOf('演示预置复盘') < 0, '尚未分析未显示');
    await shot('P2-interview-unanalyzed-desktop', true);
    await hash('#/interviews?job=job_002&goal=goal_ai_pm');
    await helpers();
    var list = await evaluate("document.querySelector('#ca-view').textContent");
    assert(list.indexOf('一面') >= 0 && list.indexOf('二面') >= 0, '面试列表缺少多轮');
    return '预置复盘标注正确；保存笔记后显示尚未分析；列表含两轮';
  });

  await check('P2-C', '进展二级页：已分析／已投递／回复／面试可返回', async function () {
    await hash('#/progress/analyzed');
    await helpers();
    assert((await evaluate("document.querySelector('#ca-view').textContent")).indexOf('已分析岗位') >= 0, '分析页失败');
    await evaluate("__t.click('a.ca-btn', '返回求职进展')");
    await sleep(200);
    assert((await evaluate('location.hash')) === '#/home', '未返回首页');
    await hash('#/progress/interviews');
    await helpers();
    var iv = await evaluate("document.querySelector('#ca-view').textContent");
    assert(iv.indexOf('面试') >= 0 && iv.indexOf('一面') >= 0, '面试二级页失败');
    await shot('P2-progress-interviews-desktop');
    return '进展二级页可进入并返回；面试二级列出关联轮次';
  });

  await check('P2-D', '文档编辑离开保护与保存失败草稿保留', async function () {
    await goto(ENTRY + '?test=isolated#/prepare?job=job_001&goal=goal_ai_pm&doc=doc_base_resume');
    await helpers();
    await evaluate("__t.fill('#doc-body', '未保存的材料草稿正文（离开保护）')");
    await sleep(80);
    assert((await evaluate('CareerAgent.features.prepare.guard.isDirty()')) === true, '草稿未标脏');
    await evaluate("__t.click('.ca-nav__link', '求职进展')");
    await sleep(200);
    assert((await evaluate('location.hash')).indexOf('#/prepare') === 0, '未拦截离开');
    assert(await evaluate("!!document.querySelector('dialog[open]')"), '未弹出离开确认');
    await evaluate("__t.click('dialog[open] button', '继续编辑')");
    await sleep(150);
    assert((await evaluate('location.hash')).indexOf('#/prepare') === 0, '继续编辑后地址错误');
    assert((await evaluate("document.querySelector('#doc-body').value")).indexOf('离开保护') >= 0, '草稿丢失');

    var verBefore = await evaluate("__t.stored().data.documentVersions.filter(function(v){return v.documentId==='doc_base_resume';}).length");
    var beforeRaw = await evaluate('CareerAgentTest.peekStored()');
    await evaluate('CareerAgentTest.failWrites(true)');
    await evaluate("__t.click('button', '保存为新版本')");
    await waitFor("document.querySelector('.ca-form-error') && !document.querySelector('.ca-form-error').hidden", 4000, '保存失败提示');
    assert((await evaluate("document.querySelector('#doc-body').value")).indexOf('离开保护') >= 0, '失败后草稿丢失');
    assert((await evaluate('CareerAgentTest.peekStored()')) === beforeRaw, '失败却写入存储');
    assert((await evaluate("__t.text('.ca-form-error')")).indexOf('重试保存') >= 0, '缺少重试入口');
    await evaluate('CareerAgentTest.failWrites(false)');
    await evaluate("__t.click('.ca-form-error button', '重试保存')");
    await waitFor("__t.stored().data.documentVersions.filter(function(v){return v.documentId==='doc_base_resume';}).length > " + verBefore, 4000, '重试保存');
    assert((await evaluate('CareerAgent.features.prepare.guard.isDirty()')) === false, '保存成功后仍脏');
    await shot('P2-doc-leave-guard-desktop', true);
    await goto(ENTRY + '#/home');
    await helpers();
    return '继续编辑保留草稿；写失败保留草稿并可重试成功；成功后清除离开保护';
  });

  await check('P3-A', '首页首屏上传入口与我的简历／助手可达', async function () {
    await hash('#/home');
    await helpers();
    var text = await evaluate("document.querySelector('#ca-view').textContent");
    assert(text.indexOf('上传 PDF 简历') >= 0, '首页缺少上传入口');
    assert(text.indexOf('我的简历') >= 0, '首页缺少简历入口');
    assert(text.indexOf('开始整理求职材料') >= 0, '缺少整理入口');
    assert(text.indexOf('求职助手') >= 0, '缺少助手入口');
    await evaluate("__t.click('a.ca-btn', '上传 PDF 简历')");
    await sleep(250);
    assert((await evaluate('location.hash')).indexOf('#/resume') === 0, '未进入我的简历');
    await shot('P3-home-resume-entry-desktop');
    await hash('#/assistant');
    await helpers();
    var asst = await evaluate("document.querySelector('#ca-view').textContent");
    assert(asst.indexOf('求职助手') >= 0 && asst.indexOf('不是完整聊天') >= 0 && asst.indexOf('去上传简历') >= 0, '助手页内容不足');
    await evaluate("__t.click('a.ca-btn', '去上传简历')");
    await sleep(200);
    assert((await evaluate('location.hash')).indexOf('#/resume') === 0, '助手未跳到简历');
    return '首页可见上传；助手可引导至我的简历';
  });

  await check('P3-B', '上传登记可查看；确认前不冒充已核实；失败不覆盖', async function () {
    try {
      await goto(ENTRY + '?test=isolated#/resume');
      await helpers();
      var up = await evaluate(
        "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'ok.pdf',byteSize:800,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'browser_p3_up'}); await CareerAgentTest.refresh(); location.hash='#/resume?file='+r.fileId; return r; })()"
      );
      assert(up && up.fileId, '上传登记失败');
      await sleep(350);
      await helpers();
      var page = await evaluate("document.querySelector('#ca-view').textContent");
      assert(page.indexOf('ok.pdf') >= 0, '文件名未展示');
      assert(page.indexOf('可查看／编辑') >= 0 || page.indexOf('已上传') >= 0, '上传状态未展示：' + page.slice(0, 160));
      assert(page.indexOf('正文未读取') >= 0, '应区分正文未读取');
      assert(page.indexOf('确认这份简历内容') < 0, '上传页不应再强制确认');
      await evaluate("__t.fill('#resume-text', '浏览器验收简历正文（合成）')");
      await evaluate("__t.click('button', '保存正文')");
      await waitFor("__t.stored().data.files.filter(function(f){return f.id==='" + up.fileId + "';})[0].textDraft.indexOf('浏览器验收')>=0", 4000, '正文保存');
      await helpers();
      var afterSave = await evaluate("document.querySelector('#ca-view').textContent");
      assert(afterSave.indexOf('正文已读取') >= 0, '保存后应显示正文已读取');
      var beforeConfirm = await evaluate("__t.stored().data.files.filter(function(f){return f.id==='" + up.fileId + "';})[0]");
      assert(beforeConfirm.status === 'pending_confirm' && !beforeConfirm.sourceId, '确认前不应有来源');
      await evaluate(
        "(async function(){ await CareerAgentTest.service.confirmResumeFile({fileId:'" +
          up.fileId +
          "',commandId:'browser_p3_cf'}); await CareerAgentTest.refresh(); })()"
      );
      await waitFor("__t.stored().data.files.filter(function(f){return f.id==='" + up.fileId + "';})[0].status==='confirmed'", 4000, '确认');
      var confirmedId = up.fileId;
      var fail = await evaluate(
        "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'bad.pdf',byteSize:10,mimeType:'application/pdf',status:'read_failed',readError:'无法读取该文件',commandId:'browser_p3_fail'}); await CareerAgentTest.refresh(); return r; })()"
      );
      var cur = await evaluate(
        "(function(){ var files=__t.stored().data.files; var confirmed=files.filter(function(f){return f.status==='confirmed';})[0]; return confirmed && confirmed.id; })()"
      );
      assert(cur === confirmedId, '失败上传覆盖了当前可用简历');
      await evaluate("location.hash=" + JSON.stringify('#/resume?file=' + fail.fileId));
      await sleep(300);
      await helpers();
      var failText = await evaluate("document.querySelector('#ca-view').textContent");
      assert(failText.indexOf('读取失败') >= 0 && failText.indexOf('无法读取') >= 0, '失败原因未显示');
      await shot('P3-resume-pending-confirm-desktop', true);
      return '上传可查看；正文未读／已读可区分；页内无强制确认；失败不覆盖';
    } finally {
      await goto(ENTRY + '#/home');
      await helpers();
    }
  });

  await check('P4-A', '帮我改简历入口与准备材料中的使用确认', async function () {
    await goto(ENTRY + '#/home');
    await helpers();
    var home = await evaluate("document.querySelector('#ca-view').textContent");
    assert(home.indexOf('帮我改简历') >= 0, '首页缺少改简历入口');
    await evaluate("__t.click('a.ca-btn', '帮我改简历')");
    await sleep(250);
    assert((await evaluate('location.hash')).indexOf('#/resume/revise') === 0, '未进入改简历页');
    var revise = await evaluate("document.querySelector('#ca-view').textContent");
    assert(revise.indexOf('尚未接入真实 AI') >= 0 || revise.indexOf('未配置') >= 0 || revise.indexOf('演示') >= 0, '缺少边界说明');
    assert(revise.indexOf('选择要对齐的岗位') >= 0, '缺少岗位选择');
    assert(revise.indexOf('开始准备修改') >= 0, '缺少准备入口');
    await shot('P4-revise-resume-desktop');

    var ready = await evaluate(
      "(async function(){ var up=await CareerAgentTest.service.recordResumeFileUpload({fileName:'p4-use.pdf',byteSize:900,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'browser_p4_up'}); await CareerAgentTest.service.saveResumeFileText({fileId:up.fileId,text:'第四阶段用于确认的正文（合成）',commandId:'browser_p4_txt'}); await CareerAgentTest.refresh(); return up.fileId; })()"
    );
    assert(ready, '准备确认材料失败');
    await hash('#/prepare?job=job_001&goal=goal_ai_pm');
    await helpers();
    var prep = await evaluate("document.querySelector('#ca-view').textContent");
    assert(prep.indexOf('确认使用此简历') >= 0, '准备材料页缺少使用确认');
    await evaluate("__t.click('button', '确认使用此简历')");
    await waitFor("__t.stored().data.files.filter(function(f){return f.fileName==='p4-use.pdf';})[0].status==='confirmed'", 5000, '准备页确认');
    await helpers();
    var after = await evaluate("document.querySelector('#ca-view').textContent");
    assert(after.indexOf('已确认') >= 0, '确认后状态未更新');
    await shot('P4-prepare-use-confirm-desktop', true);
    return '改简历入口可达；准备材料页可确认使用';
  });

  await check('P4-B', '上传后刷新仍见文件；正文空／有文案区分', async function () {
    await goto(ENTRY + '#/resume');
    await helpers();
    var id = await evaluate(
      "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'refresh.pdf',byteSize:640,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'browser_p4_ref_' + Date.now()}); await CareerAgentTest.refresh(); location.hash='#/resume?file='+r.fileId; return r.fileId; })()"
    );
    await sleep(300);
    await helpers();
    var before = await evaluate("document.querySelector('#ca-view').textContent");
    assert(before.indexOf('refresh.pdf') >= 0 && before.indexOf('正文未读取') >= 0, '上传后状态不对');
    await reload();
    await helpers();
    await evaluate("location.hash=" + JSON.stringify('#/resume?file=' + id));
    await sleep(300);
    await helpers();
    var afterReload = await evaluate("document.querySelector('#ca-view').textContent");
    assert(afterReload.indexOf('refresh.pdf') >= 0, '刷新后文件名丢失：' + afterReload.slice(0, 160));
    assert(
      (await evaluate("__t.stored().data.files.some(function(f){return f.id==='" + id + "' && f.fileName==='refresh.pdf';})")) === true,
      '刷新后存储中无该文件'
    );
    await evaluate("__t.fill('#resume-text', '刷新后粘贴的正文')");
    await evaluate("__t.click('button', '保存正文')");
    await waitFor("__t.stored().data.files.filter(function(f){return f.id==='" + id + "';})[0].textDraft.indexOf('刷新后粘贴')>=0", 4000, '保存');
    await helpers();
    assert((await evaluate("document.querySelector('#ca-view').textContent")).indexOf('正文已读取') >= 0, '有正文后未标已读取');
    await hash('#/home');
    await helpers();
    return '刷新保留文件；正文未读／已读可区分';
  });

  await check('P5-A', '岗位建议：采纳／跳过／改写；不覆盖原简历；使用此简历才确认', async function () {
    await goto(ENTRY + '#/home');
    await helpers();
    await evaluate("(async function(){ await CareerAgentTest.service.resetDemo({confirmed:true}); await CareerAgentTest.refresh(); CareerAgentTest.clearAiProvider(); })()");
    await sleep(200);
    await helpers();
    var fileId = await evaluate(
      "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'p5-sug.pdf',byteSize:700,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'browser_p5_up_'+Date.now()}); await CareerAgentTest.service.saveResumeFileText({fileId:r.fileId,text:'林小舟｜产品助理\\n虚构科技｜智能客服知识库问答\\n与算法同事制定人工抽检规则',commandId:'browser_p5_txt_'+Date.now()}); await CareerAgentTest.refresh(); return r.fileId; })()"
    );
    var original = await evaluate("__t.stored().data.files.filter(function(f){return f.id==='" + fileId + "';})[0].textDraft");
    await hash('#/resume/revise?job=job_001');
    await helpers();
    var prep = await evaluate("document.querySelector('#ca-view').textContent");
    assert(prep.indexOf('将发送给模型的内容范围') >= 0, '准备步缺少发送范围');
    assert(prep.indexOf('已收到模型返回') < 0, '未生成却出现模型成功文案');
    await evaluate("document.querySelector('#revise-send-confirm').click()");
    await evaluate("__t.click('button', '下一步：生成建议')");
    await sleep(200);
    await helpers();
    var gen = await evaluate("document.querySelector('#ca-view').textContent");
    assert(gen.indexOf('尚未接入真实 AI') >= 0, '未配置时应提示尚未接入');
    await evaluate("__t.click('button', '改用本地演示建议')");
    await sleep(300);
    await helpers();
    var page = await evaluate("document.querySelector('#ca-view').textContent");
    assert(page.indexOf('本地演示建议') >= 0 && page.indexOf('不是真实 AI') >= 0, '缺少演示边界');
    assert(page.indexOf('已收到模型返回') < 0, '演示路径不应写模型成功');
    assert(page.indexOf('采纳') >= 0 && page.indexOf('跳过') >= 0 && page.indexOf('改写后采纳') >= 0, '缺少三种处理');
    var sugCount = await evaluate("document.querySelectorAll('.ca-suggest').length");
    assert(sugCount >= 3 && sugCount <= 5, '建议条数异常：' + sugCount);

    await evaluate("__t.click('.ca-suggest button', '采纳')");
    await sleep(200);
    await helpers();
    assert((await evaluate("document.querySelector('.ca-suggest').textContent")).indexOf('已采纳') >= 0, '采纳状态未显示');
    await evaluate("__t.click('.ca-suggest button', '跳过')");
    await sleep(150);
    await helpers();
    assert((await evaluate("Array.prototype.some.call(document.querySelectorAll('.ca-suggest'),function(el){return el.textContent.indexOf('已跳过')>=0;})")) === true, '跳过状态未显示');

    await evaluate("__t.click('.ca-suggest button', '改写后采纳')");
    await sleep(150);
    await evaluate(
      "(function(){ var ta=document.querySelector('textarea[id^=\"suggest-edit-\"]'); if(!ta) throw new Error('无改写框'); ta.value=ta.value+'（浏览器改写补充）'; ta.dispatchEvent(new Event('input',{bubbles:true})); })()"
    );
    await evaluate("__t.click('button', '确认改写并采纳')");
    await sleep(200);
    await helpers();
    assert((await evaluate("Array.prototype.some.call(document.querySelectorAll('.ca-suggest'),function(el){return el.textContent.indexOf('已改写后采纳')>=0;})")) === true, '改写采纳状态未显示');
    assert((await evaluate("__t.stored().data.files.filter(function(f){return f.id==='" + fileId + "';})[0].textDraft")) === original, '采纳后原简历被覆盖');
    var stillPending = await evaluate("__t.stored().data.files.filter(function(f){return f.id==='" + fileId + "';})[0].status");
    assert(stillPending === 'pending_confirm', '建议页不应触发确认，实际：' + stillPending);

    await evaluate("__t.click('button', '保存为新草稿')");
    await waitFor(
      "(function(){ var docs=__t.stored().data.documents.filter(function(d){return d.jobId==='job_001'&&d.kind==='resume'&&d.draft.parameters.variant==='tailored';}); if(!docs.length) return false; var id=docs[0].id; return __t.stored().data.documentVersions.some(function(v){return v.documentId===id&&v.userConfirmed===false;}); })()",
      6000,
      '保存岗位草稿'
    );
    assert((await evaluate("__t.stored().data.files.filter(function(f){return f.id==='" + fileId + "';})[0].textDraft")) === original, '保存草稿后原简历被覆盖');
    await shot('P5-revise-suggestions-desktop', true);

    await evaluate("__t.click('button', '使用此简历')");
    await waitFor("__t.stored().data.files.filter(function(f){return f.id==='" + fileId + "';})[0].status==='confirmed'", 5000, '使用此简历确认');
    assert((await evaluate('location.hash')).indexOf('#/prepare') === 0, '确认后应进入准备材料');
    return '建议可处理；原简历保留；仅使用此简历才确认';
  });

  await check('P5-B', '无正文不生成建议；保存失败可重试', async function () {
    try {
      await goto(ENTRY + '?test=isolated#/home');
      await helpers();
      await evaluate('CareerAgentTest.clearAiProvider()');
      await evaluate(
        "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'only-empty.pdf',byteSize:80,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'iso_empty_up'}); await CareerAgentTest.refresh(); location.hash='#/resume/revise?job=job_001'; })()"
      );
      await sleep(400);
      await helpers();
      var isoPage = await evaluate("document.querySelector('#ca-view').textContent");
      assert(isoPage.indexOf('还没有简历正文') >= 0 || isoPage.indexOf('请先编辑正文') >= 0, '无正文应提示先编辑：' + isoPage.slice(0, 140));
      assert((await evaluate("document.querySelectorAll('.ca-suggest').length")) === 0, '无正文不应渲染建议卡');

      await evaluate(
        "(async function(){ var cur=__t.stored().data.files.filter(function(f){return f.status!=='read_failed';})[0]; await CareerAgentTest.service.saveResumeFileText({fileId:cur.id,text:'隔离正文\\n智能客服知识库\\n与算法协作评测',commandId:'iso_txt'}); await CareerAgentTest.refresh(); location.hash='#/resume/revise?job=job_001'; })()"
      );
      await sleep(400);
      await helpers();
      await evaluate("document.querySelector('#revise-send-confirm').click()");
      await evaluate("__t.click('button', '下一步：生成建议')");
      await sleep(200);
      await evaluate("__t.click('button', '改用本地演示建议')");
      await sleep(300);
      await helpers();
      assert((await evaluate("document.querySelectorAll('.ca-suggest').length")) >= 3, '有正文应出现建议');
      await evaluate("__t.click('.ca-suggest button', '采纳')");
      await sleep(150);
      var beforeRaw = await evaluate('CareerAgentTest.peekStored()');
      await evaluate('CareerAgentTest.failWrites(true)');
      await evaluate("__t.click('button', '保存为新草稿')");
      await waitFor("document.querySelector('.ca-form-error') && !document.querySelector('.ca-form-error').hidden", 4000, '保存失败提示');
      assert((await evaluate('CareerAgentTest.peekStored()')) === beforeRaw, '失败却写入');
      assert((await evaluate("document.querySelector('.ca-form-error').textContent")).indexOf('重试保存') >= 0, '缺少重试');
      await evaluate('CareerAgentTest.failWrites(false)');
      await evaluate("__t.click('.ca-form-error button', '重试保存')");
      await waitFor(
        "document.querySelector('#ca-view').textContent.indexOf('本轮至少已成功保存')>=0",
        6000,
        '重试保存成功'
      );
      await shot('P5-revise-save-retry-desktop', true);
      return '无正文不生成建议；保存失败可重试';
    } finally {
      await evaluate('CareerAgentTest.clearAiProvider()');
      await goto(ENTRY + '#/home');
      await helpers();
    }
  });

  await check('P6-A', '未配置模型：显示尚未接入；不伪装生成成功', async function () {
    await goto(ENTRY + '#/home');
    await helpers();
    await evaluate("(async function(){ await CareerAgentTest.service.resetDemo({confirmed:true}); await CareerAgentTest.refresh(); CareerAgentTest.clearAiProvider(); })()");
    await evaluate(
      "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'p6-none.pdf',byteSize:400,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'p6_none_'+Date.now()}); await CareerAgentTest.service.saveResumeFileText({fileId:r.fileId,text:'产品助理\\n客服项目\\n评测协作',commandId:'p6_none_txt_'+Date.now()}); await CareerAgentTest.refresh(); })()"
    );
    await hash('#/resume/revise?job=job_001');
    await helpers();
    await evaluate("document.querySelector('#revise-send-confirm').click()");
    await evaluate("__t.click('button', '下一步：生成建议')");
    await sleep(250);
    await helpers();
    var text = await evaluate("document.querySelector('#ca-view').textContent");
    assert(text.indexOf('尚未接入真实 AI') >= 0, '未提示尚未接入');
    assert(text.indexOf('已收到模型返回') < 0, '未配置却显示模型成功');
    var disabled = await evaluate(
      "(function(){ var btns=Array.prototype.slice.call(document.querySelectorAll('button')); var b=btns.filter(function(x){return x.textContent.indexOf('向模型请求建议')>=0;})[0]; return b && b.disabled; })()"
    );
    assert(disabled === true, '未配置时生成按钮应禁用');
    await shot('P6-ai-unconfigured-desktop');
    return '未配置时明确不可用且不伪装成功';
  });

  await check('P6-B', '模型失败可重试；成功后进入逐条处理并可保存草稿', async function () {
    try {
      await goto(ENTRY + '?test=isolated#/home');
      await helpers();
      await evaluate('CareerAgentTest.clearAiProvider()');
      await evaluate(
        "(async function(){ var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'p6-mock.pdf',byteSize:500,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'p6_mock_up'}); await CareerAgentTest.service.saveResumeFileText({fileId:r.fileId,text:'林小舟｜产品助理\\n智能客服知识库\\n与算法制定抽检规则',commandId:'p6_mock_txt'}); await CareerAgentTest.refresh(); location.hash='#/resume/revise?job=job_001'; })()"
      );
      await sleep(400);
      await helpers();
      var original = await evaluate("__t.stored().data.files.filter(function(f){return f.fileName==='p6-mock.pdf';})[0].textDraft");
      await evaluate("CareerAgentTest.installAiProvider({fail:true,failMessage:'模拟模型调用失败'})");
      await evaluate("document.querySelector('#revise-send-confirm').click()");
      await evaluate("__t.click('button', '下一步：生成建议')");
      await sleep(250);
      await helpers();
      var genPage = await evaluate("document.querySelector('#ca-view').textContent");
      assert(genPage.indexOf('验证') >= 0 || genPage.indexOf('向模型请求建议') >= 0 || genPage.indexOf('测试用模型') >= 0, '安装适配器后应可请求');
      await evaluate("__t.click('button', '向模型请求建议')");
      await waitFor(
        "document.querySelector('.ca-form-error') && document.querySelector('.ca-form-error').textContent.indexOf('模拟模型调用失败')>=0",
        5000,
        '失败提示'
      );
      assert((await evaluate("__t.stored().data.files.filter(function(f){return f.fileName==='p6-mock.pdf';})[0].textDraft")) === original, '失败覆盖原简历');
      assert((await evaluate("document.querySelectorAll('.ca-suggest').length")) === 0, '失败不应写入建议列表');
      var failPhase = await evaluate("document.querySelector('#ca-view').textContent");
      assert(failPhase.indexOf('失败') >= 0 || failPhase.indexOf('生成未完成') >= 0, '应显示调用失败态');
      await evaluate("CareerAgentTest.installAiProvider({fail:false})");
      await evaluate("__t.click('.ca-form-error button', '重试生成')");
      await waitFor("document.querySelectorAll('.ca-suggest').length>=3", 8000, '重试成功出建议');
      var review = await evaluate("document.querySelector('#ca-view').textContent");
      assert(review.indexOf('模型返回') >= 0 || review.indexOf('模拟模型') >= 0, '应进入检查步');
      await evaluate("__t.click('.ca-suggest button', '采纳')");
      await sleep(150);
      await evaluate("__t.click('button', '保存为新草稿')");
      await waitFor(
        "(function(){ var docs=__t.stored().data.documents.filter(function(d){return d.jobId==='job_001'&&d.draft&&d.draft.parameters.variant==='tailored';}); if(!docs.length)return false; return __t.stored().data.documentVersions.some(function(v){return v.documentId===docs[0].id&&!v.userConfirmed;}); })()",
        6000,
        '成功后保存草稿'
      );
      assert((await evaluate("__t.stored().data.files.filter(function(f){return f.fileName==='p6-mock.pdf';})[0].textDraft")) === original, '保存后原简历被覆盖');
      await shot('P6-ai-retry-success-desktop', true);
      return '失败可重试；成功后可保存岗位草稿且不覆盖原简历';
    } finally {
      await evaluate('CareerAgentTest.clearAiProvider()');
      await evaluate('CareerAgentTest.clearAiSessionConfig()');
      await goto(ENTRY + '#/home');
      await helpers();
    }
  });

  await check('P7-A', '配置区状态：未配置→待验证→清除；密钥不进存储；本地演示可用', async function () {
    try {
      await goto(ENTRY + '?test=isolated#/home');
      await helpers();
      await evaluate('CareerAgentTest.clearAiProvider()');
      await evaluate('CareerAgentTest.clearAiSessionConfig()');
      await evaluate(
        "(async function(){ await CareerAgentTest.service.resetDemo({confirmed:true}); await CareerAgentTest.refresh(); var r=await CareerAgentTest.service.recordResumeFileUpload({fileName:'p7-cfg.pdf',byteSize:420,mimeType:'application/pdf',status:'pending_confirm',readError:null,commandId:'p7_cfg_up'}); await CareerAgentTest.service.saveResumeFileText({fileId:r.fileId,text:'产品助理\\n知识库问答\\n人工抽检规则',commandId:'p7_cfg_txt'}); await CareerAgentTest.refresh(); location.hash='#/resume/revise?job=job_001'; })()"
      );
      await sleep(450);
      await helpers();
      var prepare = await evaluate("document.querySelector('#ca-view').textContent");
      assert(prepare.indexOf('模型配置') >= 0, '缺少模型配置区');
      assert(prepare.indexOf('未配置') >= 0 || prepare.indexOf('DeepSeek') >= 0, '应展示未配置或 DeepSeek 默认');
      assert(prepare.indexOf('api.deepseek.com') >= 0 || prepare.indexOf('deepseek-chat') >= 0, '应展示 DeepSeek 默认地址或模型');

      await evaluate(
        "CareerAgentTest.setAiSessionConfig({provider:'deepseek',model:'deepseek-chat',baseUrl:'https://api.deepseek.com',apiKey:'sk-p7-browser-fake'})"
      );
      await evaluate("CareerAgentTest.refresh()");
      await sleep(300);
      await hash('#/resume/revise?job=job_001');
      await helpers();
      var pending = await evaluate("document.querySelector('#ca-view').textContent");
      assert(pending.indexOf('已配置待验证') >= 0 || pending.indexOf('待验证') >= 0, '保存后应显示待验证');
      var maskedOk = await evaluate("CareerAgentTest.getAiStatus().keyMasked && CareerAgentTest.getAiStatus().keyMasked.indexOf('sk-p7-browser-fake')<0");
      assert(maskedOk === true, '页面状态不应回显完整密钥');
      var stored = await evaluate("CareerAgentTest.peekStored() || ''");
      assert(String(stored).indexOf('sk-p7-browser-fake') < 0, '业务存储不得含密钥');

      await evaluate("CareerAgentTest.clearAiSessionConfig()");
      await evaluate("CareerAgentTest.refresh()");
      await sleep(250);
      await hash('#/resume/revise?job=job_001');
      await helpers();
      var cleared = await evaluate("document.querySelector('#ca-view').textContent");
      assert(cleared.indexOf('未配置') >= 0 || (await evaluate("CareerAgentTest.getAiStatus().configPhase")) === 'unconfigured', '清除后应回到未配置');

      await evaluate("document.querySelector('#revise-send-confirm').click()");
      await evaluate("__t.click('button', '下一步：生成建议')");
      await sleep(250);
      await helpers();
      await evaluate("__t.click('button', '改用本地演示建议（非真实 AI）')");
      await waitFor("document.querySelectorAll('.ca-suggest').length>=1", 5000, '本地演示建议');
      var demoPage = await evaluate("document.querySelector('#ca-view').textContent");
      assert(demoPage.indexOf('不是真实 AI') >= 0 || demoPage.indexOf('本地演示') >= 0, '演示路径未标明非真实 AI');
      await shot('P7-config-demo-desktop', true);
      return '配置态清晰；清除恢复未配置；密钥不落盘；本地演示可用';
    } finally {
      await evaluate('CareerAgentTest.clearAiProvider()');
      await evaluate('CareerAgentTest.clearAiSessionConfig()');
      await goto(ENTRY + '#/home');
      await helpers();
    }
  });

  await check('P8-A', '投递结果：记录 Offer／接受；preparing 可退出；终态只读提示', async function () {
    await goto(ENTRY + '?test=isolated#/home');
    await helpers();
    await evaluate("(async function(){ await CareerAgentTest.service.resetDemo({confirmed:true}); await CareerAgentTest.refresh(); })()");
    await sleep(300);

    // preparing 退出（app_001 / job_001）
    await hash('#/prepare?job=job_001&goal=goal_ai_pm');
    await helpers();
    await evaluate("__t.click('button', '我退出投递')");
    await sleep(120);
    await evaluate(
      "(function(){ var el=document.querySelector('#outcome-at'); el.value='2026-09-28T12:00'; el.dispatchEvent(new Event('input',{bubbles:true})); return el.value; })()"
    );
    await evaluate("__t.click('button', '确认退出投递')");
    await waitFor(
      "__t.stored().data.applications.filter(function(a){return a.id==='app_001';})[0].status==='withdrawn'",
      6000,
      'preparing 退出'
    );
    assert(!(await evaluate("__t.stored().data.applications.filter(function(a){return a.id==='app_001';})[0].submittedAt")), '退出不应伪造投递时间');

    // 已面试排期 → Offer → 接受（app_002）
    await hash('#/prepare?job=job_002&goal=goal_ai_pm');
    await helpers();
    var pageOffer = await evaluate("document.querySelector('#ca-view').textContent");
    assert(pageOffer.indexOf('记录投递结果') >= 0, '应显示结果记录区');
    await evaluate("__t.click('button', '收到 Offer')");
    await sleep(100);
    await evaluate(
      "(function(){ var el=document.querySelector('#outcome-at'); el.value='2026-09-29T10:00'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    );
    await evaluate("__t.click('button', '确认记录 Offer')");
    await waitFor(
      "__t.stored().data.applications.filter(function(a){return a.id==='app_002';})[0].status==='offer_received'",
      6000,
      '记录 Offer'
    );
    var openIv = await evaluate(
      "__t.stored().data.interviews.filter(function(iv){return iv.applicationId==='app_002'&&(iv.status==='scheduled'||iv.status==='invited');}).length"
    );
    assert(openIv === 0, '未完成面试应取消');

    await helpers();
    await evaluate("__t.click('button', '接受 Offer')");
    await sleep(100);
    await evaluate(
      "(function(){ var el=document.querySelector('#outcome-at'); el.value='2026-09-29T18:00'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    );
    await evaluate("__t.click('button', '确认接受 Offer')");
    await waitFor(
      "__t.stored().data.applications.filter(function(a){return a.id==='app_002';})[0].status==='accepted'",
      6000,
      '接受 Offer'
    );
    var terminal = await evaluate("document.querySelector('#ca-view').textContent");
    assert(terminal.indexOf('已结束') >= 0 || terminal.indexOf('已接受 Offer') >= 0, '终态应有只读说明');
    await shot('P8-outcome-accepted-desktop', true);
    return 'preparing 可退出；Offer／接受可用；未完成面试取消；终态只读';
  });

  await check('P9-A', '面试改期与取消：时间更新；取消后投递回退', async function () {
    await goto(ENTRY + '?test=isolated#/home');
    await helpers();
    await evaluate("(async function(){ await CareerAgentTest.service.resetDemo({confirmed:true}); await CareerAgentTest.refresh(); })()");
    await sleep(400);
    var seedOk = await evaluate(
      "(function(){ var s=__t.stored(); var iv=s.data.interviews.filter(function(x){return x.id==='interview_002';})[0]; var app=s.data.applications.filter(function(a){return a.id==='app_002';})[0]; return iv && iv.status==='scheduled' && app && app.status==='interview_scheduled'; })()"
    );
    assert(seedOk === true, '重置后样例面试／投递状态不正确');
    await evaluate("location.hash='#/interview/interview_002'");
    await sleep(350);
    await helpers();
    var detail = await evaluate("document.querySelector('#ca-view').textContent");
    assert(detail.indexOf('二面') >= 0 || detail.indexOf('第 2 轮') >= 0, '未打开面试详情：' + detail.slice(0, 120));
    assert(detail.indexOf('改期') >= 0, '缺少改期区：' + detail.slice(0, 200));
    assert(detail.indexOf('取消本轮') >= 0, '缺少取消区：' + detail.slice(0, 200));
    await evaluate(
      "(function(){ var el=document.querySelector('#iv-reschedule-at'); if(!el) throw new Error('无改期输入'); el.value='2026-10-12T16:00'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
    );
    await evaluate("__t.click('button', '保存改期')");
    await waitFor(
      "__t.stored().data.interviews.filter(function(iv){return iv.id==='interview_002';})[0].scheduledAt.indexOf('2026-10-12')===0",
      6000,
      '改期保存'
    );
    await helpers();
    await evaluate("__t.click('button', '确认取消本轮')");
    await waitFor(
      "__t.stored().data.interviews.filter(function(iv){return iv.id==='interview_002';})[0].status==='cancelled'",
      6000,
      '取消面试'
    );
    assert(
      (await evaluate("__t.stored().data.applications.filter(function(a){return a.id==='app_002';})[0].status")) === 'interview_completed',
      '投递应回退为面试已完成'
    );
    await shot('P9-interview-cancel-desktop', true);
    return '改期可保存；取消后面试 cancelled、投递 interview_completed';
  });

  await check('P10-A', '助手与首页入口可达投递结果／改期引导', async function () {
    await goto(ENTRY + '#/home');
    await helpers();
    var home = await evaluate("document.querySelector('#ca-view').textContent");
    assert(home.indexOf('求职助手') >= 0, '首页应有助手入口');
    await hash('#/assistant');
    await helpers();
    var asst = await evaluate("document.querySelector('#ca-view').textContent");
    assert(asst.indexOf('记录 Offer') >= 0 || asst.indexOf('投递结果') >= 0, '助手缺投递结果引导');
    assert(asst.indexOf('改期') >= 0 || asst.indexOf('取消面试') >= 0, '助手缺改期引导');
    await evaluate("__t.click('a', '去记录投递结果')");
    await sleep(300);
    assert((await evaluate('location.hash')).indexOf('#/prepare') === 0, '未进入准备材料');
    await hash('#/assistant');
    await helpers();
    await evaluate("__t.click('a', '打开面试详情')");
    await sleep(300);
    var h2 = await evaluate('location.hash');
    assert(h2.indexOf('#/interview') === 0 || h2.indexOf('#/interviews') === 0, '未进入面试：' + h2);
    await shot('P10-assistant-guides-desktop', true);
    return '助手卡片可达准备材料与面试';
  });

  await check('A04', '编辑被引用资产：未勾选／勾选／仅确认，刷新与过期判定', async function () {
    await goto(ENTRY + '#/vault/asset_001');
    await helpers();
    var evBefore = await evaluate('__t.stored().data.events.length');
    var srcBefore = await evaluate('__t.stored().data.sources.length');
    var snapBefore = await evaluate("JSON.stringify(__t.stored().data.assessments)");
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(150);
    await evaluate("__t.fill('#asset-title', '智能客服知识库问答项目（二期修订）')");
    await shot('A04-edit-form-desktop', true);
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '保存完成');
    await reload();
    await helpers();
    var a1 = await evaluate("__t.asset('asset_001')");
    var srcAfter = await evaluate('__t.stored().data.sources.length');
    var detail = await evaluate("document.querySelector('.ca-detail').textContent");
    assert(a1.revision === 2 && a1.provenance.userConfirmed === false && a1.provenance.sourceIds.length === 2, '未勾选保存结果错误');
    assert(srcAfter === srcBefore + 1, '未新增来源');
    assert(detail.indexOf('（二期修订）') >= 0 && detail.indexOf('待确认') >= 0 && detail.indexOf('手动输入') >= 0, '刷新后详情未恢复');
    assert((await evaluate("JSON.stringify(__t.stored().data.assessments)")) === snapBefore, '评估快照被改写');
    await shot('A04-asset-after-save-desktop', true);

    await hash('#/jobs/job_001?goal=goal_ai_pm');
    var stale1 = await evaluate("document.querySelector('#ca-view').textContent.indexOf('当前评估可能过期') >= 0");
    var snapshotShown = await evaluate("document.querySelector('.ca-compare').textContent.indexOf('智能客服知识库问答项目') >= 0");
    await shot('A04-job-stale-desktop', true);
    await hash('#/jobs/job_002?goal=goal_ai_pm');
    var stale2 = await evaluate("document.querySelector('#ca-view').textContent.indexOf('当前评估可能过期') >= 0");
    await hash('#/jobs/job_003?goal=goal_b2b_pm');
    var stale3 = await evaluate("document.querySelector('#ca-view').textContent.indexOf('当前评估可能过期') >= 0");
    assert(stale1 && stale2 && !stale3 && snapshotShown, '过期判定错误：' + [stale1, stale2, stale3, snapshotShown].join(','));

    await hash('#/vault/asset_002');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-body', '访谈 12 位区域销售，重做指标口径与权限分层（演示修订）。')");
    await evaluate("(function(){var c=document.querySelector('#asset-confirm'); c.checked=true; c.dispatchEvent(new Event('change')); return true;})()");
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '勾选保存完成');
    var a2 = await evaluate("__t.asset('asset_002')");
    assert(a2.revision === 2 && a2.provenance.userConfirmed === true && a2.provenance.sourceIds.length === 2, '勾选确认保存结果错误');

    await hash('#/vault/asset_004');
    await helpers();
    var src4 = await evaluate('__t.stored().data.sources.length');
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("(function(){var c=document.querySelector('#asset-confirm'); c.checked=true; c.dispatchEvent(new Event('change')); return true;})()");
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '仅确认保存完成');
    var a4 = await evaluate("__t.asset('asset_004')");
    var src4After = await evaluate('__t.stored().data.sources.length');
    var evAfter = await evaluate('__t.stored().data.events.length');
    assert(a4.revision === 2 && a4.provenance.userConfirmed === true && src4After === src4 && a4.provenance.sourceIds.length === 1, '仅确认结果错误');
    assert(evAfter === evBefore + 3, '事件数量 ' + evBefore + '→' + evAfter);
    return 'asset_001 未勾选：r1→r2、待确认、来源 1→2、刷新恢复；job_001/job_002 评估显示过期且快照仍为原内容，job_003 未误标；asset_002 勾选：r2 已确认；asset_004 仅确认：r2 已确认、来源不增；共新增 3 条 career_asset.revised';
  });

  await check('A06', '草稿离开保护与取消编辑', async function () {
    await hash('#/vault/asset_003');
    await helpers();
    var evBefore = await evaluate('__t.stored().data.events.length');
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '草稿标题（不应保存）')");
    await evaluate("__t.click('.ca-nav__link', '求职进展')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '离开确认框');
    await shot('A06-leave-guard-desktop');
    await evaluate("__t.click('dialog.ca-dialog button', '继续编辑')");
    await sleep(200);
    var h1 = await evaluate('location.hash');
    var draft = await evaluate("document.querySelector('#asset-title') && document.querySelector('#asset-title').value");
    assert(h1 === '#/vault/asset_003' && draft === '草稿标题（不应保存）', '取消离开后草稿丢失：' + h1 + ' ' + draft);

    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '目标切换确认框');
    await evaluate("__t.click('dialog.ca-dialog button', '继续编辑')");
    await sleep(250);
    var goalKept = await evaluate("document.querySelector('#ca-goal-select').value");
    var draft2 = await evaluate("document.querySelector('#asset-title').value");
    assert(goalKept === 'goal_ai_pm' && draft2 === '草稿标题（不应保存）', '目标切换保护失败');

    await send('Runtime.evaluate', { expression: "document.querySelector('#asset-title').focus()" });
    await send('Input.insertText', { text: '！' });
    await sleep(100);
    dialogs = [];
    send('Page.reload', {});
    await sleep(800);
    var beforeUnload = dialogs.indexOf('beforeunload') >= 0;
    await helpers();
    var stillDraft = await evaluate("document.querySelector('#asset-title') && document.querySelector('#asset-title').value");

    await evaluate("__t.click('.ca-nav__link', '求职进展')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '离开确认框 2');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await sleep(250);
    var h2 = await evaluate('location.hash');
    var a3 = await evaluate("__t.asset('asset_003')");
    assert(h2 === '#/home' && a3.revision === 1 && a3.title.indexOf('草稿') < 0, '放弃后状态错误');

    await hash('#/vault/asset_003');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-body', '取消前的修改')");
    await evaluate("__t.click('form.ca-form button', '取消')");
    await sleep(200);
    var a3b = await evaluate("__t.asset('asset_003')");
    var evAfter = await evaluate('__t.stored().data.events.length');
    assert(a3b.revision === 1 && evAfter === evBefore && !(await evaluate("!!document.querySelector('form.ca-form')")), '取消编辑产生了写入');

    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '无变化保存');
    var a3c = await evaluate("__t.asset('asset_003')");
    var evNoop = await evaluate('__t.stored().data.events.length');
    assert(a3c.revision === 1 && evNoop === evBefore && a3c.provenance.userConfirmed === true, '无变化保存产生了写入或撤销了确认');
    return '导航离开→“继续编辑”保留地址与草稿；目标切换→“继续编辑”保持原目标与草稿；刷新保护 beforeunload ' + (beforeUnload ? '已触发并取消（草稿仍在：' + (stillDraft ? '是' : '否') + '）' : '未在无头环境触发，未验证') + '；“放弃修改并离开”后 revision 仍 1；取消编辑与无变化保存均不增 revision、不写事件、不撤销确认';
  });

  await check('A08-reset', '正常存储下取消重置不变，确认重置只恢复本应用', async function () {
    await evaluate("localStorage.setItem('other-app.keep', 'keep-me'); true");
    await hash('#/home');
    await helpers();
    var raw = await evaluate("localStorage.getItem('" + KEY + "')");
    await evaluate("document.querySelector('#ca-reset').click()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '重置确认框');
    await shot('A08-reset-confirm-desktop');
    await evaluate("__t.click('dialog.ca-dialog button', '取消')");
    await sleep(200);
    assert((await evaluate("localStorage.getItem('" + KEY + "')")) === raw, '取消重置改变了数据');
    await evaluate("document.querySelector('#ca-reset').click()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '重置确认框 2');
    await evaluate("__t.click('dialog.ca-dialog button', '确认重置')");
    await waitFor("(function(){var a=__t.asset('asset_001'); return a && a.revision===1;})()", 3000, '重置完成');
    var keep = await evaluate("localStorage.getItem('other-app.keep')");
    var m = await evaluate("__t.all('.ca-metric__value')");
    assert(keep === 'keep-me' && m.join('/') === '2/1/1/1', '重置影响了其他键或指标异常');
    return '取消后存储原串不变；确认后 asset_001 回到 revision 1、指标 2/1/1/1；其他键 other-app.keep 保留';
  });

  await check('A09', '桌面与窄屏布局、键盘操作、标签', async function () {
    await hash('#/home');
    await helpers();
    await evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0,0); true");
    await send('Runtime.evaluate', { expression: "document.body.focus()" });
    var seq = [];
    var focusStyle = '';
    for (var i = 0; i < 30; i++) {
      await key('Tab');
      seq.push(await evaluate("(function(){var e=document.activeElement; return e.tagName + ':' + (e.id || e.textContent.trim().replace(/\\s+/g,'').slice(0,8));})()"));
      if (seq[seq.length - 1].indexOf('跳到主要内容') >= 0) {
        focusStyle = await evaluate("(function(){var e=document.activeElement; var s=getComputedStyle(e); return e.matches(':focus-visible') + ' ' + s.outlineStyle + ' ' + s.outlineWidth;})()");
      }
      if (seq[seq.length - 1].indexOf('职业资产') >= 0) break;
    }
    var onNav = await evaluate("document.activeElement.textContent.trim()");
    assert(onNav.indexOf('职业资产') >= 0, 'Tab 未到达导航：' + seq.join(' | '));
    var navFocus = await evaluate("(function(){var e=document.activeElement; var s=getComputedStyle(e); return e.matches(':focus-visible') + ' ' + s.outlineStyle + ' ' + s.outlineWidth;})()");
    focusStyle = focusStyle + '；导航链接 ' + navFocus;
    await key('Enter');
    await sleep(300);
    var afterEnter = await evaluate('location.hash');
    assert(afterEnter === '#/vault', '键盘回车导航失败：' + onNav + ' → ' + afterEnter);

    var unlabeled = await evaluate("Array.prototype.filter.call(document.querySelectorAll('input, select, textarea'), function(el){ return !(el.id && document.querySelector('label[for=\"' + el.id + '\"]')) && !el.getAttribute('aria-label'); }).length");
    await hash('#/vault/asset_001');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(150);
    var focusedField = await evaluate('document.activeElement.id');
    var unlabeledForm = await evaluate("Array.prototype.filter.call(document.querySelectorAll('input, select, textarea'), function(el){ return !(el.id && document.querySelector('label[for=\"' + el.id + '\"]')) && !el.getAttribute('aria-label'); }).length");
    await evaluate("__t.click('form.ca-form button', '取消')");
    await sleep(150);
    assert(unlabeled === 0 && unlabeledForm === 0, '存在无标签控件');

    await viewport(390, 844);
    var overflow = [];
    var pages = [['#/home', 'A09-home-narrow'], ['#/vault/asset_001?fromJob=job_001&goal=goal_ai_pm&rev=1', 'A09-vault-detail-narrow'], ['#/jobs/job_002?goal=goal_ai_pm', 'A09-job-detail-narrow'], ['#/jobs', 'A09-job-list-narrow']];
    for (var k = 0; k < pages.length; k++) {
      await hash(pages[k][0]);
      await evaluate('window.scrollTo(0,0); true');
      var sw = await evaluate('document.documentElement.scrollWidth');
      if (sw > 391) overflow.push(pages[k][0] + '=' + sw);
      await shot(pages[k][1], true);
    }
    await viewport(1440, 900);
    assert(!overflow.length, '窄屏横向溢出：' + overflow.join('、'));
    return 'Tab 顺序：' + seq.join(' → ') + '；焦点样式 ' + focusStyle + '；在“' + onNav + '”回车进入 #/vault；进入编辑后焦点在 #' + focusedField + '；所有输入/选择控件均有 label；390px 下 4 个页面无横向溢出';
  });

  var normalErrors = appErrors.slice();
  await check('A11-normal', '正常流程无未处理的应用 JS 错误', async function () {
    assert(!normalErrors.length, normalErrors.join('\n'));
    return '应用 JS 错误 0 条；本轮 CDN 加载失败记录：' + (cdnFailed.length ? cdnFailed.join('、') : '无') + '；网络/资源类错误 ' + networkErrors.length + ' 条（单独记录，非应用错误）';
  });

  // ---------- 阻断 CDN ----------
  await check('A11-cdn', '阻断样式与图标 CDN 后页面仍可理解', async function () {
    await send('Network.setBlockedURLs', { urls: ['*cdn.tailwindcss.com*', '*cdn.jsdelivr.net*'] });
    appErrors = [];
    networkErrors = [];
    await goto(ENTRY + '?cdn=blocked#/jobs/job_001?goal=goal_ai_pm');
    await helpers();
    var warn = await evaluate("(function(){var e=document.querySelector('#ca-asset-warning'); return e && !e.hidden ? e.textContent : null;})()");
    var btnTexts = await evaluate("__t.all('.ca-btn').filter(function(t){return t.length>0;}).length === document.querySelectorAll('.ca-btn').length");
    await shot('A11-cdn-blocked-desktop', true);
    await send('Network.setBlockedURLs', { urls: [] });
    assert(warn && warn.indexOf('Tailwind') >= 0 && warn.indexOf('Font Awesome') >= 0, '未显示 CDN 失败提示：' + warn);
    assert(btnTexts, '存在只有图标没有文字的按钮');
    assert(!appErrors.length, '阻断 CDN 后出现应用错误：' + appErrors.join('；'));
    return '提示：“' + warn.trim() + '”；按钮均有文字；应用 JS 错误 0 条；预期的资源网络错误 ' + networkErrors.length + ' 条';
  });

  // ---------- 隔离测试场景 ----------
  await check('A07', '空／加载／读取失败与重试', async function () {
    await goto(ENTRY + '?test=empty#/home');
    await helpers();
    var emptyText = await evaluate("document.querySelector('#ca-view').textContent");
    var m = await evaluate("__t.all('.ca-metric__value')");
    await shot('A07-empty-home-desktop', true);
    await hash('#/jobs');
    var emptyJobs = await evaluate("document.querySelector('#ca-view').textContent.indexOf('还没有收藏岗位') >= 0");
    assert(emptyText.indexOf('当前目标暂无待办') >= 0 && m.join('/') === '0/0/0/0' && emptyJobs, '空状态不正确');

    var loaded = waitEvent('Page.loadEventFired', 30000).catch(function () {
      return null;
    });
    await send('Page.navigate', { url: freshUrl(ENTRY + '?test=slow#/home') });
    await loaded;
    await waitFor("document.querySelector('.ca-state--loading') && document.querySelector('.ca-state--loading').textContent.indexOf('正在读取') >= 0", 3000, '加载状态');
    await shot('A07-loading-desktop');
    await waitFor("document.querySelector('.ca-metric__value')", 5000, '慢加载完成');

    await goto(ENTRY + '?test=load_error#/home');
    await helpers();
    var errText = await evaluate("__t.text('.ca-state--error')");
    await shot('A07-load-error-desktop');
    await evaluate("__t.click('button', '重试读取')");
    await waitFor("document.querySelector('.ca-metric__value')", 3000, '重试后加载');
    assert(errText.indexOf('读取演示数据失败') >= 0, '失败状态缺失');
    return '空数据集：首页“当前目标暂无待办”、指标 0/0/0/0、岗位页“还没有收藏岗位”；慢读取显示“正在读取本地演示数据…”；读取失败显示错误与“重试读取”，重试后恢复';
  });

  await check('A08-unavailable', '启动时存储不可用：只读，禁用保存与重置', async function () {
    await goto(ENTRY + '?test=unavailable#/vault/asset_001');
    await helpers();
    var banner = await evaluate("__t.text('#ca-banners')");
    var editDisabled = await evaluate("__t.byText('button', '编辑资产').disabled");
    var resetDisabled = await evaluate("document.querySelector('#ca-reset').disabled");
    await shot('A08-unavailable-desktop');
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await sleep(300);
    var hint = await evaluate("__t.text('#ca-goal-hint')");
    var toastText = await evaluate("__t.all('.ca-toast').join(' ')");
    await reload();
    var afterReload = await evaluate("document.querySelector('#ca-goal-select').value");
    assert(banner.indexOf('本地保存不可用，当前仅供浏览') >= 0 && editDisabled && resetDisabled, '只读提示或禁用状态错误');
    assert(toastText.indexOf('刷新后不保留') >= 0 && hint.indexOf('刷新后不保留') >= 0 && afterReload === 'goal_ai_pm', '临时目标切换说明错误');
    return '显示“本地保存不可用，当前仅供浏览”；编辑与重置按钮禁用；目标可临时切换并提示“刷新后不保留”，刷新后回到 goal_ai_pm';
  });

  await check('A08-corrupt', '损坏／不兼容数据保留原串，确认重置后恢复', async function () {
    await goto(ENTRY + '?test=corrupt#/home');
    await helpers();
    var rawBefore = await evaluate('CareerAgentTest.peekStored()');
    var banner = await evaluate("__t.text('#ca-banners')");
    await shot('A08-corrupt-desktop');
    await hash('#/vault/asset_001');
    var editDisabled = await evaluate("__t.byText('button', '编辑资产').disabled");
    await evaluate("__t.click('#ca-banners button', '确认重置')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '重置确认框');
    await evaluate("__t.click('dialog.ca-dialog button', '取消')");
    await sleep(200);
    var rawAfterCancel = await evaluate('CareerAgentTest.peekStored()');
    await evaluate("__t.click('#ca-banners button', '确认重置')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '重置确认框 2');
    await evaluate("__t.click('dialog.ca-dialog button', '确认重置')");
    await waitFor("__t.text('#ca-banners').indexOf('原数据已保留') < 0", 3000, '重置后恢复');
    var editEnabled = await evaluate("!__t.byText('button', '编辑资产').disabled");
    assert(banner.indexOf('原数据已保留') >= 0 && editDisabled && rawAfterCancel === rawBefore && editEnabled, '损坏数据处理异常');

    await goto(ENTRY + '?test=incompatible#/home');
    await helpers();
    var banner2 = await evaluate("__t.text('#ca-banners')");
    var raw2 = await evaluate('CareerAgentTest.peekStored()');
    assert(banner2.indexOf('版本不兼容') >= 0 && raw2.indexOf('9.9') >= 0, '不兼容版本处理异常');
    return '损坏：提示“原数据已保留、未被覆盖”，编辑禁用，取消重置后原串不变，确认重置后恢复可编辑；不兼容版本同样只读、原串保留（schemaVersion 9.9）';
  });

  await check('A08-runtime', '运行中写入失败保留草稿；外部标签页改动后暂停写入', async function () {
    await goto(ENTRY + '?test=isolated#/vault/asset_001');
    await helpers();
    var before = await evaluate('CareerAgentTest.peekStored()');
    await evaluate('CareerAgentTest.failWrites(true)');
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '写入失败测试标题')");
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("document.querySelector('.ca-form-error') && !document.querySelector('.ca-form-error').hidden", 3000, '失败提示');
    var errText = await evaluate("__t.text('.ca-form-error')");
    var draft = await evaluate("document.querySelector('#asset-title').value");
    var after = await evaluate('CareerAgentTest.peekStored()');
    var banner = await evaluate("__t.text('#ca-banners')");
    await shot('A08-write-failed-desktop', true);
    assert(errText.indexOf('重试保存') >= 0, '失败提示缺少重试入口：' + errText);
    assert(errText.indexOf('未保存') >= 0 && draft === '写入失败测试标题' && after === before && banner.indexOf('仅供浏览') < 0, '写入失败处理异常');
    await evaluate('CareerAgentTest.failWrites(false)');
    await evaluate("__t.click('.ca-form-error button', '重试保存')");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '重试成功');
    var saved = JSON.parse(await evaluate('CareerAgentTest.peekStored()'));
    var a1 = saved.data.assets.filter(function (a) { return a.id === 'asset_001'; })[0];
    var revEvents = saved.data.events.filter(function (e) { return e.type === 'career_asset.revised'; }).length;
    assert(a1.revision === 2 && revEvents === 1, '重试结果错误');

    await evaluate('CareerAgentTest.simulateExternalChange()');
    await sleep(200);
    var banner2 = await evaluate("__t.text('#ca-banners')");
    await shot('A08-external-change-desktop');
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await sleep(300);
    var toastText = await evaluate("__t.all('.ca-toast').join(' ')");
    var stored = await evaluate('CareerAgentTest.peekStored()');
    assert(banner2.indexOf('其他标签页修改') >= 0 && stored === '{"externalTab":true}', '外部改动处理异常');
    return '写入失败：显示“未保存”+重试，草稿保留，存储原串不变，未降级为只读；重试复用同一操作后 r2、仅 1 条事件；外部改动：显示暂停保存并提示重新加载，之后写入被拒绝' + (toastText.indexOf('已暂停保存') >= 0 || toastText.indexOf('未切换') >= 0 ? '（目标切换被拒绝）' : '（目标选择器已禁用）') + '，外部数据未被覆盖';
  });

  await check('A10', 'Demo 标记、来源、确认状态与占位文案', async function () {
    await goto(ENTRY + '?test=isolated#/jobs/job_001?goal=goal_ai_pm');
    await helpers();
    var header = await evaluate("__t.text('.ca-header')");
    var nav = await evaluate("__t.text('.ca-nav')");
    var jobText = await evaluate("document.querySelector('#ca-view').textContent");
    await hash('#/vault/asset_004');
    var vaultText = await evaluate("document.querySelector('#ca-view').textContent");
    var banned = ['已同步', '云端保存成功', '投递成功', '生成成功', '上传成功', '准确率'];
    var all = header + nav + jobText + vaultText;
    var found = banned.filter(function (w) { return all.indexOf(w) >= 0 && all.indexOf('不代表内容真实性或模型准确率') < 0 && all.indexOf('不是模型准确率') < 0; });
    assert(header.indexOf('合成演示数据') >= 0 && nav.indexOf('当前浏览器本地') >= 0, '缺少 Demo 或保存位置标记');
    assert(jobText.indexOf('演示评估') >= 0 && jobText.indexOf('非模型实时分析') >= 0 && jobText.indexOf('待核实') >= 0, '评估标记缺失');
    assert(vaultText.indexOf('待确认：以下内容尚未经用户核实') >= 0 && vaultText.indexOf('演示值，不代表内容真实性或模型准确率') >= 0, '待确认或置信度说明缺失');
    assert(!found.length, '出现不当表述：' + found.join('、'));
    return '顶栏“合成演示数据｜Demo Beta”；导航“保存位置：当前浏览器本地（不同步云端）”；评估标“演示评估：演示预置，非模型实时分析”，待确认证据标“待核实”；待确认资产明确“尚未经用户核实”，置信度注明演示值；未出现成功/同步/准确率类表述';
  });

  // ---------- FIX1 回归：草稿生命周期与结构损坏 ----------
  await check('F01', '放弃草稿后取消重置：草稿可继续编辑并保存', async function () {
    appErrors = [];
    await goto(ENTRY + '?test=isolated#/vault/asset_001');
    await helpers();
    var rawBefore = await evaluate('CareerAgentTest.peekStored()');
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '重置取消后应仍可编辑')");
    await evaluate("document.querySelector('#ca-reset').click()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '草稿离开确认');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]') && document.querySelector('#ca-dialog-title').textContent.indexOf('重置') >= 0", 2000, '重置确认框');
    await evaluate("__t.click('dialog.ca-dialog button', '取消')");
    await sleep(250);
    assert(await evaluate("!!document.querySelector('form.ca-form')"), '取消重置后表单应仍可见');
    assert(await evaluate("document.querySelector('#asset-title').value") === '重置取消后应仍可编辑', '草稿标题丢失');
    await evaluate("__t.fill('#asset-title', '重置取消后继续修改并保存')");
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '保存完成');
    var a1 = await evaluate("__t.asset('asset_001')");
    assert(a1.revision === 2 && a1.title === '重置取消后继续修改并保存', '保存结果错误');
    assert(await evaluate('CareerAgentTest.peekStored()') !== rawBefore, '应已写入存储');
    assert(!appErrors.length, '有 JS 错误：' + appErrors.join('；'));
    await shot('F01-cancel-reset-keep-draft-desktop', true);
    return '放弃草稿后取消重置：表单仍可见且可继续输入；保存成功 r2；无 JS 错误；取消重置期间未提前清空草稿';
  });

  await check('F02', '目标切换写入失败：目标不变，草稿可恢复保存', async function () {
    appErrors = [];
    await goto(ENTRY + '?test=isolated#/vault/asset_002');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '切换失败后应保留的草稿')");
    await evaluate('CareerAgentTest.failWrites(true)');
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '草稿离开确认');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await sleep(400);
    var goal = await evaluate("document.querySelector('#ca-goal-select').value");
    var formOk = await evaluate("!!document.querySelector('form.ca-form') && document.querySelector('#asset-title').value==='切换失败后应保留的草稿'");
    assert(goal === 'goal_ai_pm' && formOk, '目标或草稿状态错误：goal=' + goal);
    await evaluate("__t.fill('#asset-title', '切换失败后继续保存')");
    await evaluate('CareerAgentTest.failWrites(false)');
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '保存完成');
    var a2 = await evaluate("__t.asset('asset_002')");
    assert(a2.revision === 2 && a2.title === '切换失败后继续保存', '恢复写入后保存失败');
    assert(!appErrors.length, '有 JS 错误：' + appErrors.join('；'));
    await shot('F02-goal-switch-fail-keep-draft-desktop', true);
    return '切换目标并允许离开后写入失败：目标仍为 goal_ai_pm；草稿保留可继续输入；解除故障后保存成功 r2；无失效表单／JS 错误';
  });

  await check('F03', '确认重置但写入失败：数据与草稿均保留', async function () {
    appErrors = [];
    await goto(ENTRY + '?test=isolated#/vault/asset_003');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '重置写失败应保留草稿')");
    await evaluate('CareerAgentTest.failWrites(true)');
    await evaluate("document.querySelector('#ca-reset').click()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '草稿离开确认');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]') && document.querySelector('#ca-dialog-title').textContent.indexOf('重置') >= 0", 2000, '重置确认框');
    await evaluate("__t.click('dialog.ca-dialog button', '确认重置')");
    await sleep(400);
    var toast = await evaluate("__t.all('.ca-toast').join(' ')");
    var formOk = await evaluate("!!document.querySelector('form.ca-form') && document.querySelector('#asset-title').value==='重置写失败应保留草稿'");
    var a3 = await evaluate("__t.asset('asset_003')");
    assert(formOk && a3.revision === 1 && a3.title.indexOf('产品助理') >= 0, '重置失败后状态错误');
    assert(toast.indexOf('重置未完成') >= 0, '缺少失败提示：' + toast);
    await evaluate('CareerAgentTest.failWrites(false)');
    await evaluate("__t.fill('#asset-title', '重置写失败后最终保存')");
    await evaluate("document.querySelector('form.ca-form').requestSubmit()");
    await waitFor("!document.querySelector('form.ca-form')", 3000, '保存完成');
    var saved = await evaluate("__t.asset('asset_003')");
    assert(saved.revision === 2 && saved.title === '重置写失败后最终保存', '恢复后保存失败');
    assert(!appErrors.length, '有 JS 错误：' + appErrors.join('；'));
    await shot('F03-reset-write-fail-keep-draft-desktop', true);
    return '确认重置但写入失败：已提交资产仍为 r1；草稿表单保留；解除故障后可保存到 r2；无 JS 错误';
  });

  await check('F04', '成功重置／切换路径，以及普通导航放弃／继续编辑', async function () {
    appErrors = [];
    await goto(ENTRY + '?test=isolated#/vault/asset_001');
    await helpers();
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '将被成功重置丢弃')");
    await evaluate("document.querySelector('#ca-reset').click()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '草稿离开');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]') && document.querySelector('#ca-dialog-title').textContent.indexOf('重置') >= 0", 2000, '重置确认');
    await evaluate("__t.click('dialog.ca-dialog button', '确认重置')");
    await waitFor("(function(){var a=__t.asset('asset_001'); return a && a.revision===1 && a.title.indexOf('智能客服')===0;})()", 3000, '重置完成');
    assert(!(await evaluate("!!document.querySelector('form.ca-form')")), '成功重置后表单应关闭');

    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '将被成功切换丢弃')");
    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_b2b_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '切换离开确认');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await waitFor("document.querySelector('#ca-goal-select').value==='goal_b2b_pm'", 3000, '目标已切换');
    assert(!(await evaluate("!!document.querySelector('form.ca-form')")), '成功切换后表单应关闭');
    assert((await evaluate("__t.asset('asset_001')")).revision === 1, '成功切换不应写入资产');

    await evaluate("(function(){var s=document.querySelector('#ca-goal-select'); s.value='goal_ai_pm'; s.dispatchEvent(new Event('change')); return true;})()");
    await waitFor("document.querySelector('#ca-goal-select').value==='goal_ai_pm'", 3000, '切回目标一');
    await evaluate("__t.click('button', '编辑资产')");
    await sleep(120);
    await evaluate("__t.fill('#asset-title', '导航继续编辑草稿')");
    await evaluate("__t.click('.ca-nav__link', '求职进展')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '导航离开');
    await evaluate("__t.click('dialog.ca-dialog button', '继续编辑')");
    await sleep(200);
    assert((await evaluate('location.hash')) === '#/vault/asset_001', '继续编辑应留在资产页');
    assert((await evaluate("document.querySelector('#asset-title').value")) === '导航继续编辑草稿', '继续编辑草稿丢失');
    await evaluate("__t.click('.ca-nav__link', '求职进展')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '导航放弃');
    await evaluate("__t.click('dialog.ca-dialog button', '放弃修改并离开')");
    await sleep(250);
    assert((await evaluate('location.hash')) === '#/home', '放弃后应离开');
    assert((await evaluate("__t.asset('asset_001')")).revision === 1, '放弃导航不应写入');
    assert(!appErrors.length, '有 JS 错误：' + appErrors.join('；'));
    return '成功重置恢复种子并关闭表单；成功切换目标并关闭表单且不写资产；导航“继续编辑”保留草稿，“放弃”后离开且 revision 仍为 1';
  });

  await check('F05-browser', 'evidence=null 进入 invalid_data，岗位页不崩溃', async function () {
    appErrors = [];
    await goto(ENTRY + '?test=bad_evidence#/jobs/job_001?goal=goal_ai_pm');
    await helpers();
    var raw = await evaluate('CareerAgentTest.peekStored()');
    var banner = await evaluate("__t.text('#ca-banners')");
    var jobText = await evaluate("document.querySelector('#ca-view').textContent");
    var renderCrash = jobText.indexOf('页面渲染出错') >= 0;
    assert(banner.indexOf('原数据已保留') >= 0, '未进入 invalid_data 提示：' + banner);
    assert(!renderCrash, '岗位页仍渲染崩溃：' + jobText.slice(0, 120));
    assert(raw.indexOf('"evidence":null') >= 0, '原串未保留 evidence:null');
    await hash('#/vault/asset_001');
    await sleep(200);
    assert(await evaluate("__t.byText('button', '编辑资产').disabled"), '损坏数据下编辑应禁用');
    await evaluate("__t.click('#ca-banners button', '确认重置')");
    await waitFor("document.querySelector('dialog.ca-dialog[open]')", 2000, '重置确认');
    await evaluate("__t.click('dialog.ca-dialog button', '取消')");
    await sleep(200);
    assert((await evaluate('CareerAgentTest.peekStored()')) === raw, '取消重置改动了原串');
    await shot('F05-invalid-evidence-desktop', true);
    assert(!appErrors.some(function (e) { return e.indexOf('length') >= 0 || e.indexOf('TypeError') >= 0; }), '仍有结构相关 JS 错误：' + appErrors.join('；'));
    return 'evidence=null 加载为 invalid_data，横幅提示原数据保留；岗位页不崩溃；编辑禁用；取消重置原串不变';
  });

  var summary = {
    runAt: new Date().toISOString(),
    chrome: path.basename(CHROME) + ' (headless=new, remote-debugging-pipe)',
    entry: 'file://…/app/index.html',
    results: results,
    appErrorsAfterNormal: normalErrors,
    networkErrorsLastRun: networkErrors
  };
  fs.writeFileSync(path.join(OUT, 'browser-check-result.json'), JSON.stringify(summary, null, 2));
  var failed = results.filter(function (r) { return !r.ok; }).length;
  console.log('\n共 ' + results.length + ' 组，通过 ' + (results.length - failed) + ' 组，失败 ' + failed + ' 组。截图目录：assets/screenshots/phase1/');
  return failed;
}

function cleanup(code) {
  try {
    child.kill('SIGTERM');
  } catch (e) {}
  setTimeout(function () {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (e) {}
    process.exit(code);
  }, 600);
}

var overall = setTimeout(function () {
  console.error('整体超时');
  cleanup(2);
}, 240000);

main().then(
  function (failed) {
    clearTimeout(overall);
    cleanup(failed ? 1 : 0);
  },
  function (err) {
    clearTimeout(overall);
    console.error('脚本出错：' + err.stack);
    cleanup(2);
  }
);
