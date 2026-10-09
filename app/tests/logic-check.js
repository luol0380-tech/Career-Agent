#!/usr/bin/env node
// 第一阶段纯逻辑校验：在 Node 的隔离上下文加载 domain／fixtures／data 脚本，使用内存存储驱动，
// 不访问浏览器、不启动服务。用法：node app/tests/logic-check.js
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = path.resolve(__dirname, '..');
var FILES = [
  'domain/constants.js',
  'domain/validate.js',
  'domain/selectors.js',
  'fixtures/demo-data.js',
  'data/storage.js',
  'data/workspace.js',
  'data/phase2-commands.js',
  'data/phase3-commands.js',
  'lib/revise-suggestions.js',
  'lib/revise-prompt.js',
  'lib/ai-provider.js'
];

function loadApp() {
  var ctx = vm.createContext({ setTimeout: setTimeout, console: console, URLSearchParams: URLSearchParams });
  FILES.forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(APP, file), 'utf8'), ctx, { filename: file });
  });
  return ctx.CareerAgent;
}

var CA = loadApp();
var C = CA.domain.constants;
var S = CA.domain.selectors;
var results = [];

function assert(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
}

function makeService(opts) {
  opts = opts || {};
  var driver = CA.data.storage.createMemoryDriver({
    preload: opts.preload || {},
    probeFails: !!opts.probeFails,
    failBusinessWrites: !!opts.failBusinessWrites
  });
  var tick = 0;
  var service = CA.data.createWorkspaceService({
    driver: driver,
    hooks: opts.hooks || { loadDelayMs: 0, failLoads: 0 },
    clock: function () {
      tick += 1;
      return '2026-09-29T10:' + String(tick).padStart(2, '0') + ':00+08:00';
    }
  });
  return { service: service, driver: driver };
}

async function expectReject(promise, code, message) {
  try {
    await promise;
  } catch (err) {
    assert(err.code === code, message + '（期望 ' + code + '，实际 ' + err.code + '）');
    return err;
  }
  throw new Error('断言失败：' + message + '（未被拒绝）');
}

function counts(ws) {
  return {
    sources: ws.data.sources.length,
    events: ws.data.events.length,
    revision: S.asset(ws.data, 'asset_001').revision
  };
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name: name, ok: true });
  } catch (err) {
    results.push({ name: name, ok: false, error: err.message });
  }
}

