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
  var busy = false;
  var appRef = null;
  var lastUiError = null;
  var lastUploadNotice = null;

  function stopEditing() {
    editState = null;
    if (appRef) appRef.router.clearGuard(guard);
  }

  var guard = {
    isDirty: function () {
      if (!editState || !editState.original) return false;
      return editState.text !== editState.original.text;
    },
    confirmLeave: function () {
      return ui.confirmDialog({
        title: '有未保存的简历正文',
        message: '离开后这次在页面上的修改会丢失；已保存的内容不受影响。',
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

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function hasReadableText(file) {
    return !!(file && file.textDraft && String(file.textDraft).trim());
  }

  /** 用户可见状态：上传结果／是否可编辑，不强迫理解「确认」技术含义 */
  function displayStatus(file) {
    if (!file) return { label: '未知', tone: 'neutral', textState: '' };
    if (file.status === 'read_failed') {
      return { label: '读取失败', tone: 'danger', textState: '正文未读取' };
    }
    if (file.status === 'pending_read') {
      return { label: '正在读取', tone: 'warn', textState: '正文未读取' };
    }
    if (file.status === 'confirmed') {
      return {
        label: '已确认可用',
        tone: 'ok',
        textState: hasReadableText(file) ? '正文已读取' : '正文未读取'
      };
    }
    // pending_confirm：上传已登记，尚未在「使用此简历」场景确认
    if (hasReadableText(file)) {
      return { label: '可查看／编辑', tone: 'ok', textState: '正文已读取' };
    }
    return { label: '已上传', tone: 'info', textState: '正文未读取' };
  }

  function statusBadges(file) {
    var ds = displayStatus(file);
    return [
      ui.badge(ds.label, ds.tone),
      ds.textState ? ui.badge(ds.textState, ds.textState === '正文已读取' ? 'ok' : 'warn') : null
    ];
  }

  function readLocalPdf(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('没有选择文件'));
        return;
      }
      if (file.type && file.type !== 'application/pdf') {
        reject(new Error('请选择 PDF 文件（当前类型不被支持）'));
        return;
      }
      if (!/\.pdf$/i.test(file.name || '')) {
        reject(new Error('请选择扩展名为 .pdf 的文件'));
        return;
      }
      if (file.size > C.LIMITS.RESUME_FILE_MAX_BYTES) {
        reject(new Error('文件超过 5MB 演示上限，请压缩后再试'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var buffer = reader.result;
        var meta = {
          fileName: file.name,
          byteSize: file.size,
          mimeType: file.type || 'application/pdf',
          status: 'pending_confirm',
          buffer: buffer
        };
        var extractor = CA.lib && CA.lib.pdfText && CA.lib.pdfText.extractTextFromPdf;
        if (!extractor) {
          meta.extractedText = '';
          meta.extractNote = '当前页面未加载文字读取能力，请手动粘贴正文。';
          resolve(meta);
          return;
        }
        extractor(buffer).then(
          function (result) {
            var text = (result && result.text) || '';
            meta.extractedText = text;
            if (!text) {
              meta.extractNote = '这份 PDF 没有抽出可读文字（可能是扫描件）。请在下方手动粘贴正文。';
            } else {
              meta.extractNote = null;
            }
            resolve(meta);
          },
          function (err) {
            meta.extractedText = '';
            meta.extractNote = (err && err.message) || '未能从 PDF 读取文字，请手动粘贴正文。';
            resolve(meta);
          }
        );
      };
      reader.onerror = function () {
        reject(new Error('浏览器无法读取该文件，请换一份 PDF 或重试'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function failWithRecord(message, fileId) {
    var err = new Error(message);
    err.fileId = fileId;
    err.recorded = true;
    return err;
  }

  function saveExtractedText(ctx, fileId, text) {
    var normalized = String(text || '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return Promise.resolve(null);
    return ctx.app.service.saveResumeFileText({
      fileId: fileId,
      text: normalized,
      commandId: ctx.app.service.newCommandId()
    });
  }

  function persistEditedText(ctx, file, nextText) {
    var previousText = file.textDraft || '';
    var fp = CA.domain.validate.stableStringify({
      op: 'saveResumeFileText',
      fileId: file.id,
      text: String(nextText || '').replace(/\r\n?/g, '\n').trim()
    });
    if (!editState.attempt || editState.attempt.fp !== fp) {
      editState.attempt = { fp: fp, commandId: ctx.app.service.newCommandId() };
    }
    return ctx.app.service
      .saveResumeFileText({ fileId: file.id, text: nextText, commandId: editState.attempt.commandId })
      .then(function (res) {
        // 沿用 DocumentVersion 不可变规则：已有关联文档且正文相对上一份有变化时，追加一版材料（未勾选确认）。
        var changed = String(previousText).replace(/\r\n?/g, '\n').trim() !== String(nextText || '').replace(/\r\n?/g, '\n').trim();
        if (!changed || !file.documentId || !String(nextText || '').trim()) return res;
        return ctx.app.service
          .saveDocumentVersion({
            documentId: file.documentId,
            body: nextText,
            parameters: { variant: 'base' },
            userConfirmed: false,
            commandId: ctx.app.service.newCommandId()
          })
          .then(function () {
            return res;
          })
          .catch(function () {
            // 正文草稿已保存；材料版本写入失败不回滚草稿，提示用户可在准备材料页再保存。
            ui.toast('正文已保存。同步材料版本未完成，可到「准备投递材料」再保存一版。', 'info');
            return res;
          });
      });
  }

  function uploadFromInput(ctx, inputEl) {
    var file = inputEl.files && inputEl.files[0];
    inputEl.value = '';
    if (!file) {
      lastUiError = '已取消选择，没有上传新文件。';
      ctx.app.rerender();
      return;
    }
    busy = true;
    lastUiError = null;
    ctx.app.rerender();
    readLocalPdf(file).then(
      function (meta) {
        return ctx.app.service
          .recordResumeFileUpload({
            fileName: meta.fileName,
            byteSize: meta.byteSize,
            mimeType: meta.mimeType,
            status: 'pending_confirm',
            readError: null,
            commandId: ctx.app.service.newCommandId()
          })
          .then(function (res) {
            return saveExtractedText(ctx, res.fileId, meta.extractedText).then(function () {
              return {
                fileId: res.fileId,
                fileName: meta.fileName,
                byteSize: meta.byteSize,
                extracted: !!(meta.extractedText && meta.extractedText.trim()),
                extractNote: meta.extractNote
              };
            });
          });
      },
      function (err) {
        return ctx.app.service
          .recordResumeFileUpload({
            fileName: file.name || '未命名.pdf',
            byteSize: Number.isInteger(file.size) ? file.size : 0,
            mimeType: file.type || 'application/pdf',
            status: 'read_failed',
            readError: err.message || '读取失败',
            commandId: ctx.app.service.newCommandId()
          })
          .then(function (res) {
            throw failWithRecord(err.message || '读取失败', res.fileId);
          });
      }
    ).then(
      function (info) {
        busy = false;
        lastUploadNotice = info;
        ui.toast(
          info.extracted
            ? 'PDF 已上传，正文已读入，可查看／编辑。'
            : 'PDF 已上传。正文尚未读入，请查看说明并手动粘贴。',
          info.extracted ? 'ok' : 'info'
        );
        ctx.app.router.navigate(shared.resumeHash({ file: info.fileId }));
        return ctx.app.refresh();
      },
      function (e) {
        busy = false;
        lastUiError = e.message || '上传未成功';
        if (e.recorded) {
          ui.toast('读取失败已记录，上一份可用材料仍保留。', 'danger');
          ctx.app.refresh();
        } else {
          ui.toast(lastUiError, 'danger');
          ctx.app.rerender();
        }
      }
    );
  }

  function filePicker(ctx, label, variant) {
    var input = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, id: 'resume-file-input' });
    input.addEventListener('change', function () {
      uploadFromInput(ctx, input);
    });
    return h(
      'div',
      { class: 'ca-file-picker' },
      input,
      ui.button(label, {
        variant: variant || 'primary',
        icon: 'upload',
        disabled: !ctx.ws.status.writable || busy,
        onClick: function () {
          input.click();
        }
      })
    );
  }

  function renderDetail(ctx, file) {
    var tz = S.user(ctx.ws.data).timeZone;
    var ds = displayStatus(file);
    if (!editState || editState.fileId !== file.id) {
      editState = {
        fileId: file.id,
        text: file.textDraft || '',
        original: { text: file.textDraft || '' },
        attempt: null,
        lastError: null
      };
      if (appRef) appRef.router.clearGuard(guard);
    }
    var ta = h('textarea', { id: 'resume-text', class: 'ca-input ca-textarea', rows: '12' });
    ta.value = editState.text;
    ta.addEventListener('input', function () {
      editState.text = ta.value;
      markDirty(ctx);
    });
    var err = h('div', { class: 'ca-form-error', hidden: true, role: 'alert' });
    if (editState.lastError) {
      err.hidden = false;
      ui.append(err, h('p', null, h('strong', null, '未保存：'), editState.lastError));
    }

    var actions = [];
    if (file.status === 'pending_confirm' || file.status === 'confirmed') {
      actions.push(
        ui.button(busy ? '正在保存…' : '保存正文', {
          variant: 'primary',
          disabled: !ctx.ws.status.writable || busy,
          onClick: function () {
            if (busy) return;
            busy = true;
            editState.lastError = null;
            persistEditedText(ctx, file, editState.text).then(
              function () {
                busy = false;
                stopEditing();
                ui.toast('正文已保存。此前已确认的材料版本仍保留；正式「使用此简历」时再确认最新内容。', 'ok');
                ctx.app.refresh();
              },
              function (e) {
                busy = false;
                editState.lastError = e.message;
                markDirty(ctx);
                ctx.app.rerender();
              }
            );
          }
        })
      );
    }

    var textNotice =
      file.status === 'read_failed'
        ? null
        : ds.textState === '正文已读取'
          ? ui.notice('ok', '正文已读取。可直接查看或修改；保存后不会覆盖历史上已经留下的材料版本。')
          : ui.notice(
              'warn',
              '正文未读取：未能从这份 PDF 抽出可用文字，或你尚未粘贴。请在下方手动粘贴后点「保存正文」。'
            );

    return h(
      'article',
      { class: 'ca-detail' },
      h('h3', { class: 'ca-subsection__title' }, file.fileName),
      h(
        'dl',
        { class: 'ca-meta' },
        h('div', null, h('dt', null, '上传状态'), h('dd', null, statusBadges(file))),
        h('div', null, h('dt', null, '大小'), h('dd', null, formatSize(file.byteSize))),
        h('div', null, h('dt', null, '上传时间'), h('dd', null, ui.formatDateTime(file.createdAt, tz))),
        file.readError ? h('div', null, h('dt', null, '失败原因'), h('dd', null, file.readError)) : null
      ),
      file.status === 'read_failed'
        ? ui.notice('warn', '这次文件读取没有成功。上一份可用材料仍然保留；可以重新选择 PDF。')
        : textNotice,
      file.status === 'confirmed'
        ? ui.notice('info', '这份材料曾用于确认。若你改了正文并保存，需要在「帮我改简历」或准备材料时再次「使用此简历」。')
        : null,
      file.status !== 'read_failed'
        ? [
            h(
              'div',
              { class: 'ca-field' },
              h('label', { class: 'ca-label', for: 'resume-text' }, '简历正文（可查看／编辑）'),
              ta
            ),
            err,
            h('div', { class: 'ca-actions' }, actions)
          ]
        : h('div', { class: 'ca-actions' }, filePicker(ctx, '重新选择 PDF', 'primary')),
      h(
        'div',
        { class: 'ca-actions' },
        file.status !== 'read_failed' ? filePicker(ctx, '重新上传 PDF', 'secondary') : null,
        ui.link(shared.reviseResumeHash(), '帮我改简历', {
          className: 'ca-btn ca-btn--secondary',
          icon: 'magic'
        }),
        ui.link('#/jobs', '开始整理求职材料', { className: 'ca-btn ca-btn--ghost' })
      )
    );
  }

  function render(ctx) {
    appRef = ctx.app;
    var ws = ctx.ws;
    var q = ctx.route.query;
    var page = h('section', { class: 'ca-page' });
    page.appendChild(
      shared.pageHeader(
        '我的简历',
        '上传 PDF、查看和修改正文。上传后即可查看／编辑；在准备投递或「帮我改简历」时再确认使用。文件只保存在当前浏览器本地。'
      )
    );
    if (lastUiError) {
      page.appendChild(ui.notice('warn', lastUiError));
    }

    page.appendChild(
      h(
        'div',
        { class: 'ca-actions ca-actions--primary' },
        filePicker(ctx, '上传 PDF 简历', 'primary'),
        ui.link(shared.reviseResumeHash(), '帮我改简历', {
          className: 'ca-btn ca-btn--secondary',
          icon: 'magic'
        }),
        ui.link('#/assistant', '打开求职助手', { className: 'ca-btn ca-btn--ghost', icon: 'comments' })
      )
    );

    if (q.upload === '1') {
      page.appendChild(
        ui.notice('info', '请点击「上传 PDF 简历」选择本地文件。取消选择不会改动已有材料。')
      );
    }

    var current = S.currentResumeFile(ws.data);
    var selected = q.file ? S.resumeFile(ws.data, q.file) : current;
    var list = S.resumeFilesNewestFirst(ws.data);

    if (lastUploadNotice) {
      var notice = lastUploadNotice;
      page.appendChild(
        ui.notice(
          notice.extracted ? 'ok' : 'info',
          [
            h(
              'p',
              null,
              '已上传「' +
                notice.fileName +
                '」（' +
                formatSize(notice.byteSize) +
                '）。状态：' +
                (notice.extracted ? '可查看／编辑' : '已上传，正文未读取') +
                '。'
            ),
            notice.extractNote ? h('p', null, notice.extractNote) : null,
            h('p', null, '不会自动当成已核实经历。需要用于岗位匹配或投递材料时，请走「帮我改简历」或准备材料中的使用确认。')
          ]
        )
      );
      lastUploadNotice = null;
    }

    if (!list.length) {
      page.appendChild(
        ui.statePanel('empty', '还没有简历文件', '先上传一份 PDF。演示不会上传到云端，也不会自动当成已核实经历。', [
          filePicker(ctx, '上传 PDF 简历', 'primary')
        ])
      );
      return page;
    }

    page.appendChild(
      h(
        'div',
        { class: 'ca-split has-detail' },
        h(
          'div',
          { class: 'ca-pane ca-pane--list', 'aria-label': '简历材料列表' },
          h(
            'ul',
            { class: 'ca-row-list' },
            list.map(function (file) {
              var ds = displayStatus(file);
              return h(
                'li',
                null,
                h(
                  'a',
                  {
                    class: 'ca-row' + (selected && selected.id === file.id ? ' is-current' : ''),
                    href: shared.resumeHash({ file: file.id })
                  },
                  h('span', { class: 'ca-row__title' }, file.fileName),
                  h('span', { class: 'ca-row__meta' }, formatSize(file.byteSize) + ' · ' + ds.label),
                  h('span', { class: 'ca-row__tags' }, statusBadges(file))
                )
              );
            })
          )
        ),
        h(
          'div',
          { class: 'ca-pane ca-pane--detail' },
          selected ? renderDetail(ctx, selected) : ui.statePanel('info', '请选择一份材料', '从左侧列表打开查看或修改。')
        )
      )
    );
    return page;
  }

  CA.features.resume = {
    render: render,
    guard: guard,
    displayStatus: displayStatus,
    hasReadableText: hasReadableText,
    openUpload: function (ctx) {
      ctx.app.router.navigate(shared.resumeHash({ upload: '1' }));
    }
  };
})(window);
