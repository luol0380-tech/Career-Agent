(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  var editState = null;
  var submitState = null;
  var replyState = null;
  var outcomeState = null;
  var busy = false;
  var appRef = null;

  function VDeep(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function paramsEqual(a, b) {
    return CA.domain.validate.stableStringify(a || {}) === CA.domain.validate.stableStringify(b || {});
  }

  function stopEditing() {
    editState = null;
    if (appRef) appRef.router.clearGuard(guard);
  }

  var guard = {
    isDirty: function () {
      if (!editState || !editState.original) return false;
      return (
        editState.body !== editState.original.body ||
        !paramsEqual(editState.parameters, editState.original.parameters) ||
        editState.confirm !== editState.original.confirm
      );
    },
    confirmLeave: function () {
      return ui.confirmDialog({
        title: '有未保存的材料修改',
        message: '离开后本次材料草稿会被丢弃，已保存的材料版本不受影响。',
        confirmText: '放弃修改并离开',
        cancelText: '继续编辑',
        danger: true
      });
    },
    discard: function () {
      stopEditing();
    }
  };

  function markDirty(ctx) {
    if (!ctx || !ctx.app || !ctx.app.router) return;
    if (guard.isDirty()) ctx.app.router.setGuard(guard);
    else ctx.app.router.clearGuard(guard);
  }

  function paramsEditor(doc, draftParams, onChange) {
    if (doc.kind === 'resume') {
      var sel = h('select', { id: 'doc-variant', class: 'ca-input', disabled: true }, [
        h('option', { value: 'base' }, C.RESUME_VARIANT.base),
        h('option', { value: 'tailored' }, C.RESUME_VARIANT.tailored)
      ]);
      sel.value = draftParams.variant;
      return h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'doc-variant' }, '简历类型（归属创建后不可改）'), sel);
    }
    if (doc.kind === 'self_introduction') {
      var dsel = h('select', { id: 'doc-duration', class: 'ca-input' }, [
        h('option', { value: '30' }, C.INTRO_DURATION[30]),
        h('option', { value: '60' }, C.INTRO_DURATION[60]),
        h('option', { value: '120' }, C.INTRO_DURATION[120])
      ]);
      dsel.value = String(draftParams.durationSeconds || 60);
      dsel.addEventListener('change', function () {
        onChange({ durationSeconds: parseInt(dsel.value, 10) });
      });
      return h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'doc-duration' }, '时长'), dsel);
    }
    if (doc.kind === 'opening_message') {
      var csel = h('select', { id: 'doc-channel', class: 'ca-input' }, Object.keys(C.OPENING_CHANNEL).map(function (k) {
        return h('option', { value: k }, C.OPENING_CHANNEL[k]);
      }));
      csel.value = draftParams.channel || 'boss';
      csel.addEventListener('change', function () {
        onChange({ channel: csel.value });
      });
      return h(
        'div',
        { class: 'ca-field' },
        h('label', { class: 'ca-label', for: 'doc-channel' }, '开场沟通材料的渠道参数'),
        csel,
        h('p', { class: 'ca-help' }, '这是材料模板参数，不是投递记录上的渠道字段。本阶段 Application 不保存投递渠道。')
      );
    }
    return null;
  }

  function renderDocEditor(ctx, doc) {
    var versions = S.versionsForDocument(ctx.ws.data, doc.id);
    if (!editState || editState.documentId !== doc.id) {
      editState = {
        documentId: doc.id,
        body: doc.draft.body,
        parameters: VDeep(doc.draft.parameters),
        confirm: false,
        original: {
          body: doc.draft.body,
          parameters: VDeep(doc.draft.parameters),
          confirm: false
        },
        attempt: null,
        lastError: null
      };
      if (appRef) appRef.router.clearGuard(guard);
    }
    var body = h('textarea', { id: 'doc-body', class: 'ca-input ca-textarea', rows: '10' });
    body.value = editState.body;
    body.addEventListener('input', function () {
      editState.body = body.value;
      markDirty(ctx);
    });
    var confirm = h('input', { id: 'doc-confirm', type: 'checkbox', class: 'ca-checkbox' });
    confirm.checked = editState.confirm;
    confirm.addEventListener('change', function () {
      editState.confirm = confirm.checked;
      markDirty(ctx);
    });
    var err = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
    var saveBtn = ui.button(busy ? '正在保存…' : '保存为新版本', {
      variant: 'primary',
      disabled: !ctx.ws.status.writable || busy,
      onClick: function () {
        saveVersion(ctx, doc, err, saveBtn);
      }
    });
    if (editState.lastError) {
      err.hidden = false;
      ui.append(
        err,
        h('p', null, h('strong', null, '未保存：'), editState.lastError),
        ui.button('重试保存', {
          variant: 'secondary',
          onClick: function () {
            saveVersion(ctx, doc, err, saveBtn);
          }
        })
      );
    }
    return h(
      'div',
      { class: 'ca-doc-editor' },
      h('div', { class: 'ca-row__tags' }, ui.badge(C.DOCUMENT_KIND[doc.kind], 'neutral'), ui.badge(doc.draft.userConfirmed ? '草稿已确认' : '草稿待确认', doc.draft.userConfirmed ? 'ok' : 'warn'), ui.badge('来源：' + C.ORIGIN[doc.draft.origin], 'demo')),
      h('h3', { class: 'ca-subsection__title' }, doc.title),
      paramsEditor(doc, editState.parameters, function (next) {
        Object.keys(next).forEach(function (k) {
          editState.parameters[k] = next[k];
        });
        markDirty(ctx);
      }),
      h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'doc-body' }, '正文'), body),
      h('div', { class: 'ca-field ca-field--check' }, confirm, h('label', { class: 'ca-label', for: 'doc-confirm' }, '确认此版本可用于投递')),
      h('p', { class: 'ca-help' }, '每次保存都会保留一份新的材料版本，之前保存的内容仍可查看；保存不会自动变成“已投递”。'),
      err,
      h('div', { class: 'ca-actions' }, saveBtn),
      h(
        'section',
        { class: 'ca-subsection', 'aria-labelledby': 'doc-versions' },
        h('h4', { id: 'doc-versions', class: 'ca-subsection__title' }, '已保存版本（' + versions.length + '）'),
        versions.length
          ? h(
              'ol',
              { class: 'ca-version-list' },
              versions.map(function (ver) {
                return h(
                  'li',
                  { class: 'ca-version' },
                  h('strong', null, 'v' + ver.versionNumber),
                  ui.badge(ver.userConfirmed ? '已确认' : '未确认', ver.userConfirmed ? 'ok' : 'warn'),
                  h('span', { class: 'ca-help' }, ui.formatDateTime(ver.createdAt, S.user(ctx.ws.data).timeZone) || ver.createdAt),
                  h('details', { class: 'ca-details' }, h('summary', null, '查看这版内容'), h('p', { class: 'ca-pre' }, ver.body))
                );
              })
            )
          : h('p', { class: 'ca-help' }, '尚无保存版本。')
      )
    );
  }

  function saveVersion(ctx, doc, errBox, saveBtn) {
    if (busy || !editState) return;
    busy = true;
    if (saveBtn) saveBtn.disabled = true;
    editState.lastError = null;
    errBox.hidden = true;
    ui.clear(errBox);
    var service = ctx.app.service;
    var params = {
      documentId: doc.id,
      body: editState.body,
      parameters: editState.parameters,
      userConfirmed: editState.confirm
    };
    var fp = CA.domain.validate.stableStringify({
      op: 'saveDocumentVersion',
      documentId: params.documentId,
      body: String(params.body || '').replace(/\r\n?/g, '\n').trim(),
      parameters: params.parameters,
      userConfirmed: params.userConfirmed === true
    });
    if (!editState.attempt || editState.attempt.fp !== fp) {
      editState.attempt = { fp: fp, commandId: service.newCommandId() };
    }
    params.commandId = editState.attempt.commandId;
    service.saveDocumentVersion(params).then(
      function (res) {
        busy = false;
        stopEditing();
        ui.toast('已保存为第 ' + res.versionNumber + ' 版，之前的版本仍保留。', 'ok');
        ctx.app.refresh();
      },
      function (e) {
        busy = false;
        if (saveBtn) saveBtn.disabled = !ctx.ws.status.writable;
        editState.lastError = e.message || '保存失败';
        errBox.hidden = false;
        ui.clear(errBox);
        ui.append(
          errBox,
          h('p', null, h('strong', null, '未保存：'), editState.lastError),
          ui.button('重试保存', {
            variant: 'secondary',
            onClick: function () {
              saveVersion(ctx, doc, errBox, saveBtn);
            }
          })
        );
        markDirty(ctx);
      }
    );
  }

  function renderSubmission(ctx, goal, job, app) {
    var tz = S.user(ctx.ws.data).timeZone;
    var wrap = h('section', { class: 'ca-subsection', 'aria-labelledby': 'prep-submit' }, h('h3', { id: 'prep-submit', class: 'ca-subsection__title' }, '投递跟进'));
    if (!app) {
      wrap.appendChild(h('p', { class: 'ca-help' }, '尚未建立投递记录。可先“开始准备投递”，不会变成已投递。'));
      wrap.appendChild(
        ui.button('开始准备投递', {
          variant: 'secondary',
          disabled: !ctx.ws.status.writable || busy,
          onClick: function () {
            busy = true;
            ctx.app.service.prepareApplication({ goalId: goal.id, jobId: job.id, commandId: ctx.app.service.newCommandId() }).then(
              function () {
                busy = false;
                ui.toast('已创建准备中的投递记录。', 'ok');
                return ctx.app.service.ensureContextDocuments({ goalId: goal.id, jobId: job.id }).then(function () {
                  ctx.app.refresh();
                });
              },
              function (e) {
                busy = false;
                ui.toast(e.message, 'danger');
              }
            );
          }
        })
      );
      return wrap;
    }

    wrap.appendChild(
      h(
        'dl',
        { class: 'ca-meta' },
        h('div', null, h('dt', null, '投递状态'), h('dd', null, C.APPLICATION_STATUS[app.status])),
        h('div', null, h('dt', null, '投递时间'), h('dd', null, app.submittedAt ? ui.formatDateTime(app.submittedAt, tz) : '尚未记录已投递')),
        h('div', null, h('dt', null, '招聘方回复'), h('dd', null, app.hasHrReply ? '已记录回复' + (app.firstHrReplyAt ? '（最早 ' + ui.formatDateTime(app.firstHrReplyAt, tz) + '）' : '（时间未知）') : '尚未记录回复')),
        h('div', null, h('dt', null, '投递材料'), h('dd', null, app.materialsUnknown ? '未记录投递材料（补录）' : app.submittedDocumentVersionIds.length ? app.submittedDocumentVersionIds.length + ' 个版本' : '尚未选定'))
      )
    );

    if (app.status === 'preparing') {
      if (!submitState) {
        submitState = { submittedAt: '', materialsUnknown: false, versionIds: {}, attempt: null };
      }
      var timeInput = h('input', { id: 'submit-at', class: 'ca-input', type: 'datetime-local' });
      timeInput.value = submitState.submittedAt;
      timeInput.addEventListener('input', function () {
        submitState.submittedAt = timeInput.value;
      });
      var unknown = h('input', { id: 'materials-unknown', type: 'checkbox', class: 'ca-checkbox' });
      unknown.checked = submitState.materialsUnknown;
      unknown.addEventListener('change', function () {
        submitState.materialsUnknown = unknown.checked;
        ctx.app.rerender();
      });
      var versions = S.confirmedVersionsForSubmission(ctx.ws.data, goal.id, job.id);
      var list = h(
        'div',
        { class: 'ca-check-list' },
        versions.map(function (ver) {
          var doc = S.document(ctx.ws.data, ver.documentId);
          var id = 'ver-' + ver.id;
          var box = h('input', { id: id, type: 'checkbox', class: 'ca-checkbox', disabled: submitState.materialsUnknown });
          box.checked = !!submitState.versionIds[ver.id];
          box.addEventListener('change', function () {
            if (box.checked) submitState.versionIds[ver.id] = true;
            else delete submitState.versionIds[ver.id];
          });
          return h('label', { class: 'ca-check-row', for: id }, box, h('span', null, S.documentLabel(doc) + ' · v' + ver.versionNumber));
        })
      );
      if (!versions.length) list.appendChild(h('p', { class: 'ca-help' }, '暂无已确认的材料版本。请先保存并确认至少一个版本，或勾选材料未知。'));
      var subErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
      wrap.appendChild(
        h(
          'form',
          {
            class: 'ca-form',
            onsubmit: function (event) {
              event.preventDefault();
              doSubmit(ctx, app, subErr);
            }
          },
          h('h4', { class: 'ca-subsection__title' }, '记录已投递'),
          h('p', { class: 'ca-help' }, '只记录你已在外部完成的投递，不会向任何平台自动投递。'),
          h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'submit-at' }, '投递发生时间'), timeInput),
          h('div', { class: 'ca-field ca-field--check' }, unknown, h('label', { class: 'ca-label', for: 'materials-unknown' }, '补录历史投递，材料版本未知')),
          submitState.materialsUnknown ? null : h('div', { class: 'ca-field' }, h('span', { class: 'ca-label' }, '引用已确认材料版本'), list),
          subErr,
          h('div', { class: 'ca-actions' }, ui.button('确认记录已投递', { type: 'submit', variant: 'primary', disabled: !ctx.ws.status.writable || busy }))
        )
      );
    } else if (!app.hasHrReply || app.status === 'submitted' || app.status === 'hr_responded' || app.status === 'interview_scheduled' || app.status === 'interview_completed') {
      if (!replyState) replyState = { repliedAt: '', summary: '', attempt: null };
      var rTime = h('input', { id: 'reply-at', class: 'ca-input', type: 'datetime-local' });
      rTime.value = replyState.repliedAt;
      rTime.addEventListener('input', function () {
        replyState.repliedAt = rTime.value;
      });
      var rSum = h('textarea', { id: 'reply-sum', class: 'ca-input ca-textarea', rows: '3' });
      rSum.value = replyState.summary;
      rSum.addEventListener('input', function () {
        replyState.summary = rSum.value;
      });
      var rErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
      wrap.appendChild(
        h(
          'form',
          {
            class: 'ca-form',
            onsubmit: function (event) {
              event.preventDefault();
              doReply(ctx, app, rErr);
            }
          },
          h('h4', { class: 'ca-subsection__title' }, '记录招聘方回复'),
          h('p', { class: 'ca-help' }, '只有明确的招聘方回复才计入 HR 回复。时间未知可留空，仍会记为已回复。'),
          h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'reply-at' }, '回复时间（可空）'), rTime),
          h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'reply-sum' }, '回复备注（仅属招聘方回复，不是投递备注）'), rSum),
          h('p', { class: 'ca-help' }, '本阶段 Application 不设通用投递备注字段；此处摘要只随回复事件保存。'),
          rErr,
          h('div', { class: 'ca-actions' }, ui.button('保存回复记录', { type: 'submit', variant: 'secondary', disabled: !ctx.ws.status.writable || busy }))
        )
      );
    }

    var terminal = app.status === 'rejected' || app.status === 'withdrawn' || app.status === 'accepted';
    if (terminal) {
      wrap.appendChild(
        ui.notice(
          'info',
          '这条投递已结束（' +
            C.APPLICATION_STATUS[app.status] +
            '）。本阶段不提供改回进行中状态；若记错请用「重置演示」恢复样例数据。'
        )
      );
    } else {
      wrap.appendChild(renderOutcomeForms(ctx, app));
    }

    wrap.appendChild(
      h(
        'div',
        { class: 'ca-actions' },
        ui.link(shared.interviewsHash(job.id, goal.id), '查看／登记面试记录', { className: 'ca-btn ca-btn--secondary', icon: 'comments' })
      )
    );
    return wrap;
  }

  function renderOutcomeForms(ctx, app) {
    var section = h('div', { class: 'ca-outcome-forms' });
    var canOffer = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed'].indexOf(app.status) >= 0;
    var canReject = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed', 'offer_received'].indexOf(app.status) >= 0;
    var canWithdraw = ['preparing', 'submitted', 'hr_responded', 'interview_scheduled', 'interview_completed', 'offer_received'].indexOf(app.status) >= 0;
    var canAccept = app.status === 'offer_received';

    if (!outcomeState || outcomeState.applicationId !== app.id) {
      outcomeState = {
        applicationId: app.id,
        mode: canAccept ? 'accept' : canOffer ? 'offer' : canWithdraw ? 'withdraw' : 'reject',
        at: '',
        reason: '',
        attempt: null,
        fp: null,
        lastError: null
      };
    }

    if (!canOffer && !canReject && !canWithdraw && !canAccept) return section;

    section.appendChild(h('h4', { class: 'ca-subsection__title' }, '记录投递结果'));
    section.appendChild(
      h(
        'p',
        { class: 'ca-help' },
        '只记录你在外部已经发生的结果（收到 Offer、被拒绝、你主动退出或接受 Offer）。不会向任何招聘平台自动操作。记录 Offer／拒绝／退出时，未完成的面试会被标为已取消，相关准备待办会被关闭。'
      )
    );

    var modeRow = h('div', { class: 'ca-actions ca-actions--wrap' });
    function modeBtn(mode, label, enabled) {
      if (!enabled) return;
      modeRow.appendChild(
        ui.button(label, {
          variant: outcomeState.mode === mode ? 'primary' : 'ghost',
          disabled: busy,
          onClick: function () {
            outcomeState.mode = mode;
            outcomeState.lastError = null;
            ctx.app.rerender();
          }
        })
      );
    }
    modeBtn('offer', '收到 Offer', canOffer);
    modeBtn('reject', '被拒绝', canReject);
    modeBtn('withdraw', '我退出投递', canWithdraw);
    modeBtn('accept', '接受 Offer', canAccept);
    section.appendChild(modeRow);

    var timeId = 'outcome-at';
    var timeInput = h('input', { id: timeId, class: 'ca-input', type: 'datetime-local' });
    timeInput.value = outcomeState.at;
    timeInput.addEventListener('input', function () {
      outcomeState.at = timeInput.value;
    });
    var reasonId = 'outcome-reason';
    var reasonInput = h('textarea', { id: reasonId, class: 'ca-input ca-textarea', rows: '2' });
    reasonInput.value = outcomeState.reason;
    reasonInput.addEventListener('input', function () {
      outcomeState.reason = reasonInput.value;
    });
    var errBox = h('div', { class: 'ca-form-error', hidden: !outcomeState.lastError, role: 'alert' });
    if (outcomeState.lastError) {
      ui.append(errBox, h('p', null, h('strong', null, '未保存：'), outcomeState.lastError));
    }

    var showReason = outcomeState.mode === 'reject' || outcomeState.mode === 'withdraw';
    var submitLabel =
      outcomeState.mode === 'offer'
        ? '确认记录 Offer'
        : outcomeState.mode === 'reject'
          ? '确认记录拒绝'
          : outcomeState.mode === 'withdraw'
            ? '确认退出投递'
            : '确认接受 Offer';

    section.appendChild(
      h(
        'form',
        {
          class: 'ca-form',
          onsubmit: function (event) {
            event.preventDefault();
            doOutcome(ctx, app, errBox);
          }
        },
        h(
          'div',
          { class: 'ca-field' },
          h('label', { class: 'ca-label', for: timeId }, '发生时间'),
          timeInput
        ),
        showReason
          ? h(
              'div',
              { class: 'ca-field' },
              h('label', { class: 'ca-label', for: reasonId }, '原因说明（可空）'),
              reasonInput
            )
          : null,
        errBox,
        h(
          'div',
          { class: 'ca-actions' },
          ui.button(busy ? '保存中…' : submitLabel, {
            type: 'submit',
            variant: outcomeState.mode === 'withdraw' || outcomeState.mode === 'reject' ? 'danger' : 'primary',
            disabled: !ctx.ws.status.writable || busy
          })
        )
      )
    );
    return section;
  }

  function doOutcome(ctx, app, errBox) {
    if (busy || !outcomeState) return;
    var at = toIsoFromLocal(outcomeState.at);
    if (!at) {
      outcomeState.lastError = '请填写有效的发生时间。';
      errBox.hidden = false;
      ui.clear(errBox);
      ui.append(errBox, h('p', null, outcomeState.lastError));
      return;
    }
    var mode = outcomeState.mode;
    var reason = outcomeState.reason;
    var op =
      mode === 'offer'
        ? 'recordOffer'
        : mode === 'reject'
          ? 'recordRejection'
          : mode === 'withdraw'
            ? 'withdrawApplication'
            : 'acceptOffer';
    var params;
    var fpPayload;
    if (mode === 'offer') {
      params = { applicationId: app.id, receivedAt: at, commandId: outcomeState.attempt };
      fpPayload = { op: op, applicationId: app.id, receivedAt: at };
    } else if (mode === 'reject') {
      params = { applicationId: app.id, rejectedAt: at, reason: reason, commandId: outcomeState.attempt };
      fpPayload = {
        op: op,
        applicationId: app.id,
        rejectedAt: at,
        reason: reason == null || reason === '' ? null : String(reason).replace(/\r\n?/g, '\n').trim()
      };
    } else if (mode === 'withdraw') {
      params = { applicationId: app.id, withdrawnAt: at, reason: reason, commandId: outcomeState.attempt };
      fpPayload = {
        op: op,
        applicationId: app.id,
        withdrawnAt: at,
        reason: reason == null || reason === '' ? null : String(reason).replace(/\r\n?/g, '\n').trim()
      };
    } else {
      params = { applicationId: app.id, acceptedAt: at, commandId: outcomeState.attempt };
      fpPayload = { op: op, applicationId: app.id, acceptedAt: at };
    }
    var fp = CA.domain.validate.stableStringify(fpPayload);
    if (!outcomeState.fp || outcomeState.fp !== fp) {
      outcomeState.fp = fp;
      outcomeState.attempt = ctx.app.service.newCommandId();
      params.commandId = outcomeState.attempt;
    } else {
      params.commandId = outcomeState.attempt;
    }

    busy = true;
    outcomeState.lastError = null;
    ctx.app.rerender();
    var call =
      mode === 'offer'
        ? ctx.app.service.recordOffer(params)
        : mode === 'reject'
          ? ctx.app.service.recordRejection(params)
          : mode === 'withdraw'
            ? ctx.app.service.withdrawApplication(params)
            : ctx.app.service.acceptOffer(params);
    call.then(
      function () {
        busy = false;
        outcomeState = null;
        var toast =
          mode === 'offer'
            ? '已记录收到 Offer（外部结果，非自动投递）。'
            : mode === 'reject'
              ? '已记录招聘方拒绝。'
              : mode === 'withdraw'
                ? '已记录你退出该投递。'
                : '已记录接受 Offer。';
        ui.toast(toast, 'ok');
        ctx.app.refresh();
      },
      function (e) {
        busy = false;
        outcomeState.lastError = e.message || '保存失败';
        errBox.hidden = false;
        ui.clear(errBox);
        ui.append(
          errBox,
          h('p', null, h('strong', null, '未保存：'), outcomeState.lastError),
          ui.button('重试保存', {
            variant: 'secondary',
            onClick: function () {
              doOutcome(ctx, app, errBox);
            }
          })
        );
        ctx.app.rerender();
      }
    );
  }

  function toIsoFromLocal(localValue) {
    if (!localValue) return null;
    var d = new Date(localValue);
    if (isNaN(d.getTime())) return null;
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    var offset = -d.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var abs = Math.abs(offset);
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes()) +
      ':' +
      pad(d.getSeconds()) +
      sign +
      pad(Math.floor(abs / 60)) +
      ':' +
      pad(abs % 60)
    );
  }

  function doSubmit(ctx, app, errBox) {
    if (busy || !submitState) return;
    var submittedAt = toIsoFromLocal(submitState.submittedAt);
    if (!submittedAt) {
      errBox.hidden = false;
      ui.clear(errBox);
      ui.append(errBox, h('p', null, '请填写有效的投递发生时间。'));
      return;
    }
    var versionIds = Object.keys(submitState.versionIds);
    busy = true;
    var params = {
      applicationId: app.id,
      submittedAt: submittedAt,
      documentVersionIds: submitState.materialsUnknown ? [] : versionIds,
      materialsUnknown: submitState.materialsUnknown,
      commandId: (submitState.attempt = submitState.attempt || ctx.app.service.newCommandId())
    };
    // 参数变化换新 commandId
    var fp = CA.domain.validate.stableStringify({
      op: 'recordSubmission',
      applicationId: params.applicationId,
      submittedAt: params.submittedAt,
      documentVersionIds: params.documentVersionIds,
      materialsUnknown: params.materialsUnknown
    });
    if (!submitState.fp || submitState.fp !== fp) {
      submitState.fp = fp;
      submitState.attempt = ctx.app.service.newCommandId();
      params.commandId = submitState.attempt;
    }
    ctx.app.service.recordSubmission(params).then(
      function () {
        busy = false;
        submitState = null;
        ui.toast('已记录外部投递（未向平台自动投递）。', 'ok');
        ctx.app.refresh();
      },
      function (e) {
        busy = false;
        errBox.hidden = false;
        ui.clear(errBox);
        ui.append(errBox, h('p', null, h('strong', null, '未保存：'), e.message));
      }
    );
  }

  function doReply(ctx, app, errBox) {
    if (busy || !replyState) return;
    var repliedAt = replyState.repliedAt ? toIsoFromLocal(replyState.repliedAt) : null;
    if (replyState.repliedAt && !repliedAt) {
      errBox.hidden = false;
      ui.clear(errBox);
      ui.append(errBox, h('p', null, '回复时间格式无效。'));
      return;
    }
    busy = true;
    var params = {
      applicationId: app.id,
      repliedAt: repliedAt,
      summary: replyState.summary,
      commandId: replyState.attempt || ctx.app.service.newCommandId()
    };
    var fp = CA.domain.validate.stableStringify({
      op: 'recordHrReply',
      applicationId: params.applicationId,
      repliedAt: params.repliedAt,
      summary: String(params.summary || '').replace(/\r\n?/g, '\n').trim()
    });
    if (!replyState.fp || replyState.fp !== fp) {
      replyState.fp = fp;
      replyState.attempt = ctx.app.service.newCommandId();
      params.commandId = replyState.attempt;
    }
    ctx.app.service.recordHrReply(params).then(
      function () {
        busy = false;
        replyState = null;
        ui.toast('已记录招聘方回复。', 'ok');
        ctx.app.refresh();
      },
      function (e) {
        busy = false;
        errBox.hidden = false;
        ui.clear(errBox);
        ui.append(errBox, h('p', null, h('strong', null, '未保存：'), e.message));
      }
    );
  }

  function render(ctx) {
    appRef = ctx.app;
    var ws = ctx.ws;
    var q = ctx.route.query;
    var job = q.job ? S.job(ws.data, q.job) : null;
    var goal = q.goal ? S.goal(ws.data, q.goal) : null;
    var selectedDocId = q.doc || null;

    if (!job || !goal || !S.jobBelongsToGoal(job, goal.id)) {
      var page = h('section', { class: 'ca-page' });
      page.appendChild(shared.pageHeader('准备投递材料'));
      page.appendChild(
        ui.statePanel('error', '无法确定要准备材料的岗位', '链接缺少岗位或目标，或该岗位不属于所给目标。', [
          ui.link('#/jobs', '查看岗位列表', { className: 'ca-btn ca-btn--secondary' }),
          ui.link('#/home', '回到求职首页', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
      return page;
    }

    var app = S.applicationFor(ws.data, goal.id, job.id);
    var docs = S.documentsForJobContext(ws.data, goal.id, job.id).slice();
    (ws.data.documents || []).forEach(function (doc) {
      if (doc.kind === 'interview_prep' && doc.jobId === job.id && doc.goalId === goal.id) {
        if (
          !docs.some(function (d) {
            return d.id === doc.id;
          })
        ) {
          docs.push(doc);
        }
      }
    });
    var wrap = h('section', { class: 'ca-page' });
    wrap.appendChild(shared.pageHeader('准备投递材料', '编辑简历、自我介绍、开场沟通；面试准备材料在登记面试后可用。保存版本后可记录外部投递。'));
    wrap.appendChild(
      h(
        'dl',
        { class: 'ca-meta ca-meta--card' },
        h('div', null, h('dt', null, '求职目标'), h('dd', null, goal.title)),
        h('div', null, h('dt', null, '岗位'), h('dd', null, job.title)),
        h('div', null, h('dt', null, '公司'), h('dd', null, job.companyName)),
        h('div', null, h('dt', null, '当前投递记录'), h('dd', null, app ? C.APPLICATION_STATUS[app.status] : '尚无投递记录'))
      )
    );
    var useBanner = shared.resumeUseBanner(ctx, { successToast: '已确认使用这份简历，可继续编辑投递材料。' });
    if (useBanner) wrap.appendChild(useBanner);
    wrap.appendChild(
      ui.notice('info', [
        h('strong', null, '演示数据｜本地保存。'),
        h('span', null, '不会调用真实模型，也不会自动投递到外部平台。')
      ])
    );

    if (!docs.length) {
      wrap.appendChild(
        ui.statePanel('empty', '还没有可编辑的投递材料', '可创建准备中的投递并生成材料入口。', [
          ui.button('准备材料入口', {
            variant: 'primary',
            disabled: !ws.status.writable,
            onClick: function () {
              var sid = ctx.app.service;
              Promise.resolve()
                .then(function () {
                  return app ? { applicationId: app.id } : sid.prepareApplication({ goalId: goal.id, jobId: job.id, commandId: sid.newCommandId() });
                })
                .then(function () {
                  return sid.ensureContextDocuments({ goalId: goal.id, jobId: job.id });
                })
                .then(function () {
                  ctx.app.refresh();
                })
                .catch(function (e) {
                  ui.toast(e.message, 'danger');
                });
            }
          })
        ])
      );
    } else {
      var current = selectedDocId ? S.document(ws.data, selectedDocId) : docs[0];
      if (!current || docs.indexOf(current) < 0) {
        if (selectedDocId && current && current.jobId === job.id && current.goalId === goal.id) {
          docs = docs.concat([current]);
        } else {
          current = docs[0];
        }
      }
      wrap.appendChild(
        h(
          'div',
          { class: 'ca-split has-detail' },
          h(
            'div',
            { class: 'ca-pane ca-pane--list', 'aria-label': '材料列表' },
            h(
              'ul',
              { class: 'ca-row-list' },
              docs.map(function (doc) {
                var latest = S.latestVersion(ws.data, doc.id);
                return h(
                  'li',
                  null,
                  h(
                    'a',
                    {
                      class: 'ca-row' + (doc.id === current.id ? ' is-current' : ''),
                      href: shared.prepareHash(job.id, goal.id, { doc: doc.id })
                    },
                    h('span', { class: 'ca-row__title' }, doc.title),
                    h('span', { class: 'ca-row__meta' }, C.DOCUMENT_KIND[doc.kind] + (latest ? '｜最新 v' + latest.versionNumber : '｜尚无版本')),
                    h('span', { class: 'ca-row__tags' }, ui.badge(doc.draft.userConfirmed ? '草稿已确认' : '草稿待确认', doc.draft.userConfirmed ? 'ok' : 'warn'))
                  )
                );
              })
            )
          ),
          h('div', { class: 'ca-pane ca-pane--detail' }, h('article', { class: 'ca-detail' }, renderDocEditor(ctx, current)))
        )
      );
    }

    wrap.appendChild(renderSubmission(ctx, goal, job, app));
    wrap.appendChild(
      h('div', { class: 'ca-actions' }, ui.link(shared.jobHash(job.id, goal.id), '返回岗位', { className: 'ca-btn ca-btn--secondary', icon: 'reply' }))
    );
    return wrap;
  }

  CA.features.prepare = { render: render, guard: guard };
})(window);
