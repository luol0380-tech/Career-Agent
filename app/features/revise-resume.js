(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.features = CA.features || {};
  var ui = CA.components.ui;
  var h = ui.h;
  var S = CA.domain.selectors;
  var shared = CA.features.shared;
  var Sug = CA.lib.reviseSuggestions;
  var Prompt = CA.lib.revisePrompt;
  var AI = CA.lib.aiProvider;

  var busy = false;
  var appRef = null;
  var session = null;
  var configBusy = false;
  var configMessage = null;
  var statusRefreshStarted = false;
  var statusCheckedOnce = false;

  function hasReadableText(file) {
    return !!(file && file.textDraft && String(file.textDraft).trim());
  }

  function stopSession() {
    session = null;
    if (appRef) appRef.router.clearGuard(guard);
  }

  var guard = {
    isDirty: function () {
      if (!session) return false;
      return session.draftText !== session.cleanText;
    },
    confirmLeave: function () {
      return ui.confirmDialog({
        title: '有未保存的定向修改草稿',
        message: '离开后这次在页面上的建议处理会丢失；已点「保存为新草稿」写入岗位材料的内容不受影响，原简历正文也不会被改掉。',
        confirmText: '放弃修改并离开',
        cancelText: '继续编辑',
        danger: true
      });
    },
    discard: function () {
      stopSession();
    }
  };

  function markDirty(ctx) {
    if (!ctx || !ctx.app || !ctx.app.router) return;
    if (guard.isDirty()) ctx.app.router.setGuard(guard);
    else ctx.app.router.clearGuard(guard);
  }

  function phaseLabel(phase) {
    return (
      {
        unconfigured: '未接入',
        pending_verify: '已配置待验证',
        verified: '验证成功',
        failed: '验证失败'
      }[phase] || phase
    );
  }

  function callPhaseLabel(phase) {
    return (
      {
        idle: '待命',
        preparing: '准备中',
        requesting: '请求中',
        success: '成功',
        failed: '失败'
      }[phase] || phase
    );
  }

  function ensureBackendStatus(ctx) {
    if (statusRefreshStarted || statusCheckedOnce) return;
    if (!AI.refreshStatus) return;
    statusRefreshStarted = true;
    AI.refreshStatus().then(
      function () {
        statusRefreshStarted = false;
        statusCheckedOnce = true;
        if (ctx && ctx.app) ctx.app.rerender();
      },
      function () {
        statusRefreshStarted = false;
        statusCheckedOnce = true;
        if (ctx && ctx.app) ctx.app.rerender();
      }
    );
  }

  function renderBackendStatusPanel(ctx) {
    ensureBackendStatus(ctx);
    var st = AI.getStatus();
    var phase = st.configPhase || (st.configured ? 'pending_verify' : 'unconfigured');
    var tone = phase === 'verified' ? 'ok' : phase === 'failed' || phase === 'unconfigured' ? 'warn' : 'info';
    var facts = [];
    facts.push(h('li', null, '接入方式：本机助手服务（密钥只在服务端 .env，页面不粘贴密钥）'));
    facts.push(h('li', null, '模型：' + (st.model || 'deepseek-chat')));
    facts.push(h('li', null, '状态：' + phaseLabel(phase)));
    if (st.verify && st.verify.message) facts.push(h('li', null, st.verify.message));
    if (st.reason) facts.push(h('li', null, st.reason));

    return h(
      'section',
      { class: 'ca-section', 'aria-labelledby': 'ai-config-title' },
      h(
        'div',
        { class: 'ca-section__head' },
        h('h2', { id: 'ai-config-title', class: 'ca-section__title' }, '本机模型服务'),
        h('span', { class: 'ca-section__meta' }, ui.badge(phaseLabel(phase), tone))
      ),
      ui.notice(
        tone,
        st.configured
          ? '已连接到本机助手服务。生成前请确认发送范围；返回的建议仍须你逐条核对，系统不能证明没有新增未经依据的内容。'
          : '真实生成需要本机助手服务，并由服务端读取 DEEPSEEK_API_KEY。未连接或未配置时不能发起真实生成，也不会伪装成功。可用「本地演示建议」练习流程。'
      ),
      h('ul', { class: 'ca-facts' }, facts),
      configMessage ? ui.notice(configMessage.tone || 'info', configMessage.text) : null,
      h(
        'div',
        { class: 'ca-actions' },
        ui.button(configBusy ? '检查中…' : '重新检查服务', {
          variant: 'secondary',
          disabled: configBusy,
          onClick: function () {
            if (configBusy || !AI.refreshStatus) return;
            configBusy = true;
            configMessage = { tone: 'info', text: '正在检查本机助手服务…' };
            ctx.app.rerender();
            AI.refreshStatus().then(
              function () {
                configBusy = false;
                var now = AI.getStatus();
                configMessage = {
                  tone: now.configured ? 'ok' : 'warn',
                  text: now.configured ? '本机服务可用。' : now.reason || '本机服务不可用。'
                };
                ctx.app.rerender();
              },
              function () {
                configBusy = false;
                configMessage = { tone: 'warn', text: '检查失败。请确认已通过授权启动的本机地址打开页面。' };
                ctx.app.rerender();
              }
            );
          }
        }),
        ui.button(configBusy ? '验证中…' : '验证连接', {
          variant: 'primary',
          disabled: configBusy || !st.configured,
          onClick: function () {
            if (configBusy || !AI.getStatus().configured) return;
            configBusy = true;
            configMessage = { tone: 'info', text: '正在验证连接（不会发送简历正文）…' };
            ctx.app.rerender();
            AI.verifyConfig().then(
              function () {
                configBusy = false;
                configMessage = { tone: 'ok', text: '验证成功。生成前仍需确认发送范围，并在采纳前检查建议内容。' };
                ctx.app.rerender();
              },
              function (err) {
                configBusy = false;
                configMessage = { tone: 'warn', text: (err && err.message) || '验证失败' };
                ctx.app.rerender();
              }
            );
          }
        })
      )
    );
  }

  function statusLabel(result) {
    if (result === 'accepted') return { text: '已采纳', tone: 'ok' };
    if (result === 'skipped') return { text: '已跳过', tone: 'neutral' };
    if (result === 'rewritten') return { text: '已改写后采纳', tone: 'info' };
    return { text: '待处理', tone: 'warn' };
  }

  function mapItems(suggestions) {
    return (suggestions || []).map(function (sug, i) {
      return {
        id: sug.id || 'sug_' + (i + 1),
        kind: sug.kind,
        title: sug.title,
        reason: sug.reason,
        targetExcerpt: sug.targetExcerpt,
        proposedReplacement: sug.proposedReplacement,
        needsUserConfirm: !!sug.needsUserConfirm,
        result: 'pending',
        appliedText: null
      };
    });
  }

  function ensureSession(ctx, job, file) {
    var sourceText = file.textDraft || '';
    if (session && session.jobId === job.id && session.fileId === file.id && session.sourceText === sourceText) {
      return session;
    }
    session = {
      jobId: job.id,
      fileId: file.id,
      sourceText: sourceText,
      draftText: sourceText,
      cleanText: sourceText,
      step: 'prepare',
      sendConfirmed: false,
      callPhase: 'idle',
      items: [],
      suggestionSource: null,
      generation: null,
      genError: null,
      editingId: null,
      editText: '',
      saveAttempt: null,
      lastError: null,
      savedOnce: false
    };
    return session;
  }

  function findTailoredDoc(data, goalId, jobId) {
    return (data.documents || []).filter(function (doc) {
      return (
        doc.kind === 'resume' &&
        doc.jobId === jobId &&
        doc.goalId === goalId &&
        doc.draft &&
        doc.draft.parameters &&
        doc.draft.parameters.variant === 'tailored'
      );
    })[0];
  }

  function recordGeneration(meta) {
    if (!session) return;
    session.generation = {
      at: meta.at || new Date().toISOString(),
      jobId: session.jobId,
      providerId: meta.providerId || null,
      model: meta.model || null,
      status: meta.status,
      errorCode: meta.errorCode || null,
      suggestionCount: meta.suggestionCount || 0,
      source: meta.source || null
    };
  }

  function runGenerate(ctx, job, file, mode) {
    if (!session || busy) return;
    var assessment = S.latestAssessment(ctx.ws.data, job.id, ctx.ws.ui.selectedGoalId);
    var payload = { job: job, resumeText: session.sourceText, assessment: assessment };
    var preservedDraft = session.draftText;
    var preservedItems = session.items;
    var preservedSource = session.suggestionSource;

    if (mode === 'demo') {
      session.callPhase = 'preparing';
      var built = Sug.buildDemoSuggestions(payload);
      if (!built.ok || !built.suggestions.length) {
        session.callPhase = 'failed';
        session.genError = '本地演示也无法生成：请先准备可读的简历正文。';
        ctx.app.rerender();
        return;
      }
      session.items = mapItems(built.suggestions);
      session.draftText = session.sourceText;
      session.cleanText = session.sourceText;
      session.suggestionSource = 'demo';
      session.genError = null;
      session.callPhase = 'success';
      session.step = 'review';
      recordGeneration({
        status: 'demo',
        providerId: 'local_demo',
        suggestionCount: session.items.length,
        source: 'demo'
      });
      markDirty(ctx);
      ui.toast('已载入本地演示建议。这不是真实 AI 生成。', 'info');
      ctx.app.rerender();
      return;
    }

    var st = AI.getStatus();
    if (!st.configured) {
      session.callPhase = 'failed';
      session.genError = '尚未接入真实 AI：请先配置并验证模型。';
      ctx.app.rerender();
      return;
    }
    if (!session.sendConfirmed) {
      session.callPhase = 'failed';
      session.genError = '请先确认可以发送岗位信息与简历正文。';
      ctx.app.rerender();
      return;
    }

    busy = true;
    session.genError = null;
    session.callPhase = 'preparing';
    ctx.app.rerender();
    // 下一帧进入请求中，让用户能看到准备→请求
    setTimeout(function () {
      if (!session || !busy) return;
      session.callPhase = 'requesting';
      ctx.app.rerender();
      AI.generateResumeSuggestions(payload).then(
        function (res) {
          busy = false;
          session.items = mapItems(res.suggestions);
          session.draftText = session.sourceText;
          session.cleanText = session.sourceText;
          session.suggestionSource = 'model';
          session.genError = null;
          session.callPhase = 'success';
          session.step = 'review';
          recordGeneration({
            status: 'success',
            providerId: res.providerId,
            model: res.model,
            suggestionCount: session.items.length,
            source: 'model'
          });
          markDirty(ctx);
          ui.toast('已收到模型返回的建议。请逐条核对后再采纳。', 'ok');
          ctx.app.rerender();
        },
        function (err) {
          busy = false;
          session.draftText = preservedDraft;
          session.items = preservedItems;
          session.suggestionSource = preservedSource;
          session.callPhase = 'failed';
          session.genError = err.message || '生成失败';
          recordGeneration({
            status: err.code === 'not_configured' ? 'unavailable' : 'failed',
            providerId: (AI.getStatus() || {}).providerId,
            model: (AI.getStatus() || {}).model,
            errorCode: err.code || 'failed',
            source: 'model'
          });
          markDirty(ctx);
          ui.toast(session.genError + ' 原简历与当前草稿均未改动。', 'danger');
          ctx.app.rerender();
        }
      );
    }, 40);
  }

  function saveDraft(ctx, job, goalId) {
    if (!session || busy) return;
    if (!ctx.ws.status.writable) {
      session.lastError = '当前不能保存（本地保存不可用或只读）。';
      ctx.app.rerender();
      return;
    }
    busy = true;
    session.lastError = null;
    var body = session.draftText;
    var fp = CA.domain.validate.stableStringify({
      op: 'reviseSaveDraft',
      jobId: job.id,
      fileId: session.fileId,
      body: String(body || '').replace(/\r\n?/g, '\n').trim()
    });
    if (!session.saveAttempt || session.saveAttempt.fp !== fp) {
      session.saveAttempt = { fp: fp, commandId: ctx.app.service.newCommandId() };
    }
    var commandId = session.saveAttempt.commandId;
    ctx.app.rerender();
    ctx.app.service
      .ensureContextDocuments({ goalId: goalId, jobId: job.id })
      .then(function () {
        return ctx.app.service.readWorkspace();
      })
      .then(function (ws) {
        var doc = findTailoredDoc(ws.data, goalId, job.id);
        if (!doc) throw new Error('未能建立该岗位的定向简历材料入口');
        return ctx.app.service.saveDocumentVersion({
          documentId: doc.id,
          body: body,
          parameters: { variant: 'tailored' },
          userConfirmed: false,
          commandId: commandId
        });
      })
      .then(function () {
        busy = false;
        session.savedOnce = true;
        session.lastError = null;
        session.cleanText = session.draftText;
        session.saveAttempt = null;
        markDirty(ctx);
        ui.toast('已保存为该岗位的新草稿。原「我的简历」正文未改动；确认前不算已核实事实。', 'ok');
        return ctx.app.refresh();
      })
      .catch(function (e) {
        busy = false;
        session.lastError = e.message || '保存未成功';
        markDirty(ctx);
        ui.toast('草稿未保存，可点「重试保存」。原简历仍在。', 'danger');
        ctx.app.rerender();
      });
  }

  function useResume(ctx, file, job, goalId) {
    if (busy) return;
    if (!hasReadableText(file) && !(session && String(session.draftText || '').trim())) {
      ui.toast('请先准备简历正文，再确认使用。', 'info');
      return;
    }
    busy = true;
    var alreadyConfirmed = file.status === 'confirmed';
    var run = alreadyConfirmed
      ? Promise.resolve({ status: 'already' })
      : ctx.app.service.confirmResumeFile({ fileId: file.id, commandId: ctx.app.service.newCommandId() });
    run
      .then(function () {
        busy = false;
        stopSession();
        ui.toast(
          alreadyConfirmed
            ? '已进入该岗位材料整理。定向草稿若已保存，可在准备材料中继续编辑。'
            : '已确认使用这份简历。定向建议草稿不会自动当成已核实经历。',
          'ok'
        );
        ctx.app.router.navigate(shared.prepareHash(job.id, goalId, { from: 'revise' }));
        return ctx.app.refresh();
      })
      .catch(function (e) {
        busy = false;
        ui.toast(e.message || '未能确认使用这份简历', 'danger');
        ctx.app.rerender();
      });
  }

  function acceptItem(ctx, item, mode, customText) {
    if (!session || item.result !== 'pending') return;
    var replacement = mode === 'rewritten' ? customText : item.proposedReplacement;
    var applied = Sug.applySuggestionToDraft(session.draftText, item, replacement);
    if (!applied.ok) {
      ui.toast(applied.error, 'danger');
      return;
    }
    session.draftText = applied.draft;
    item.result = mode;
    item.appliedText = replacement;
    session.editingId = null;
    session.editText = '';
    markDirty(ctx);
    ctx.app.rerender();
  }

  function skipItem(ctx, item) {
    if (!session || item.result !== 'pending') return;
    item.result = 'skipped';
    session.editingId = null;
    markDirty(ctx);
    ctx.app.rerender();
  }

  function renderSteps(active) {
    var steps = [
      { id: 'prepare', label: '1. 准备内容' },
      { id: 'generate', label: '2. 生成建议' },
      { id: 'review', label: '3. 检查并保存' }
    ];
    return h(
      'ol',
      { class: 'ca-steps', 'aria-label': '改简历步骤' },
      steps.map(function (s) {
        return h('li', { class: 'ca-steps__item' + (s.id === active ? ' is-active' : '') }, s.label);
      })
    );
  }

  function renderContextMeta(job, goal, file, assessment) {
    return h(
      'dl',
      { class: 'ca-meta ca-meta--card' },
      h('div', null, h('dt', null, '岗位'), h('dd', null, job.title)),
      h('div', null, h('dt', null, '公司'), h('dd', null, job.companyName)),
      h('div', null, h('dt', null, '求职目标'), h('dd', null, goal ? goal.title : '')),
      h(
        'div',
        null,
        h('dt', null, '当前简历'),
        h(
          'dd',
          null,
          file.fileName +
            '｜' +
            (file.status === 'confirmed' ? '已确认可用' : '尚未用于投递确认') +
            '｜' +
            (hasReadableText(file) ? '正文已读取' : '正文未读取')
        )
      ),
      assessment
        ? h(
            'div',
            null,
            h('dt', null, '本地演示评估'),
            h('dd', null, [shared.matchBadge(assessment.match.level), h('span', null, ' ' + (assessment.match.summary || ''))])
          )
        : null
    );
  }

  function renderSuggestionCard(ctx, item) {
    var st = statusLabel(item.result);
    var rewriteLabel = session.suggestionSource === 'model' ? '模型建议改写' : '建议改写';
    var body = [
      h('div', { class: 'ca-suggest__head' }, h('h3', { class: 'ca-suggest__title' }, item.title), ui.badge(st.text, st.tone)),
      item.needsUserConfirm ? ui.badge('需要用户确认', 'warn') : null,
      h('p', { class: 'ca-suggest__reason' }, item.reason),
      h(
        'div',
        { class: 'ca-suggest__block' },
        h('p', { class: 'ca-suggest__label' }, '指向的原文段落'),
        h('pre', { class: 'ca-suggest__excerpt' }, item.targetExcerpt)
      ),
      h(
        'div',
        { class: 'ca-suggest__block' },
        h('p', { class: 'ca-suggest__label' }, item.result === 'rewritten' ? '你改写后采纳的内容' : rewriteLabel),
        h('pre', { class: 'ca-suggest__excerpt' }, item.appliedText || item.proposedReplacement)
      )
    ];
    if (item.result === 'pending') {
      if (session.editingId === item.id) {
        var ta = h('textarea', { class: 'ca-input ca-textarea', rows: '6', id: 'suggest-edit-' + item.id });
        ta.value = session.editText;
        ta.addEventListener('input', function () {
          session.editText = ta.value;
          markDirty(ctx);
        });
        body.push(
          h('div', { class: 'ca-field' }, h('label', { class: 'ca-label', for: 'suggest-edit-' + item.id }, '改写后再采纳'), ta),
          h(
            'div',
            { class: 'ca-actions' },
            ui.button('确认改写并采纳', {
              variant: 'primary',
              disabled: busy || !String(session.editText || '').trim(),
              onClick: function () {
                acceptItem(ctx, item, 'rewritten', session.editText);
              }
            }),
            ui.button('取消改写', {
              variant: 'ghost',
              onClick: function () {
                session.editingId = null;
                session.editText = '';
                ctx.app.rerender();
              }
            })
          )
        );
      } else {
        body.push(
          h(
            'div',
            { class: 'ca-actions' },
            ui.button('采纳', {
              variant: 'primary',
              disabled: busy,
              onClick: function () {
                acceptItem(ctx, item, 'accepted');
              }
            }),
            ui.button('跳过', {
              variant: 'secondary',
              disabled: busy,
              onClick: function () {
                skipItem(ctx, item);
              }
            }),
            ui.button('改写后采纳', {
              variant: 'ghost',
              disabled: busy,
              onClick: function () {
                session.editingId = item.id;
                session.editText = item.proposedReplacement;
                ctx.app.rerender();
              }
            })
          )
        );
      }
    }
    return h('li', { class: 'ca-suggest', 'data-suggest-id': item.id }, body);
  }

  function renderPrepare(ctx, job, file, goal, assessment) {
    var scope = Prompt.describeSendScope({ job: job, resumeText: session.sourceText, assessment: assessment });
    var aiStatus = AI.getStatus();
    var page = h('section', { class: 'ca-page' });
    page.appendChild(shared.pageHeader('帮我改简历｜准备内容', job.companyName + '｜' + job.title));
    page.appendChild(renderSteps('prepare'));
    page.appendChild(
      ui.notice(
        'warn',
        '真实 AI 生成需要本机助手服务，通常会产生费用。未连接或未配置时不能发起真实生成，也不会用固定文案冒充已经向模型请求成功。密钥只由服务端读取，页面不粘贴、不保存密钥。'
      )
    );
    page.appendChild(renderContextMeta(job, goal, file, assessment));
    page.appendChild(renderBackendStatusPanel(ctx));
    if (!hasReadableText(file)) {
      page.appendChild(
        ui.statePanel('warn', '还没有简历正文', '请先编辑正文。没有正文时不会发送，也不会生成建议。', [
          ui.link(shared.resumeHash({ file: file.id }), '去编辑正文', { className: 'ca-btn ca-btn--primary' })
        ])
      );
      return page;
    }
    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'send-scope' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'send-scope', class: 'ca-section__title' }, '将发送给模型的内容范围')),
        h(
          'ul',
          { class: 'ca-facts' },
          h('li', null, '目标岗位：' + scope.companyName + '｜' + scope.jobTitle),
          h('li', null, 'JD 摘要（前 160 字）与完整 JD 长度 ' + scope.jdLength + ' 字'),
          h('li', null, '你确认发送的简历正文：约 ' + scope.resumeCharCount + ' 字／' + scope.resumeParagraphCount + ' 段'),
          scope.includesAssessmentSummary
            ? h('li', null, '可选附带本地演示评估摘要（非模型结论，仅作参考）')
            : null,
          h(
            'li',
            null,
            aiStatus.willCallExternal
              ? '确认生成后，上述内容会发送到外部模型服务（' +
                  aiStatus.label +
                  '／' +
                  (aiStatus.model || '未写模型名') +
                  '）。'
              : '当前不会发送到外部模型：' + (aiStatus.reason || '尚未接入真实 AI。')
          ),
          h('li', null, '当前配置状态：' + phaseLabel(aiStatus.configPhase || 'unconfigured'))
        ),
        h('p', { class: 'ca-help' }, '密钥不会写入本应用本地存储、事件或页面日志；简历全文也不会写入运行日志。'),
        h(
          'label',
          { class: 'ca-check' },
          (function () {
            var input = h('input', { type: 'checkbox', id: 'revise-send-confirm' });
            input.checked = !!session.sendConfirmed;
            input.addEventListener('change', function () {
              session.sendConfirmed = !!input.checked;
              ctx.app.rerender();
            });
            return input;
          })(),
          h('span', null, '我确认可以按上述范围发送岗位信息与简历正文（仅在真实生成时发送）。')
        )
      )
    );
    page.appendChild(
      h(
        'div',
        { class: 'ca-actions ca-actions--primary' },
        ui.button('下一步：生成建议', {
          variant: 'primary',
          disabled: !session.sendConfirmed,
          onClick: function () {
            session.step = 'generate';
            session.genError = null;
            session.callPhase = 'idle';
            ctx.app.rerender();
          }
        }),
        ui.link(shared.reviseResumeHash(), '返回岗位列表', { className: 'ca-btn ca-btn--ghost' }),
        ui.link(shared.resumeHash({ file: file.id }), '返回简历', { className: 'ca-btn ca-btn--ghost' })
      )
    );
    return page;
  }

  function renderGenerate(ctx, job, file, goal, assessment) {
    var aiStatus = AI.getStatus();
    var scope = Prompt.describeSendScope({ job: job, resumeText: session.sourceText, assessment: assessment });
    var phase = aiStatus.configPhase || (aiStatus.configured ? 'pending_verify' : 'unconfigured');
    var callPhase = session.callPhase || 'idle';
    var page = h('section', { class: 'ca-page' });
    page.appendChild(shared.pageHeader('帮我改简历｜生成建议', job.companyName + '｜' + job.title));
    page.appendChild(renderSteps('generate'));
    page.appendChild(renderContextMeta(job, goal, file, assessment));

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'gen-reconfirm' },
        h(
          'div',
          { class: 'ca-section__head' },
          h('h2', { id: 'gen-reconfirm', class: 'ca-section__title' }, '生成前再次确认'),
          ui.badge(phaseLabel(phase), phase === 'verified' ? 'ok' : phase === 'failed' || phase === 'unconfigured' ? 'warn' : 'info')
        ),
        h(
          'ul',
          { class: 'ca-facts' },
          h('li', null, '发送范围：' + scope.companyName + '｜' + scope.jobTitle + '；简历约 ' + scope.resumeCharCount + ' 字'),
          h(
            'li',
            null,
            '模型：' +
              (aiStatus.configured ? (aiStatus.label || '') + '／' + (aiStatus.model || '未写') : '尚未配置')
          ),
          h('li', null, '验证状态：' + phaseLabel(phase) + (aiStatus.verify && aiStatus.verify.message ? '（' + aiStatus.verify.message + '）' : '')),
          h(
            'li',
            null,
            aiStatus.willCallExternal
              ? '点击下方按钮后，岗位信息与简历正文将发送到外部模型服务，通常会产生费用。'
              : '当前不会外发：' + (aiStatus.reason || '请先连接本机助手服务。')
          ),
          h('li', null, '调用进度：' + callPhaseLabel(callPhase))
        )
      )
    );

    if (!aiStatus.configured) {
      page.appendChild(
        ui.statePanel(
          'warn',
          '尚未接入真实 AI',
          '请返回上一步检查本机助手服务（须通过已授权启动的本机地址打开，并由服务端配置密钥）。也可直接使用本地演示建议练习流程——不会写成真实请求成功。',
          [
            ui.button('返回检查服务', {
              variant: 'secondary',
              disabled: busy,
              onClick: function () {
                session.step = 'prepare';
                ctx.app.rerender();
              }
            })
          ]
        )
      );
    } else if (phase === 'pending_verify') {
      page.appendChild(
        ui.notice('warn', '本机服务已配置但尚未验证连接。建议先返回上一步点「验证连接」；也可直接尝试生成（失败时原简历与草稿保留）。')
      );
    } else if (phase === 'failed') {
      page.appendChild(ui.notice('warn', '上次验证失败。请检查本机 .env 中的密钥配置后重试验证，再生成。'));
    } else if (phase === 'verified') {
      page.appendChild(
        ui.notice(
          'info',
          '已验证：' +
            aiStatus.label +
            (aiStatus.model ? '／' + aiStatus.model : '') +
            '。点击下方按钮才会发送内容；返回建议仍须你检查是否新增未经依据的内容；失败时原简历与草稿会保留。'
        )
      );
    }

    if (session.genError) {
      page.appendChild(
        h(
          'div',
          { class: 'ca-form-error', role: 'alert' },
          h('p', null, h('strong', null, '生成未完成（' + callPhaseLabel(callPhase) + '）：'), session.genError),
          ui.button(busy ? '正在重试…' : '重试生成', {
            variant: 'primary',
            disabled: busy || !aiStatus.configured || !session.sendConfirmed,
            onClick: function () {
              runGenerate(ctx, job, file, 'model');
            }
          })
        )
      );
    }

    if (session.generation) {
      page.appendChild(
        h(
          'p',
          { class: 'ca-help', id: 'revise-gen-meta' },
          '最近一次尝试：' +
            session.generation.at +
            '｜岗位 ' +
            job.title +
            '｜提供方 ' +
            (session.generation.providerId || '无') +
            (session.generation.model ? '／' + session.generation.model : '') +
            '｜状态 ' +
            session.generation.status +
            (session.generation.errorCode ? '（' + session.generation.errorCode + '）' : '')
        )
      );
    }

    var callBusyLabel =
      callPhase === 'preparing' ? '准备中…' : callPhase === 'requesting' ? '请求中…' : busy ? '正在请求模型…' : '向模型请求建议';

    page.appendChild(
      h(
        'div',
        { class: 'ca-actions ca-actions--primary' },
        ui.button(callBusyLabel, {
          variant: 'primary',
          disabled: busy || !aiStatus.configured || !session.sendConfirmed,
          onClick: function () {
            runGenerate(ctx, job, file, 'model');
          }
        }),
        ui.button('改用本地演示建议（非真实 AI）', {
          variant: 'secondary',
          disabled: busy,
          onClick: function () {
            runGenerate(ctx, job, file, 'demo');
          }
        }),
        ui.button('返回上一步', {
          variant: 'ghost',
          disabled: busy,
          onClick: function () {
            session.step = 'prepare';
            session.callPhase = 'idle';
            ctx.app.rerender();
          }
        })
      )
    );
    page.appendChild(
      ui.notice('info', '本地演示建议仅供流程练习，页面会明确标注“不是真实 AI”，不会写成请求已成功。')
    );
    return page;
  }

  function renderReview(ctx, job, file, goal, assessment) {
    var page = h('section', { class: 'ca-page' });
    var goalId = ctx.ws.ui.selectedGoalId;
    page.appendChild(shared.pageHeader('帮我改简历｜检查并保存', job.companyName + '｜' + job.title));
    page.appendChild(renderSteps('review'));

    if (session.suggestionSource === 'demo') {
      page.appendChild(ui.notice('warn', '当前为本地演示建议，不是真实 AI 生成，也不代表模型准确率。'));
    } else if (session.suggestionSource === 'model') {
      page.appendChild(
        ui.notice(
          'ok',
          '当前建议来自已配置的模型返回。请只采纳你确认属实的内容；采纳前不会修改原简历。'
        )
      );
    }

    page.appendChild(renderContextMeta(job, goal, file, assessment));

    if (!session.items.length) {
      page.appendChild(
        ui.statePanel('info', '还没有可检查的建议', '请返回生成步骤请求模型，或载入本地演示建议。', [
          ui.button('返回生成步骤', {
            variant: 'primary',
            onClick: function () {
              session.step = 'generate';
              ctx.app.rerender();
            }
          })
        ])
      );
      return page;
    }

    var counts = { pending: 0, accepted: 0, skipped: 0, rewritten: 0 };
    session.items.forEach(function (it) {
      counts[it.result] = (counts[it.result] || 0) + 1;
    });

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'revise-sugs' },
        h(
          'div',
          { class: 'ca-section__head' },
          h('h2', { id: 'revise-sugs', class: 'ca-section__title' }, '逐条处理建议'),
          h(
            'span',
            { class: 'ca-section__meta' },
            '共 ' +
              session.items.length +
              ' 条｜待处理 ' +
              counts.pending +
              '｜已采纳 ' +
              (counts.accepted + counts.rewritten) +
              '｜已跳过 ' +
              counts.skipped
          )
        ),
        h(
          'ul',
          { class: 'ca-suggest-list' },
          session.items.map(function (item) {
            return renderSuggestionCard(ctx, item);
          })
        )
      )
    );

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'revise-draft' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'revise-draft', class: 'ca-section__title' }, '定向编辑草稿')),
        h('p', { class: 'ca-help' }, '草稿仅在本页与「保存为新草稿」后的岗位材料中；不会覆盖「我的简历」原正文。'),
        h('pre', { class: 'ca-suggest__draft', id: 'revise-draft-preview' }, session.draftText)
      )
    );

    var err = h('div', { class: 'ca-form-error', hidden: !session.lastError, role: 'alert' });
    if (session.lastError) {
      ui.append(
        err,
        h('p', null, h('strong', null, '未保存：'), session.lastError),
        ui.button(busy ? '正在重试…' : '重试保存', {
          variant: 'primary',
          disabled: busy || !ctx.ws.status.writable,
          onClick: function () {
            saveDraft(ctx, job, goalId);
          }
        })
      );
    }
    page.appendChild(err);

    if (session.generation) {
      page.appendChild(
        h(
          'p',
          { class: 'ca-help' },
          '生成本次记录：' +
            session.generation.at +
            '｜提供方 ' +
            (session.generation.providerId || '无') +
            '｜状态 ' +
            session.generation.status +
            '｜建议 ' +
            session.generation.suggestionCount +
            ' 条'
        )
      );
    }

    page.appendChild(
      h(
        'div',
        { class: 'ca-actions ca-actions--primary' },
        ui.button(busy ? '正在保存…' : '保存为新草稿', {
          variant: 'primary',
          disabled: busy || !ctx.ws.status.writable,
          onClick: function () {
            saveDraft(ctx, job, goalId);
          }
        }),
        ui.button(busy ? '处理中…' : '使用此简历', {
          variant: 'secondary',
          disabled: busy || !ctx.ws.status.writable,
          onClick: function () {
            useResume(ctx, file, job, goalId);
          }
        }),
        ui.button('返回生成步骤', {
          variant: 'ghost',
          disabled: busy,
          onClick: function () {
            session.step = 'generate';
            ctx.app.rerender();
          }
        }),
        ui.link(shared.resumeHash({ file: file.id }), '返回简历', { className: 'ca-btn ca-btn--ghost', icon: 'reply' })
      )
    );

    if (session.savedOnce) {
      page.appendChild(ui.notice('ok', '本轮至少已成功保存过一版岗位草稿。原简历仍保留；「使用此简历」才会进入确认。'));
    }
    return page;
  }

  function renderWorkspace(ctx, job, file) {
    var goalId = ctx.ws.ui.selectedGoalId;
    var goal = S.goal(ctx.ws.data, goalId);
    var assessment = S.latestAssessment(ctx.ws.data, job.id, goalId);
    ensureSession(ctx, job, file);
    if (!hasReadableText(file) && session.step !== 'prepare') {
      session.step = 'prepare';
    }
    if (session.step === 'generate') return renderGenerate(ctx, job, file, goal, assessment);
    if (session.step === 'review') return renderReview(ctx, job, file, goal, assessment);
    return renderPrepare(ctx, job, file, goal, assessment);
  }

  function renderJobPicker(ctx) {
    var ws = ctx.ws;
    var goalId = ws.ui.selectedGoalId;
    var goal = S.goal(ws.data, goalId);
    var jobs = S.jobsForGoal(ws.data, goalId);
    var current = S.currentResumeFile(ws.data);
    var aiStatus = AI.getStatus();
    var page = h('section', { class: 'ca-page' });
    page.appendChild(
      shared.pageHeader('帮我改简历', '选择目标岗位后，按「准备 → 生成 → 检查保存」处理建议。未配置模型时不能真实生成。')
    );
    page.appendChild(
      ui.notice(
        aiStatus.configured ? (aiStatus.configPhase === 'verified' ? 'info' : 'warn') : 'warn',
        aiStatus.configured
          ? '本机模型服务：' +
              phaseLabel(aiStatus.configPhase || 'pending_verify') +
              '（' +
              (aiStatus.label || '') +
              (aiStatus.model ? '／' + aiStatus.model : '') +
              '）。生成前会再次确认发送范围；返回建议仍须你逐条检查。'
          : '尚未接入真实 AI：需要本机助手服务读取密钥。进入岗位后可检查服务状态，也可用「本地演示建议」练习，但不会显示真实生成成功。'
      )
    );
    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'revise-current' },
        h('div', { class: 'ca-section__head' }, h('h2', { id: 'revise-current', class: 'ca-section__title' }, '当前将参考的材料')),
        !current
          ? ui.statePanel('empty', '还没有可用的简历材料', '请先上传 PDF，或打开「我的简历」粘贴正文。', [
              ui.link(shared.resumeHash({ upload: '1' }), '上传 PDF 简历', { className: 'ca-btn ca-btn--primary', icon: 'upload' }),
              ui.link(shared.resumeHash(), '打开我的简历', { className: 'ca-btn ca-btn--secondary' })
            ])
          : current.status === 'read_failed'
            ? ui.statePanel('warn', '当前材料读取失败', current.readError || '请重新上传。', [
                ui.link(shared.resumeHash({ file: current.id }), '查看失败原因', { className: 'ca-btn ca-btn--primary' })
              ])
            : [
                h(
                  'dl',
                  { class: 'ca-meta ca-meta--card' },
                  h('div', null, h('dt', null, '文件'), h('dd', null, current.fileName)),
                  h('div', null, h('dt', null, '正文'), h('dd', null, hasReadableText(current) ? '正文已读取' : '正文未读取')),
                  h(
                    'div',
                    null,
                    h('dt', null, '使用状态'),
                    h(
                      'dd',
                      null,
                      current.status === 'confirmed' ? ui.badge('已确认可用', 'ok') : ui.badge('尚未用于投递／匹配确认', 'warn')
                    )
                  )
                ),
                h(
                  'div',
                  { class: 'ca-actions' },
                  ui.link(shared.resumeHash({ file: current.id }), '查看／编辑正文', {
                    className: 'ca-btn ca-btn--secondary',
                    icon: 'edit'
                  })
                )
              ]
      )
    );

    page.appendChild(
      h(
        'section',
        { class: 'ca-section', 'aria-labelledby': 'revise-jobs' },
        h(
          'div',
          { class: 'ca-section__head' },
          h('h2', { id: 'revise-jobs', class: 'ca-section__title' }, '选择要对齐的岗位'),
          h('span', { class: 'ca-section__meta' }, goal ? goal.title : '当前目标')
        ),
        jobs.length
          ? h(
              'ul',
              { class: 'ca-row-list' },
              jobs.map(function (job) {
                return h(
                  'li',
                  null,
                  h(
                    'div',
                    { class: 'ca-row ca-row--static' },
                    h('span', { class: 'ca-row__title' }, job.companyName + '｜' + job.title),
                    h(
                      'span',
                      { class: 'ca-row__tags' },
                      (function () {
                        var as = S.latestAssessment(ws.data, job.id, goalId);
                        return as ? shared.matchBadge(as.match.level) : ui.badge('尚无评估', 'neutral');
                      })()
                    ),
                    h(
                      'div',
                      { class: 'ca-actions' },
                      ui.link(shared.reviseResumeHash({ job: job.id }), '开始准备修改', {
                        className: 'ca-btn ca-btn--primary'
                      }),
                      ui.link(shared.jobHash(job.id, goalId), '先看岗位', { className: 'ca-btn ca-btn--ghost ca-btn--sm' })
                    )
                  )
                );
              })
            )
          : ui.statePanel('empty', '当前目标下还没有岗位', '先到岗位工作区查看岗位。', [
              ui.link('#/jobs', '打开岗位工作区', { className: 'ca-btn ca-btn--secondary' })
            ])
      )
    );
    page.appendChild(
      h(
        'div',
        { class: 'ca-actions' },
        ui.link(shared.resumeHash(), '返回我的简历', { className: 'ca-btn ca-btn--secondary', icon: 'reply' }),
        ui.link('#/home', '回到求职进展', { className: 'ca-btn ca-btn--ghost' })
      )
    );
    return page;
  }

  function render(ctx) {
    appRef = ctx.app;
    var jobId = ctx.route.query.job;
    if (!jobId) {
      if (session && !guard.isDirty()) stopSession();
      return renderJobPicker(ctx);
    }
    var job = S.job(ctx.ws.data, jobId);
    var goalId = ctx.ws.ui.selectedGoalId;
    if (!job || !S.jobBelongsToGoal(job, goalId)) {
      var miss = h('section', { class: 'ca-page' });
      miss.appendChild(shared.pageHeader('帮我改简历'));
      miss.appendChild(
        ui.statePanel('error', '找不到该岗位', '岗位不属于当前目标，或不存在。', [
          ui.link(shared.reviseResumeHash(), '返回岗位列表', { className: 'ca-btn ca-btn--primary' })
        ])
      );
      return miss;
    }
    var file = S.currentResumeFile(ctx.ws.data);
    if (!file || file.status === 'read_failed') {
      var empty = h('section', { class: 'ca-page' });
      empty.appendChild(shared.pageHeader('帮我改简历｜' + job.title));
      empty.appendChild(
        ui.statePanel('empty', '还没有可用的简历材料', '请先上传并准备正文。', [
          ui.link(shared.resumeHash({ upload: '1' }), '上传 PDF 简历', { className: 'ca-btn ca-btn--primary' }),
          ui.link(shared.reviseResumeHash(), '返回岗位列表', { className: 'ca-btn ca-btn--secondary' })
        ])
      );
      return empty;
    }
    return renderWorkspace(ctx, job, file);
  }

  CA.features.reviseResume = {
    render: render,
    guard: guard,
    _session: function () {
      return session;
    },
    _resetSession: function () {
      stopSession();
    }
  };
})(window);
