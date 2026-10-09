(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.data = CA.data || {};
  var C = CA.domain.constants;
  var V = CA.domain.validate;
  var S = CA.domain.selectors;

  CA.data.attachPhase3Commands = function (api, ctx) {
    var fail = ctx.fail;
    var persist = ctx.persist;
    var assertCandidate = ctx.assertCandidate;
    var getCommitted = ctx.getCommitted;
    var getStorageStatus = ctx.getStorageStatus;
    var isExternalChange = ctx.isExternalChange;
    var clock = ctx.clock;
    var randomId = ctx.randomId;
    var normalizeText = ctx.normalizeText;
    var serialized = ctx.serialized;

    function requireWritable() {
      if (getStorageStatus() !== C.STORAGE_STATUS.AVAILABLE) throw fail('read_only');
      if (isExternalChange()) throw fail('external_change');
      if (!getCommitted()) throw fail('not_loaded');
    }

    function replayOrNull(data, userId, commandId, fingerprint) {
      var prior = S.findEventByCommand(data, userId, commandId);
      if (!prior) return null;
      if (prior.requestFingerprint !== fingerprint) throw fail('command_conflict');
      return prior;
    }

    function pushEvent(candidate, event) {
      candidate.data.events.push(event);
    }

    function ensureBaseResume(candidate, user, now) {
      var existing = S.baseResumeDocument(candidate.data);
      if (existing) return existing;
      var docId = randomId('doc');
      var doc = {
        id: docId,
        userId: user.id,
        kind: 'resume',
        title: '我的简历',
        goalId: null,
        jobId: null,
        applicationId: null,
        interviewId: null,
        draft: {
          body: '',
          parameters: { variant: 'base' },
          inputSnapshot: { assetSnapshots: [], jobSnapshot: null, goalSnapshot: null },
          origin: 'user_authored',
          userEdited: true,
          userConfirmed: false
        },
        createdAt: now,
        updatedAt: now
      };
      candidate.data.documents.push(doc);
      return doc;
    }

    api.recordResumeFileUpload = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId) throw fail('invalid_input', { fields: { commandId: '缺少操作编号' } });
        var committed = getCommitted();
        var user = S.user(committed.data);
        var fileName = normalizeText(input.fileName || '');
        var mimeType = String(input.mimeType || '');
        var byteSize = input.byteSize;
        var status = input.status;
        var readError = input.readError == null ? null : String(input.readError);
        if (!fileName || fileName.length > C.LIMITS.RESUME_FILE_NAME_MAX) {
          throw fail('invalid_input', { fields: { fileName: '请提供有效的文件名' } });
        }
        if (!Number.isInteger(byteSize) || byteSize < 0) throw fail('invalid_input', { fields: { byteSize: '文件大小无效' } });
        if (byteSize > C.LIMITS.RESUME_FILE_MAX_BYTES) {
          throw fail('invalid_input', { fields: { byteSize: '文件超过演示上限（5MB），请压缩后重试' } });
        }
        if (status !== 'pending_confirm' && status !== 'read_failed') {
          throw fail('invalid_input', { fields: { status: '上传结果状态无效' } });
        }
        if (status === 'read_failed') {
          if (!readError || !String(readError).trim()) throw fail('invalid_input', { fields: { readError: '请说明读取失败原因' } });
        } else {
          readError = null;
          if (mimeType !== 'application/pdf') {
            throw fail('invalid_input', { fields: { mimeType: '请选择 PDF 文件' } });
          }
        }

        var fingerprint = V.stableStringify({
          op: 'recordResumeFileUpload',
          fileName: fileName,
          byteSize: byteSize,
          mimeType: mimeType,
          status: status,
          readError: readError
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', fileId: prior.subject.id };

        var now = clock();
        var candidate = V.deepClone(committed);
        var fileId = randomId('file');
        candidate.data.files.push({
          id: fileId,
          userId: user.id,
          fileName: fileName,
          byteSize: byteSize,
          mimeType: mimeType || 'application/pdf',
          status: status,
          readError: readError,
          textDraft: '',
          sourceId: null,
          documentId: null,
          createdAt: now,
          updatedAt: now
        });
        var eventType = status === 'read_failed' ? 'resume_file.read_failed' : 'resume_file.uploaded';
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: eventType,
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'resume_file', id: fileId },
          relatedRefs: [],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload:
            status === 'read_failed'
              ? { readError: readError, fileName: fileName }
              : { fileName: fileName, byteSize: byteSize, mimeType: mimeType, status: status }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', fileId: fileId, fileStatus: status };
      });
    };

    api.saveResumeFileText = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.fileId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var text = typeof input.text === 'string' ? String(input.text).replace(/\r\n?/g, '\n') : '';
        if (text.length > C.LIMITS.DOCUMENT_BODY_MAX) {
          throw fail('invalid_input', { fields: { text: '正文过长，请精简后再保存' } });
        }
        var fingerprint = V.stableStringify({
          op: 'saveResumeFileText',
          fileId: input.fileId,
          text: text.trim()
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', fileId: input.fileId };

        var file = S.resumeFile(committed.data, input.fileId);
        if (!file || file.userId !== user.id) throw fail('not_found');
        if (file.status === 'read_failed' || file.status === 'pending_read') {
          throw fail('invalid_input', { fields: { status: '当前状态不能编辑正文' } });
        }

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.resumeFile(candidate.data, file.id);
        target.textDraft = text;
        if (target.status === 'confirmed') {
          target.status = 'pending_confirm';
          target.sourceId = null;
        }
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'resume_file.text_saved',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'resume_file', id: file.id },
          relatedRefs: [],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { textLength: text.trim().length }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', fileId: file.id };
      });
    };

    api.confirmResumeFile = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.fileId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var fingerprint = V.stableStringify({ op: 'confirmResumeFile', fileId: input.fileId });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) {
          return {
            status: 'replayed',
            fileId: input.fileId,
            sourceId: prior.payload.sourceId,
            documentId: prior.payload.documentId,
            versionId: prior.payload.versionId || null
          };
        }

        var file = S.resumeFile(committed.data, input.fileId);
        if (!file || file.userId !== user.id) throw fail('not_found');
        if (file.status !== 'pending_confirm') {
          throw fail('invalid_input', { fields: { status: '只有待确认的材料可以确认' } });
        }
        var text = normalizeText(file.textDraft);
        if (!text) throw fail('invalid_input', { fields: { text: '请先填写或粘贴简历正文再确认' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.resumeFile(candidate.data, file.id);
        var sourceId = randomId('src');
        candidate.data.sources.push({
          id: sourceId,
          userId: user.id,
          kind: 'pdf_upload',
          label: 'PDF 上传｜' + target.fileName,
          rawText: text,
          capturedAt: now,
          createdAt: now
        });
        var doc = ensureBaseResume(candidate, user, now);
        var versions = S.versionsForDocument(candidate.data, doc.id);
        var nextNum = versions.length ? versions[0].versionNumber + 1 : 1;
        var versionId = randomId('dver');
        doc.draft.body = text;
        doc.draft.origin = 'user_authored';
        doc.draft.userEdited = true;
        doc.draft.userConfirmed = true;
        doc.draft.inputSnapshot = { assetSnapshots: [], jobSnapshot: null, goalSnapshot: null };
        doc.updatedAt = now;
        candidate.data.documentVersions.push({
          id: versionId,
          userId: user.id,
          documentId: doc.id,
          versionNumber: nextNum,
          body: text,
          parameters: { variant: 'base' },
          inputSnapshot: V.deepClone(doc.draft.inputSnapshot),
          origin: 'user_authored',
          userEdited: true,
          userConfirmed: true,
          createdAt: now
        });
        target.status = 'confirmed';
        target.sourceId = sourceId;
        target.documentId = doc.id;
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'resume_file.confirmed',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'resume_file', id: file.id },
          relatedRefs: [{ type: 'document', id: doc.id }],
          actor: { type: 'user', id: user.id },
          sourceId: sourceId,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { sourceId: sourceId, documentId: doc.id, versionId: versionId }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', fileId: file.id, sourceId: sourceId, documentId: doc.id, versionId: versionId };
      });
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