(async function main() {
  await test('fixture 通过完整校验且每次返回独立副本', async function () {
    var a = CA.fixtures.demo.createEnvelope();
    var errors = CA.domain.validate.validateEnvelope(a);
    assert(errors.length === 0, errors.join('\n'));
    a.data.assets[0].title = '被改动';
    var b = CA.fixtures.demo.createEnvelope();
    assert(b.data.assets[0].title !== '被改动', 'fixture 不应被副本修改影响');
    assert(b.data.assets.length >= 4 && b.data.jobs.length >= 3 && b.data.goals.length === 2, '数据量不足');
  });

  await test('A12 初始指标：目标一 2/1/1/1，目标二 1/1/0/0', async function () {
    var data = CA.fixtures.demo.createEnvelope().data;
    var m1 = S.goalMetrics(data, 'goal_ai_pm');
    var m2 = S.goalMetrics(data, 'goal_b2b_pm');
    assert(JSON.stringify([m1.analyzedJobs, m1.submitted, m1.hrReplies, m1.completedInterviews]) === '[2,1,1,1]', JSON.stringify(m1));
    assert(JSON.stringify([m2.analyzedJobs, m2.submitted, m2.hrReplies, m2.completedInterviews]) === '[1,1,0,0]', JSON.stringify(m2));
  });

  await test('A02 岗位与待办按目标过滤，目标二不含二面排期待办', async function () {
    var data = CA.fixtures.demo.createEnvelope().data;
    var j1 = S.jobsForGoal(data, 'goal_ai_pm').map(function (j) { return j.id; });
    var j2 = S.jobsForGoal(data, 'goal_b2b_pm').map(function (j) { return j.id; });
    assert(j1.join() === 'job_001,job_002' && j2.join() === 'job_003', '岗位过滤错误');
    var a2 = S.openActionItemsForGoal(data, 'goal_b2b_pm');
    assert(a2.every(function (ai) { return ai.goalId === 'goal_b2b_pm' && ai.interviewId !== 'interview_002'; }), '目标二混入了目标一待办');
    assert(a2.every(function (ai) { return ai.status === 'open'; }), '已完成待办不应出现');
  });

  await test('首次加载写入种子并在刷新后恢复；目标选择持久化且不改历史 goalId', async function () {
    var t = makeService();
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'available', '应为 available');
    var appsBefore = JSON.stringify(ws.data.applications);
    await t.service.selectGoal('goal_b2b_pm');
    var reload = CA.data.createWorkspaceService({ driver: t.driver });
    var ws2 = await reload.loadWorkspace();
    assert(ws2.ui.selectedGoalId === 'goal_b2b_pm', '刷新后目标未恢复');
    assert(JSON.stringify(ws2.data.applications) === appsBefore, 'Application 被改写');
    assert(ws2.data.events.length === ws.data.events.length, '切换目标不应写业务事件');
    await expectReject(reload.selectGoal('goal_unknown'), 'invalid_goal', '未知目标应被拒绝');
  });

  await test('A04 修改内容未勾选确认：revision+1、新增 manual_entry 来源、待确认、旧评估过期且快照不变', async function () {
    var t = makeService();
    var ws = await t.service.loadWorkspace();
    var before = counts(ws);
    var snapBefore = JSON.stringify(ws.data.assessments);
    var res = await t.service.updateCareerAsset({
      assetId: 'asset_001', expectedRevision: 1, title: '智能客服知识库问答项目（修订）',
      body: S.asset(ws.data, 'asset_001').body, confirmFacts: false, commandId: 'cmd_a'
    });
    assert(res.status === 'saved' && res.newRevision === 2, JSON.stringify(res));
    var after = await CA.data.createWorkspaceService({ driver: t.driver }).loadWorkspace();
    var asset = S.asset(after.data, 'asset_001');
    assert(asset.revision === 2 && asset.provenance.userConfirmed === false && asset.provenance.confirmedAt === null, '确认状态错误');
    assert(asset.provenance.sourceIds.length === 2 && asset.provenance.sourceIds[0] === 'src_asset_001', '旧来源应保留');
    var src = S.source(after.data, asset.provenance.sourceIds[1]);
    assert(src.kind === 'manual_entry', '新来源类型错误');
    assert(S.source(after.data, 'src_asset_001').rawText === S.source(ws.data, 'src_asset_001').rawText, '原始来源被改写');
    assert(after.data.sources.length === before.sources + 1 && after.data.events.length === before.events + 1, '来源或事件数量错误');
    var ev = after.data.events[after.data.events.length - 1];
    assert(ev.type === 'career_asset.revised' && ev.payload.previousRevision === 1 && ev.payload.newRevision === 2 && ev.payload.changedFields.join() === 'title', '事件载荷错误');
    assert(JSON.stringify(after.data.assessments) === snapBefore, '评估快照被改写');
    assert(S.assessmentStaleness(after.data, S.latestAssessment(after.data, 'job_001', 'goal_ai_pm')).isStale, 'assess_001 应过期');
    assert(S.assessmentStaleness(after.data, S.latestAssessment(after.data, 'job_002', 'goal_ai_pm')).isStale, 'assess_002 应过期');
    assert(!S.assessmentStaleness(after.data, S.latestAssessment(after.data, 'job_003', 'goal_b2b_pm')).isStale, 'assess_003 不应被误标过期');
  });

  await test('A04 修改内容并勾选确认：新版本已确认', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var res = await t.service.updateCareerAsset({
      assetId: 'asset_002', expectedRevision: 1, title: '销售数据看板改版', body: '新的正文内容（演示）', confirmFacts: true, commandId: 'cmd_b'
    });
    var ws = await t.service.readWorkspace();
    var asset = S.asset(ws.data, 'asset_002');
    assert(res.newRevision === 2 && asset.provenance.userConfirmed === true && asset.provenance.confirmedAt !== null, '应为已确认');
  });

  await test('A04 仅确认待确认资产：revision+1，不新增来源', async function () {
    var t = makeService();
    var ws = await t.service.loadWorkspace();
    var a4 = S.asset(ws.data, 'asset_004');
    var res = await t.service.updateCareerAsset({
      assetId: 'asset_004', expectedRevision: 1, title: a4.title, body: a4.body, confirmFacts: true, commandId: 'cmd_c'
    });
    var after = await t.service.readWorkspace();
    var asset = S.asset(after.data, 'asset_004');
    assert(res.status === 'saved' && asset.revision === 2 && asset.provenance.userConfirmed, '仅确认失败');
    assert(after.data.sources.length === ws.data.sources.length, '仅确认不应新增来源');
    var ev = after.data.events[after.data.events.length - 1];
    assert(ev.sourceId === null && ev.payload.sourceId === null && ev.payload.userConfirmed === true, '仅确认事件载荷错误');
  });

  await test('A12 无变化保存为无操作且不撤销已有确认；取消编辑不写入', async function () {
    var t = makeService();
    var ws = await t.service.loadWorkspace();
    var a1 = S.asset(ws.data, 'asset_001');
    var raw = t.driver.peek(C.STORAGE_KEY);
    var res = await t.service.updateCareerAsset({
      assetId: 'asset_001', expectedRevision: 1, title: a1.title, body: a1.body, confirmFacts: false, commandId: 'cmd_d'
    });
    assert(res.status === 'noop' && res.newRevision === 1, '应为无操作');
    assert(t.driver.peek(C.STORAGE_KEY) === raw, '无操作不应写入存储');
    var after = await t.service.readWorkspace();
    assert(S.asset(after.data, 'asset_001').provenance.userConfirmed === true, '已有确认被撤销');
  });

  await test('A12 相同请求重试复用结果；同键不同参数与过期 revision 被拒绝', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var req = { assetId: 'asset_003', expectedRevision: 1, title: '改后的标题（演示）', body: '改后的正文（演示）', confirmFacts: false, commandId: 'cmd_e' };
    var first = await t.service.updateCareerAsset(req);
    var ws1 = await t.service.readWorkspace();
    var second = await t.service.updateCareerAsset(Object.assign({}, req));
    var ws2 = await t.service.readWorkspace();
    assert(first.newRevision === 2 && second.status === 'replayed' && second.newRevision === 2, '重试结果不一致');
    assert(ws1.data.events.length === ws2.data.events.length && S.asset(ws2.data, 'asset_003').revision === 2, '重试产生了重复写入');
    await expectReject(t.service.updateCareerAsset(Object.assign({}, req, { body: '另一段正文' })), 'command_conflict', '同键不同参数');
    await expectReject(t.service.updateCareerAsset(Object.assign({}, req, { commandId: 'cmd_f', body: '再改' })), 'revision_conflict', '过期 revision');
    var ws3 = await t.service.readWorkspace();
    assert(S.asset(ws3.data, 'asset_003').revision === 2 && ws3.data.events.length === ws2.data.events.length, '被拒绝的请求改变了数据');
  });

  await test('A08 运行中写入失败：实体、来源、事件不变，可重试成功', async function () {
    var t = makeService();
    var ws = await t.service.loadWorkspace();
    var raw = t.driver.peek(C.STORAGE_KEY);
    t.driver.faults.failWrites = true;
    var req = { assetId: 'asset_001', expectedRevision: 1, title: '失败时的标题', body: 'x', confirmFacts: false, commandId: 'cmd_g' };
    await expectReject(t.service.updateCareerAsset(req), 'write_failed', '写入失败');
    var mid = await t.service.readWorkspace();
    assert(JSON.stringify(counts(mid)) === JSON.stringify(counts(ws)) && t.driver.peek(C.STORAGE_KEY) === raw, '失败后状态改变');
    assert(mid.status.storageStatus === 'available', '不应自动降级');
    t.driver.faults.failWrites = false;
    var retry = await t.service.updateCareerAsset(req);
    assert(retry.status === 'saved' && retry.newRevision === 2, '重试应成功');
  });

  await test('A08 启动存储不可用：只读，拒绝保存和重置，目标仅临时切换', async function () {
    var t = makeService({ probeFails: true });
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'unavailable' && ws.status.readOnly, '应为只读');
    await expectReject(t.service.updateCareerAsset({ assetId: 'asset_001', expectedRevision: 1, title: 'x', body: 'y', confirmFacts: false, commandId: 'cmd_h' }), 'read_only', '只读保存');
    await expectReject(t.service.resetDemo({ confirmed: true }), 'read_only', '只读重置');
    var sel = await t.service.selectGoal('goal_b2b_pm');
    assert(sel.persisted === false, '目标选择不应宣称已持久化');
  });

  await test('A08 损坏与不兼容数据：保留原串，只读预览，确认重置后恢复', async function () {
    var cases = ['{broken', JSON.stringify({ schemaVersion: '9.9', data: {}, ui: {} })];
    for (var i = 0; i < cases.length; i++) {
      var preload = {};
      preload[C.STORAGE_KEY] = cases[i];
      var t = makeService({ preload: preload });
      var ws = await t.service.loadWorkspace();
      assert(ws.status.storageStatus === 'invalid_data' && ws.status.invalidReason, '应识别为 invalid_data');
      assert(t.driver.peek(C.STORAGE_KEY) === cases[i], '原串被覆盖');
      await expectReject(t.service.updateCareerAsset({ assetId: 'asset_001', expectedRevision: 1, title: 'x', body: 'y', confirmFacts: false, commandId: 'cmd_i' }), 'invalid_data', '损坏时保存');
      await expectReject(t.service.resetDemo({}), 'not_confirmed', '未确认的重置');
      assert(t.driver.peek(C.STORAGE_KEY) === cases[i], '未确认重置改动了原串');
      t.driver.faults.failWrites = true;
      await expectReject(t.service.resetDemo({ confirmed: true }), 'write_failed', '重置写入失败');
      assert(t.service.getStatus().storageStatus === 'invalid_data' && t.driver.peek(C.STORAGE_KEY) === cases[i], '重置失败后应保持原状');
      t.driver.faults.failWrites = false;
      await t.service.resetDemo({ confirmed: true });
      assert(t.service.getStatus().storageStatus === 'available', '重置后应恢复 available');
    }
  });

  await test('A08 重置只写本应用键，其他键保留', async function () {
    var preload = { 'other-app.key': 'keep-me' };
    var t = makeService({ preload: preload });
    await t.service.loadWorkspace();
    await t.service.updateCareerAsset({ assetId: 'asset_001', expectedRevision: 1, title: '改动', body: 'b', confirmFacts: false, commandId: 'cmd_j' });
    await t.service.resetDemo({ confirmed: true });
    var ws = await t.service.readWorkspace();
    assert(S.asset(ws.data, 'asset_001').revision === 1, '重置未恢复初始数据');
    assert(t.driver.peek('other-app.key') === 'keep-me', '其他键被清理');
  });

  await test('A08 其他标签页改动后暂停写入', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    t.driver.simulateExternalWrite(C.STORAGE_KEY, '{"changed":true}');
    assert(t.service.getStatus().externalChange === true, '未检测到外部改动');
    await expectReject(t.service.updateCareerAsset({ assetId: 'asset_001', expectedRevision: 1, title: 'x', body: 'y', confirmFacts: false, commandId: 'cmd_k' }), 'external_change', '外部改动后保存');
    await expectReject(t.service.selectGoal('goal_b2b_pm'), 'external_change', '外部改动后切换目标');
    assert(t.driver.peek(C.STORAGE_KEY) === '{"changed":true}', '外部数据被覆盖');
  });

  await test('A07 读取失败后重试恢复', async function () {
    var t = makeService({ hooks: { loadDelayMs: 0, failLoads: 1 } });
    await expectReject(t.service.loadWorkspace(), 'load_failed', '首次读取失败');
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'available', '重试应成功');
  });

  await test('A07 空数据集通过校验，指标全为 0', async function () {
    var env = CA.data.storage.emptyEnvelope();
    assert(CA.domain.validate.validateEnvelope(env).length === 0, '空数据集校验失败');
    var m = S.goalMetrics(env.data, 'goal_ai_pm');
    assert(m.analyzedJobs + m.submitted + m.hrReplies + m.completedInterviews === 0, '空数据指标应为 0');
  });

  await test('校验拒绝跨用户引用与重复 Application', async function () {
    var env = CA.fixtures.demo.createEnvelope();
    env.data.applications[0].userId = 'user_other';
    assert(CA.domain.validate.validateEnvelope(env).length > 0, '跨用户应被拒绝');
    var env2 = CA.fixtures.demo.createEnvelope();
    var dup = JSON.parse(JSON.stringify(env2.data.applications[0]));
    dup.id = 'app_dup';
    env2.data.applications.push(dup);
    assert(CA.domain.validate.validateEnvelope(env2).length > 0, '重复 Application 应被拒绝');
  });

  await test('F05 evidence 为 null／缺失／错误类型进入 invalid_data，原串保留', async function () {
    var cases = [
      { label: 'null', mutate: function (env) { env.data.assessments[0].evidence = null; } },
      { label: '缺失', mutate: function (env) { delete env.data.assessments[0].evidence; } },
      { label: '对象', mutate: function (env) { env.data.assessments[0].evidence = { bad: true }; } },
      {
        label: '条目非法',
        mutate: function (env) {
          env.data.assessments[0].evidence = [{ requirement: '', assetId: 'asset_001', assetRevision: 1, excerpt: 'x' }];
        }
      }
    ];
    for (var i = 0; i < cases.length; i++) {
      var env = CA.fixtures.demo.createEnvelope();
      cases[i].mutate(env);
      var errors = CA.domain.validate.validateEnvelope(env);
      assert(errors.length > 0, cases[i].label + ' 应被校验拒绝：' + errors.join(';'));
      var preload = {};
      preload[C.STORAGE_KEY] = JSON.stringify(env);
      var t = makeService({ preload: preload });
      var ws = await t.service.loadWorkspace();
      assert(ws.status.storageStatus === 'invalid_data', cases[i].label + ' 应为 invalid_data');
      assert(t.driver.peek(C.STORAGE_KEY) === preload[C.STORAGE_KEY], cases[i].label + ' 原串被覆盖');
      await expectReject(
        t.service.updateCareerAsset({
          assetId: 'asset_001',
          expectedRevision: 1,
          title: 'x',
          body: 'y',
          confirmFacts: false,
          commandId: 'cmd_f05_' + i
        }),
        'invalid_data',
        cases[i].label + ' 保存'
      );
    }
  });

  await test('F06 evidence=[] 的合法评估可通过校验并加载', async function () {
    var env = CA.fixtures.demo.createEnvelope();
    env.data.assessments[0].evidence = [];
    assert(CA.domain.validate.validateEnvelope(env).length === 0, '空 evidence 不应被拒');
    var preload = {};
    preload[C.STORAGE_KEY] = JSON.stringify(env);
    var t = makeService({ preload: preload });
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'available', '空 evidence 应可用');
    assert(Array.isArray(ws.data.assessments[0].evidence) && ws.data.assessments[0].evidence.length === 0, 'evidence 未保持空数组');
  });

  await test('F07 探测成功但首次播种写入失败进入 unavailable', async function () {
    var t = makeService({ failBusinessWrites: true });
    t.driver.faults.failBusinessWrites = true;
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'unavailable' && ws.status.readOnly, '应为只读 unavailable');
    assert(t.driver.peek(C.STORAGE_KEY) === null, '不应留下半成品业务键');
    await expectReject(
      t.service.updateCareerAsset({
        assetId: 'asset_001',
        expectedRevision: 1,
        title: 'x',
        body: 'y',
        confirmFacts: false,
        commandId: 'cmd_f07'
      }),
      'read_only',
      '播种失败后保存'
    );
    await expectReject(t.service.resetDemo({ confirmed: true }), 'read_only', '播种失败后重置');
  });

  await test('F08 所有 seed ActionItem 的来源事件存在且不晚于待办创建', async function () {
    var data = CA.fixtures.demo.createEnvelope().data;
    assert(!data.actionItems.some(function (ai) { return ai.id === 'action_005'; }), 'action_005 应已删除');
    data.actionItems.forEach(function (ai) {
      var ev = data.events.filter(function (e) { return e.id === ai.sourceEventId; })[0];
      assert(!!ev, ai.id + ' 缺少来源事件');
      assert(Date.parse(ev.occurredAt) <= Date.parse(ai.createdAt), ai.id + ' 的来源事件晚于待办创建');
    });
    var m1 = S.goalMetrics(data, 'goal_ai_pm');
    var m2 = S.goalMetrics(data, 'goal_b2b_pm');
    assert(JSON.stringify([m1.analyzedJobs, m1.submitted, m1.hrReplies, m1.completedInterviews]) === '[2,1,1,1]', JSON.stringify(m1));
    assert(JSON.stringify([m2.analyzedJobs, m2.submitted, m2.hrReplies, m2.completedInterviews]) === '[1,1,0,0]', JSON.stringify(m2));
  });

  await test('P2-01 文档版本不可覆盖，保存新增版本', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var before = (await t.service.readWorkspace()).data.documentVersions.filter(function (v) {
      return v.documentId === 'doc_base_resume';
    });
    var snap = JSON.stringify(before[0]);
    var res = await t.service.saveDocumentVersion({
      documentId: 'doc_base_resume',
      body: '基础简历第二版正文（合成）',
      parameters: { variant: 'base' },
      userConfirmed: true,
      commandId: 'cmd_p2_doc_1'
    });
    assert(res.status === 'saved' && res.versionNumber === before[0].versionNumber + 1, '版本号未递增');
    var after = await t.service.readWorkspace();
    var old = after.data.documentVersions.filter(function (v) {
      return v.id === before[0].id;
    })[0];
    assert(JSON.stringify(old) === snap, '旧版本被改写');
    var newest = S.latestVersion(after.data, 'doc_base_resume');
    assert(newest.body.indexOf('第二版') >= 0 && newest.userConfirmed === true, '新版本内容错误');
    var again = await t.service.saveDocumentVersion({
      documentId: 'doc_base_resume',
      body: '基础简历第二版正文（合成）',
      parameters: { variant: 'base' },
      userConfirmed: true,
      commandId: 'cmd_p2_doc_1'
    });
    assert(again.status === 'replayed' && again.versionNumber === res.versionNumber, '幂等重放失败');
    assert(
      after.data.documentVersions.filter(function (v) {
        return v.documentId === 'doc_base_resume';
      }).length ===
        (await t.service.readWorkspace()).data.documentVersions.filter(function (v) {
          return v.documentId === 'doc_base_resume';
        }).length,
      '重放新增了版本'
    );
  });

  await test('P2-02 投递引用具体已确认版本；材料未知与版本互斥', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var prep = await t.service.prepareApplication({ goalId: 'goal_ai_pm', jobId: 'job_001', commandId: 'cmd_p2_prep' });
    assert(prep.status === 'existing' || prep.status === 'saved', '准备投递失败');
    await t.service.ensureContextDocuments({ goalId: 'goal_ai_pm', jobId: 'job_001' });
    var ws0 = await t.service.readWorkspace();
    var app = S.applicationFor(ws0.data, 'goal_ai_pm', 'job_001');
    assert(app && app.status === 'preparing', 'job_001 应为 preparing');
    var tailored = ws0.data.documents.filter(function (d) {
      return d.kind === 'resume' && d.draft.parameters.variant === 'tailored' && d.jobId === 'job_001';
    })[0];
    assert(!!tailored, '缺少定制简历文档');
    var ver = await t.service.saveDocumentVersion({
      documentId: tailored.id,
      body: '定制简历用于投递引用',
      parameters: { variant: 'tailored' },
      userConfirmed: true,
      commandId: 'cmd_p2_ver'
    });
    await expectReject(
      t.service.recordSubmission({
        applicationId: app.id,
        submittedAt: '2026-09-20T12:00:00+08:00',
        documentVersionIds: [],
        materialsUnknown: false,
        commandId: 'cmd_p2_sub_bad'
      }),
      'invalid_input',
      '未选版本应拒绝'
    );
    var sub = await t.service.recordSubmission({
      applicationId: app.id,
      submittedAt: '2026-09-20T12:00:00+08:00',
      documentVersionIds: [ver.versionId],
      materialsUnknown: false,
      commandId: 'cmd_p2_sub'
    });
    assert(sub.status === 'saved', '投递记录失败');
    var after = await t.service.readWorkspace();
    var app2 = S.application(after.data, app.id);
    assert(app2.status === 'submitted' && app2.submittedDocumentVersionIds[0] === ver.versionId && app2.materialsUnknown === false, '投递引用错误');
    var bodySnap = S.documentVersion(after.data, ver.versionId).body;
    await t.service.saveDocumentVersion({
      documentId: tailored.id,
      body: '后续修改不应覆盖已投递版本',
      parameters: { variant: 'tailored' },
      userConfirmed: true,
      commandId: 'cmd_p2_ver2'
    });
    assert(S.documentVersion((await t.service.readWorkspace()).data, ver.versionId).body === bodySnap, '已投递版本被改写');
  });

  await test('P2-03 多轮面试按 applicationId 关联，不按公司名', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var list = S.interviewsForApplication((await t.service.readWorkspace()).data, 'app_002');
    assert(list.length === 2 && list[0].id === 'interview_001' && list[1].id === 'interview_002', '预置面试关联错误');
    var res = await t.service.scheduleInterview({
      applicationId: 'app_002',
      roundNumber: 3,
      label: '三面（合成）',
      scheduledAt: '2026-10-20T10:00:00+08:00',
      invitationAt: '2026-09-28T09:00:00+08:00',
      commandId: 'cmd_p2_iv3'
    });
    assert(res.status === 'saved', '登记面试失败');
    var ws = await t.service.readWorkspace();
    var iv = S.interview(ws.data, res.interviewId);
    assert(iv.applicationId === 'app_002' && iv.roundNumber === 3, '新面试未挂到同一投递');
    var app = S.application(ws.data, 'app_002');
    assert(app.status === 'interview_scheduled', '投递状态未更新');
    await expectReject(
      t.service.scheduleInterview({
        applicationId: 'app_002',
        roundNumber: 3,
        label: '三面重复',
        scheduledAt: null,
        invitationAt: '2026-09-28T10:00:00+08:00',
        commandId: 'cmd_p2_iv3b'
      }),
      'invalid_input',
      '重复轮次应拒绝'
    );
  });

  await test('P2-04 保存笔记清空复盘，标记尚未分析；预置复盘保留', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var seeded = S.interview((await t.service.readWorkspace()).data, 'interview_001');
    assert(seeded.review && seeded.review.origin === 'demo_fixture', '预置复盘缺失');
    var saved = await t.service.saveInterviewTranscript({
      interviewId: 'interview_001',
      text: '用户新笔记，覆盖转写（合成）',
      commandId: 'cmd_p2_note'
    });
    assert(saved.status === 'saved', '保存笔记失败');
    var iv = S.interview((await t.service.readWorkspace()).data, 'interview_001');
    assert(iv.transcript.text.indexOf('用户新笔记') >= 0 && iv.review === null, '复盘未清空为尚未分析');
    var evt = (await t.service.readWorkspace()).data.events.filter(function (e) {
      return e.commandId === 'cmd_p2_note';
    })[0];
    assert(evt && evt.type === 'interview.transcript_saved', '缺少 transcript_saved 事件');
  });

  await test('P2-05 缺少 documents 的旧包可软迁移后写入文档版本', async function () {
    var fixture = CA.fixtures.demo.createEnvelope();
    delete fixture.data.documents;
    delete fixture.data.documentVersions;
    var t = makeService({ preload: {} });
    t.driver.setItem(C.STORAGE_KEY, JSON.stringify(fixture));
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'available' && Array.isArray(ws.data.documents) && Array.isArray(ws.data.documentVersions), '软迁移失败');
    await t.service.ensureContextDocuments({ goalId: 'goal_ai_pm', jobId: 'job_001' });
    var after = await t.service.readWorkspace();
    assert(after.data.documents.length >= 1, '软迁移后无法创建文档');
  });

  await test('P2-06 documents 非数组视为损坏，不软迁移成空数组', async function () {
    var fixture = CA.fixtures.demo.createEnvelope();
    fixture.data.documents = { bad: true };
    var raw = JSON.stringify(fixture);
    var t = makeService({ preload: {} });
    t.driver.setItem(C.STORAGE_KEY, raw);
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'invalid_data', '非数组应 invalid_data');
    assert(t.driver.peek(C.STORAGE_KEY) === raw, '原串被覆盖');
  });

  await test('P3-01 上传 PDF 元信息待确认，失败不覆盖上一份', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var ok = await t.service.recordResumeFileUpload({
      fileName: 'demo-resume.pdf',
      byteSize: 1200,
      mimeType: 'application/pdf',
      status: 'pending_confirm',
      readError: null,
      commandId: 'cmd_p3_up1'
    });
    assert(ok.status === 'saved', '上传失败');
    var f1 = S.resumeFile((await t.service.readWorkspace()).data, ok.fileId);
    assert(f1.status === 'pending_confirm' && f1.fileName === 'demo-resume.pdf', '待确认状态错误');
    await t.service.saveResumeFileText({ fileId: ok.fileId, text: '林小舟｜产品助理（合成）', commandId: 'cmd_p3_txt' });
    await t.service.confirmResumeFile({ fileId: ok.fileId, commandId: 'cmd_p3_cf' });
    var confirmed = S.currentResumeFile((await t.service.readWorkspace()).data);
    assert(confirmed && confirmed.status === 'confirmed' && confirmed.sourceId, '确认失败');
    var fail = await t.service.recordResumeFileUpload({
      fileName: 'broken.pdf',
      byteSize: 10,
      mimeType: 'application/pdf',
      status: 'read_failed',
      readError: '无法读取该文件',
      commandId: 'cmd_p3_fail'
    });
    var after = await t.service.readWorkspace();
    assert(S.resumeFile(after.data, fail.fileId).status === 'read_failed', '失败记录缺失');
    assert(S.currentResumeFile(after.data).id === confirmed.id, '失败覆盖了当前可用简历');
    var again = await t.service.recordResumeFileUpload({
      fileName: 'demo-resume.pdf',
      byteSize: 1200,
      mimeType: 'application/pdf',
      status: 'pending_confirm',
      readError: null,
      commandId: 'cmd_p3_up1'
    });
    assert(again.status === 'replayed' && again.fileId === ok.fileId, '上传幂等失败');
  });

  await test('P3-02 缺省 files 软迁移；确认前不算已确认事实', async function () {
    var fixture = CA.fixtures.demo.createEnvelope();
    delete fixture.data.files;
    var t = makeService({ preload: {} });
    t.driver.setItem(C.STORAGE_KEY, JSON.stringify(fixture));
    var ws = await t.service.loadWorkspace();
    assert(ws.status.storageStatus === 'available' && Array.isArray(ws.data.files), 'files 软迁移失败');
    var up = await t.service.recordResumeFileUpload({
      fileName: 'new.pdf',
      byteSize: 100,
      mimeType: 'application/pdf',
      status: 'pending_confirm',
      commandId: 'cmd_p3_soft'
    });
    var file = S.resumeFile((await t.service.readWorkspace()).data, up.fileId);
    assert(file.status === 'pending_confirm' && !file.sourceId, '未确认却有来源');
    await expectReject(
      t.service.confirmResumeFile({ fileId: up.fileId, commandId: 'cmd_p3_empty' }),
      'invalid_input',
      '空正文不应确认'
    );
  });

  await test('P4-01 上传后可存正文；确认可延后；改稿保留旧版本', async function () {
    var t = makeService();
    await t.service.loadWorkspace();
    var up = await t.service.recordResumeFileUpload({
      fileName: 'phase4.pdf',
      byteSize: 2048,
      mimeType: 'application/pdf',
      status: 'pending_confirm',
      commandId: 'cmd_p4_up'
    });
    var empty = S.resumeFile((await t.service.readWorkspace()).data, up.fileId);
    assert(empty.textDraft === '' && empty.status === 'pending_confirm', '初始应无正文且未确认');
    await t.service.saveResumeFileText({
      fileId: up.fileId,
      text: '第一版抽出正文（合成）',
      commandId: 'cmd_p4_txt1'
    });
    var draft = S.resumeFile((await t.service.readWorkspace()).data, up.fileId);
    assert(draft.textDraft.indexOf('第一版') >= 0 && !draft.sourceId, '正文保存后仍不应自动确认');
    await t.service.confirmResumeFile({ fileId: up.fileId, commandId: 'cmd_p4_cf' });
    var confirmed = S.resumeFile((await t.service.readWorkspace()).data, up.fileId);
    assert(confirmed.status === 'confirmed' && confirmed.documentId && confirmed.sourceId, '延后确认失败');
    var versionsBefore = S.versionsForDocument((await t.service.readWorkspace()).data, confirmed.documentId).length;
    await t.service.saveResumeFileText({
      fileId: up.fileId,
      text: '第二版修改后的正文（合成）',
      commandId: 'cmd_p4_txt2'
    });
    var afterEdit = await t.service.readWorkspace();
    var edited = S.resumeFile(afterEdit.data, up.fileId);
    assert(edited.status === 'pending_confirm' && edited.textDraft.indexOf('第二版') >= 0, '改稿后应回到待使用确认');
    assert(S.source(afterEdit.data, confirmed.sourceId).rawText.indexOf('第一版') >= 0, '原确认来源正文被覆盖');
    await t.service.saveDocumentVersion({
      documentId: confirmed.documentId,
      body: '第二版修改后的正文（合成）',
      parameters: { variant: 'base' },
      userConfirmed: false,
      commandId: 'cmd_p4_ver'
    });
    var afterVer = await t.service.readWorkspace();
    var versions = S.versionsForDocument(afterVer.data, confirmed.documentId);
    assert(versions.length === versionsBefore + 1, '应新增材料版本');
    assert(versions.some(function (v) { return v.body.indexOf('第一版') >= 0; }), '旧版正文应仍可查');
    assert(versions.some(function (v) { return v.body.indexOf('第二版') >= 0 && !v.userConfirmed; }), '新版应为未确认材料');
  });

  await test('P5-01 演示建议可指向段落；空正文不生成；采纳不改原文件；保存为岗位新草稿', async function () {
    var Sug = CA.lib.reviseSuggestions;
    var empty = Sug.buildDemoSuggestions({
      resumeText: '   ',
      job: { id: 'job_001', title: 'AI 产品经理', companyName: '星河', jdText: '要求：评测' }
    });
    assert(empty.ok === false && empty.reason === 'empty_resume' && empty.suggestions.length === 0, '空正文不应生成建议');

    var t = makeService();
    await t.service.loadWorkspace();
    var job = S.job((await t.service.readWorkspace()).data, 'job_001');
    var assessment = S.latestAssessment((await t.service.readWorkspace()).data, 'job_001', 'goal_ai_pm');
    var resumeText =
      '林小舟｜产品助理\n虚构科技有限公司｜2023.07–2025.08\n项目：智能客服知识库问答；销售数据看板改版。\n与算法同事制定人工抽检规则。';
    var built = Sug.buildDemoSuggestions({ resumeText: resumeText, job: job, assessment: assessment });
    assert(built.ok && built.suggestions.length >= 3 && built.suggestions.length <= 5, '建议条数应在 3–5');
    built.suggestions.forEach(function (sug) {
      assert(resumeText.indexOf(sug.targetExcerpt) >= 0, '建议必须指向简历原文段落');
      assert(sug.reason.indexOf('演示') >= 0 || sug.reason.indexOf('不是') >= 0, '建议须标明演示性质');
    });

    var up = await t.service.recordResumeFileUpload({
      fileName: 'p5.pdf',
      byteSize: 500,
      mimeType: 'application/pdf',
      status: 'pending_confirm',
      commandId: 'cmd_p5_up'
    });
    await t.service.saveResumeFileText({ fileId: up.fileId, text: resumeText, commandId: 'cmd_p5_txt' });
    var before = S.resumeFile((await t.service.readWorkspace()).data, up.fileId).textDraft;
    var first = built.suggestions[0];
    var applied = Sug.applySuggestionToDraft(resumeText, first, first.proposedReplacement);
    assert(applied.ok && applied.draft !== resumeText, '采纳应改变草稿');
    assert(before === resumeText, '原文件正文不应因内存草稿改变');

    await t.service.ensureContextDocuments({ goalId: 'goal_ai_pm', jobId: 'job_001' });
    var ws1 = await t.service.readWorkspace();
    var tailored = ws1.data.documents.filter(function (d) {
      return d.kind === 'resume' && d.jobId === 'job_001' && d.draft.parameters.variant === 'tailored';
    })[0];
    assert(!!tailored, '缺少定制简历文档');
    var verBefore = S.versionsForDocument(ws1.data, tailored.id).length;
    await t.service.saveDocumentVersion({
      documentId: tailored.id,
      body: applied.draft,
      parameters: { variant: 'tailored' },
      userConfirmed: false,
      commandId: 'cmd_p5_save'
    });
    var ws2 = await t.service.readWorkspace();
    assert(S.resumeFile(ws2.data, up.fileId).textDraft === resumeText, '保存岗位草稿后原简历被覆盖');
    assert(S.versionsForDocument(ws2.data, tailored.id).length === verBefore + 1, '应新增未确认岗位草稿版本');
    var latest = S.versionsForDocument(ws2.data, tailored.id)[0];
    assert(latest.userConfirmed === false && latest.body.indexOf('演示改写') >= 0, '新草稿不应已确认');
  });

  await test('P6-01 未配置不可生成；提示词要求引用原文；失败不改数据；模拟成功可解析', async function () {
    var AI = CA.lib.aiProvider;
    var Prompt = CA.lib.revisePrompt;
    AI.setTestAdapter(null);
    AI.clearSessionConfig();
    AI.clearSafeLogs();
    var status = AI.getStatus();
    assert(status.configured === false, '默认应未配置');
    assert(status.configPhase === 'unconfigured', '配置阶段应为未配置');
    await expectReject(AI.generateResumeSuggestions({ resumeText: 'x', job: { id: 'j' } }), 'not_configured', '未配置应拒绝');

    var system = Prompt.buildSystemPrompt();
    assert(system.indexOf('不得编造') >= 0 && system.indexOf('需要用户确认') >= 0, '系统提示词缺硬性规则');
    var scope = Prompt.describeSendScope({
      job: { title: 'AI 产品经理', companyName: '星河', jdText: '要求评测' },
      resumeText: '段落甲\n段落乙'
    });
    assert(scope.resumeCharCount > 0 && scope.jobTitle.indexOf('产品') >= 0, '发送范围描述不完整');

    var resumeText = '林小舟｜产品助理\n智能客服知识库问答\n与算法同事制定人工抽检规则';
    var bad = null;
    try {
      Prompt.parseModelSuggestions('[{"title":"x","reason":"y","targetExcerpt":"不存在的段落","proposedReplacement":"z"}]', resumeText);
    } catch (e) {
      bad = e;
    }
    assert(bad, '无法对应原文的返回应失败');

    var okList = Prompt.parseModelSuggestions(
      JSON.stringify([
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
          title: '待确认',
          reason: '信息不足',
          targetExcerpt: '与算法同事制定人工抽检规则',
          proposedReplacement: '与算法同事制定人工抽检规则（需要用户确认是否补充指标）',
          needsUserConfirm: true
        }
      ]),
      resumeText
    );
    assert(okList.length === 2 && okList[1].needsUserConfirm === true, '解析结构化建议失败');

    AI.setTestAdapter(AI.createMockAdapter({ fail: true, failMessage: '限额' }));
    await expectReject(AI.generateResumeSuggestions({ resumeText: resumeText, job: { id: 'job_001', title: 't', companyName: 'c', jdText: 'j' } }), 'mock_fail', '模拟失败');
    AI.setTestAdapter(AI.createMockAdapter({ fail: false }));
    var res = await AI.generateResumeSuggestions({
      resumeText: resumeText,
      job: { id: 'job_001', title: 'AI 产品经理', companyName: '星河', jdText: '评测' }
    });
    assert(res.suggestions && res.suggestions.length >= 3, '模拟成功应返回建议');
    var logs = AI.getSafeLogs();
    assert(
      logs.every(function (l) {
        return !JSON.stringify(l).includes(resumeText) && !JSON.stringify(l).toLowerCase().includes('apikey');
      }),
      '安全日志不应含正文或密钥'
    );
    AI.setTestAdapter(null);
  });

  await test('P7-01 DeepSeek 默认、会话配置／清除、验证态、密钥不落盘', async function () {
    var AI = CA.lib.aiProvider;
    AI.setTestAdapter(null);
    AI.clearSessionConfig();
    AI.clearSafeLogs();

    var st0 = AI.getStatus();
    assert(st0.configPhase === 'unconfigured', '清除后应为未配置');
    assert(st0.defaults && st0.defaults.provider === 'deepseek', '默认提供方应为 deepseek');
    assert(st0.defaults.model === 'deepseek-chat', '默认模型应为 deepseek-chat');
    assert(st0.defaults.baseUrl.indexOf('api.deepseek.com') >= 0, '默认地址应为 DeepSeek');
    assert(AI.PROVIDERS.deepseek.defaultBaseUrl === 'https://api.deepseek.com', 'PROVIDERS 缺 DeepSeek');

    var bad = AI.setSessionConfig({ provider: 'deepseek', model: 'deepseek-chat', apiKey: '' });
    assert(bad.ok === false, '空密钥不应保存');

    var saved = AI.setSessionConfig({
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test-phase7-not-real'
    });
    assert(saved.ok === true, '有效配置应保存');
    var st1 = AI.getStatus();
    assert(st1.configPhase === 'pending_verify', '保存后应为已配置待验证');
    assert(st1.configured && st1.willCallExternal === true, '应标记将外呼');
    assert(st1.model === 'deepseek-chat' && st1.providerId === 'deepseek', '模型／提供方不对');
    assert(st1.keyMasked && st1.keyMasked.indexOf('sk-') === 0 && st1.keyMasked.indexOf('sk-test-phase7-not-real') < 0, '应遮罩密钥');

    var svc = makeService();
    await svc.service.loadWorkspace();
    var stored = svc.driver.peek(C.STORAGE_KEY) || '';
    assert(String(stored).indexOf('sk-test-phase7-not-real') < 0, '密钥不得写入业务存储');
    // 再写入一次配置后确认 peek 仍无密钥
    AI.setSessionConfig({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-test-phase7-not-real'
    });
    stored = svc.driver.peek(C.STORAGE_KEY) || '';
    assert(String(stored).indexOf('sk-test-phase7-not-real') < 0, '再次配置后密钥仍不得写入业务存储');

    var cleared = AI.clearSessionConfig();
    assert(cleared.configPhase === 'unconfigured' && cleared.configured === false, '清除后应回到未配置');
    await expectReject(
      AI.generateResumeSuggestions({ resumeText: 'x', job: { id: 'j', title: 't', companyName: 'c', jdText: 'd' } }),
      'not_configured',
      '清除后不可生成'
    );

    // 格式错误路径：mock 返回无法对应原文的建议
    AI.setTestAdapter(
      AI.createMockAdapter({
        suggestions: [
          {
            id: 'bad',
            title: '坏建议',
            reason: 'r',
            targetExcerpt: '这段原文根本不存在XYZ',
            proposedReplacement: '伪造内容',
            needsUserConfirm: false
          }
        ]
      })
    );
    // mock 直接返回 suggestions，不走 parse；改用会失败的 failCode=format
    AI.setTestAdapter(AI.createMockAdapter({ fail: true, failCode: 'format', failMessage: AI.userFacingError('format') }));
    await expectReject(
      AI.generateResumeSuggestions({
        resumeText: '简历正文一段',
        job: { id: 'job_001', title: 't', companyName: 'c', jdText: 'j' }
      }),
      'format',
      '格式错误应失败'
    );
    var msg = AI.userFacingError('timeout');
    assert(msg.indexOf('超时') >= 0, '超时文案不可理解');
    assert(AI.userFacingError('auth').indexOf('密钥') >= 0, '权限文案不可理解');
    assert(AI.userFacingError('rate_limit').indexOf('额度') >= 0 || AI.userFacingError('rate_limit').indexOf('次') >= 0, '限额文案');

    var logs = AI.getSafeLogs();
    assert(
      logs.every(function (l) {
        var s = JSON.stringify(l);
        return s.indexOf('sk-test-phase7-not-real') < 0;
      }),
      '安全日志不得含完整密钥'
    );
    AI.setTestAdapter(null);
    AI.clearSessionConfig();
  });

  await test('P8-01 投递结果：Offer／拒绝／退出／接受；未完成面试取消；终态不可再改', async function () {
    var t = makeService();
    await t.service.loadWorkspace();

    // preparing 可直接退出，不变成已投递
    var w1 = await t.service.withdrawApplication({
      applicationId: 'app_001',
      withdrawnAt: '2026-09-28T12:00:00+08:00',
      reason: '暂不投递',
      commandId: 'cmd_p8_withdraw_prep'
    });
    assert(w1.status === 'saved', 'preparing 退出应成功');
    var ws1 = await t.service.readWorkspace();
    assert(S.application(ws1.data, 'app_001').status === 'withdrawn', '应为 withdrawn');
    assert(!S.application(ws1.data, 'app_001').submittedAt, '退出不得伪造投递时间');

    // 已投递 → Offer：取消未完成面试、关闭待办
    var openBefore = ws1.data.interviews.filter(function (iv) {
      return iv.applicationId === 'app_002' && (iv.status === 'scheduled' || iv.status === 'invited');
    }).length;
    assert(openBefore >= 1, '样例应有未完成面试');
    await t.service.recordOffer({
      applicationId: 'app_002',
      receivedAt: '2026-09-29T10:00:00+08:00',
      commandId: 'cmd_p8_offer'
    });
    var ws2 = await t.service.readWorkspace();
    var app2 = S.application(ws2.data, 'app_002');
    assert(app2.status === 'offer_received', '应为 offer_received');
    assert(app2.hasHrReply === true, 'Offer 应记为已有招聘方回复');
    var stillOpen = ws2.data.interviews.filter(function (iv) {
      return iv.applicationId === 'app_002' && (iv.status === 'scheduled' || iv.status === 'invited');
    });
    assert(stillOpen.length === 0, '未完成面试应取消');
    var openActions = ws2.data.actionItems.filter(function (ai) {
      return ai.applicationId === 'app_002' && ai.status === 'open';
    });
    assert(openActions.length === 0, '相关开放待办应关闭');

    // 幂等重试
    var replay = await t.service.recordOffer({
      applicationId: 'app_002',
      receivedAt: '2026-09-29T10:00:00+08:00',
      commandId: 'cmd_p8_offer'
    });
    assert(replay.status === 'replayed', '同 commandId 应重放');

    // 接受 Offer
    await t.service.acceptOffer({
      applicationId: 'app_002',
      acceptedAt: '2026-09-29T18:00:00+08:00',
      commandId: 'cmd_p8_accept'
    });
    var ws3 = await t.service.readWorkspace();
    assert(S.application(ws3.data, 'app_002').status === 'accepted', '应为 accepted');
    await expectReject(
      t.service.recordRejection({
        applicationId: 'app_002',
        rejectedAt: '2026-09-30T10:00:00+08:00',
        reason: null,
        commandId: 'cmd_p8_rej_after'
      }),
      'invalid_input',
      '终态不可再拒绝'
    );

    // 另一条已投递 → 拒绝
    await t.service.recordRejection({
      applicationId: 'app_003',
      rejectedAt: '2026-09-28T15:00:00+08:00',
      reason: 'HC 关闭',
      commandId: 'cmd_p8_reject'
    });
    var ws4 = await t.service.readWorkspace();
    assert(S.application(ws4.data, 'app_003').status === 'rejected', '应为 rejected');
    var rejEvt = ws4.data.events.filter(function (e) {
      return e.type === 'application.rejected' && e.subject.id === 'app_003';
    })[0];
    assert(rejEvt && rejEvt.payload.reason === 'HC 关闭', '拒绝原因应入事件');
  });

  await test('P9-01 面试改期与取消；投递状态按规则回退', async function () {
    var t = makeService();
    await t.service.loadWorkspace();

    await t.service.rescheduleInterview({
      interviewId: 'interview_002',
      scheduledAt: '2026-10-12T16:00:00+08:00',
      commandId: 'cmd_p9_reschedule'
    });
    var ws1 = await t.service.readWorkspace();
    var iv2 = S.interview(ws1.data, 'interview_002');
    assert(iv2.scheduledAt === '2026-10-12T16:00:00+08:00' && iv2.status === 'scheduled', '改期失败');
    var rsEvt = ws1.data.events.filter(function (e) {
      return e.type === 'interview.rescheduled' && e.subject.id === 'interview_002';
    })[0];
    assert(rsEvt && rsEvt.payload.previousScheduledAt === '2026-10-09T15:00:00+08:00', '改期事件载荷');

    var replay = await t.service.rescheduleInterview({
      interviewId: 'interview_002',
      scheduledAt: '2026-10-12T16:00:00+08:00',
      commandId: 'cmd_p9_reschedule'
    });
    assert(replay.status === 'replayed', '改期应幂等');

    await t.service.cancelInterview({
      interviewId: 'interview_002',
      reason: '改期冲突，本轮取消',
      commandId: 'cmd_p9_cancel'
    });
    var ws2 = await t.service.readWorkspace();
    assert(S.interview(ws2.data, 'interview_002').status === 'cancelled', '应取消');
    assert(S.application(ws2.data, 'app_002').status === 'interview_completed', '仅剩已完成轮次时应为 interview_completed');
    await expectReject(
      t.service.cancelInterview({ interviewId: 'interview_001', reason: null, commandId: 'cmd_p9_cancel_done' }),
      'invalid_input',
      '已完成轮次不可取消'
    );
  });

  var failed = results.filter(function (r) { return !r.ok; });
  results.forEach(function (r) {
    console.log((r.ok ? '通过  ' : '失败  ') + r.name + (r.ok ? '' : '\n      ' + r.error));
  });
  console.log('\n共 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + ' 项，失败 ' + failed.length + ' 项。');
  process.exitCode = failed.length ? 1 : 0;
})();
