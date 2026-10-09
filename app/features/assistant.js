(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var shared = CA.features.shared;
  var S = CA.domain.selectors;

  var GUIDES = [
    {
      id: 'upload',
      title: '我想上传 PDF 简历',
      body: '打开「我的简历」，选择本地 PDF。上传后即可查看／编辑；能读出文字时会填入正文，读不出时可手动粘贴。',
      href: function () {
        return shared.resumeHash({ upload: '1' });
      },
      cta: '去上传简历'
    },
    {
      id: 'edit',
      title: '我想查看或修改简历',
      body: '在「我的简历」里打开当前材料，编辑正文后保存。若要按岗位使用，请走「帮我改简历」。',
      href: function () {
        return shared.resumeHash();
      },
      cta: '打开我的简历'
    },
    {
      id: 'revise',
      title: '我想按岗位改简历',
      body: '进入「帮我改简历」选择岗位，按准备→生成→检查保存处理。未配置模型时显示尚未接入真实 AI；也可用本地演示建议练习（会明确标注非 AI）。',
      href: function () {
        return shared.reviseResumeHash();
      },
      cta: '打开帮我改简历'
    },
    {
      id: 'jobs',
      title: '我想看看岗位和匹配',
      body: '岗位工作区里有当前目标下的岗位与演示评估。评估是预置演示，不是实时模型分析。',
      href: function () {
        return '#/jobs';
      },
      cta: '查看岗位'
    },
    {
      id: 'interview',
      title: '我想记录或复盘面试',
      body: '先从岗位进入面试记录。新笔记保存后显示尚未分析，不会自动套用样例结论。',
      href: function (ws) {
        var goalId = ws.ui.selectedGoalId;
        var iv = S.interviewsForGoal(ws.data, goalId)[0];
        if (iv) return shared.interviewHash(iv.id);
        var job = S.jobsForGoal(ws.data, goalId)[0];
        return job ? shared.interviewsHash(job.id, goalId) : '#/jobs';
      },
      cta: '去面试记录'
    },
    {
      id: 'prepare',
      title: '我想整理投递材料',
      body: '从岗位详情进入准备材料，可编辑简历／自我介绍／开场沟通，并记录外部投递。使用简历前会请你确认。',
      href: function (ws) {
        var goalId = ws.ui.selectedGoalId;
        var job = S.jobsForGoal(ws.data, goalId)[0];
        return job ? shared.prepareHash(job.id, goalId) : '#/jobs';
      },
      cta: '开始整理材料'
    },
    {
      id: 'outcome',
      title: '我想记录 Offer／拒绝／退出',
      body: '在准备材料页的「投递跟进」里记录外部已发生的结果。不会向招聘平台自动投递；结束后不能改回进行中。',
      href: function (ws) {
        var goalId = ws.ui.selectedGoalId;
        var apps = (ws.data.applications || []).filter(function (a) {
          return a.goalId === goalId && a.status !== 'rejected' && a.status !== 'withdrawn' && a.status !== 'accepted';
        });
        var app = apps[0] || (ws.data.applications || []).filter(function (a) { return a.goalId === goalId; })[0];
        if (app) return shared.prepareHash(app.jobId, goalId);
        var job = S.jobsForGoal(ws.data, goalId)[0];
        return job ? shared.prepareHash(job.id, goalId) : '#/jobs';
      },
      cta: '去记录投递结果'
    },
    {
      id: 'reschedule',
      title: '我想改期或取消面试',
      body: '打开未完成的面试详情，可改期（不新增轮次）或取消本轮；投递状态会按规则更新。',
      href: function (ws) {
        var goalId = ws.ui.selectedGoalId;
        var open = S.interviewsForGoal(ws.data, goalId).filter(function (iv) {
          return iv.status === 'scheduled' || iv.status === 'invited';
        })[0];
        if (open) return shared.interviewHash(open.id);
        var iv = S.interviewsForGoal(ws.data, goalId)[0];
        if (iv) return shared.interviewHash(iv.id);
        var job = S.jobsForGoal(ws.data, goalId)[0];
        return job ? shared.interviewsHash(job.id, goalId) : '#/jobs';
      },
      cta: '打开面试详情'
    }
  ];

  function render(ctx) {
    var page = h('section', { class: 'ca-page' });
    page.appendChild(
      shared.pageHeader(
        '求职助手',
        '用几条固定引导帮你找到正确页面。这不是完整聊天机器人，也不会分析你的简历或编造结论。'
      )
    );
    page.appendChild(
      ui.notice('info', '演示 Beta：助手只负责指路；上传、修改、确认都在对应页面用按钮完成。')
    );
    page.appendChild(
      h(
        'ul',
        { class: 'ca-guide-list' },
        GUIDES.map(function (g) {
          var href = g.href(ctx.ws);
          return h(
            'li',
            { class: 'ca-guide-card' },
            h('h3', { class: 'ca-guide-card__title' }, g.title),
            h('p', { class: 'ca-guide-card__body' }, g.body),
            ui.link(href, g.cta, { className: 'ca-btn ca-btn--primary', icon: 'arrow-right' })
          );
        })
      )
    );
    page.appendChild(
      h('div', { class: 'ca-actions' }, ui.link('#/home', '返回求职进展', { className: 'ca-btn ca-btn--secondary', icon: 'reply' }))
    );
    return page;
  }

  CA.features.assistant = { render: render };
})(window);
