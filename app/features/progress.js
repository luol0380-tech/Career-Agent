(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  var META = {
    analyzed: {
      title: '已分析岗位',
      desc: '当前目标下已有岗位评估的岗位。',
      empty: '还没有完成岗位分析。'
    },
    submitted: {
      title: '已投递',
      desc: '当前目标下已记录外部投递的记录。',
      empty: '还没有记录投递。'
    },
    replies: {
      title: 'HR 回复',
      desc: '当前目标下已明确记录招聘方回复的投递。',
      empty: '还没有记录 HR 回复。'
    },
    interviews: {
      title: '面试记录',
      desc: '当前目标下已关联的面试轮次（含完成与排期中）。',
      empty: '还没有面试记录。'
    },
    guide: {
      title: '职业指南',
      desc: '用一条清晰的下一步建议推进当前目标。',
      empty: '职业指南将在后续阶段开放。'
    },
    review: {
      title: '面试复盘入口',
      desc: '从岗位进入面试记录，查看预置复盘或保存尚未分析的笔记。',
      empty: '请从岗位详情进入面试记录；复盘不会在这里伪装成已自动分析。'
    }
  };

  function renderJobRows(jobs, goalId, extraMeta) {
    return h(
      'ul',
      { class: 'ca-row-list' },
      jobs.map(function (job) {
        var meta = extraMeta ? extraMeta(job) : job.companyName + '｜' + job.location;
        return h(
          'li',
          null,
          h(
            'a',
            { class: 'ca-row', href: shared.jobHash(job.id, goalId) },
            h('span', { class: 'ca-row__title' }, job.title),
            h('span', { class: 'ca-row__meta' }, meta),
            h('span', { class: 'ca-row__tag' }, '查看岗位详情')
          )
        );
      })
    );
  }

  function renderInterviewRows(ws, goalId) {
    var list = S.interviewsForGoal(ws.data, goalId);
    var tz = S.user(ws.data).timeZone;
    return h(
      'ul',
      { class: 'ca-row-list' },
      list.map(function (iv) {
        var app = S.application(ws.data, iv.applicationId);
        var job = app ? S.job(ws.data, app.jobId) : null;
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
              (job ? job.companyName + '｜' + job.title + '｜' : '') +
                (iv.scheduledAt ? ui.formatDateTime(iv.scheduledAt, tz) : '时间待定')
            ),
            h(
              'span',
              { class: 'ca-row__tags' },
              ui.badge(C.INTERVIEW_STATUS[iv.status], iv.status === 'completed' ? 'ok' : 'info')
            )
          )
        );
      })
    );
  }

  function render(ctx) {
    var ws = ctx.ws;
    var goalId = ws.ui.selectedGoalId;
    var kind = ctx.route.params.kind || 'analyzed';
    var meta = META[kind];
    var page = h('section', { class: 'ca-page' });

    if (!meta) {
      page.appendChild(shared.pageHeader('求职进展'));
      page.appendChild(
        ui.statePanel('error', '未知的进展入口', '链接中的进展类型无效。', [
          ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })
        ])
      );
      return page;
    }

    page.appendChild(shared.pageHeader(meta.title, meta.desc));
    page.appendChild(
      h('div', { class: 'ca-actions' }, ui.link('#/home', '返回求职进展', { className: 'ca-btn ca-btn--secondary', icon: 'reply' }))
    );

    if (kind === 'guide') {
      page.appendChild(
        ui.statePanel('empty', meta.empty, '当前版本保留入口说明，不会伪装成已完成的功能。', [
          ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })
        ])
      );
      return page;
    }

    if (kind === 'review') {
      var withInterview = S.interviewsForGoal(ws.data, goalId);
      if (!withInterview.length) {
        page.appendChild(
          ui.statePanel('empty', meta.empty, '当前目标下还没有面试。可先在岗位详情登记面试。', [
            ui.link('#/jobs', '打开岗位工作区', { className: 'ca-btn ca-btn--primary' })
          ])
        );
        return page;
      }
      page.appendChild(h('p', { class: 'ca-progress-count' }, '当前目标：' + withInterview.length + ' 场面试'));
      page.appendChild(renderInterviewRows(ws, goalId));
      return page;
    }

    if (kind === 'interviews') {
      var interviews = S.interviewsForGoal(ws.data, goalId);
      page.appendChild(h('p', { class: 'ca-progress-count' }, '当前目标：' + interviews.length + ' 场面试'));
      page.appendChild(
        interviews.length
          ? renderInterviewRows(ws, goalId)
          : ui.statePanel('empty', meta.empty, '可以先回到求职进展，查看其他下一步。', [
              ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })
            ])
      );
      return page;
    }

    var jobs = [];
    var tz = S.user(ws.data).timeZone;
    if (kind === 'analyzed') {
      jobs = S.analyzedJobsForGoal(ws.data, goalId);
      page.appendChild(h('p', { class: 'ca-progress-count' }, '当前目标：' + jobs.length + ' 个岗位'));
      page.appendChild(
        jobs.length
          ? renderJobRows(jobs, goalId)
          : ui.statePanel('empty', meta.empty, '可以先回到求职进展。', [ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })])
      );
      return page;
    }

    if (kind === 'submitted') {
      var submitted = S.submittedApplicationsForGoal(ws.data, goalId);
      page.appendChild(h('p', { class: 'ca-progress-count' }, '当前目标：' + submitted.length + ' 条投递'));
      if (!submitted.length) {
        page.appendChild(
          ui.statePanel('empty', meta.empty, '可以先回到求职进展。', [ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })])
        );
        return page;
      }
      page.appendChild(
        h(
          'ul',
          { class: 'ca-row-list' },
          submitted.map(function (app) {
            var job = S.job(ws.data, app.jobId);
            return h(
              'li',
              null,
              h(
                'a',
                { class: 'ca-row', href: shared.jobHash(app.jobId, goalId) },
                h('span', { class: 'ca-row__title' }, job ? job.title : app.jobId),
                h(
                  'span',
                  { class: 'ca-row__meta' },
                  (job ? job.companyName + '｜' : '') +
                    C.APPLICATION_STATUS[app.status] +
                    (app.submittedAt ? '｜' + ui.formatDateTime(app.submittedAt, tz) : '')
                ),
                h('span', { class: 'ca-row__tag' }, '查看岗位')
              )
            );
          })
        )
      );
      return page;
    }

    if (kind === 'replies') {
      var replies = S.hrReplyApplicationsForGoal(ws.data, goalId);
      page.appendChild(h('p', { class: 'ca-progress-count' }, '当前目标：' + replies.length + ' 条已回复投递'));
      if (!replies.length) {
        page.appendChild(
          ui.statePanel('empty', meta.empty, '可以先回到求职进展。', [ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })])
        );
        return page;
      }
      page.appendChild(
        h(
          'ul',
          { class: 'ca-row-list' },
          replies.map(function (app) {
            var job = S.job(ws.data, app.jobId);
            return h(
              'li',
              null,
              h(
                'a',
                { class: 'ca-row', href: shared.jobHash(app.jobId, goalId) },
                h('span', { class: 'ca-row__title' }, job ? job.title : app.jobId),
                h(
                  'span',
                  { class: 'ca-row__meta' },
                  (job ? job.companyName + '｜' : '') +
                    (app.firstHrReplyAt ? '最早回复 ' + ui.formatDateTime(app.firstHrReplyAt, tz) : '已回复，时间未知')
                ),
                h('span', { class: 'ca-row__tag' }, '查看岗位')
              )
            );
          })
        )
      );
      return page;
    }

    page.appendChild(ui.statePanel('error', '未知入口', '', [ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--primary' })]));
    return page;
  }

  CA.features.progress = { render: render };
})(window);
