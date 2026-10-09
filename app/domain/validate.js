(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.domain = CA.domain || {};
  var C = CA.domain.constants;

  var ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/;

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // 键排序后的序列化，用作 requestFingerprint；不是密码学哈希。
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(function (key) {
          return JSON.stringify(key) + ':' + stableStringify(value[key]);
        })
        .join(',') +
      '}'
    );
  }

  function isTimestamp(value) {
    return typeof value === 'string' && ISO_WITH_OFFSET.test(value) && !isNaN(Date.parse(value));
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function createChecker() {
    var errors = [];
    return {
      errors: errors,
      check: function (condition, message) {
        if (!condition) errors.push(message);
        return !!condition;
      }
    };
  }

  function indexById(list, where, checker) {
    var map = Object.create(null);
    (list || []).forEach(function (item, i) {
      if (!checker.check(item && isNonEmptyString(item.id), where + '[' + i + '] 缺少 id')) return;
      checker.check(!map[item.id], where + ' 存在重复 id：' + item.id);
      map[item.id] = item;
    });
    return map;
  }

  function checkProvenance(p, where, checker, sourcesById, userId) {
    if (!checker.check(p && typeof p === 'object', where + '.provenance 缺失')) return;
    checker.check(Array.isArray(p.sourceIds), where + '.provenance.sourceIds 必须为数组');
    (p.sourceIds || []).forEach(function (sid) {
      var s = sourcesById && sourcesById[sid];
      checker.check(!!s, where + ' 引用了不存在的来源 ' + sid);
      if (s) checker.check(s.userId === userId, where + ' 引用了其他用户的来源 ' + sid);
    });
    checker.check(
      p.confidence === null || (typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1),
      where + '.provenance.confidence 必须为 0～1 或 null'
    );
    checker.check(typeof p.userConfirmed === 'boolean', where + '.provenance.userConfirmed 必须为布尔值');
    if (p.userConfirmed) {
      checker.check(isTimestamp(p.confirmedAt), where + ' 已确认时 confirmedAt 必须为时间戳');
    } else {
      checker.check(p.confirmedAt === null, where + ' 未确认时 confirmedAt 必须为 null');
    }
  }

  function belongs(checker, record, userId, where) {
    checker.check(record.userId === userId, where + ' ' + record.id + ' 不属于当前用户');
  }

  // 完整校验演示状态包：字段、枚举、引用存在且同属一个用户。返回错误信息数组，空数组表示通过。
  function validateEnvelope(envelope) {
    var checker = createChecker();
    var check = checker.check;

    if (!check(envelope && typeof envelope === 'object', '状态包不是对象')) return checker.errors;
    if (!check(envelope.schemaVersion === C.SCHEMA_VERSION, 'schemaVersion 不兼容：' + envelope.schemaVersion)) {
      return checker.errors;
    }
    var data = envelope.data;
    if (!check(data && typeof data === 'object', '缺少 data')) return checker.errors;
    var missing = C.DATA_COLLECTIONS.filter(function (name) {
      return !Array.isArray(data[name]);
    });
    if (!check(missing.length === 0, 'data 缺少集合：' + missing.join('、'))) return checker.errors;
    if (!check(envelope.ui && typeof envelope.ui === 'object', '缺少 ui')) return checker.errors;

    var users = indexById(data.users, 'users', checker);
    var goals = indexById(data.goals, 'goals', checker);
    var sources = indexById(data.sources, 'sources', checker);
    var assets = indexById(data.assets, 'assets', checker);
    var jobs = indexById(data.jobs, 'jobs', checker);
    var assessments = indexById(data.assessments, 'assessments', checker);
    var applications = indexById(data.applications, 'applications', checker);
    var interviews = indexById(data.interviews, 'interviews', checker);
    var actionItems = indexById(data.actionItems, 'actionItems', checker);
    var events = indexById(data.events, 'events', checker);

    check(data.users.length === 1, '演示数据必须恰好包含 1 个用户');
    var user = data.users[0];
    if (!user) return checker.errors;
    var userId = user.id;
    check(isNonEmptyString(user.displayName), 'User.displayName 缺失');
    check(isNonEmptyString(user.timeZone), 'User.timeZone 缺失');

    data.goals.forEach(function (g) {
      belongs(checker, g, userId, 'CareerGoal');
      check(C.GOAL_STATUS.indexOf(g.status) >= 0, 'CareerGoal ' + g.id + ' status 非法');
      check(Array.isArray(g.targetRoles) && Array.isArray(g.cities), 'CareerGoal ' + g.id + ' 角色／城市必须为数组');
      check(g.salaryExpectation === null || typeof g.salaryExpectation === 'string', 'CareerGoal ' + g.id + ' salaryExpectation 类型错误');
      check(Number.isInteger(g.revision) && g.revision >= 1, 'CareerGoal ' + g.id + ' revision 非法');
    });

    data.sources.forEach(function (s) {
      belongs(checker, s, userId, 'SourceRecord');
      check(Object.prototype.hasOwnProperty.call(C.SOURCE_KIND, s.kind), 'SourceRecord ' + s.id + ' kind 非法');
      check(typeof s.rawText === 'string', 'SourceRecord ' + s.id + ' rawText 必须为文本');
      check(isTimestamp(s.capturedAt) && isTimestamp(s.createdAt), 'SourceRecord ' + s.id + ' 时间戳非法');
    });

    data.assets.forEach(function (a) {
      var where = 'CareerAsset ' + a.id;
      belongs(checker, a, userId, 'CareerAsset');
      check(Object.prototype.hasOwnProperty.call(C.ASSET_KIND, a.kind), where + ' kind 非法');
      check(isNonEmptyString(a.title) && typeof a.body === 'string', where + ' title／body 非法');
      check(Number.isInteger(a.revision) && a.revision >= 1, where + ' revision 非法');
      checkProvenance(a.provenance, where, checker, sources, userId);
    });

    data.jobs.forEach(function (j) {
      var where = 'Job ' + j.id;
      belongs(checker, j, userId, 'Job');
      check(Array.isArray(j.goalIds), where + ' goalIds 必须为数组');
      (j.goalIds || []).forEach(function (gid) {
        check(goals[gid] && goals[gid].userId === userId, where + ' 关联了无效目标 ' + gid);
      });
      check(j.salaryText === null || typeof j.salaryText === 'string', where + ' salaryText 类型错误');
      check(Number.isInteger(j.revision) && j.revision >= 1, where + ' revision 非法');
      checkProvenance(j.provenance, where, checker, sources, userId);
    });

    data.assessments.forEach(function (as) {
      var where = 'JobAssessment ' + as.id;
      belongs(checker, as, userId, 'JobAssessment');
      check(jobs[as.jobId] && jobs[as.jobId].userId === userId, where + ' jobId 无效');
      check(goals[as.goalId] && goals[as.goalId].userId === userId, where + ' goalId 无效');
      check(as.jobSnapshot && as.jobSnapshot.jobId === as.jobId, where + ' jobSnapshot 与 jobId 不一致');
      check(as.goalSnapshot && as.goalSnapshot.goalId === as.goalId, where + ' goalSnapshot 与 goalId 不一致');
      check(as.match && typeof as.match === 'object' && Object.prototype.hasOwnProperty.call(C.MATCH_LEVEL, as.match.level), where + ' match.level 非法');
      check(as.match && isNonEmptyString(as.match.summary), where + ' match.summary 缺失');
      check(Object.prototype.hasOwnProperty.call(C.ORIGIN, as.origin), where + ' origin 非法');
      check(Array.isArray(as.assetSnapshots), where + ' assetSnapshots 必须为数组');
      if (Array.isArray(as.assetSnapshots)) {
        as.assetSnapshots.forEach(function (snap, i) {
          var snapWhere = where + ' 快照[' + i + ']';
          if (!check(snap && typeof snap === 'object', snapWhere + ' 必须为对象')) return;
          check(isNonEmptyString(snap.assetId), snapWhere + ' 缺少 assetId');
          check(Number.isInteger(snap.revision) && snap.revision >= 1, snapWhere + ' revision 非法');
          check(isNonEmptyString(snap.title), snapWhere + ' 缺少 title');
          check(typeof snap.body === 'string', snapWhere + ' body 必须为文本');
          checkProvenance(snap.provenance, snapWhere, checker, sources, userId);
        });
      }
      // evidence／gaps／risks 为必填数组：null、缺失或错误类型一律拒绝，合法空数组可通过。
      check(Array.isArray(as.evidence), where + ' evidence 必须为数组');
      if (Array.isArray(as.evidence)) {
        as.evidence.forEach(function (ev, i) {
          var evWhere = where + ' evidence[' + i + ']';
          if (!check(ev && typeof ev === 'object', evWhere + ' 必须为对象')) return;
          check(isNonEmptyString(ev.requirement), evWhere + ' 缺少 requirement');
          check(isNonEmptyString(ev.assetId), evWhere + ' 缺少 assetId');
          check(Number.isInteger(ev.assetRevision) && ev.assetRevision >= 1, evWhere + ' assetRevision 非法');
          check(typeof ev.excerpt === 'string' && ev.excerpt.length > 0, evWhere + ' 缺少 excerpt');
          var found =
            Array.isArray(as.assetSnapshots) &&
            as.assetSnapshots.some(function (snap) {
              return snap && snap.assetId === ev.assetId && snap.revision === ev.assetRevision;
            });
          check(found, where + ' 证据 ' + ev.assetId + '@' + ev.assetRevision + ' 缺少对应快照');
        });
      }
      ['gaps', 'risks'].forEach(function (field) {
        check(Array.isArray(as[field]), where + ' ' + field + ' 必须为数组');
        if (!Array.isArray(as[field])) return;
        as[field].forEach(function (item, i) {
          var itemWhere = where + ' ' + field + '[' + i + ']';
          if (!check(item && typeof item === 'object', itemWhere + ' 必须为对象')) return;
          check(isNonEmptyString(item.description) && isNonEmptyString(item.basis), itemWhere + ' 缺少描述或依据');
        });
      });
    });

    var appKeys = Object.create(null);
    data.applications.forEach(function (app) {
      var where = 'Application ' + app.id;
      belongs(checker, app, userId, 'Application');
      check(goals[app.goalId] && goals[app.goalId].userId === userId, where + ' goalId 无效');
      check(jobs[app.jobId] && jobs[app.jobId].userId === userId, where + ' jobId 无效');
      check(Object.prototype.hasOwnProperty.call(C.APPLICATION_STATUS, app.status), where + ' status 非法');
      var key = app.userId + '|' + app.goalId + '|' + app.jobId;
      check(!appKeys[key], where + ' 与其他记录的用户＋目标＋岗位重复');
      appKeys[key] = true;
      check(app.submittedAt === null || isTimestamp(app.submittedAt), where + ' submittedAt 非法');
      if (app.status === 'preparing') check(app.submittedAt === null, where + ' 准备中不能有 submittedAt');
      check(typeof app.hasHrReply === 'boolean', where + ' hasHrReply 必须为布尔值');
      if (!app.hasHrReply) check(app.firstHrReplyAt === null, where + ' 无回复时 firstHrReplyAt 必须为 null');
      else check(app.firstHrReplyAt === null || isTimestamp(app.firstHrReplyAt), where + ' firstHrReplyAt 非法');
      check(Array.isArray(app.submittedDocumentVersionIds), where + ' submittedDocumentVersionIds 必须为数组');
      check(typeof app.materialsUnknown === 'boolean', where + ' materialsUnknown 必须为布尔值');
    });

    var rounds = Object.create(null);
    data.interviews.forEach(function (iv) {
      var where = 'Interview ' + iv.id;
      belongs(checker, iv, userId, 'Interview');
      check(applications[iv.applicationId] && applications[iv.applicationId].userId === userId, where + ' applicationId 无效');
      check(Number.isInteger(iv.roundNumber) && iv.roundNumber >= 1, where + ' roundNumber 必须为正整数');
      var key = iv.applicationId + '|' + iv.roundNumber;
      check(!rounds[key], where + ' 与同一投递的其他轮次重复');
      rounds[key] = true;
      check(Object.prototype.hasOwnProperty.call(C.INTERVIEW_STATUS, iv.status), where + ' status 非法');
      check(iv.scheduledAt === null || isTimestamp(iv.scheduledAt), where + ' scheduledAt 非法');
      check(iv.completedAt === null || isTimestamp(iv.completedAt), where + ' completedAt 非法');
      if (iv.status === 'completed') check(isTimestamp(iv.completedAt), where + ' 已完成必须有 completedAt');
      if (iv.status === 'scheduled') check(isTimestamp(iv.scheduledAt), where + ' 已排期必须有 scheduledAt');
      check(Array.isArray(iv.prepDocumentVersionIds), where + ' prepDocumentVersionIds 必须为数组');
      if (iv.transcript !== null) {
        check(iv.transcript && typeof iv.transcript === 'object', where + ' transcript 非法');
        if (iv.transcript) {
          check(typeof iv.transcript.text === 'string', where + ' transcript.text 非法');
          check(iv.transcript.sourceId === null || !!sources[iv.transcript.sourceId], where + ' transcript.sourceId 无效');
          check(Number.isInteger(iv.transcript.revision) && iv.transcript.revision >= 1, where + ' transcript.revision 非法');
          check(isTimestamp(iv.transcript.capturedAt), where + ' transcript.capturedAt 非法');
        }
      }
      if (iv.review !== null) {
        check(iv.review && typeof iv.review === 'object', where + ' review 非法');
        if (iv.review) {
          check(isNonEmptyString(iv.review.summary), where + ' review.summary 缺失');
          check(Array.isArray(iv.review.strengths) && Array.isArray(iv.review.improvements) && Array.isArray(iv.review.nextActions), where + ' review 列表字段非法');
          check(Object.prototype.hasOwnProperty.call(C.ORIGIN, iv.review.origin), where + ' review.origin 非法');
          check(isTimestamp(iv.review.createdAt), where + ' review.createdAt 非法');
        }
      }
    });

    var documents = indexById(data.documents || [], 'documents', checker);
    var documentVersions = indexById(data.documentVersions || [], 'documentVersions', checker);

    (data.documents || []).forEach(function (doc) {
      var where = 'Document ' + doc.id;
      belongs(checker, doc, userId, 'Document');
      check(Object.prototype.hasOwnProperty.call(C.DOCUMENT_KIND, doc.kind), where + ' kind 非法');
      check(isNonEmptyString(doc.title), where + ' 缺少 title');
      check(doc.goalId === null || (goals[doc.goalId] && goals[doc.goalId].userId === userId), where + ' goalId 无效');
      check(doc.jobId === null || (jobs[doc.jobId] && jobs[doc.jobId].userId === userId), where + ' jobId 无效');
      check(doc.applicationId === null || (applications[doc.applicationId] && applications[doc.applicationId].userId === userId), where + ' applicationId 无效');
      check(doc.interviewId === null || (interviews[doc.interviewId] && interviews[doc.interviewId].userId === userId), where + ' interviewId 无效');
      if (doc.kind === 'resume' && doc.draft && doc.draft.parameters && doc.draft.parameters.variant === 'tailored') {
        check(!!doc.goalId && !!doc.jobId, where + ' 定制简历必须有 goalId 与 jobId');
      }
      if (doc.kind === 'self_introduction' || doc.kind === 'opening_message') {
        check(!!doc.goalId, where + ' 至少需要 goalId');
      }
      if (doc.kind === 'interview_prep') {
        check(!!doc.interviewId && !!doc.applicationId && !!doc.goalId && !!doc.jobId, where + ' 面试准备文档上下文不完整');
      }
      if (doc.applicationId) {
        var linkedApp = applications[doc.applicationId];
        if (linkedApp) {
          check(doc.goalId === linkedApp.goalId && doc.jobId === linkedApp.jobId, where + ' 与投递的目标／岗位不一致');
        }
      }
      check(doc.draft && typeof doc.draft === 'object', where + ' 缺少 draft');
      if (doc.draft) {
        check(typeof doc.draft.body === 'string', where + ' draft.body 非法');
        check(doc.draft.parameters && typeof doc.draft.parameters === 'object', where + ' draft.parameters 非法');
        check(Object.prototype.hasOwnProperty.call(C.ORIGIN, doc.draft.origin), where + ' draft.origin 非法');
        check(typeof doc.draft.userEdited === 'boolean' && typeof doc.draft.userConfirmed === 'boolean', where + ' draft 确认字段非法');
      }
    });

    (data.documentVersions || []).forEach(function (ver) {
      var where = 'DocumentVersion ' + ver.id;
      belongs(checker, ver, userId, 'DocumentVersion');
      check(documents[ver.documentId] && documents[ver.documentId].userId === userId, where + ' documentId 无效');
      check(Number.isInteger(ver.versionNumber) && ver.versionNumber >= 1, where + ' versionNumber 非法');
      check(typeof ver.body === 'string', where + ' body 非法');
      check(ver.parameters && typeof ver.parameters === 'object', where + ' parameters 非法');
      check(Object.prototype.hasOwnProperty.call(C.ORIGIN, ver.origin), where + ' origin 非法');
      check(typeof ver.userEdited === 'boolean' && typeof ver.userConfirmed === 'boolean', where + ' 确认字段非法');
      check(isTimestamp(ver.createdAt), where + ' createdAt 非法');
    });

    var files = indexById(data.files || [], 'files', checker);
    (data.files || []).forEach(function (file) {
      var where = 'ResumeFile ' + file.id;
      belongs(checker, file, userId, 'ResumeFile');
      check(isNonEmptyString(file.fileName) && file.fileName.length <= C.LIMITS.RESUME_FILE_NAME_MAX, where + ' fileName 非法');
      check(Number.isInteger(file.byteSize) && file.byteSize >= 0, where + ' byteSize 非法');
      check(typeof file.mimeType === 'string', where + ' mimeType 非法');
      check(Object.prototype.hasOwnProperty.call(C.RESUME_FILE_STATUS, file.status), where + ' status 非法');
      check(file.readError === null || typeof file.readError === 'string', where + ' readError 非法');
      if (file.status === 'read_failed') check(isNonEmptyString(file.readError), where + ' 读取失败须有原因');
      else check(file.readError === null, where + ' 非失败状态不应有 readError');
      check(typeof file.textDraft === 'string', where + ' textDraft 非法');
      check(file.sourceId === null || (sources[file.sourceId] && sources[file.sourceId].userId === userId), where + ' sourceId 无效');
      check(file.documentId === null || (documents[file.documentId] && documents[file.documentId].userId === userId), where + ' documentId 无效');
      if (file.status === 'confirmed') {
        check(!!file.sourceId, where + ' 已确认必须有来源');
      }
      check(isTimestamp(file.createdAt) && isTimestamp(file.updatedAt), where + ' 时间戳非法');
    });

    data.applications.forEach(function (app) {
      (app.submittedDocumentVersionIds || []).forEach(function (vid) {
        var ver = documentVersions[vid];
        check(ver && ver.userId === userId, 'Application ' + app.id + ' 引用了无效材料版本 ' + vid);
        if (ver) {
          var doc = documents[ver.documentId];
          check(doc && doc.kind !== 'interview_prep', 'Application ' + app.id + ' 不能引用面试准备材料');
        }
      });
      if (!app.materialsUnknown && app.submittedAt) {
        check((app.submittedDocumentVersionIds || []).length > 0, 'Application ' + app.id + ' 已投递但未记录材料且未标材料未知');
      }
    });

    data.interviews.forEach(function (iv) {
      (iv.prepDocumentVersionIds || []).forEach(function (vid) {
        check(documentVersions[vid] && documentVersions[vid].userId === userId, 'Interview ' + iv.id + ' 引用了无效准备文档版本 ' + vid);
      });
    });

    data.actionItems.forEach(function (ai) {
      var where = 'ActionItem ' + ai.id;
      belongs(checker, ai, userId, 'ActionItem');
      check(goals[ai.goalId] && goals[ai.goalId].userId === userId, where + ' goalId 无效');
      check(Object.prototype.hasOwnProperty.call(C.ACTION_ITEM_KIND, ai.kind), where + ' kind 非法');
      check(Object.prototype.hasOwnProperty.call(C.ACTION_ITEM_STATUS, ai.status), where + ' status 非法');
      check(ai.dueAt === null || isTimestamp(ai.dueAt), where + ' dueAt 非法');
      check(!!events[ai.sourceEventId], where + ' sourceEventId 无效');
      if (ai.jobId !== null) check(jobs[ai.jobId] && jobs[ai.jobId].userId === userId, where + ' jobId 无效');
      if (ai.applicationId !== null) {
        var app = applications[ai.applicationId];
        if (check(app && app.userId === userId, where + ' applicationId 无效')) {
          check(app.goalId === ai.goalId, where + ' 与投递的目标不一致');
          if (ai.jobId !== null) check(app.jobId === ai.jobId, where + ' 与投递的岗位不一致');
        }
      }
      if (ai.interviewId !== null) {
        var iv2 = interviews[ai.interviewId];
        if (check(iv2 && iv2.userId === userId, where + ' interviewId 无效')) {
          check(iv2.applicationId === ai.applicationId, where + ' 与面试所属投递不一致');
        }
      }
    });

    var commandKeys = Object.create(null);
    var subjectMaps = {
      user: users,
      career_goal: goals,
      career_asset: assets,
      job: jobs,
      application: applications,
      interview: interviews,
      document: documents,
      resume_file: files
    };
    data.events.forEach(function (ev) {
      var where = 'Event ' + ev.id;
      belongs(checker, ev, userId, 'Event');
      check(C.EVENT_TYPES.indexOf(ev.type) >= 0, where + ' type 非法：' + ev.type);
      check(ev.schemaVersion === C.EVENT_PAYLOAD_VERSION, where + ' schemaVersion 非法');
      check(ev.subject && C.SUBJECT_TYPES.indexOf(ev.subject.type) >= 0, where + ' subject 非法');
      if (ev.subject && subjectMaps[ev.subject.type]) {
        check(!!subjectMaps[ev.subject.type][ev.subject.id], where + ' subject 指向不存在的对象');
      }
      check(Array.isArray(ev.relatedRefs), where + ' relatedRefs 必须为数组');
      check(ev.actor && (ev.actor.type === 'user' || ev.actor.type === 'system'), where + ' actor 非法');
      check(ev.sourceId === null || !!sources[ev.sourceId], where + ' sourceId 无效');
      check(ev.occurredAt === null || isTimestamp(ev.occurredAt), where + ' occurredAt 非法');
      check(isTimestamp(ev.recordedAt), where + ' recordedAt 非法');
      check(isNonEmptyString(ev.commandId), where + ' 缺少 commandId');
      var key = ev.userId + '|' + ev.commandId;
      check(!commandKeys[key], where + ' commandId 重复：' + ev.commandId);
      commandKeys[key] = true;
      check(typeof ev.requestFingerprint === 'string', where + ' 缺少 requestFingerprint');
      check(ev.payload && typeof ev.payload === 'object', where + ' 缺少 payload');
    });

    var selected = envelope.ui.selectedGoalId;
    check(goals[selected] && goals[selected].status === 'active', 'ui.selectedGoalId 不是有效的 active 目标');

    return checker.errors;
  }

  CA.domain.validate = {
    deepClone: deepClone,
    stableStringify: stableStringify,
    isTimestamp: isTimestamp,
    validateEnvelope: validateEnvelope,
    validateAssetDraft: function (title, body) {
      var errors = {};
      var L = C.LIMITS;
      if (!isNonEmptyString(title)) errors.title = '请填写标题。';
      else if (title.trim().length > L.ASSET_TITLE_MAX) errors.title = '标题不超过 ' + L.ASSET_TITLE_MAX + ' 个字符。';
      if (!isNonEmptyString(body)) errors.body = '请填写正文。';
      else if (body.trim().length > L.ASSET_BODY_MAX) errors.body = '正文不超过 ' + L.ASSET_BODY_MAX + ' 个字符。';
      return errors;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
