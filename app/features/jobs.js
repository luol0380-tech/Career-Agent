(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  function renderList(ws, goalId, selectedId) {
    var jobs = S.jobsForGoal(ws.data, goalId);
    if (!jobs.length) {
      return ui.statePanel('empty', '当前目标下还没有收藏岗位', '本阶段不提供新增岗位。可以切换到其他求职目标查看。');
    }
    return h(
      'ul',
      { class: 'ca-row-list' },
      jobs.map(function (job) {
        var as = S.latestAssessment(ws.data, job.id, goalId);
        var app = S.applicationFor(ws.data, goalId, job.id);
        var stale = as ? S.assessmentStaleness(ws.data, as).isStale : false;
        var current = job.id === selectedId;
        return h(
          'li',
          null,
          h(
            'a',
            { class: 'ca-row' + (current ? ' is-current' : ''), href: shared.jobHash(job.id, goalId), 'aria-current': current ? 'true' : null },
            h('span', { class: 'ca-row__title' }, job.title),
            h('span', { class: 'ca-row__meta' }, job.companyName + '｜' + job.location),
            h(
              'span',
              { class: 'ca-row__tags' },
              as ? shared.matchBadge(as.match.level) : ui.badge('尚无评估', 'neutral'),
              stale ? ui.badge('评估可能过期', 'warn') : null,
              ui.badge(app ? C.APPLICATION_STATUS[app.status] : '未建立投递记录', 'neutral')
            )
          )
        );
      })
    );
  }

  function renderApplication(ws, goalId, jobId, tz) {
    var app = S.applicationFor(ws.data, goalId, jobId);
    var section = h(
      'section',
      { class: 'ca-subsection', 'aria-labelledby': 'job-app' },
      h('h3', { id: 'job-app', class: 'ca-subsection__title' }, '投递与面试记录')
    );
    if (!app) {
      section.appendChild(h('p', { class: 'ca-help' }, '该目标下还没有这个岗位的投递记录。收藏或评估岗位不代表已投递。'));
      return section;
    }
    var interviews = S.interviewsForApplication(ws.data, app.id);
    section.appendChild(
      h(
        'dl',
        { class: 'ca-meta' },
        h('div', null, h('dt', null, '投递状态'), h('dd', null, C.APPLICATION_STATUS[app.status])),
        h('div', null, h('dt', null, '投递时间'), h('dd', null, app.submittedAt ? ui.formatDateTime(app.submittedAt, tz) : '尚未记录已投递')),
        h(
          'div',
          null,
          h('dt', null, '招聘方回复'),
          h('dd', null, app.hasHrReply ? '已回复' + (app.firstHrReplyAt ? '，最早于 ' + ui.formatDateTime(app.firstHrReplyAt, tz) : '，时间未知') : '尚无回复记录')
        ),
        app.submittedAt
          ? h('div', null, h('dt', null, '投递材料'), h('dd', null, app.materialsUnknown ? '未记录投递材料（补录的历史投递）' : app.submittedDocumentVersionIds.length + ' 个文档版本'))
          : null
      )
    );
    if (interviews.length) {
      section.appendChild(
        h(
          'ol',
          { class: 'ca-timeline', 'aria-label': '面试轮次' },
          interviews.map(function (iv) {
            var when = iv.status === 'completed' ? '完成于 ' + ui.formatDateTime(iv.completedAt, tz) : iv.scheduledAt ? '排期 ' + ui.formatDateTime(iv.scheduledAt, tz) : '时间待定';
            return h(
              'li',
              { class: 'ca-timeline__item' },
              h(
                'a',
                { class: 'ca-timeline__link', href: shared.interviewHash(iv.id) },
                h('span', { class: 'ca-timeline__title' }, '第 ' + iv.roundNumber + ' 轮｜' + iv.label),
                ui.badge(C.INTERVIEW_STATUS[iv.status], iv.status === 'completed' ? 'ok' : 'info'),
                h('span', { class: 'ca-timeline__meta' }, when)
              )
            );
          })
        )
      );
    }
    section.appendChild(
      h(
        'div',
        { class: 'ca-actions' },
        ui.link(shared.interviewsHash(jobId ? jobId : app.jobId, goalId), '查看／登记面试记录', {
          className: 'ca-btn ca-btn--secondary ca-btn--sm',
          icon: 'comments'
        })
      )
    );
    section.appendChild(shared.demoDateNote());
    return section;
  }

  function evidenceItem(ws, as, ev, jobId, goalId) {
    var snap = as.assetSnapshots.filter(function (s) {
      return s.assetId === ev.assetId && s.revision === ev.assetRevision;
    })[0];
    var current = S.asset(ws.data, ev.assetId);
    var pending = !snap.provenance.userConfirmed;
    var changed = !current || current.revision !== ev.assetRevision;
    return h(
      'li',
      { class: 'ca-evidence' + (pending ? ' is-pending' : '') },
      h('p', { class: 'ca-evidence__req' }, h('span', { class: 'ca-evidence__label' }, '对应要求'), ev.requirement),
      h('blockquote', { class: 'ca-evidence__quote' }, ev.excerpt),
      h(
        'p',
        { class: 'ca-evidence__cite' },
        h('span', { class: 'ca-cite' }, snap.title),
        h('span', { class: 'ca-rev' }, '引用 版本 ' + ev.assetRevision),
        shared.confirmationBadge(snap.provenance, { snapshot: true }),
        pending ? ui.badge('待核实，不作为肯定证据', 'warn') : null,
        changed ? ui.badge(current ? '当前资产已更新到 版本 ' + current.revision : '资产已不存在', 'warn') : null
      ),
      h(
        'details',
        { class: 'ca-details' },
        h('summary', null, '对照评估时内容与当前资产'),
        h(
          'div',
          { class: 'ca-compare' },
          h('div', null, h('h4', { class: 'ca-compare__title' }, '评估时快照（版本 ' + snap.revision + '）'), h('p', { class: 'ca-compare__name' }, snap.title), h('p', { class: 'ca-pre' }, snap.body)),
          h(
            'div',
            null,
            h('h4', { class: 'ca-compare__title' }, current ? '当前资产（版本 ' + current.revision + '）' : '当前资产'),
            current ? [h('p', { class: 'ca-compare__name' }, current.title), h('p', { class: 'ca-pre' }, current.body)] : h('p', null, '该资产已不存在。')
          )
        )
      ),
      current
        ? h(
            'div',
            { class: 'ca-actions' },
            ui.link(shared.assetHash(ev.assetId, { fromJob: jobId, goal: goalId, rev: String(ev.assetRevision) }), '查看职业资产：' + current.title, {
              className: 'ca-btn ca-btn--secondary ca-btn--sm',
              icon: 'external-link'
            })
          )
        : null
    );
  }

  function judgementList(items, tone, emptyText) {
    if (!items.length) return h('p', { class: 'ca-help' }, emptyText);
    return h(
      'ul',
      { class: 'ca-judgements ca-judgements--' + tone },
      items.map(function (item) {
        return h('li', null, h('p', { class: 'ca-judgement__desc' }, item.description), h('p', { class: 'ca-judgement__basis' }, '依据：' + item.basis));
      })
    );
  }

  function renderAssessment(ws, goalId, job, tz) {
    var as = S.latestAssessment(ws.data, job.id, goalId);
    var section = h('section', { class: 'ca-subsection', 'aria-labelledby': 'job-assess' });
    section.appendChild(
      h(
        'div',
        { class: 'ca-section__head' },
        h('h3', { id: 'job-assess', class: 'ca-subsection__title' }, '岗位判断'),
        as ? ui.badge('演示评估：' + C.ORIGIN[as.origin] + '，非模型实时分析', 'demo') : null
      )
    );
    if (!as) {
      section.appendChild(ui.statePanel('empty', '该目标下还没有这个岗位的评估', '本阶段不调用模型，也不提供重新分析。'));
      return section;
    }
    var staleness = S.assessmentStaleness(ws.data, as);
    section.appendChild(h('p', { class: 'ca-help' }, '评估记录时间：' + ui.formatDateTime(as.createdAt, tz) + '。评估保存后不会被改写。'));
    if (staleness.isStale) {
      section.appendChild(
        ui.notice(
          'warn',
          [
            h('strong', null, '引用的职业资产已更新，当前评估可能过期。'),
            h(
              'span',
              null,
              staleness.changedAssets
                .map(function (c) {
                  var a = S.asset(ws.data, c.assetId);
                  return (a ? a.title : c.assetId) + '：评估引用 版本 ' + c.snapshotRevision + (c.currentRevision ? '，当前 版本 ' + c.currentRevision : '，资产已不存在');
                })
                .join('；') || staleness.reasons.join('；')
            ),
            h('span', null, '下方保留评估当时的内容与引用版本，本阶段不自动重新评估。')
          ]
        )
      );
    }

    section.appendChild(
      h('div', { class: 'ca-judgement-block' }, h('h4', { class: 'ca-judgement-block__title' }, 'Match 匹配'), shared.matchBadge(as.match.level), h('p', { class: 'ca-judgement__desc' }, as.match.summary), h('p', { class: 'ca-help' }, '匹配程度为预置演示判断，不是模型准确率或精确分数。'))
    );
    section.appendChild(
      h('div', { class: 'ca-judgement-block' }, h('h4', { class: 'ca-judgement-block__title' }, 'Gap 缺口'), h('p', { class: 'ca-help' }, '指目前缺少可引用的证据，不代表一定不具备该能力。'), judgementList(as.gaps, 'gap', '未列出缺口。'))
    );
    section.appendChild(
      h(
        'div',
        { class: 'ca-judgement-block' },
        h('h4', { class: 'ca-judgement-block__title' }, 'Evidence 证据（' + as.evidence.length + '）'),
        as.evidence.length
          ? h('ul', { class: 'ca-evidence-list' }, as.evidence.map(function (ev) { return evidenceItem(ws, as, ev, job.id, goalId); }))
          : h('p', { class: 'ca-help' }, '该评估没有引用职业资产。')
      )
    );
    section.appendChild(
      h('div', { class: 'ca-judgement-block' }, h('h4', { class: 'ca-judgement-block__title' }, 'Risk 风险'), h('p', { class: 'ca-help' }, '以下为演示判断中的不确定项，与已确认事实区分。'), judgementList(as.risks, 'risk', '未列出风险。'))
    );
    return section;
  }

  function renderDetail(ctx, job, goalId) {
    var ws = ctx.ws;
    var tz = S.user(ws.data).timeZone;
    var q = ctx.route.query;
    var goal = S.goal(ws.data, goalId);
    var app = S.applicationFor(ws.data, goalId, job.id);
    var stage = S.productStageForJob(ws.data, goalId, job.id);
    var detail = h('article', { class: 'ca-detail', 'aria-labelledby': 'job-detail-title' });

    detail.appendChild(ui.link('#/jobs', '返回岗位列表', { className: 'ca-link ca-back-list', icon: 'angle-left' }));

    if (goalId !== ws.ui.selectedGoalId) {
      detail.appendChild(
        ui.notice('info', '你正在目标「' + goal.title + '」的上下文中查看该岗位；当前全局目标为「' + S.goal(ws.data, ws.ui.selectedGoalId).title + '」。', [
          ui.button('切换当前目标为「' + goal.title + '」', { onClick: function () { ctx.app.selectGoal(goalId); } })
        ])
      );
    }
    if (q.notice === 'interview') {
      detail.appendChild(
        ui.notice('info', '可从下方进入面试记录与复盘。预置复盘会标明“演示预置”；新笔记保存后显示“尚未分析”。')
      );
    }

    detail.appendChild(
      h(
        'header',
        { class: 'ca-detail__head' },
        h('div', { class: 'ca-row__tags' }, ui.badge('当前阶段：' + C.PRODUCT_STAGE[stage], 'neutral'), ui.badge('所属目标：' + job.goalIds.map(function (id) { var g = S.goal(ws.data, id); return g ? g.title : id; }).join('、'), 'neutral')),
        h('h2', { id: 'job-detail-title', class: 'ca-detail__title' }, job.title),
        h('p', { class: 'ca-detail__sub' }, job.companyName + '｜' + job.location + '｜' + (job.salaryText || '岗位说明未写明薪资'))
      )
    );

    detail.appendChild(
      h(
        'div',
        { class: 'ca-actions ca-actions--primary' },
        ui.link(shared.prepareHash(job.id, goalId), '准备投递材料', { className: 'ca-btn ca-btn--primary', icon: 'file-text-o' }),
        ui.link(shared.interviewsHash(job.id, goalId), '面试记录', { className: 'ca-btn ca-btn--secondary', icon: 'comments' }),
        ui.link(shared.assetHash(null, { fromJob: job.id, goal: goalId }), '查看职业证据', { className: 'ca-btn ca-btn--secondary', icon: 'folder-open-o' })
      )
    );
    if (app && app.submittedAt) {
      detail.appendChild(h('p', { class: 'ca-help' }, '该岗位已记录投递。准备材料不会改变已投递记录。'));
    }

    var jdSource = job.provenance.sourceIds.map(function (sid) {
      var s = S.source(ws.data, sid);
      return s ? s.label + '（' + C.SOURCE_KIND[s.kind] + '）' : sid;
    });
    detail.appendChild(
      h(
        'section',
        { class: 'ca-subsection', 'aria-labelledby': 'job-jd' },
        h('h3', { id: 'job-jd', class: 'ca-subsection__title' }, '岗位要求'),
        h('p', { class: 'ca-pre' }, job.jdText),
        h('p', { class: 'ca-help' }, '来源：' + (jdSource.join('、') || '未记录') + '。岗位内容版本 ' + job.revision + '。')
      )
    );

    detail.appendChild(renderAssessment(ws, goalId, job, tz));
    detail.appendChild(renderApplication(ws, goalId, job.id, tz));
    return detail;
  }

  function render(ctx) {
    var ws = ctx.ws;
    var jobId = ctx.route.params.jobId;
    var q = ctx.route.query;
    var selectedGoalId = ws.ui.selectedGoalId;
    var selectedGoal = S.goal(ws.data, selectedGoalId);
    var page = h('section', { class: 'ca-page' });
    page.appendChild(shared.pageHeader('岗位工作区', '目标「' + selectedGoal.title + '」下收藏的岗位。评估为预置演示，不调用模型、不实时重新分析。'));

    var detailPane = h('div', { class: 'ca-pane ca-pane--detail' });
    if (!jobId) {
      detailPane.appendChild(ui.statePanel('info', '请选择一个岗位', '选择岗位后可查看匹配、缺口、证据与风险，并准备投递材料。'));
    } else {
      var job = S.job(ws.data, jobId);
      var goalParam = q.goal || null;
      var goalId = goalParam || selectedGoalId;
      var goal = S.goal(ws.data, goalId);
      if (!job) {
        detailPane.appendChild(
          ui.statePanel('error', '找不到这个岗位', '链接中的岗位编号「' + jobId + '」不存在。没有自动打开其他岗位。', [
            ui.link('#/jobs', '查看岗位列表', { className: 'ca-btn ca-btn--secondary' }),
            ui.link('#/home', '回到求职首页', { className: 'ca-btn ca-btn--secondary' })
          ])
        );
      } else if (!goal || goal.status !== 'active') {
        detailPane.appendChild(
          ui.statePanel('error', '链接中的求职目标无效', '目标编号「' + goalId + '」不存在或未启用，无法确定该岗位的判断上下文。', [
            ui.link('#/jobs', '查看岗位列表', { className: 'ca-btn ca-btn--secondary' })
          ])
        );
      } else if (!S.jobBelongsToGoal(job, goalId)) {
        var owners = job.goalIds
          .map(function (id) {
            return S.goal(ws.data, id);
          })
          .filter(function (g) {
            return g && g.status === 'active';
          });
        detailPane.appendChild(
          ui.statePanel(
            'error',
            '该岗位不属于目标「' + goal.title + '」',
            '「' + job.title + '」收藏在' + (owners.length ? '目标「' + owners.map(function (g) { return g.title; }).join('、') + '」下' : '其他目标下') + '。为避免混淆，未在当前目标中展示。',
            owners
              .map(function (g) {
                return ui.link(shared.jobHash(job.id, g.id), '在目标「' + g.title + '」中查看', { className: 'ca-btn ca-btn--secondary' });
              })
              .concat([ui.link('#/jobs', '查看当前目标岗位', { className: 'ca-btn ca-btn--secondary' })])
          )
        );
      } else {
        detailPane.appendChild(renderDetail(ctx, job, goalId));
      }
    }

    var listPane = h(
      'div',
      { class: 'ca-pane ca-pane--list', 'aria-label': '岗位列表' },
      h('p', { class: 'ca-help' }, '按当前目标筛选：' + selectedGoal.title),
      renderList(ws, selectedGoalId, jobId)
    );
    page.appendChild(h('div', { class: 'ca-split' + (jobId ? ' has-detail' : '') }, listPane, detailPane));
    return page;
  }

  CA.features.jobs = { render: render };
})(window);
