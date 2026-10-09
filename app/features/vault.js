(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var V = CA.domain.validate;
  var shared = CA.features.shared;

  // 界面状态：筛选与编辑草稿只存在于本模块内存，不写入业务存储。
  var filters = { kind: 'all', confirm: 'all' };
  var edit = null;
  var appRef = null;

  var guard = {
    isDirty: function () {
      if (!edit) return false;
      return edit.draft.title !== edit.original.title || edit.draft.body !== edit.original.body || edit.draft.confirm === true;
    },
    confirmLeave: function () {
      return ui.confirmDialog({
        title: '有未保存的资产修改',
        message: '离开后本次编辑草稿会被丢弃，已保存的资产内容不受影响。',
        confirmText: '放弃修改并离开',
        cancelText: '继续编辑',
        danger: true
      });
    },
    discard: function () {
      stopEditing();
    }
  };

  function stopEditing() {
    edit = null;
    if (appRef) appRef.router.clearGuard(guard);
  }

  function returnContext(ws, query) {
    if (!query.fromJob) return null;
    var job = S.job(ws.data, query.fromJob);
    var goal = query.goal ? S.goal(ws.data, query.goal) : null;
    if (!job || !goal || !S.jobBelongsToGoal(job, goal.id)) return { invalid: true };
    return { job: job, goal: goal };
  }

  function contextQuery(rc) {
    return rc && !rc.invalid ? { fromJob: rc.job.id, goal: rc.goal.id } : {};
  }

  function matchesFilters(asset) {
    if (filters.kind !== 'all' && asset.kind !== filters.kind) return false;
    if (filters.confirm === 'confirmed' && !asset.provenance.userConfirmed) return false;
    if (filters.confirm === 'pending' && asset.provenance.userConfirmed) return false;
    return true;
  }

  function renderListItems(container, ws, selectedId, rc) {
    ui.clear(container);
    var assets = ws.data.assets.filter(matchesFilters);
    if (!assets.length) {
      container.appendChild(
        ui.statePanel('empty', '没有符合筛选条件的资产', '调整上方筛选即可查看其他资产。本阶段不提供新增资产。')
      );
      return;
    }
    container.appendChild(
      h(
        'ul',
        { class: 'ca-row-list' },
        assets.map(function (asset) {
          var current = asset.id === selectedId;
          return h(
            'li',
            null,
            h(
              'a',
              {
                class: 'ca-row' + (current ? ' is-current' : ''),
                href: shared.assetHash(asset.id, contextQuery(rc)),
                'aria-current': current ? 'true' : null
              },
              h('span', { class: 'ca-row__title' }, asset.title),
              h('span', { class: 'ca-row__meta' }, C.ASSET_KIND[asset.kind] + '｜版本 ' + asset.revision),
              h('span', { class: 'ca-row__tags' }, shared.confirmationBadge(asset.provenance)),
              h('span', { class: 'ca-row__excerpt' }, asset.body.length > 60 ? asset.body.slice(0, 60) + '…' : asset.body)
            )
          );
        })
      )
    );
  }

  function renderFilters(onChange) {
    var kindSelect = h(
      'select',
      { id: 'vault-filter-kind', class: 'ca-input ca-input--sm' },
      h('option', { value: 'all' }, '全部类型'),
      Object.keys(C.ASSET_KIND).map(function (k) {
        return h('option', { value: k }, C.ASSET_KIND[k]);
      })
    );
    kindSelect.value = filters.kind;
    var confirmSelect = h(
      'select',
      { id: 'vault-filter-confirm', class: 'ca-input ca-input--sm' },
      h('option', { value: 'all' }, '全部确认状态'),
      h('option', { value: 'confirmed' }, '已确认'),
      h('option', { value: 'pending' }, '待确认')
    );
    confirmSelect.value = filters.confirm;
    kindSelect.addEventListener('change', function () {
      filters.kind = kindSelect.value;
      onChange();
    });
    confirmSelect.addEventListener('change', function () {
      filters.confirm = confirmSelect.value;
      onChange();
    });
    return h(
      'div',
      { class: 'ca-filters', role: 'group', 'aria-label': '筛选职业资产' },
      h('label', { for: 'vault-filter-kind', class: 'ca-label ca-label--inline' }, '类型'),
      kindSelect,
      h('label', { for: 'vault-filter-confirm', class: 'ca-label ca-label--inline' }, '确认状态'),
      confirmSelect
    );
  }

  function renderSources(ws, asset, tz) {
    var ids = asset.provenance.sourceIds.slice().reverse();
    return h(
      'section',
      { class: 'ca-subsection', 'aria-labelledby': 'asset-sources' },
      h('h3', { id: 'asset-sources', class: 'ca-subsection__title' }, '来源（' + ids.length + '）'),
      h('p', { class: 'ca-help' }, '来源记录保存后不会被改写。编辑标题或正文会新增一条“手动输入”来源，旧来源保留。有来源不等于已确认。'),
      ids.length
        ? h(
            'ul',
            { class: 'ca-source-list' },
            ids.map(function (sid) {
              var src = S.source(ws.data, sid);
              if (!src) return h('li', { class: 'ca-source' }, ui.badge('来源缺失', 'danger'), ' 引用 ' + sid + ' 不存在');
              return h(
                'li',
                { class: 'ca-source' },
                h('div', { class: 'ca-source__head' }, ui.badge(C.SOURCE_KIND[src.kind], src.kind === 'manual_entry' ? 'info' : 'neutral'), h('span', { class: 'ca-source__label' }, src.label)),
                h('p', { class: 'ca-source__meta' }, '记录时间：' + ui.formatDateTime(src.capturedAt, tz)),
                h('details', { class: 'ca-details' }, h('summary', null, '查看原始内容'), h('p', { class: 'ca-pre' }, src.rawText))
              );
            })
          )
        : ui.notice('warn', '该资产没有记录来源，请谨慎引用。')
    );
  }

  function renderReferences(ws, asset) {
    var refs = S.assessmentsReferencingAsset(ws.data, asset.id);
    return h(
      'section',
      { class: 'ca-subsection', 'aria-labelledby': 'asset-refs' },
      h('h3', { id: 'asset-refs', class: 'ca-subsection__title' }, '被岗位评估引用（' + refs.length + '）'),
      refs.length
        ? h(
            'ul',
            { class: 'ca-ref-list' },
            refs.map(function (as) {
              var job = S.job(ws.data, as.jobId);
              var goal = S.goal(ws.data, as.goalId);
              var snap = as.assetSnapshots.filter(function (s) {
                return s.assetId === asset.id;
              })[0];
              var outdated = snap.revision !== asset.revision;
              return h(
                'li',
                { class: 'ca-ref' },
                h('a', { class: 'ca-link', href: shared.jobHash(as.jobId, as.goalId) }, (job ? job.title : as.jobSnapshot.title) + '（' + (goal ? goal.title : as.goalSnapshot.title) + '）'),
                h('span', { class: 'ca-ref__meta' }, '引用 版本 ' + snap.revision),
                outdated ? ui.badge('资产已更新，该评估可能过期', 'warn') : ui.badge('引用为当前版本', 'ok')
              );
            })
          )
        : h('p', { class: 'ca-help' }, '暂无岗位评估引用该资产。')
    );
  }

  function fieldError(id) {
    return h('p', { id: id, class: 'ca-field-error', hidden: true });
  }

  function setFieldError(node, input, message) {
    if (message) {
      node.textContent = message;
      node.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      node.textContent = '';
      node.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  }

  function renderEditForm(ctx, asset) {
    var dom = {};
    dom.title = h('input', { id: 'asset-title', class: 'ca-input', type: 'text', maxlength: String(C.LIMITS.ASSET_TITLE_MAX + 20), 'aria-describedby': 'asset-title-error', autocomplete: 'off' });
    dom.title.value = edit.draft.title;
    dom.body = h('textarea', { id: 'asset-body', class: 'ca-input ca-textarea', rows: '6', 'aria-describedby': 'asset-body-error' });
    dom.body.value = edit.draft.body;
    dom.confirm = h('input', { id: 'asset-confirm', type: 'checkbox', class: 'ca-checkbox', 'aria-describedby': 'asset-confirm-help' });
    dom.confirm.checked = edit.draft.confirm;
    dom.titleError = fieldError('asset-title-error');
    dom.bodyError = fieldError('asset-body-error');
    dom.formError = h('div', { class: 'ca-form-error', role: 'alert', hidden: true });
    dom.save = ui.button('保存修改', { type: 'submit', variant: 'primary', icon: 'check' });
    dom.cancel = ui.button('取消', {
      onClick: function () {
        if (edit && edit.saving) return;
        stopEditing();
        ui.toast('已取消编辑，资产内容未改变。', 'info');
        ctx.app.rerender();
      }
    });

    dom.title.addEventListener('input', function () {
      edit.draft.title = dom.title.value;
    });
    dom.body.addEventListener('input', function () {
      edit.draft.body = dom.body.value;
    });
    dom.confirm.addEventListener('change', function () {
      edit.draft.confirm = dom.confirm.checked;
    });

    var confirmHelp = asset.provenance.userConfirmed
      ? '勾选表示你已核实这次修改后的内容。不勾选也能保存，但修改标题或正文后，新版本会标为待确认。'
      : '当前资产待确认。勾选表示你已核实内容；内容不变时勾选并保存，会把现有内容标为已确认。不勾选也能保存修改，但仍为待确认。';

    var form = h(
      'form',
      { class: 'ca-form', novalidate: true, 'aria-labelledby': 'asset-edit-title' },
      h('h3', { id: 'asset-edit-title', class: 'ca-subsection__title' }, '编辑资产'),
      h('div', { class: 'ca-field' }, h('label', { for: 'asset-title', class: 'ca-label' }, '标题'), dom.title, dom.titleError),
      h('div', { class: 'ca-field' }, h('label', { for: 'asset-body', class: 'ca-label' }, '正文'), dom.body, dom.bodyError),
      h(
        'div',
        { class: 'ca-field ca-field--check' },
        dom.confirm,
        h('div', null, h('label', { for: 'asset-confirm', class: 'ca-label' }, '确认这次修改'), h('p', { id: 'asset-confirm-help', class: 'ca-help' }, confirmHelp))
      ),
      dom.formError,
      h('div', { class: 'ca-actions' }, dom.save, dom.cancel)
    );

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit(ctx, asset, dom);
    });
    edit.dom = dom;
    return form;
  }

  function showFormError(ctx, dom, err) {
    ui.clear(dom.formError);
    dom.formError.hidden = false;
    var actions = [];
    if (err.code === 'write_failed') {
      actions.push(ui.button('重试保存', { variant: 'primary', onClick: function () { dom.save.click(); } }));
    }
    if (err.code === 'external_change' || err.code === 'revision_conflict') {
      actions.push(ui.button('重新加载页面', { onClick: function () { ctx.app.reload(); } }));
    }
    ui.append(
      dom.formError,
      h('p', null, h('strong', null, '未保存：'), err.message || '保存失败。'),
      h('p', { class: 'ca-help' }, '草稿仍保留在表单中，资产、来源与记录都保持保存前的状态。'),
      actions.length ? h('div', { class: 'ca-actions' }, actions) : null
    );
  }

  function setSaving(dom, saving) {
    edit.saving = saving;
    dom.save.disabled = saving;
    dom.cancel.disabled = saving;
    dom.save.setAttribute('aria-busy', saving ? 'true' : 'false');
    dom.save.querySelector('span').textContent = saving ? '正在保存…' : '保存修改';
  }

  function submit(ctx, asset, dom) {
    if (!edit || edit.saving) return;
    var errors = V.validateAssetDraft(edit.draft.title, edit.draft.body);
    setFieldError(dom.titleError, dom.title, errors.title);
    setFieldError(dom.bodyError, dom.body, errors.body);
    if (errors.title || errors.body) {
      (errors.title ? dom.title : dom.body).focus();
      return;
    }
    var service = ctx.app.service;
    var params = {
      assetId: edit.assetId,
      expectedRevision: edit.baseRevision,
      title: edit.draft.title,
      body: edit.draft.body,
      confirmFacts: edit.draft.confirm
    };
    var fingerprint = service.fingerprintAssetUpdate(params);
    // 同一参数的重试复用 操作记录；参数变化视为新操作。
    if (!edit.attempt || edit.attempt.fingerprint !== fingerprint) {
      edit.attempt = { fingerprint: fingerprint, commandId: service.newCommandId() };
    }
    params.commandId = edit.attempt.commandId;
    dom.formError.hidden = true;
    setSaving(dom, true);
    service.updateCareerAsset(params).then(
      function (res) {
        var before = edit.baseRevision;
        stopEditing();
        if (res.status === 'noop') ui.toast('标题、正文和确认状态都没有变化，未写入任何记录。', 'info');
        else if (res.status === 'replayed') ui.toast('这次修改此前已保存（版本 ' + res.newRevision + '），未重复写入。', 'info');
        else {
          ui.toast(
            '已保存到当前浏览器本地：版本 ' + before + ' → ' + res.newRevision + '。' +
              (params.confirmFacts ? '新版本已确认。' : '新版本为待确认。') +
              '引用旧版本的岗位评估已标为可能过期。',
            'ok'
          );
        }
        ctx.app.refresh();
      },
      function (err) {
        if (!edit) return;
        setSaving(dom, false);
        if (err.fields) {
          setFieldError(dom.titleError, dom.title, err.fields.title);
          setFieldError(dom.bodyError, dom.body, err.fields.body);
        }
        showFormError(ctx, dom, err);
      }
    );
  }

  function renderDetail(ctx, asset, rc) {
    var ws = ctx.ws;
    var tz = S.user(ws.data).timeZone;
    var status = ws.status;
    var q = ctx.route.query;
    var detail = h('article', { class: 'ca-detail', 'aria-labelledby': 'asset-detail-title' });

    detail.appendChild(ui.link(shared.assetHash(null, contextQuery(rc)), '返回资产列表', { className: 'ca-link ca-back-list', icon: 'angle-left' }));

    if (q.rev && rc && !rc.invalid) {
      var rev = parseInt(q.rev, 10);
      detail.appendChild(
        ui.notice(
          rev === asset.revision ? 'info' : 'warn',
          rev === asset.revision
            ? '从岗位证据进入：该评估引用的就是当前 版本 ' + asset.revision + '。'
            : '从岗位证据进入：评估引用 版本 ' + rev + '，当前资产已更新到 版本 ' + asset.revision + '，该评估可能过期。'
        )
      );
    }

    detail.appendChild(
      h(
        'header',
        { class: 'ca-detail__head' },
        h('div', { class: 'ca-row__tags' }, ui.badge(C.ASSET_KIND[asset.kind], 'neutral'), shared.confirmationBadge(asset.provenance)),
        h('h2', { id: 'asset-detail-title', class: 'ca-detail__title' }, asset.title)
      )
    );

    if (!asset.provenance.userConfirmed) {
      detail.appendChild(ui.notice('warn', '待确认：以下内容尚未经用户核实，岗位评估中只作为待核实线索，不作为确定事实。'));
    }
    detail.appendChild(h('p', { class: 'ca-pre ca-asset-body' }, asset.body));

    detail.appendChild(
      h(
        'dl',
        { class: 'ca-meta' },
        h('div', null, h('dt', null, '当前 版本'), h('dd', null, String(asset.revision))),
        h('div', null, h('dt', null, '最近更新'), h('dd', null, ui.formatDateTime(asset.updatedAt, tz))),
        h(
          'div',
          null,
          h('dt', null, '确认状态'),
          h('dd', null, asset.provenance.userConfirmed ? '已确认于 ' + ui.formatDateTime(asset.provenance.confirmedAt, tz) : '待确认')
        ),
        h('div', null, h('dt', null, '置信度'), h('dd', null, shared.confidenceText(asset.provenance)))
      )
    );

    if (edit && edit.assetId === asset.id) {
      detail.appendChild(renderEditForm(ctx, asset));
    } else {
      var reasonId = 'asset-edit-reason';
      var reason = !status.writable
        ? status.storageStatus === 'unavailable'
          ? '本地保存不可用，当前仅供浏览，无法编辑。'
          : status.storageStatus === 'invalid_data'
          ? '本地数据损坏或版本不兼容，确认重置后才能编辑。'
          : '其他标签页修改了数据，请重新加载页面后编辑。'
        : null;
      detail.appendChild(
        h(
          'div',
          { class: 'ca-actions' },
          ui.button('编辑资产', {
            variant: 'primary',
            icon: 'pencil',
            disabled: !status.writable,
            describedBy: reason ? reasonId : null,
            onClick: function () {
              edit = {
                assetId: asset.id,
                baseRevision: asset.revision,
                original: { title: asset.title, body: asset.body },
                draft: { title: asset.title, body: asset.body, confirm: false },
                attempt: null,
                saving: false
              };
              ctx.app.router.setGuard(guard);
              ctx.app.rerender({ focus: '#asset-title' });
            }
          }),
          rc && !rc.invalid
            ? ui.link(shared.jobHash(rc.job.id, rc.goal.id), '返回岗位：' + rc.job.title, { className: 'ca-btn ca-btn--secondary', icon: 'reply' })
            : null
        )
      );
      if (reason) detail.appendChild(h('p', { id: reasonId, class: 'ca-help' }, reason));
    }

    detail.appendChild(renderSources(ws, asset, tz));
    detail.appendChild(renderReferences(ws, asset));
    return detail;
  }

  function render(ctx) {
    appRef = ctx.app;
    var ws = ctx.ws;
    var assetId = ctx.route.params.assetId;
    var rc = returnContext(ws, ctx.route.query);
    var asset = assetId ? S.asset(ws.data, assetId) : null;

    if (edit && edit.assetId !== assetId) stopEditing();
    if (edit && asset && edit.baseRevision !== asset.revision) stopEditing();

    var page = h('section', { class: 'ca-page' });
    page.appendChild(
      shared.pageHeader(
        '职业资产',
        '这些经历证据可以用于不同求职目标。切换目标不会复制或删除资产，来源、确认状态与岗位判断分开呈现。'
      )
    );

    if (rc && rc.invalid) {
      page.appendChild(ui.notice('warn', '返回岗位的链接无效（岗位或目标不存在，或岗位不属于该目标），已忽略返回入口。'));
    } else if (rc) {
      page.appendChild(
        ui.notice('info', [h('span', null, '正在从岗位核对证据：' + rc.job.companyName + '｜' + rc.job.title + '（目标：' + rc.goal.title + '）')], [
          ui.link(shared.jobHash(rc.job.id, rc.goal.id), '返回岗位', { className: 'ca-btn ca-btn--secondary ca-btn--sm', icon: 'reply' })
        ])
      );
    }

    var listBody = h('div', { class: 'ca-list-body' });
    var listPane = h(
      'div',
      { class: 'ca-pane ca-pane--list', 'aria-label': '资产列表' },
      renderFilters(function () {
        renderListItems(listBody, ws, assetId, rc);
      }),
      listBody
    );
    renderListItems(listBody, ws, assetId, rc);

    var detailPane = h('div', { class: 'ca-pane ca-pane--detail' });
    if (!assetId) {
      detailPane.appendChild(ui.statePanel('info', '请选择一项职业资产', '在列表中选择资产，可查看正文、来源、确认状态和被引用情况。'));
    } else if (!asset) {
      detailPane.appendChild(
        ui.statePanel('error', '找不到这项职业资产', '链接中的资产编号「' + assetId + '」不存在。没有自动打开其他资产。', [
          ui.link(shared.assetHash(null, contextQuery(rc)), '返回资产列表', { className: 'ca-btn ca-btn--secondary' }),
          ui.link('#/home', '回到求职首页', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
    } else {
      detailPane.appendChild(renderDetail(ctx, asset, rc));
    }

    page.appendChild(h('div', { class: 'ca-split' + (assetId ? ' has-detail' : '') }, listPane, detailPane));
    return page;
  }

  CA.features.vault = {
    render: render,
    guard: guard,
    isEditing: function () {
      return !!edit;
    }
  };
})(window);
