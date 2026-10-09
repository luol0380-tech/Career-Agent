(function (root) {
  'use strict';

  var CA = root.CareerAgent;
  var ui = CA.components.ui;
  var shell = CA.components.shell;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  var setup = CA.data.storage.createDriverFromLocation(root);
  var service = CA.data.createWorkspaceService({ driver: setup.driver, hooks: setup.hooks });
  var meta = { testScenario: setup.scenario, testScenarioLabel: setup.scenarioLabel, loadFailed: false };
  var state = { phase: 'loading', ws: null, error: null, route: null, lastHash: null };
  var viewEl = root.document.getElementById('ca-view');
  var router;

  var TITLES = {
    home: '求职进展',
    progress: '求职进展',
    vault: '职业资产',
    jobs: '岗位工作区',
    prepare: '准备投递材料',
    resume: '我的简历',
    resume_revise: '帮我改简历',
    assistant: '求职助手',
    interviews: '面试记录',
    interview: '面试详情',
    not_found: '页面不存在'
  };

  var app = {
    service: service,
    refresh: function (opts) {
      return service.readWorkspace().then(function (ws) {
        state.ws = ws;
        render(opts);
      });
    },
    rerender: function (opts) {
      render(opts);
    },
    reload: function () {
      root.location.reload();
    },
    selectGoal: selectGoal
  };

  function goalTitle(goalId) {
    var g = state.ws && S.goal(state.ws.data, goalId);
    return g ? g.title : goalId;
  }

  // 返回 true 表示已切换；失败或用户取消时返回 false，选择器回到原值。
  // 草稿只在切换真正成功后丢弃；取消离开或写入失败时保留可继续编辑的草稿。
  function selectGoal(goalId) {
    return router.confirmIfDirty().then(function (ok) {
      if (!ok) return false;
      return service.selectGoal(goalId).then(
        function (res) {
          router.discardDirty();
          ui.toast(
            res.persisted
              ? '已切换到目标「' + goalTitle(goalId) + '」，选择已保存在当前浏览器本地。'
              : '已切换到目标「' + goalTitle(goalId) + '」，仅本次浏览有效，刷新后不保留。',
            'ok'
          );
          return service.readWorkspace().then(function (ws) {
            state.ws = ws;
            var route = state.route;
            if (route && route.name === 'jobs' && route.params.jobId) {
              var job = S.job(ws.data, route.params.jobId);
              router.navigate(job && S.jobBelongsToGoal(job, goalId) ? shared.jobHash(job.id, goalId) : '#/jobs');
            } else {
              render();
            }
            return true;
          });
        },
        function (err) {
          ui.toast('目标未切换：' + err.message, 'danger');
          return false;
        }
      );
    });
  }

  function resetDemo() {
    return router.confirmIfDirty().then(function (ok) {
      if (!ok) return;
      return ui
        .confirmDialog({
          title: '重置演示数据？',
          message: '将清除本浏览器中本应用的演示修改（资产编辑、目标选择），恢复初始合成数据。其他网站和应用的数据不受影响。此操作无法撤销。',
          confirmText: '确认重置',
          cancelText: '取消',
          danger: true
        })
        .then(function (yes) {
          if (!yes) {
            ui.toast('已取消重置，数据未改变。', 'info');
            return;
          }
          return service.resetDemo({ confirmed: true }).then(
            function () {
              router.discardDirty();
              ui.toast('已恢复初始演示数据。', 'ok');
              return app.refresh();
            },
            function (err) {
              ui.toast('重置未完成：' + err.message, 'danger');
            }
          );
        });
    });
  }

  function renderRoute(route) {
    var ctx = { ws: state.ws, route: route, app: app };
    switch (route.name) {
      case 'home':
        return CA.features.home.render(ctx);
      case 'progress':
        return CA.features.progress.render(ctx);
      case 'vault':
        return CA.features.vault.render(ctx);
      case 'jobs':
        return CA.features.jobs.render(ctx);
      case 'prepare':
        return CA.features.prepare.render(ctx);
      case 'resume':
        return CA.features.resume.render(ctx);
      case 'resume_revise':
        return CA.features.reviseResume.render(ctx);
      case 'assistant':
        return CA.features.assistant.render(ctx);
      case 'interviews':
      case 'interview':
        return CA.features.interviews.render(ctx);
      default:
        return shared.notFoundView('页面不存在', '地址「' + route.hash + '」不是可用页面。当前可用：求职进展、职业资产、岗位工作区。');
    }
  }

  function render(opts) {
    opts = opts || {};
    var route = state.route;
    shell.update(state.phase === 'ready' ? state.ws : null, meta);
    ui.clear(viewEl);

    if (state.phase === 'loading') {
      viewEl.appendChild(ui.statePanel('loading', '正在读取本地演示数据…', '读取完成前不会显示任何数据。'));
      return;
    }
    if (state.phase === 'error') {
      viewEl.appendChild(
        ui.statePanel('error', '读取演示数据失败', (state.error && state.error.message) + ' 当前没有显示任何数据，可以重试读取。', [
          ui.button('重试读取', { variant: 'primary', icon: 'refresh', onClick: load })
        ])
      );
      return;
    }
    if (!route) return;

    try {
      viewEl.appendChild(renderRoute(route));
    } catch (err) {
      console.error(err);
      viewEl.appendChild(
        ui.statePanel('error', '页面渲染出错', '当前页面无法显示。可以回到求职首页或重新加载。', [
          ui.link('#/home', '回到求职首页', { className: 'ca-btn ca-btn--primary' }),
          ui.button('重新加载页面', { onClick: app.reload })
        ])
      );
    }
    var nav = route.name;
    if (route.name === 'prepare' || route.name === 'interviews' || route.name === 'interview') nav = 'jobs';
    else if (route.name === 'progress' || route.name === 'assistant') nav = 'home';
    else if (route.name === 'resume' || route.name === 'resume_revise') nav = 'resume';
    shell.setNavActive(nav);
    root.document.title = (TITLES[route.name] || 'Career Agent') + '｜Career Agent 演示';

    var focusTarget = null;
    if (opts.focus) focusTarget = viewEl.querySelector(opts.focus);
    else if (route.hash !== state.lastHash) focusTarget = viewEl.querySelector('[data-focus-target]');
    state.lastHash = route.hash;
    if (focusTarget) focusTarget.focus({ preventScroll: false });
  }

  function load() {
    state.phase = 'loading';
    meta.loadFailed = false;
    render();
    return service.loadWorkspace().then(
      function (ws) {
        state.ws = ws;
        state.phase = 'ready';
        state.lastHash = null;
        render();
      },
      function (err) {
        state.phase = 'error';
        state.error = err;
        meta.loadFailed = true;
        render();
      }
    );
  }

  function checkCdn() {
    var failures = (root.__caAssetFailures = root.__caAssetFailures || []);
    if (typeof root.tailwind === 'undefined' && failures.indexOf('样式库 Tailwind CSS') < 0) failures.push('样式库 Tailwind CSS');
    shell.renderAssetFailures();
  }

  function installTestHelpers() {
    var key = CA.domain.constants.STORAGE_KEY;
    root.CareerAgentTest = {
      scenario: setup.scenario,
      service: service,
      refresh: function () {
        return app.refresh();
      },
      peekStored: function () {
        if (setup.driver && typeof setup.driver.peek === 'function') return setup.driver.peek(key);
        try {
          return root.localStorage.getItem(key);
        } catch (e) {
          return null;
        }
      },
      installAiProvider: function (adapterOrOpts) {
        var adapter =
          adapterOrOpts && typeof adapterOrOpts.generateResumeSuggestions === 'function'
            ? adapterOrOpts
            : CA.lib.aiProvider.createMockAdapter(adapterOrOpts || {});
        CA.lib.aiProvider.setTestAdapter(adapter);
        return '已安装测试模型适配器：' + (adapter.id || 'mock');
      },
      clearAiProvider: function () {
        CA.lib.aiProvider.setTestAdapter(null);
        return '已清除测试模型适配器';
      },
      setAiSessionConfig: function (cfg) {
        return CA.lib.aiProvider.setSessionConfig(cfg || {});
      },
      clearAiSessionConfig: function () {
        return CA.lib.aiProvider.clearSessionConfig();
      },
      getAiStatus: function () {
        return CA.lib.aiProvider.getStatus();
      },
      verifyAiConfig: function () {
        return CA.lib.aiProvider.verifyConfig();
      },
      aiSafeLogs: function () {
        return CA.lib.aiProvider.getSafeLogs();
      }
    };
    if (!setup.scenario) return;
    root.CareerAgentTest.failWrites = function (on) {
      setup.driver.faults.failWrites = on !== false;
      return '写入失败注入：' + (setup.driver.faults.failWrites ? '开启' : '关闭');
    };
    root.CareerAgentTest.failBusinessWrites = function (on) {
      setup.driver.faults.failBusinessWrites = on !== false;
      return '业务键写入失败注入：' + (setup.driver.faults.failBusinessWrites ? '开启' : '关闭');
    };
    root.CareerAgentTest.simulateExternalChange = function () {
      setup.driver.simulateExternalWrite(key, '{"externalTab":true}');
      return '已模拟其他标签页写入同一存储键';
    };
    root.CareerAgentTest.failNextLoad = function () {
      setup.hooks.failLoads = 1;
      return '下一次读取将失败';
    };
    root.CareerAgentTest.replaceStored = function (value) {
      var prevFail = setup.driver.faults.failWrites;
      var prevBiz = setup.driver.faults.failBusinessWrites;
      setup.driver.faults.failWrites = false;
      setup.driver.faults.failBusinessWrites = false;
      setup.driver.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      setup.driver.faults.failWrites = prevFail;
      setup.driver.faults.failBusinessWrites = prevBiz;
      return '已替换隔离存储内容';
    };
  }

  function boot() {
    CA.onAssetFailure = function () {
      shell.renderAssetFailures();
    };
    shell.init({
      onGoalChange: selectGoal,
      onReset: resetDemo,
      onReload: app.reload,
      getStatus: service.getStatus
    });
    service.onStatusChange(function (status) {
      if (state.phase !== 'ready' || !state.ws) return;
      state.ws.status = status;
      shell.update(state.ws, meta);
    });
    router = CA.components.router.createRouter({
      onRoute: function (route) {
        state.route = route;
        if (state.phase === 'ready') render();
      }
    });
    app.router = router;
    root.addEventListener('beforeunload', function (event) {
      var vaultDirty = CA.features.vault && CA.features.vault.guard && CA.features.vault.guard.isDirty();
      var prepDirty = CA.features.prepare && CA.features.prepare.guard && CA.features.prepare.guard.isDirty();
      var resumeDirty = CA.features.resume && CA.features.resume.guard && CA.features.resume.guard.isDirty();
      var reviseDirty = CA.features.reviseResume && CA.features.reviseResume.guard && CA.features.reviseResume.guard.isDirty();
      if (vaultDirty || prepDirty || resumeDirty || reviseDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    installTestHelpers();
    checkCdn();
    router.start();
    load();
    CA.booted = true;
  }

  boot();
})(window);
