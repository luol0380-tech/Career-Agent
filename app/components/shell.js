(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.components = CA.components || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var doc = root.document;

  var els = {};
  var handlers = {};
  var busy = { goal: false, reset: false };

  function init(options) {
    handlers = options;
    els.goalSelect = doc.getElementById('ca-goal-select');
    els.goalHint = doc.getElementById('ca-goal-hint');
    els.reset = doc.getElementById('ca-reset');
    els.banners = doc.getElementById('ca-banners');
    els.storageNote = doc.getElementById('ca-storage-note');
    els.assetWarning = doc.getElementById('ca-asset-warning');
    els.nav = doc.querySelectorAll('[data-route]');

    els.goalSelect.addEventListener('change', function () {
      var previous = els.goalSelect.dataset.committed;
      var next = els.goalSelect.value;
      if (next === previous) return;
      busy.goal = true;
      els.goalSelect.disabled = true;
      els.goalSelect.setAttribute('aria-busy', 'true');
      Promise.resolve(handlers.onGoalChange(next))
        .then(function (applied) {
          if (!applied) els.goalSelect.value = previous;
        })
        .catch(function () {
          els.goalSelect.value = previous;
        })
        .then(function () {
          busy.goal = false;
          els.goalSelect.removeAttribute('aria-busy');
          els.goalSelect.disabled = false;
        });
    });

    els.reset.addEventListener('click', function () {
      if (busy.reset) return;
      busy.reset = true;
      els.reset.disabled = true;
      els.reset.setAttribute('aria-busy', 'true');
      Promise.resolve(handlers.onReset()).then(
        function () {
          busy.reset = false;
          els.reset.removeAttribute('aria-busy');
          if (handlers.getStatus) applyResetState(handlers.getStatus());
        },
        function () {
          busy.reset = false;
          els.reset.removeAttribute('aria-busy');
          if (handlers.getStatus) applyResetState(handlers.getStatus());
        }
      );
    });

    renderAssetFailures();
  }

  function applyResetState(status) {
    var canReset = !!(status && status.canReset);
    els.reset.disabled = !canReset || busy.reset;
    els.reset.title = canReset ? '清除本浏览器中的演示修改，恢复初始合成数据' : '当前无法重置演示数据';
  }

  function setNavActive(routeName) {
    Array.prototype.forEach.call(els.nav, function (a) {
      if (a.dataset.route === routeName) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function update(ws, meta) {
    var S = CA.domain.selectors;
    ui.clear(els.goalSelect);
    if (!ws) {
      els.goalSelect.appendChild(h('option', { value: '' }, meta && meta.loadFailed ? '读取失败' : '读取中…'));
      els.goalSelect.disabled = true;
      els.reset.disabled = true;
      els.goalHint.textContent = '';
      renderBanners(null, meta);
      return;
    }
    S.activeGoals(ws.data).forEach(function (goal) {
      els.goalSelect.appendChild(h('option', { value: goal.id }, goal.title));
    });
    els.goalSelect.value = ws.ui.selectedGoalId;
    els.goalSelect.dataset.committed = ws.ui.selectedGoalId;
    els.goalSelect.disabled = busy.goal || (ws.status.externalChange && !ws.status.readOnly);
    els.goalHint.textContent = ws.status.readOnly ? '仅本次浏览有效，刷新后不保留' : '';
    applyResetState(ws.status);
    els.storageNote.textContent = ws.status.readOnly
      ? '保存位置：本地保存不可用，当前仅供浏览'
      : '保存位置：当前浏览器本地（不同步云端）';
    renderBanners(ws.status, meta);
  }

  function renderBanners(status, meta) {
    ui.clear(els.banners);
    if (meta && meta.testScenario) {
      els.banners.appendChild(
        ui.notice('info', [
          h('strong', null, '隔离测试场景：' + meta.testScenarioLabel),
          h('span', null, '数据只保存在本页内存中，不读写浏览器中的正常演示数据。')
        ])
      );
    }
    if (!status) return;
    if (status.storageStatus === 'unavailable') {
      els.banners.appendChild(
        ui.notice('warn', [
          h('strong', null, '本地保存不可用，当前仅供浏览。'),
          h('span', null, '资产保存与演示重置已停用；切换目标只在本次浏览有效，刷新后不保留。当前显示的是初始合成演示数据。')
        ])
      );
    }
    if (status.storageStatus === 'invalid_data') {
      els.banners.appendChild(
        ui.notice(
          'danger',
          [
            h('strong', null, '本地演示数据损坏或版本不兼容，原数据已保留、未被覆盖。'),
            h('span', null, '当前为只读的初始演示预览。确认重置后才会用初始演示数据替换本应用的本地数据。'),
            status.invalidReason ? h('span', { class: 'ca-notice__detail' }, '检测结果：' + status.invalidReason) : null
          ],
          [ui.button('确认重置演示数据…', { variant: 'danger', onClick: handlers.onReset })]
        )
      );
    }
    if (status.externalChange) {
      els.banners.appendChild(
        ui.notice(
          'danger',
          [
            h('strong', null, '其他标签页修改了本应用的演示数据，已暂停保存。'),
            h('span', null, '为避免互相覆盖，请重新加载页面后再继续编辑。本页尚未保存的草稿不会自动提交。')
          ],
          [ui.button('重新加载页面', { variant: 'primary', onClick: handlers.onReload })]
        )
      );
    }
  }

  function renderAssetFailures() {
    var failures = root.__caAssetFailures || [];
    if (!failures.length) {
      els.assetWarning.hidden = true;
      return;
    }
    els.assetWarning.hidden = false;
    els.assetWarning.textContent =
      '外部资源加载失败：' + failures.join('、') + '。页面已改用本地基础样式，所有操作仍以文字标注，可继续使用。';
  }

  CA.components.shell = {
    init: init,
    update: update,
    setNavActive: setNavActive,
    renderAssetFailures: renderAssetFailures
  };
})(window);
