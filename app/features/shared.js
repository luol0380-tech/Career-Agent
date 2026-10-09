(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var C = CA.domain.constants;
  var S = CA.domain.selectors;
  var buildHash = CA.components.router.buildHash;

  function confirmationBadge(provenance, opts) {
    opts = opts || {};
    if (provenance.userConfirmed) return ui.badge(opts.snapshot ? '评估时已确认' : '已确认', 'ok');
    return ui.badge(opts.snapshot ? '评估时待确认' : '待确认', 'warn');
  }

  function confidenceText(provenance) {
    if (provenance.confidence === null) return '无提取过程，未记录置信度';
    return '提取自报置信度 ' + provenance.confidence.toFixed(2) + '（演示值，不代表内容真实性或模型准确率）';
  }

  function matchBadge(level) {
    var tone = { high: 'ok', medium: 'info', low: 'warn', unknown: 'neutral' }[level] || 'neutral';
    return ui.badge('匹配程度：' + C.MATCH_LEVEL[level], tone);
  }

  function pageHeader(title, subtitle, extra) {
    return h(
      'header',
      { class: 'ca-page-header' },
      h('h1', { class: 'ca-page-title', tabindex: '-1', 'data-focus-target': 'true' }, title),
      subtitle ? h('p', { class: 'ca-page-subtitle' }, subtitle) : null,
      extra || null
    );
  }

  function jobHash(jobId, goalId, extra) {
    return buildHash('/jobs/' + encodeURIComponent(jobId), Object.assign({ goal: goalId }, extra || {}));
  }

  function assetHash(assetId, query) {
    return buildHash('/vault' + (assetId ? '/' + encodeURIComponent(assetId) : ''), query || {});
  }

  function prepareHash(jobId, goalId, extra) {
    return buildHash('/prepare', Object.assign({ job: jobId, goal: goalId }, extra || {}));
  }

  function interviewsHash(jobId, goalId) {
    return buildHash('/interviews', { job: jobId, goal: goalId });
  }

  function interviewHash(interviewId) {
    return buildHash('/interview/' + encodeURIComponent(interviewId));
  }

  function resumeHash(extra) {
    return buildHash('/resume', extra || {});
  }

  function reviseResumeHash(extra) {
    return buildHash('/resume/revise', extra || {});
  }

  function demoDateNote() {
    return h('p', { class: 'ca-demo-date' }, ui.icon('calendar'), h('span', null, '演示日程：页面中的日期均为固定的合成时间，不随今天变化。'));
  }

  function notFoundView(title, message) {
    var wrap = h('section', { class: 'ca-page' });
    wrap.appendChild(pageHeader(title));
    wrap.appendChild(
      ui.statePanel('error', title, message, [
        ui.link('#/home', '回到求职首页', { className: 'ca-btn ca-btn--primary', icon: 'home' })
      ])
    );
    return wrap;
  }

  /** 在「使用此简历」场景展示确认条（投递材料／改简历） */
  function resumeUseBanner(ctx, opts) {
    opts = opts || {};
    var file = S.currentResumeFile(ctx.ws.data);
    if (!file || file.status === 'read_failed') return null;
    var hasText = !!(file.textDraft && String(file.textDraft).trim());
    if (file.status === 'confirmed') {
      return ui.notice(
        'ok',
        '当前使用的简历「' + file.fileName + '」已确认。修改正文后需再次确认才会作为最新可用内容。'
      );
    }
    if (!hasText) {
      return ui.notice('warn', [
        h('p', null, '当前简历「' + file.fileName + '」还没有正文。请先到「我的简历」粘贴或编辑后再用于本岗位。'),
        h(
          'div',
          { class: 'ca-actions' },
          ui.link(resumeHash({ file: file.id }), '去填写正文', { className: 'ca-btn ca-btn--secondary ca-btn--sm' })
        )
      ]);
    }
    var busyFlag = { on: false };
    return ui.notice('warn', [
      h(
        'p',
        null,
        '即将使用简历「' +
          file.fileName +
          '」。确认后才会把它当作已核实材料用于本流程；本演示不会自动改写内容。'
      ),
      h(
        'div',
        { class: 'ca-actions' },
        ui.button('确认使用此简历', {
          variant: 'primary',
          disabled: !ctx.ws.status.writable,
          onClick: function () {
            if (busyFlag.on) return;
            busyFlag.on = true;
            ctx.app.service
              .confirmResumeFile({ fileId: file.id, commandId: ctx.app.service.newCommandId() })
              .then(function () {
                busyFlag.on = false;
                ui.toast(opts.successToast || '已确认使用这份简历。', 'ok');
                ctx.app.refresh();
              })
              .catch(function (e) {
                busyFlag.on = false;
                ui.toast(e.message || '确认未完成', 'danger');
              });
          }
        }),
        ui.link(resumeHash({ file: file.id }), '先去查看正文', { className: 'ca-btn ca-btn--ghost ca-btn--sm' })
      )
    ]);
  }

  CA.features.shared = {
    confirmationBadge: confirmationBadge,
    confidenceText: confidenceText,
    matchBadge: matchBadge,
    pageHeader: pageHeader,
    jobHash: jobHash,
    assetHash: assetHash,
    prepareHash: prepareHash,
    interviewsHash: interviewsHash,
    interviewHash: interviewHash,
    resumeHash: resumeHash,
    reviseResumeHash: reviseResumeHash,
    resumeUseBanner: resumeUseBanner,
    demoDateNote: demoDateNote,
    notFoundView: notFoundView
  };
})(window);
