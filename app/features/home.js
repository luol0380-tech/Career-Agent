(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;

  var METRICS = [
    { key: 'analyzedJobs', label: '已分析岗位', kind: 'analyzed', hint: '有岗位评估的不同岗位数' },
    { key: 'submitted', label: '已投递', kind: 'submitted', hint: '已记录外部投递的投递数' },
    { key: 'hrReplies', label: 'HR 回复', kind: 'replies', hint: '明确记录过招聘方回复的投递数' },
    { key: 'completedInterviews', label: '面试次数', kind: 'interviews', hint: '已完成的面试轮次，不含排期中' }
  ];

  function actionTarget(item, goalId) {
    var isInterview = item.kind === 'prepare_interview' || item.kind === 'complete_interview_review';
    var actions = [];
    if (item.kind === 'complete_profile') {
      actions.push(
        ui.link(shared.assetHash(null, item.jobId ? { fromJob: item.jobId, goal: goalId } : {}), '查看职业资产', {
          className: 'ca-btn ca-btn--primary ca-btn--sm'
        })
      );
    }
    if (item.kind === 'prepare_documents' && item.jobId) {
      actions.push(
        ui.link(shared.prepareHash(item.jobId, goalId), '准备投递材料', {
          className: 'ca-btn ca-btn--primary ca-btn--sm'
        })
      );
    }
    if (isInterview && item.interviewId) {
      actions.push(
        ui.link(shared.interviewHash(item.interviewId), '打开面试记录', {
          className: 'ca-btn ca-btn--primary ca-btn--sm'
        })
      );
    } else if (isInterview && item.jobId) {
      actions.push(
        ui.link(shared.interviewsHash(item.jobId, goalId), '打开面试记录', {
          className: 'ca-btn ca-btn--primary ca-btn--sm'
        })
      );
    }
    if (item.jobId) {
      actions.push(
        ui.link(shared.jobHash(item.jobId, goalId, isInterview ? { notice: 'interview', action: item.id } : { action: item.id }), '查看岗位', {
          className: 'ca-btn ca-btn--' + (actions.length ? 'secondary' : 'primary') + ' ca-btn--sm'
        })
      );
    }
    return actions;
  }

  function renderActionItem(ws, item, goalId, tz) {
    var job = item.jobId ? S.job(ws.data, item.jobId) : null;
    var interview = item.interviewId ? S.interview(ws.data, item.interviewId) : null;
    var due = ui.formatDateTime(item.dueAt, tz);
    var meta = [];
    if (job) meta.push(h('span', null, job.companyName + '｜' + job.title));
    if (interview && interview.scheduledAt) {
      meta.push(h('span', null, '面试时间：' + ui.formatDateTime(interview.scheduledAt, tz) + '（' + C.INTERVIEW_STATUS[interview.status] + '）'));
    }
    meta.push(h('span', null, due ? '截止：' + due : '截止时间：未设置'));
    return h(
      'li',
      { class: 'ca-task' },
      h(
        'div',
        { class: 'ca-task__main' },
        h('div', { class: 'ca-task__head' }, ui.badge(C.ACTION_ITEM_KIND[item.kind], 'neutral'), ui.badge(C.ACTION_ITEM_STATUS[item.status], 'info')),
        h('h3', { class: 'ca-task__title' }, item.title),
        h('p', { class: 'ca-task__meta' }, meta)
      ),
      h('div', { class: 'ca-actions' }, actionTarget(item, goalId))
    );
  }

  function render(ctx) {
    var ws = ctx.ws;
    var goalId = ws.ui.selectedGoalId;
    var goal = S.goal(ws.data, goalId);
    var user = S.user(ws.data);
    var tz = user.timeZone;
    var metrics = S.goalMetrics(ws.data, goalId);
    var actions = S.openActionItemsForGoal(ws.data, goalId);
    var jobs = S.jobsForGoal(ws.data, goalId);

    var goalFacts = [
      '目标岗位：' + goal.targetRoles.join('、'),
      '城市：' + (goal.cities.length ? goal.cities.join('、') : '未设置'),
      '期望薪资：' + (goal.salaryExpectation || '未设置')
    ];

    var page = h('section', { class: 'ca-page' });
    page.appendChild(
      shared.pageHeader('求职进展：' + goal.title, user.displayName + '的求职记录。先处理下一步，再查看整体进展。', h('ul', { class: 'ca-facts' }, goalFacts.map(function (t) { return h('li', null, t); })))
    );

    var currentResume = S.currentResumeFile(ws.data);
    page.appendChild(
      h(
        'section',
        { class: 'ca-section ca-section--hero-actions', 'aria-labelledby': 'home-primary' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'home-primary', class: 'ca-section__title' }, '从这里开始'), h('span', { class: 'ca-section__meta' }, '上传、查看、整理')),
        h(
          'div',
          { class: 'ca-primary-actions' },
          ui.link(shared.resumeHash({ upload: '1' }), '上传 PDF 简历', {
            className: 'ca-btn ca-btn--primary ca-btn--lg',
            icon: 'upload'
          }),
          ui.link(shared.resumeHash(), currentResume ? '查看／修改我的简历' : '打开我的简历', {
            className: 'ca-btn ca-btn--secondary ca-btn--lg',
            icon: 'file-text-o'
          }),
          ui.link(shared.reviseResumeHash(), '帮我改简历', {
            className: 'ca-btn ca-btn--secondary ca-btn--lg',
            icon: 'magic'
          }),
          ui.link('#/jobs', '开始整理求职材料', {
            className: 'ca-btn ca-btn--secondary ca-btn--lg',
            icon: 'briefcase'
          })
        ),
        currentResume
          ? h(
              'p',
              { class: 'ca-help' },
              '当前材料：' +
                currentResume.fileName +
                '（' +
                (CA.features.resume && CA.features.resume.displayStatus
                  ? CA.features.resume.displayStatus(currentResume).label
                  : C.RESUME_FILE_STATUS[currentResume.status]) +
                '）'
            )
          : h('p', { class: 'ca-help' }, '还没有上传简历。上传后即可查看／编辑；用于岗位材料时再确认使用。'),
        h(
          'div',
          { class: 'ca-actions' },
          ui.link('#/assistant', '求职助手帮我指路', { className: 'ca-btn ca-btn--ghost', icon: 'comments' }),
          ui.link('#/assistant', '记录 Offer／改期面试', { className: 'ca-btn ca-btn--ghost', icon: 'map-signs' })
        )
      )
    );

    var actionsSection = (
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'home-actions' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'home-actions', class: 'ca-section__title' }, '待办'), h('span', { class: 'ca-section__meta' }, '当前目标，共 ' + actions.length + ' 项待处理')),
        actions.length
          ? h('ul', { class: 'ca-task-list' }, actions.map(function (item) { return renderActionItem(ws, item, goalId, tz); }))
          : ui.statePanel('empty', '当前目标暂无待办', '可以先查看下方岗位，核对职业证据。', [
              ui.link('#/jobs', '查看岗位工作区', { className: 'ca-btn ca-btn--secondary' })
            ]),
        shared.demoDateNote()
      )
    );

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'home-metrics' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'home-metrics', class: 'ca-section__title' }, '进展'), h('span', { class: 'ca-section__meta' }, '当前目标 · 累计')),
        h(
          'dl',
          { class: 'ca-metrics' },
          METRICS.map(function (m) {
            return h('div', { class: 'ca-metric' }, h('dt', null, h('a', { href: '#/progress/' + m.kind, class: 'ca-metric__link' }, m.label)), h('dd', { class: 'ca-metric__value' }, String(metrics[m.key])), h('dd', { class: 'ca-metric__hint' }, m.hint));
          })
        )
      )
    );
    page.appendChild(actionsSection);

    page.appendChild(
      h('section', { class: 'ca-section', 'aria-labelledby': 'home-guide' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'home-guide', class: 'ca-section__title' }, '下一步'), h('span', { class: 'ca-section__meta' }, '把事情往前推进')),
        h('div', { class: 'ca-guide-links' },
          ui.link('#/assistant', '求职助手', { className: 'ca-btn ca-btn--primary' }),
          ui.link('#/progress/guide', '查看职业指南', { className: 'ca-btn ca-btn--secondary' }),
          ui.link('#/progress/review', '面试复盘', { className: 'ca-btn ca-btn--secondary' })
        )
      )
    );

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'home-jobs' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'home-jobs', class: 'ca-section__title' }, '相关岗位'), h('span', { class: 'ca-section__meta' }, jobs.length + ' 个岗位')),
        jobs.length
          ? h(
              'ul',
              { class: 'ca-row-list' },
              jobs.map(function (job) {
                var app = S.applicationFor(ws.data, goalId, job.id);
                return h(
                  'li',
                  null,
                  h(
                    'a',
                    { class: 'ca-row', href: shared.jobHash(job.id, goalId) },
                    h('span', { class: 'ca-row__title' }, job.title),
                    h('span', { class: 'ca-row__meta' }, job.companyName + '｜' + job.location),
                    h('span', { class: 'ca-row__tag' }, app ? C.APPLICATION_STATUS[app.status] : '未建立投递记录')
                  )
                );
              })
            )
          : ui.statePanel('empty', '当前目标下还没有收藏岗位', '本阶段不提供新增岗位，可切换到其他目标查看。')
      )
    );
    return page;
  }

  CA.features.home = { render: render };
})(window);
