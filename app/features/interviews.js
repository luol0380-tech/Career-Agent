(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  var noteState = null;
  var scheduleState = null;
  var busy = false;

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toIsoFromLocal(localValue) {
    if (!localValue) return null;
    var d = new Date(localValue);
    if (isNaN(d.getTime())) return null;
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

  function nowIso() {
    return toIsoFromLocal(new Date());
  }

  function renderList(ctx) {
    var ws = ctx.ws;
    var q = ctx.route.query;
    var job = q.job ? S.job(ws.data, q.job) : null;
    var goal = q.goal ? S.goal(ws.data, q.goal) : null;
    var page = h('section', { class: 'ca-page' });
    if (!job || !goal || !S.jobBelongsToGoal(job, goal.id)) {
      page.appendChild(shared.pageHeader('面试记录'));
      page.appendChild(
        ui.statePanel('error', '无法确定岗位上下文', '请从岗位详情进入面试记录。没有按公司名猜测其他岗位。', [
          ui.link('#/jobs', '查看岗位列表', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
      return page;
    }
    var app = S.applicationFor(ws.data, goal.id, job.id);
    page.appendChild(shared.pageHeader('面试记录', job.companyName + '｜' + job.title + '（目标：' + goal.title + '）'));
    page.appendChild(
      ui.notice(
        'info',
        '面试通过 ID 关联投递与岗位。预置复盘会标明“演示预置”；新保存的笔记显示“尚未分析”，不会自动生成结论。'
      )
    );

    if (!app || !app.submittedAt) {
      page.appendChild(
        ui.statePanel('empty', '需要先记录外部投递', '准备中的岗位不能登记面试邀请。请先在文档工作区记录已投递。', [
          ui.link(shared.prepareHash(job.id, goal.id), '去准备投递材料', { className: 'ca-btn ca-btn--primary' }),
          ui.link(shared.jobHash(job.id, goal.id), '返回岗位', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
      return page;
    }

    var interviews = S.interviewsForApplication(ws.data, app.id);
    if (interviews.length) {
      page.appendChild(
        h(
          'ul',
          { class: 'ca-row-list' },
          interviews.map(function (iv) {
            return h(
              'li',
              null,
              h(
                'a',
                { class: 'ca-row', href: shared.interviewHash(iv.id) },
                h('span', { class: 'ca-row__title' }, '第 ' + iv.roundNumber + ' 轮｜' + iv.label),
                h(
                  'span',
                  { class: 'ca-row__meta' },
                  iv.scheduledAt ? ui.formatDateTime(iv.scheduledAt, S.user(ws.data).timeZone) : '时间待定'
                ),
                h(
                  'span',
                  { class: 'ca-row__tags' },
                  ui.badge(C.INTERVIEW_STATUS[iv.status], iv.status === 'completed' ? 'ok' : 'info')
                )
              )
            );
          })
        )
      );
    } else {
      page.appendChild(ui.statePanel('empty', '还没有面试记录', '可以登记新的面试邀请／排期。'));
    }

    if (!scheduleState || scheduleState.applicationId !== app.id) {
      scheduleState = {
        applicationId: app.id,
        roundNumber: String(interviews.length + 1),
        label: '',
        scheduledAt: '',
        invitationAt: null,
        attempt: null,
        fp: null
      };
    }

    var roundInput = h('input', { id: 'iv-round', class: 'ca-input', type: 'number', min: '1' });
    roundInput.value = scheduleState.roundNumber;
    roundInput.addEventListener('input', function () {
      scheduleState.roundNumber = roundInput.value;
    });
    var labelInput = h('input', { id: 'iv-label', class: 'ca-input', type: 'text', placeholder: '例如：一面（业务面）' });
    labelInput.value = scheduleState.label;
    labelInput.addEventListener('input', function () {
      scheduleState.label = labelInput.value;
    });
    var timeInput = h('input', { id: 'iv-time', class: 'ca-input', type: 'datetime-local' });
    timeInput.value = scheduleState.scheduledAt;
    timeInput.addEventListener('input', function () {
      scheduleState.scheduledAt = timeInput.value;
    });
    var err = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });

    page.appendChild(
      h(
        'form',
        {
          class: 'ca-form',
          onsubmit: function (event) {
            event.preventDefault();
            if (busy) return;
            var scheduledAt = scheduleState.scheduledAt ? toIsoFromLocal(scheduleState.scheduledAt) : null;
            if (scheduleState.scheduledAt && !scheduledAt) {
              err.hidden = false;
              ui.clear(err);
              ui.append(err, h('p', null, '面试时间格式无效；若时间未定请留空。'));
              return;
            }
            var roundNumber = parseInt(scheduleState.roundNumber, 10);
            if (!scheduleState.invitationAt) scheduleState.invitationAt = nowIso();
            var label = scheduleState.label || '第 ' + roundNumber + ' 轮';
            var fingerprint = CA.domain.validate.stableStringify({
              op: 'scheduleInterview',
              applicationId: app.id,
              roundNumber: roundNumber,
              label: String(label || '').replace(/\r\n?/g, '\n').trim(),
              scheduledAt: scheduledAt,
              invitationAt: scheduleState.invitationAt
            });
            if (!scheduleState.fp || scheduleState.fp !== fingerprint) {
              scheduleState.fp = fingerprint;
              scheduleState.attempt = ctx.app.service.newCommandId();
            }
            busy = true;
            ctx.app.service
              .scheduleInterview({
                applicationId: app.id,
                roundNumber: roundNumber,
                label: label,
                scheduledAt: scheduledAt,
                invitationAt: scheduleState.invitationAt,
                commandId: scheduleState.attempt
              })
              .then(
                function (res) {
                  busy = false;
                  scheduleState = null;
                  ui.toast('已登记面试邀请。', 'ok');
                  return ctx.app.service.ensureInterviewPrepDocument({ interviewId: res.interviewId }).then(function () {
                    ctx.app.router.navigate(shared.interviewHash(res.interviewId));
                  });
                },
                function (e) {
                  busy = false;
                  err.hidden = false;
                  ui.clear(err);
                  ui.append(err, h('p', null, h('strong', null, '未保存：'), e.message));
                }
              );
          }
        },
        h('h3', { class: 'ca-subsection__title' }, '登记面试邀请'),
        h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-round' }, '轮次'), roundInput),
        h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-label' }, '标签'), labelInput),
        h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-time' }, '面试时间（可空＝已邀请待定）'), timeInput),
        err,
        h(
          'div',
          { class: 'ca-actions' },
          ui.button('保存面试邀请', { type: 'submit', variant: 'primary', disabled: !ws.status.writable || busy })
        )
      )
    );
    page.appendChild(
      h('div', { class: 'ca-actions' }, ui.link(shared.jobHash(job.id, goal.id), '返回岗位', { className: 'ca-btn ca-btn--secondary' }))
    );
    return page;
  }

  function renderDetail(ctx) {
    var ws = ctx.ws;
    var interviewId = ctx.route.params.interviewId;
    var iv = S.interview(ws.data, interviewId);
    var page = h('section', { class: 'ca-page' });
    if (!iv) {
      page.appendChild(shared.pageHeader('面试详情'));
      page.appendChild(
        ui.statePanel('error', '找不到这场面试', '链接中的面试编号不存在。没有按公司名猜测其他面试。', [
          ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
      return page;
    }
    var app = S.application(ws.data, iv.applicationId);
    var job = S.job(ws.data, app.jobId);
    var goal = S.goal(ws.data, app.goalId);
    var tz = S.user(ws.data).timeZone;
    page.appendChild(shared.pageHeader('第 ' + iv.roundNumber + ' 轮｜' + iv.label, job.companyName + '｜' + job.title));
    page.appendChild(
      h(
        'dl',
        { class: 'ca-meta ca-meta--card' },
        h('div', null, h('dt', null, '状态'), h('dd', null, C.INTERVIEW_STATUS[iv.status])),
        h('div', null, h('dt', null, '排期'), h('dd', null, iv.scheduledAt ? ui.formatDateTime(iv.scheduledAt, tz) : '时间待定')),
        h('div', null, h('dt', null, '完成时间'), h('dd', null, iv.completedAt ? ui.formatDateTime(iv.completedAt, tz) : '—')),
        h('div', null, h('dt', null, '关联投递'), h('dd', null, C.APPLICATION_STATUS[app.status] + '（按投递编号关联）'))
      )
    );

    page.appendChild(
      h(
        'section',
        { class: 'ca-subsection' },
        h('h3', { class: 'ca-subsection__title' }, '用户笔记／转写'),
        iv.transcript ? h('p', { class: 'ca-pre' }, iv.transcript.text) : h('p', { class: 'ca-help' }, '尚无笔记。'),
        iv.transcript
          ? h('p', { class: 'ca-help' }, '版本 ' + iv.transcript.revision + ' · ' + ui.formatDateTime(iv.transcript.capturedAt, tz))
          : null
      )
    );

    var reviewBlock = h('section', { class: 'ca-subsection' }, h('h3', { class: 'ca-subsection__title' }, '复盘结论'));
    if (iv.review) {
      reviewBlock.appendChild(
        ui.badge(iv.review.origin === 'demo_fixture' ? '演示预置复盘' : C.ORIGIN[iv.review.origin] || iv.review.origin, 'demo')
      );
      if (iv.transcript && iv.review.transcriptRevision !== iv.transcript.revision) {
        reviewBlock.appendChild(ui.notice('warn', '转写已更新，当前复盘可能过期。'));
      }
      reviewBlock.appendChild(h('p', null, iv.review.summary));
      reviewBlock.appendChild(h('p', { class: 'ca-help' }, '优势：' + (iv.review.strengths || []).join('；') || '—'));
      reviewBlock.appendChild(h('p', { class: 'ca-help' }, '改进：' + (iv.review.improvements || []).join('；') || '—'));
    } else {
      reviewBlock.appendChild(
        ui.notice(
          'info',
          iv.transcript
            ? '已有笔记，尚未分析。本阶段不会自动生成复盘结论。'
            : '保存笔记后将显示“尚未分析”，不会套用固定样例复盘。'
        )
      );
    }
    page.appendChild(reviewBlock);

    if (!noteState || noteState.interviewId !== iv.id) {
      noteState = { interviewId: iv.id, text: iv.transcript ? iv.transcript.text : '', attempt: null, fp: null };
    }
    var ta = h('textarea', { id: 'iv-notes', class: 'ca-input ca-textarea', rows: '5' });
    ta.value = noteState.text;
    ta.addEventListener('input', function () {
      noteState.text = ta.value;
    });
    var nErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
    page.appendChild(
      h(
        'form',
        {
          class: 'ca-form',
          onsubmit: function (event) {
            event.preventDefault();
            if (busy) return;
            var text = noteState.text;
            var fingerprint = CA.domain.validate.stableStringify({
              op: 'saveInterviewTranscript',
              interviewId: iv.id,
              text: String(text || '').replace(/\r\n?/g, '\n').trim()
            });
            if (!noteState.fp || noteState.fp !== fingerprint) {
              noteState.fp = fingerprint;
              noteState.attempt = ctx.app.service.newCommandId();
            }
            busy = true;
            ctx.app.service
              .saveInterviewTranscript({ interviewId: iv.id, text: text, commandId: noteState.attempt })
              .then(
                function () {
                  busy = false;
                  noteState = null;
                  ui.toast('笔记已保存；复盘标记为尚未分析。', 'ok');
                  ctx.app.refresh();
                },
                function (e) {
                  busy = false;
                  nErr.hidden = false;
                  ui.clear(nErr);
                  ui.append(nErr, h('p', null, h('strong', null, '未保存：'), e.message));
                }
              );
          }
        },
        h('h3', { class: 'ca-subsection__title' }, '编辑笔记'),
        h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-notes' }, '笔记正文'), ta),
        nErr,
        h(
          'div',
          { class: 'ca-actions' },
          ui.button('保存笔记', { type: 'submit', variant: 'primary', disabled: !ws.status.writable || busy })
        )
      )
    );

    if (iv.status === 'scheduled' || iv.status === 'invited') {
      if (app.status === 'interview_scheduled') {
        var rescheduleAt = h('input', { id: 'iv-reschedule-at', class: 'ca-input', type: 'datetime-local' });
        var rescheduleErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
        page.appendChild(
          h(
            'form',
            {
              class: 'ca-form',
              onsubmit: function (event) {
                event.preventDefault();
                if (busy) return;
                var iso = rescheduleAt.value ? toIsoFromLocal(rescheduleAt.value) : null;
                if (rescheduleAt.value && !iso) {
                  rescheduleErr.hidden = false;
                  ui.clear(rescheduleErr);
                  ui.append(rescheduleErr, h('p', null, '时间格式无效。'));
                  return;
                }
                var fingerprint = CA.domain.validate.stableStringify({
                  op: 'rescheduleInterview',
                  interviewId: iv.id,
                  scheduledAt: iso
                });
                if (!noteState || noteState._rsFp !== fingerprint) {
                  noteState = noteState || { interviewId: iv.id };
                  noteState._rsFp = fingerprint;
                  noteState._rsCmd = ctx.app.service.newCommandId();
                }
                busy = true;
                ctx.app.service
                  .rescheduleInterview({ interviewId: iv.id, scheduledAt: iso, commandId: noteState._rsCmd })
                  .then(
                    function (res) {
                      busy = false;
                      ui.toast(res.status === 'noop' ? '时间未变化，未写入新记录。' : '已更新面试时间。', 'ok');
                      ctx.app.refresh();
                    },
                    function (e) {
                      busy = false;
                      rescheduleErr.hidden = false;
                      ui.clear(rescheduleErr);
                      ui.append(
                        rescheduleErr,
                        h('p', null, h('strong', null, '未保存：'), e.message),
                        ui.button('重试保存', {
                          variant: 'secondary',
                          onClick: function () {
                            rescheduleErr.closest('form').requestSubmit();
                          }
                        })
                      );
                    }
                  );
              }
            },
            h('h3', { class: 'ca-subsection__title' }, '改期／确认时间'),
            h('p', { class: 'ca-help' }, '不会新增一轮面试。清空时间表示仍为「已邀请，时间待定」。'),
            h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-reschedule-at' }, '新的面试时间（可空）'), rescheduleAt),
            rescheduleErr,
            h(
              'div',
              { class: 'ca-actions' },
              ui.button('保存改期', { type: 'submit', variant: 'secondary', disabled: !ws.status.writable || busy })
            )
          )
        );

        var cancelReason = h('textarea', { id: 'iv-cancel-reason', class: 'ca-input ca-textarea', rows: '2' });
        var cancelErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
        page.appendChild(
          h(
            'form',
            {
              class: 'ca-form',
              onsubmit: function (event) {
                event.preventDefault();
                if (busy) return;
                var reason = cancelReason.value;
                var fingerprint = CA.domain.validate.stableStringify({
                  op: 'cancelInterview',
                  interviewId: iv.id,
                  reason: reason == null || reason === '' ? null : String(reason).replace(/\r\n?/g, '\n').trim()
                });
                if (!noteState || noteState._cancelFp !== fingerprint) {
                  noteState = noteState || { interviewId: iv.id };
                  noteState._cancelFp = fingerprint;
                  noteState._cancelCmd = ctx.app.service.newCommandId();
                }
                busy = true;
                ctx.app.service
                  .cancelInterview({ interviewId: iv.id, reason: reason, commandId: noteState._cancelCmd })
                  .then(
                    function () {
                      busy = false;
                      ui.toast('已取消本轮面试。投递状态已按规则更新。', 'ok');
                      ctx.app.refresh();
                    },
                    function (e) {
                      busy = false;
                      cancelErr.hidden = false;
                      ui.clear(cancelErr);
                      ui.append(
                        cancelErr,
                        h('p', null, h('strong', null, '未保存：'), e.message),
                        ui.button('重试保存', {
                          variant: 'secondary',
                          onClick: function () {
                            cancelErr.closest('form').requestSubmit();
                          }
                        })
                      );
                    }
                  );
              }
            },
            h('h3', { class: 'ca-subsection__title' }, '取消本轮面试'),
            h('p', { class: 'ca-help' }, '若没有其他未完成轮次：有已完成轮次则投递变为「面试已完成」，否则变为「招聘方已回复」。'),
            h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-cancel-reason' }, '取消原因（可空）'), cancelReason),
            cancelErr,
            h(
              'div',
              { class: 'ca-actions' },
              ui.button('确认取消本轮', { type: 'submit', variant: 'danger', disabled: !ws.status.writable || busy })
            )
          )
        );
      }

      var doneAt = h('input', { id: 'iv-done-at', class: 'ca-input', type: 'datetime-local' });
      var doneErr = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
      page.appendChild(
        h(
          'form',
          {
            class: 'ca-form',
            onsubmit: function (event) {
              event.preventDefault();
              if (busy) return;
              var iso = doneAt.value ? toIsoFromLocal(doneAt.value) : nowIso();
              if (!iso) {
                doneErr.hidden = false;
                ui.clear(doneErr);
                ui.append(doneErr, h('p', null, '完成时间格式无效。'));
                return;
              }
              busy = true;
              ctx.app.service
                .completeInterview({ interviewId: iv.id, completedAt: iso, commandId: ctx.app.service.newCommandId() })
                .then(
                  function () {
                    busy = false;
                    ui.toast('已记录面试完成。', 'ok');
                    ctx.app.refresh();
                  },
                  function (e) {
                    busy = false;
                    doneErr.hidden = false;
                    ui.clear(doneErr);
                    ui.append(doneErr, h('p', null, h('strong', null, '未保存：'), e.message));
                  }
                );
            }
          },
          h('h3', { class: 'ca-subsection__title' }, '标记本轮已完成'),
          h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'iv-done-at' }, '完成时间（可空＝当前本地时间）'), doneAt),
          doneErr,
          h(
            'div',
            { class: 'ca-actions' },
            ui.button('确认已完成', { type: 'submit', variant: 'secondary', disabled: !ws.status.writable || busy })
          )
        )
      );
    }

    var prepDocs = (ws.data.documents || []).filter(function (doc) {
      return doc.kind === 'interview_prep' && doc.interviewId === iv.id;
    });
    if (prepDocs.length) {
      page.appendChild(
        h(
          'section',
          { class: 'ca-subsection' },
          h('h3', { class: 'ca-subsection__title' }, '面试准备材料'),
          h(
            'ul',
            { class: 'ca-row-list' },
            prepDocs.map(function (doc) {
              return h(
                'li',
                null,
                h(
                  'a',
                  {
                    class: 'ca-row',
                    href: shared.prepareHash(job.id, goal.id, { doc: doc.id })
                  },
                  h('span', { class: 'ca-row__title' }, doc.title),
                  h('span', { class: 'ca-row__meta' }, '在文档工作区编辑')
                )
              );
            })
          )
        )
      );
    } else {
      page.appendChild(
        h(
          'div',
          { class: 'ca-actions' },
          ui.button('创建面试准备材料', {
            variant: 'secondary',
            disabled: !ws.status.writable || busy,
            onClick: function () {
              busy = true;
              ctx.app.service.ensureInterviewPrepDocument({ interviewId: iv.id }).then(
                function (res) {
                  busy = false;
                  ctx.app.router.navigate(shared.prepareHash(job.id, goal.id, { doc: res.documentId }));
                },
                function (e) {
                  busy = false;
                  ui.toast(e.message, 'danger');
                }
              );
            }
          })
        )
      );
    }

    page.appendChild(
      h(
        'div',
        { class: 'ca-actions' },
        ui.link(shared.interviewsHash(job.id, goal.id), '返回面试列表', { className: 'ca-btn ca-btn--secondary' }),
        ui.link(shared.jobHash(job.id, goal.id), '返回岗位', { className: 'ca-btn ca-btn--secondary' }),
        ui.link(shared.prepareHash(job.id, goal.id), '准备投递材料', { className: 'ca-btn ca-btn--secondary' })
      )
    );
    return page;
  }

  function render(ctx) {
    if (ctx.route.name === 'interview') return renderDetail(ctx);
    return renderList(ctx);
  }

  CA.features.interviews = { render: render };
})(window);
