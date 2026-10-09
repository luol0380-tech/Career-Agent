(function (root) {
  'use strict';

  // 第二阶段业务命令：挂到已有 workspace service 上，保持统一持久化与幂等入口。
  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.data = CA.data || {};

  CA.data.attachPhase2Commands = function (api, ctx) {
    var C = CA.domain.constants;
    var V = CA.domain.validate;
    var S = CA.domain.selectors;
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
    var STATUS = C.STORAGE_STATUS;

    function requireWritable() {
      if (!getCommitted()) throw fail('not_loaded');
      if (getStorageStatus() === STATUS.UNAVAILABLE) throw fail('read_only');
      if (getStorageStatus() === STATUS.INVALID_DATA) throw fail('invalid_data');
      if (isExternalChange()) throw fail('external_change');
    }

    function replayOrNull(data, userId, commandId, fingerprint) {
      var prior = S.findEventByCommand(data, userId, commandId);
      if (!prior) return null;
      if (prior.requestFingerprint !== fingerprint) throw fail('command_conflict');
      return prior;
    }

    function pushEvent(candidate, fields) {
      candidate.data.events.push(fields);
    }

    function confirmedAssetSnapshots(data) {
      return data.assets
        .filter(function (a) {
          return a.provenance.userConfirmed;
        })
        .map(function (a) {
          return {
            assetId: a.id,
            revision: a.revision,
            title: a.title,
            body: a.body,
            provenance: V.deepClone(a.provenance)
          };
        });
    }

    function buildInputSnapshot(data, goalId, jobId) {
      var snap = { assetSnapshots: confirmedAssetSnapshots(data), jobSnapshot: null, goalSnapshot: null };
      if (jobId) {
        var job = S.job(data, jobId);
        if (job) snap.jobSnapshot = { jobId: job.id, revision: job.revision, companyName: job.companyName, title: job.title, jdText: job.jdText };
      }
      if (goalId) {
        var goal = S.goal(data, goalId);
        if (goal) {
          snap.goalSnapshot = {
            goalId: goal.id,
            revision: goal.revision,
            title: goal.title,
            targetRoles: goal.targetRoles.slice(),
            cities: goal.cities.slice(),
            salaryExpectation: goal.salaryExpectation
          };
        }
      }
      return snap;
    }

    function validateDocumentParams(kind, parameters) {
      if (!parameters || typeof parameters !== 'object') return false;
      if (kind === 'resume') return parameters.variant === 'base' || parameters.variant === 'tailored';
      if (kind === 'self_introduction') return [30, 60, 120].indexOf(parameters.durationSeconds) >= 0;
      if (kind === 'opening_message') return !!C.OPENING_CHANNEL[parameters.channel];
      if (kind === 'interview_prep') return true;
      return false;
    }

    api.prepareApplication = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId) throw fail('invalid_input', { fields: { commandId: '缺少 commandId' } });
        var committed = getCommitted();
        var user = S.user(committed.data);
        var fingerprint = V.stableStringify({ op: 'prepareApplication', goalId: input.goalId, jobId: input.jobId });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: prior.subject.id };

        var goal = S.goal(committed.data, input.goalId);
        var job = S.job(committed.data, input.jobId);
        if (!goal || goal.userId !== user.id || goal.status !== 'active') throw fail('invalid_goal');
        if (!job || job.userId !== user.id || !S.jobBelongsToGoal(job, goal.id)) throw fail('not_found');

        var existing = S.applicationFor(committed.data, goal.id, job.id);
        if (existing) return { status: 'existing', applicationId: existing.id };

        var now = clock();
        var candidate = V.deepClone(committed);
        var appId = randomId('app');
        candidate.data.applications.push({
          id: appId,
          userId: user.id,
          goalId: goal.id,
          jobId: job.id,
          status: 'preparing',
          submittedAt: null,
          hasHrReply: false,
          firstHrReplyAt: null,
          submittedDocumentVersionIds: [],
          materialsUnknown: false,
          createdAt: now,
          updatedAt: now
        });
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.prepared',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: appId },
          relatedRefs: [
            { type: 'job', id: job.id },
            { type: 'career_goal', id: goal.id }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { goalId: goal.id, jobId: job.id }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: appId };
      });
    };

    api.ensureContextDocuments = function (input) {
      return serialized(function () {
        requireWritable();
        var committed = getCommitted();
        var user = S.user(committed.data);
        var goal = S.goal(committed.data, input.goalId);
        var job = S.job(committed.data, input.jobId);
        if (!goal || !job || !S.jobBelongsToGoal(job, goal.id)) throw fail('not_found');
        var app = S.applicationFor(committed.data, goal.id, job.id);
        var candidate = V.deepClone(committed);
        var now = clock();
        var changed = false;
        var specs = [
          { kind: 'resume', title: '定制简历｜' + job.companyName, parameters: { variant: 'tailored' }, needJob: true },
          { kind: 'self_introduction', title: '自我介绍｜' + goal.title, parameters: { durationSeconds: 60 }, needJob: false },
          { kind: 'opening_message', title: '开场沟通｜' + job.companyName, parameters: { channel: 'boss' }, needJob: true }
        ];
        specs.forEach(function (spec) {
          var found = candidate.data.documents.some(function (doc) {
            if (doc.kind !== spec.kind) return false;
            if (spec.kind === 'resume' && doc.draft.parameters.variant !== 'tailored') return false;
            if (doc.goalId !== goal.id) return false;
            if (spec.needJob && doc.jobId !== job.id) return false;
            if (!spec.needJob && doc.jobId !== null && doc.jobId !== job.id) return false;
            return true;
          });
          if (found) return;
          changed = true;
          candidate.data.documents.push({
            id: randomId('doc'),
            userId: user.id,
            kind: spec.kind,
            title: spec.title,
            goalId: goal.id,
            jobId: spec.needJob ? job.id : null,
            // 有 applicationId 时契约要求 goalId／jobId 与投递一致；目标级材料不挂投递。
            applicationId: app && spec.needJob ? app.id : null,
            interviewId: null,
            draft: {
              body: '',
              parameters: V.deepClone(spec.parameters),
              inputSnapshot: buildInputSnapshot(candidate.data, goal.id, spec.needJob ? job.id : null),
              origin: 'user_authored',
              userEdited: false,
              userConfirmed: false
            },
            createdAt: now,
            updatedAt: now
          });
        });
        var hasBase = candidate.data.documents.some(function (doc) {
          return doc.kind === 'resume' && doc.draft.parameters.variant === 'base';
        });
        if (!hasBase) {
          changed = true;
          candidate.data.documents.push({
            id: randomId('doc'),
            userId: user.id,
            kind: 'resume',
            title: '基础简历',
            goalId: null,
            jobId: null,
            applicationId: null,
            interviewId: null,
            draft: {
              body: '',
              parameters: { variant: 'base' },
              inputSnapshot: buildInputSnapshot(candidate.data, null, null),
              origin: 'user_authored',
              userEdited: false,
              userConfirmed: false
            },
            createdAt: now,
            updatedAt: now
          });
        }
        if (!changed) return { status: 'noop' };
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved' };
      });
    };

    api.saveDocumentVersion = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.documentId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var body = normalizeText(input.body);
        if (!body || body.length > C.LIMITS.DOCUMENT_BODY_MAX) throw fail('invalid_input', { fields: { body: '正文不能为空且需在限制内' } });
        var fingerprint = V.stableStringify({
          op: 'saveDocumentVersion',
          documentId: input.documentId,
          body: body,
          parameters: input.parameters || null,
          userConfirmed: input.userConfirmed === true
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', versionId: prior.payload.versionId, versionNumber: prior.payload.versionNumber };

        var doc = S.document(committed.data, input.documentId);
        if (!doc || doc.userId !== user.id) throw fail('not_found');
        var parameters = V.deepClone(input.parameters || doc.draft.parameters);
        if (!validateDocumentParams(doc.kind, parameters)) throw fail('invalid_input', { fields: { parameters: '参数不合法' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.document(candidate.data, doc.id);
        var versions = S.versionsForDocument(candidate.data, doc.id);
        var nextNum = versions.length ? versions[0].versionNumber + 1 : 1;
        var versionId = randomId('dver');
        var origin = target.draft.origin;
        var userEdited = origin !== 'user_authored' ? true : body !== target.draft.body || V.stableStringify(parameters) !== V.stableStringify(target.draft.parameters);
        if (origin === 'user_authored' && !target.draft.userEdited && body) userEdited = true;

        target.draft.body = body;
        target.draft.parameters = parameters;
        target.draft.inputSnapshot = buildInputSnapshot(candidate.data, target.goalId, target.jobId);
        target.draft.userEdited = target.draft.userEdited || userEdited;
        target.draft.userConfirmed = input.userConfirmed === true;
        target.updatedAt = now;

        candidate.data.documentVersions.push({
          id: versionId,
          userId: user.id,
          documentId: doc.id,
          versionNumber: nextNum,
          body: body,
          parameters: V.deepClone(parameters),
          inputSnapshot: V.deepClone(target.draft.inputSnapshot),
          origin: origin,
          userEdited: target.draft.userEdited,
          userConfirmed: target.draft.userConfirmed,
          createdAt: now
        });
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'document.version_saved',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'document', id: doc.id },
          relatedRefs: [],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { versionId: versionId, versionNumber: nextNum }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', versionId: versionId, versionNumber: nextNum };
      });
    };

    api.recordSubmission = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var materialsUnknown = input.materialsUnknown === true;
        var versionIds = Array.isArray(input.documentVersionIds) ? input.documentVersionIds.slice() : [];
        var fingerprint = V.stableStringify({
          op: 'recordSubmission',
          applicationId: input.applicationId,
          submittedAt: input.submittedAt,
          documentVersionIds: versionIds,
          materialsUnknown: materialsUnknown
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        if (app.status !== 'preparing') throw fail('invalid_input', { fields: { status: '仅准备中的投递可记录已投递' } });
        if (!V.isTimestamp(input.submittedAt)) throw fail('invalid_input', { fields: { submittedAt: '请填写有效投递时间' } });
        if (!materialsUnknown) {
          if (!versionIds.length) throw fail('invalid_input', { fields: { documentVersionIds: '请选择至少一个已确认材料版本，或勾选材料未知' } });
          versionIds.forEach(function (vid) {
            var ver = S.documentVersion(committed.data, vid);
            if (!ver || ver.userId !== user.id || !ver.userConfirmed) throw fail('invalid_input', { fields: { documentVersionIds: '只能引用已确认的材料版本' } });
            var doc = S.document(committed.data, ver.documentId);
            if (!doc || doc.kind === 'interview_prep') throw fail('invalid_input', { fields: { documentVersionIds: '不能引用面试准备材料' } });
          });
        } else if (versionIds.length) {
          throw fail('invalid_input', { fields: { documentVersionIds: '材料未知时不能同时引用版本' } });
        }

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.status = 'submitted';
        target.submittedAt = input.submittedAt;
        target.submittedDocumentVersionIds = versionIds;
        target.materialsUnknown = materialsUnknown;
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.submitted',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.submittedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { submittedAt: input.submittedAt, documentVersionIds: versionIds, materialsUnknown: materialsUnknown }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.recordHrReply = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var summary = normalizeText(input.summary || '');
        if (summary.length > C.LIMITS.REPLY_SUMMARY_MAX) throw fail('invalid_input', { fields: { summary: '备注过长' } });
        var repliedAt = input.repliedAt === null || input.repliedAt === '' ? null : input.repliedAt;
        if (repliedAt !== null && !V.isTimestamp(repliedAt)) throw fail('invalid_input', { fields: { repliedAt: '回复时间格式无效' } });
        var fingerprint = V.stableStringify({
          op: 'recordHrReply',
          applicationId: input.applicationId,
          repliedAt: repliedAt,
          summary: summary
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        var allowed = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed', 'offer_received'];
        if (allowed.indexOf(app.status) < 0) throw fail('invalid_input', { fields: { status: '当前投递状态不能记录招聘方回复' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.hasHrReply = true;
        if (repliedAt) {
          if (!target.firstHrReplyAt || Date.parse(repliedAt) < Date.parse(target.firstHrReplyAt)) target.firstHrReplyAt = repliedAt;
        }
        if (target.status === 'submitted') target.status = 'hr_responded';
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.hr_reply_recorded',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: repliedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { repliedAt: repliedAt, summary: summary }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.scheduleInterview = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var scheduledAt = input.scheduledAt === null || input.scheduledAt === '' ? null : input.scheduledAt;
        if (scheduledAt !== null && !V.isTimestamp(scheduledAt)) throw fail('invalid_input', { fields: { scheduledAt: '面试时间格式无效' } });
        var roundNumber = input.roundNumber;
        if (!Number.isInteger(roundNumber) || roundNumber < 1) throw fail('invalid_input', { fields: { roundNumber: '轮次必须为正整数' } });
        var label = normalizeText(input.label || ('第 ' + roundNumber + ' 轮'));
        var invitationAt = input.invitationAt && V.isTimestamp(input.invitationAt) ? input.invitationAt : clock();
        var fingerprint = V.stableStringify({
          op: 'scheduleInterview',
          applicationId: input.applicationId,
          roundNumber: roundNumber,
          label: label,
          scheduledAt: scheduledAt,
          invitationAt: invitationAt
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', interviewId: prior.subject.id };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        var allowed = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed'];
        if (allowed.indexOf(app.status) < 0) throw fail('invalid_input', { fields: { status: '当前状态不能登记面试邀请' } });
        var dup = committed.data.interviews.some(function (iv) {
          return iv.applicationId === app.id && iv.roundNumber === roundNumber;
        });
        if (dup) throw fail('invalid_input', { fields: { roundNumber: '该轮次已存在' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var interviewId = randomId('interview');
        var status = scheduledAt ? 'scheduled' : 'invited';
        candidate.data.interviews.push({
          id: interviewId,
          userId: user.id,
          applicationId: app.id,
          roundNumber: roundNumber,
          label: label,
          status: status,
          scheduledAt: scheduledAt,
          completedAt: null,
          prepDocumentVersionIds: [],
          transcript: null,
          review: null,
          createdAt: now,
          updatedAt: now
        });
        var targetApp = S.application(candidate.data, app.id);
        targetApp.status = 'interview_scheduled';
        targetApp.hasHrReply = true;
        if (!targetApp.firstHrReplyAt || Date.parse(invitationAt) < Date.parse(targetApp.firstHrReplyAt)) {
          targetApp.firstHrReplyAt = invitationAt;
        }
        targetApp.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'interview.invitation_recorded',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'interview', id: interviewId },
          relatedRefs: [
            { type: 'application', id: app.id },
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: invitationAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { applicationId: app.id, roundNumber: roundNumber, scheduledAt: scheduledAt, invitationAt: invitationAt }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', interviewId: interviewId };
      });
    };

    api.completeInterview = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.interviewId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        if (!V.isTimestamp(input.completedAt)) throw fail('invalid_input', { fields: { completedAt: '请填写完成时间' } });
        var fingerprint = V.stableStringify({ op: 'completeInterview', interviewId: input.interviewId, completedAt: input.completedAt });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', interviewId: input.interviewId };

        var iv = S.interview(committed.data, input.interviewId);
        if (!iv || iv.userId !== user.id) throw fail('not_found');
        if (iv.status !== 'scheduled' && iv.status !== 'invited') throw fail('invalid_input', { fields: { status: '仅未完成的面试可标记完成' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.interview(candidate.data, iv.id);
        target.status = 'completed';
        target.completedAt = input.completedAt;
        target.updatedAt = now;
        var app = S.application(candidate.data, iv.applicationId);
        var othersOpen = candidate.data.interviews.some(function (row) {
          return row.applicationId === iv.applicationId && row.id !== iv.id && (row.status === 'invited' || row.status === 'scheduled');
        });
        if (!othersOpen) app.status = 'interview_completed';
        else app.status = 'interview_scheduled';
        app.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'interview.completed',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'interview', id: iv.id },
          relatedRefs: [{ type: 'application', id: iv.applicationId }],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.completedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { completedAt: input.completedAt }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', interviewId: iv.id };
      });
    };

    api.rescheduleInterview = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.interviewId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var scheduledAt = input.scheduledAt === null || input.scheduledAt === '' ? null : input.scheduledAt;
        if (scheduledAt !== null && !V.isTimestamp(scheduledAt)) throw fail('invalid_input', { fields: { scheduledAt: '面试时间格式无效' } });
        var fingerprint = V.stableStringify({
          op: 'rescheduleInterview',
          interviewId: input.interviewId,
          scheduledAt: scheduledAt
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', interviewId: input.interviewId };

        var iv = S.interview(committed.data, input.interviewId);
        if (!iv || iv.userId !== user.id) throw fail('not_found');
        if (iv.status !== 'scheduled' && iv.status !== 'invited') {
          throw fail('invalid_input', { fields: { status: '仅未完成的面试可改期' } });
        }
        var app = S.application(committed.data, iv.applicationId);
        if (!app || app.status !== 'interview_scheduled') {
          throw fail('invalid_input', { fields: { status: '当前投递状态不能改期面试' } });
        }
        var prev = iv.scheduledAt;
        if (prev === scheduledAt || (prev == null && scheduledAt == null)) {
          return { status: 'noop', interviewId: iv.id };
        }

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.interview(candidate.data, iv.id);
        target.scheduledAt = scheduledAt;
        target.status = scheduledAt ? 'scheduled' : 'invited';
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'interview.rescheduled',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'interview', id: iv.id },
          relatedRefs: [{ type: 'application', id: iv.applicationId }],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: scheduledAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { previousScheduledAt: prev, scheduledAt: scheduledAt }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', interviewId: iv.id };
      });
    };

    api.cancelInterview = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.interviewId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var reason = input.reason == null || input.reason === '' ? null : normalizeText(input.reason);
        if (reason && reason.length > C.LIMITS.REPLY_SUMMARY_MAX) throw fail('invalid_input', { fields: { reason: '原因过长' } });
        var fingerprint = V.stableStringify({
          op: 'cancelInterview',
          interviewId: input.interviewId,
          reason: reason
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', interviewId: input.interviewId };

        var iv = S.interview(committed.data, input.interviewId);
        if (!iv || iv.userId !== user.id) throw fail('not_found');
        if (iv.status !== 'scheduled' && iv.status !== 'invited') {
          throw fail('invalid_input', { fields: { status: '仅未完成的面试可取消' } });
        }
        var app = S.application(committed.data, iv.applicationId);
        if (!app || app.status !== 'interview_scheduled') {
          throw fail('invalid_input', { fields: { status: '当前投递状态不能取消面试' } });
        }

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.interview(candidate.data, iv.id);
        target.status = 'cancelled';
        target.updatedAt = now;
        var targetApp = S.application(candidate.data, iv.applicationId);
        var othersOpen = candidate.data.interviews.some(function (row) {
          return row.applicationId === iv.applicationId && row.id !== iv.id && (row.status === 'invited' || row.status === 'scheduled');
        });
        var hasCompleted = candidate.data.interviews.some(function (row) {
          return row.applicationId === iv.applicationId && row.status === 'completed';
        });
        if (othersOpen) targetApp.status = 'interview_scheduled';
        else if (hasCompleted) targetApp.status = 'interview_completed';
        else targetApp.status = 'hr_responded';
        targetApp.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'interview.cancelled',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'interview', id: iv.id },
          relatedRefs: [{ type: 'application', id: iv.applicationId }],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { reason: reason }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', interviewId: iv.id };
      });
    };

    api.saveInterviewTranscript = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.interviewId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        var text = normalizeText(input.text);
        if (!text || text.length > C.LIMITS.TRANSCRIPT_MAX) throw fail('invalid_input', { fields: { text: '笔记不能为空且需在限制内' } });
        var fingerprint = V.stableStringify({ op: 'saveInterviewTranscript', interviewId: input.interviewId, text: text });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', interviewId: input.interviewId, revision: prior.payload.newRevision };

        var iv = S.interview(committed.data, input.interviewId);
        if (!iv || iv.userId !== user.id) throw fail('not_found');
        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.interview(candidate.data, iv.id);
        var prevRev = target.transcript ? target.transcript.revision : 0;
        var sourceId = randomId('src');
        candidate.data.sources.push({
          id: sourceId,
          userId: user.id,
          kind: 'manual_entry',
          label: '面试笔记｜' + target.label,
          rawText: text,
          capturedAt: now,
          createdAt: now
        });
        target.transcript = { text: text, sourceId: sourceId, revision: prevRev + 1, capturedAt: now };
        // 新输入未分析：清空复盘，页面显示“尚未分析”。
        target.review = null;
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'interview.transcript_saved',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'interview', id: iv.id },
          relatedRefs: [{ type: 'application', id: iv.applicationId }],
          actor: { type: 'user', id: user.id },
          sourceId: sourceId,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { previousRevision: prevRev, newRevision: prevRev + 1, sourceId: sourceId }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', interviewId: iv.id, revision: prevRev + 1 };
      });
    };

    api.recordOffer = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        if (!V.isTimestamp(input.receivedAt)) throw fail('invalid_input', { fields: { receivedAt: '请填写有效的 Offer 时间' } });
        var fingerprint = V.stableStringify({
          op: 'recordOffer',
          applicationId: input.applicationId,
          receivedAt: input.receivedAt
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        var allowed = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed'];
        if (allowed.indexOf(app.status) < 0) throw fail('invalid_input', { fields: { status: '当前状态不能记录 Offer' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.status = 'offer_received';
        target.hasHrReply = true;
        if (!target.firstHrReplyAt || Date.parse(input.receivedAt) < Date.parse(target.firstHrReplyAt)) {
          target.firstHrReplyAt = input.receivedAt;
        }
        target.updatedAt = now;
        (candidate.data.interviews || []).forEach(function (row) {
          if (row.applicationId === app.id && (row.status === 'invited' || row.status === 'scheduled')) {
            row.status = 'cancelled';
            row.updatedAt = now;
          }
        });
        (candidate.data.actionItems || []).forEach(function (ai) {
          if (ai.applicationId === app.id && ai.status === 'open') {
            if (
              ai.kind === 'prepare_interview' ||
              ai.kind === 'prepare_documents' ||
              ai.kind === 'complete_interview_review' ||
              ai.kind === 'review_job'
            ) {
              ai.status = 'dismissed';
              ai.updatedAt = now;
            }
          }
        });
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.offer_recorded',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.receivedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { receivedAt: input.receivedAt }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.recordRejection = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        if (!V.isTimestamp(input.rejectedAt)) throw fail('invalid_input', { fields: { rejectedAt: '请填写有效的拒绝时间' } });
        var reason = input.reason == null || input.reason === '' ? null : normalizeText(input.reason);
        if (reason && reason.length > C.LIMITS.REPLY_SUMMARY_MAX) throw fail('invalid_input', { fields: { reason: '原因过长' } });
        var fingerprint = V.stableStringify({
          op: 'recordRejection',
          applicationId: input.applicationId,
          rejectedAt: input.rejectedAt,
          reason: reason
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        var allowed = ['submitted', 'hr_responded', 'interview_scheduled', 'interview_completed', 'offer_received'];
        if (allowed.indexOf(app.status) < 0) throw fail('invalid_input', { fields: { status: '当前状态不能记录拒绝' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.status = 'rejected';
        target.hasHrReply = true;
        if (!target.firstHrReplyAt || Date.parse(input.rejectedAt) < Date.parse(target.firstHrReplyAt)) {
          target.firstHrReplyAt = input.rejectedAt;
        }
        target.updatedAt = now;
        (candidate.data.interviews || []).forEach(function (row) {
          if (row.applicationId === app.id && (row.status === 'invited' || row.status === 'scheduled')) {
            row.status = 'cancelled';
            row.updatedAt = now;
          }
        });
        (candidate.data.actionItems || []).forEach(function (ai) {
          if (ai.applicationId === app.id && ai.status === 'open') {
            if (
              ai.kind === 'prepare_interview' ||
              ai.kind === 'prepare_documents' ||
              ai.kind === 'complete_interview_review' ||
              ai.kind === 'review_job'
            ) {
              ai.status = 'dismissed';
              ai.updatedAt = now;
            }
          }
        });
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.rejected',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.rejectedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { rejectedAt: input.rejectedAt, reason: reason }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.withdrawApplication = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        if (!V.isTimestamp(input.withdrawnAt)) throw fail('invalid_input', { fields: { withdrawnAt: '请填写有效的退出时间' } });
        var reason = input.reason == null || input.reason === '' ? null : normalizeText(input.reason);
        if (reason && reason.length > C.LIMITS.REPLY_SUMMARY_MAX) throw fail('invalid_input', { fields: { reason: '原因过长' } });
        var fingerprint = V.stableStringify({
          op: 'withdrawApplication',
          applicationId: input.applicationId,
          withdrawnAt: input.withdrawnAt,
          reason: reason
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        var allowed = ['preparing', 'submitted', 'hr_responded', 'interview_scheduled', 'interview_completed', 'offer_received'];
        if (allowed.indexOf(app.status) < 0) throw fail('invalid_input', { fields: { status: '当前状态不能退出投递' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.status = 'withdrawn';
        target.updatedAt = now;
        (candidate.data.interviews || []).forEach(function (row) {
          if (row.applicationId === app.id && (row.status === 'invited' || row.status === 'scheduled')) {
            row.status = 'cancelled';
            row.updatedAt = now;
          }
        });
        (candidate.data.actionItems || []).forEach(function (ai) {
          if (ai.applicationId === app.id && ai.status === 'open') {
            if (
              ai.kind === 'prepare_interview' ||
              ai.kind === 'prepare_documents' ||
              ai.kind === 'complete_interview_review' ||
              ai.kind === 'review_job'
            ) {
              ai.status = 'dismissed';
              ai.updatedAt = now;
            }
          }
        });
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.withdrawn',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.withdrawnAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { withdrawnAt: input.withdrawnAt, reason: reason }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.acceptOffer = function (input) {
      return serialized(function () {
        requireWritable();
        if (!input || !input.commandId || !input.applicationId) throw fail('invalid_input');
        var committed = getCommitted();
        var user = S.user(committed.data);
        if (!V.isTimestamp(input.acceptedAt)) throw fail('invalid_input', { fields: { acceptedAt: '请填写有效的接受时间' } });
        var fingerprint = V.stableStringify({
          op: 'acceptOffer',
          applicationId: input.applicationId,
          acceptedAt: input.acceptedAt
        });
        var prior = replayOrNull(committed.data, user.id, input.commandId, fingerprint);
        if (prior) return { status: 'replayed', applicationId: input.applicationId };

        var app = S.application(committed.data, input.applicationId);
        if (!app || app.userId !== user.id) throw fail('not_found');
        if (app.status !== 'offer_received') throw fail('invalid_input', { fields: { status: '只有已收到 Offer 的投递才能记录接受' } });

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.application(candidate.data, app.id);
        target.status = 'accepted';
        target.updatedAt = now;
        pushEvent(candidate, {
          id: randomId('evt'),
          userId: user.id,
          type: 'application.offer_accepted',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'application', id: app.id },
          relatedRefs: [
            { type: 'job', id: app.jobId },
            { type: 'career_goal', id: app.goalId }
          ],
          actor: { type: 'user', id: user.id },
          sourceId: null,
          occurredAt: input.acceptedAt,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: { acceptedAt: input.acceptedAt }
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', applicationId: app.id };
      });
    };

    api.ensureInterviewPrepDocument = function (input) {
      return serialized(function () {
        requireWritable();
        var committed = getCommitted();
        var user = S.user(committed.data);
        var iv = S.interview(committed.data, input.interviewId);
        if (!iv || iv.userId !== user.id) throw fail('not_found');
        var existing = (committed.data.documents || []).filter(function (doc) {
          return doc.kind === 'interview_prep' && doc.interviewId === iv.id;
        })[0];
        if (existing) return { status: 'existing', documentId: existing.id };
        var app = S.application(committed.data, iv.applicationId);
        var now = clock();
        var candidate = V.deepClone(committed);
        var docId = randomId('doc');
        candidate.data.documents.push({
          id: docId,
          userId: user.id,
          kind: 'interview_prep',
          title: '面试准备｜' + iv.label,
          goalId: app.goalId,
          jobId: app.jobId,
          applicationId: app.id,
          interviewId: iv.id,
          draft: {
            body: '',
            parameters: {},
            inputSnapshot: buildInputSnapshot(candidate.data, app.goalId, app.jobId),
            origin: 'user_authored',
            userEdited: false,
            userConfirmed: false
          },
          createdAt: now,
          updatedAt: now
        });
        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', documentId: docId };
      });
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
