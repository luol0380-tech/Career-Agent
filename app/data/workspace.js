(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.data = CA.data || {};

  var C = CA.domain.constants;
  var V = CA.domain.validate;
  var S = CA.domain.selectors;
  var STATUS = C.STORAGE_STATUS;

  var MESSAGES = {
    read_only: '本地保存不可用，当前仅供浏览，无法保存。',
    invalid_data: '本地演示数据损坏或版本不兼容，需先确认重置后才能保存。',
    external_change: '其他标签页修改了本应用的演示数据，已暂停保存。请重新加载页面后再操作。',
    write_failed: '写入浏览器本地存储失败，本次修改未保存。',
    load_failed: '读取本地演示数据失败。',
    revision_conflict: '该资产已被更新，为避免覆盖未保存本次修改。请重新加载页面后再编辑。',
    command_conflict: '同一操作标识对应了不同的修改内容，已拒绝执行。',
    not_found: '找不到要修改的对象。',
    invalid_input: '输入内容未通过校验。',
    invalid_goal: '该目标不存在、不属于当前用户或未启用。',
    not_confirmed: '重置演示需要明确确认。',
    invalid_candidate: '修改后的数据未通过一致性校验，已拒绝保存。',
    not_loaded: '演示数据尚未加载。'
  };

  function fail(code, extra) {
    var err = new Error(MESSAGES[code] || code);
    err.code = code;
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        err[key] = extra[key];
      });
    }
    return err;
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function defaultClock() {
    var d = new Date();
    var offset = -d.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var abs = Math.abs(offset);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
    );
  }

  function randomId(prefix) {
    var cryptoObj = root.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return prefix + '_' + cryptoObj.randomUUID();
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function normalizeText(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function createWorkspaceService(options) {
    var driver = options.driver;
    var hooks = options.hooks || { loadDelayMs: 0, failLoads: 0 };
    var clock = options.clock || defaultClock;
    var createFixture = options.createFixture || CA.fixtures.demo.createEnvelope;

    var committed = null;
    var storageStatus = null;
    var invalidReason = null;
    var readOnlyReason = null;
    var lastKnownRaw = null;
    var externalChange = false;
    var queue = Promise.resolve();
    var statusListeners = [];

    function notifyStatus() {
      var status = getStatus();
      statusListeners.forEach(function (fn) {
        fn(status);
      });
    }

    driver.onExternalChange(function (change) {
      if (storageStatus === STATUS.UNAVAILABLE) return;
      if (change.key !== null && change.key !== C.STORAGE_KEY) return;
      if (change.newValue === lastKnownRaw) return;
      externalChange = true;
      notifyStatus();
    });

    function getStatus() {
      return {
        storageStatus: storageStatus,
        readOnly: storageStatus !== STATUS.AVAILABLE,
        readOnlyReason: readOnlyReason,
        invalidReason: invalidReason,
        externalChange: externalChange,
        writable: storageStatus === STATUS.AVAILABLE && !externalChange,
        canReset: storageStatus !== STATUS.UNAVAILABLE && !externalChange
      };
    }

    function snapshot() {
      if (!committed) throw fail('not_loaded');
      var copy = V.deepClone(committed);
      copy.status = getStatus();
      return copy;
    }

    function serialized(task) {
      var run = queue.then(task, task);
      queue = run.catch(function () {});
      return run;
    }

    function probe() {
      try {
        driver.setItem(C.STORAGE_PROBE_KEY, '1');
        var ok = driver.getItem(C.STORAGE_PROBE_KEY) === '1';
        driver.removeItem(C.STORAGE_PROBE_KEY);
        return ok;
      } catch (e) {
        return false;
      }
    }

    function enterUnavailable(reason) {
      storageStatus = STATUS.UNAVAILABLE;
      readOnlyReason = reason;
      invalidReason = null;
      committed = createFixture();
    }

    // 写入候选快照；只有成功后才替换已提交状态。
    function persist(candidate) {
      if (storageStatus === STATUS.UNAVAILABLE) throw fail('read_only');
      if (externalChange) throw fail('external_change');
      var current;
      try {
        current = driver.getItem(C.STORAGE_KEY);
      } catch (e) {
        throw fail('write_failed', { cause: e && e.message });
      }
      if (current !== lastKnownRaw) {
        externalChange = true;
        notifyStatus();
        throw fail('external_change');
      }
      var text = JSON.stringify(candidate);
      try {
        driver.setItem(C.STORAGE_KEY, text);
      } catch (e) {
        throw fail('write_failed', { cause: e && e.name });
      }
      lastKnownRaw = text;
      committed = candidate;
    }

    function assertCandidate(candidate) {
      var errors = V.validateEnvelope(candidate);
      if (errors.length) throw fail('invalid_candidate', { details: errors });
    }

    function loadWorkspace() {
      return serialized(function () {
        return delay(hooks.loadDelayMs || 0).then(function () {
          if (hooks.failLoads > 0) {
            hooks.failLoads -= 1;
            throw fail('load_failed');
          }
          externalChange = false;
          readOnlyReason = null;
          invalidReason = null;

          if (!probe()) {
            enterUnavailable('startup_probe_failed');
            notifyStatus();
            return snapshot();
          }

          var raw;
          try {
            raw = driver.getItem(C.STORAGE_KEY);
          } catch (e) {
            throw fail('load_failed', { cause: e && e.message });
          }

          if (raw === null) {
            var seed = createFixture();
            assertCandidate(seed);
            var text = JSON.stringify(seed);
            try {
              driver.setItem(C.STORAGE_KEY, text);
            } catch (e) {
              enterUnavailable('seed_write_failed');
              notifyStatus();
              return snapshot();
            }
            lastKnownRaw = text;
            committed = seed;
            storageStatus = STATUS.AVAILABLE;
            notifyStatus();
            return snapshot();
          }

          lastKnownRaw = raw;
          var parsed = null;
          var errors;
          try {
            parsed = JSON.parse(raw);
            // 缺省 documents／documentVersions 视为 []（见 DATA_SCHEMA 软迁移）；非数组保持原样交给校验 → invalid_data。
            if (parsed && parsed.data) {
              if (parsed.data.documents === undefined || parsed.data.documents === null) parsed.data.documents = [];
              if (parsed.data.documentVersions === undefined || parsed.data.documentVersions === null) parsed.data.documentVersions = [];
              if (parsed.data.files === undefined || parsed.data.files === null) parsed.data.files = [];
            }
            errors = V.validateEnvelope(parsed);
          } catch (e) {
            errors = ['无法解析为 JSON'];
          }
          if (errors.length) {
            storageStatus = STATUS.INVALID_DATA;
            invalidReason = errors.slice(0, 3).join('；');
            committed = createFixture();
          } else {
            storageStatus = STATUS.AVAILABLE;
            committed = parsed;
          }
          notifyStatus();
          return snapshot();
        });
      });
    }

    function readWorkspace() {
      return Promise.resolve().then(snapshot);
    }

    function selectGoal(goalId) {
      return serialized(function () {
        if (!committed) throw fail('not_loaded');
        var user = S.user(committed.data);
        var goal = S.goal(committed.data, goalId);
        if (!goal || goal.userId !== user.id || goal.status !== 'active') throw fail('invalid_goal');
        if (committed.ui.selectedGoalId === goalId) return { status: 'noop', persisted: storageStatus === STATUS.AVAILABLE };
        if (storageStatus !== STATUS.AVAILABLE) {
          committed.ui.selectedGoalId = goalId;
          return { status: 'temporary', persisted: false };
        }
        var candidate = V.deepClone(committed);
        candidate.ui.selectedGoalId = goalId;
        persist(candidate);
        return { status: 'saved', persisted: true };
      });
    }

    function assetFingerprint(input) {
      return V.stableStringify({
        op: 'updateCareerAsset',
        assetId: input.assetId,
        expectedRevision: input.expectedRevision,
        title: normalizeText(input.title),
        body: normalizeText(input.body),
        confirmFacts: input.confirmFacts === true
      });
    }

    function updateCareerAsset(input) {
      return serialized(function () {
        if (!committed) throw fail('not_loaded');
        if (storageStatus === STATUS.UNAVAILABLE) throw fail('read_only');
        if (storageStatus === STATUS.INVALID_DATA) throw fail('invalid_data');
        if (externalChange) throw fail('external_change');
        if (!input || typeof input.commandId !== 'string' || !input.commandId) throw fail('invalid_input', { fields: { commandId: '缺少 commandId' } });

        var data = committed.data;
        var user = S.user(data);
        var fingerprint = assetFingerprint(input);

        var prior = S.findEventByCommand(data, user.id, input.commandId);
        if (prior) {
          if (prior.requestFingerprint !== fingerprint) throw fail('command_conflict');
          return { status: 'replayed', newRevision: prior.payload.newRevision, eventId: prior.id };
        }

        var asset = S.asset(data, input.assetId);
        if (!asset || asset.userId !== user.id) throw fail('not_found');
        if (input.expectedRevision !== asset.revision) {
          throw fail('revision_conflict', { currentRevision: asset.revision });
        }

        var title = normalizeText(input.title);
        var body = normalizeText(input.body);
        var fieldErrors = V.validateAssetDraft(title, body);
        if (Object.keys(fieldErrors).length) throw fail('invalid_input', { fields: fieldErrors });

        var changedFields = [];
        if (title !== asset.title) changedFields.push('title');
        if (body !== asset.body) changedFields.push('body');
        var contentChanged = changedFields.length > 0;
        var confirm = input.confirmFacts === true;

        if (!contentChanged && !(confirm && !asset.provenance.userConfirmed)) {
          return { status: 'noop', newRevision: asset.revision };
        }

        var now = clock();
        var candidate = V.deepClone(committed);
        var target = S.asset(candidate.data, asset.id);
        var previousRevision = target.revision;
        var sourceId = null;

        if (contentChanged) {
          sourceId = randomId('src');
          candidate.data.sources.push({
            id: sourceId,
            userId: user.id,
            kind: 'manual_entry',
            label: '手动编辑：' + title,
            rawText: '标题：' + title + '\n\n正文：' + body,
            capturedAt: now,
            createdAt: now
          });
          target.title = title;
          target.body = body;
          target.provenance.sourceIds = target.provenance.sourceIds.concat([sourceId]);
          target.provenance.confidence = null;
          target.provenance.userConfirmed = confirm;
          target.provenance.confirmedAt = confirm ? now : null;
        } else {
          changedFields = ['userConfirmed'];
          target.provenance.userConfirmed = true;
          target.provenance.confirmedAt = now;
        }
        target.revision = previousRevision + 1;
        target.updatedAt = now;

        var eventId = randomId('evt');
        candidate.data.events.push({
          id: eventId,
          userId: user.id,
          type: 'career_asset.revised',
          schemaVersion: C.EVENT_PAYLOAD_VERSION,
          subject: { type: 'career_asset', id: asset.id },
          relatedRefs: [],
          actor: { type: 'user', id: user.id },
          sourceId: sourceId,
          occurredAt: now,
          recordedAt: now,
          commandId: input.commandId,
          requestFingerprint: fingerprint,
          payload: {
            previousRevision: previousRevision,
            newRevision: target.revision,
            changedFields: changedFields,
            sourceId: sourceId,
            userConfirmed: target.provenance.userConfirmed
          }
        });

        assertCandidate(candidate);
        persist(candidate);
        return { status: 'saved', newRevision: target.revision, eventId: eventId, sourceId: sourceId };
      });
    }

    function resetDemo(request) {
      return serialized(function () {
        if (!request || request.confirmed !== true) throw fail('not_confirmed');
        if (storageStatus === STATUS.UNAVAILABLE) throw fail('read_only');
        if (externalChange) throw fail('external_change');
        var fresh = createFixture();
        assertCandidate(fresh);
        var text = JSON.stringify(fresh);
        try {
          var current = driver.getItem(C.STORAGE_KEY);
          if (current !== lastKnownRaw) {
            externalChange = true;
            notifyStatus();
            throw fail('external_change');
          }
          driver.setItem(C.STORAGE_KEY, text);
        } catch (e) {
          if (e && e.code) throw e;
          throw fail('write_failed', { cause: e && e.name });
        }
        try {
          driver.removeItem(C.STORAGE_PROBE_KEY);
        } catch (e) {
          // 探测键清理失败不影响已写入的重置结果。
        }
        lastKnownRaw = text;
        committed = fresh;
        storageStatus = STATUS.AVAILABLE;
        invalidReason = null;
        readOnlyReason = null;
        notifyStatus();
        return { status: 'reset' };
      });
    }

    var api = {
      loadWorkspace: loadWorkspace,
      readWorkspace: readWorkspace,
      selectGoal: selectGoal,
      updateCareerAsset: updateCareerAsset,
      resetDemo: resetDemo,
      getStatus: getStatus,
      onStatusChange: function (fn) {
        statusListeners.push(fn);
      },
      newCommandId: function () {
        return randomId('cmd');
      },
      fingerprintAssetUpdate: assetFingerprint
    };

    if (typeof CA.data.attachPhase2Commands === 'function') {
      CA.data.attachPhase2Commands(api, {
        fail: fail,
        persist: persist,
        assertCandidate: assertCandidate,
        getCommitted: function () {
          return committed;
        },
        getStorageStatus: function () {
          return storageStatus;
        },
        isExternalChange: function () {
          return externalChange;
        },
        clock: clock,
        randomId: randomId,
        normalizeText: normalizeText,
        serialized: serialized
      });
    }
    if (typeof CA.data.attachPhase3Commands === 'function') {
      CA.data.attachPhase3Commands(api, {
        fail: fail,
        persist: persist,
        assertCandidate: assertCandidate,
        getCommitted: function () {
          return committed;
        },
        getStorageStatus: function () {
          return storageStatus;
        },
        isExternalChange: function () {
          return externalChange;
        },
        clock: clock,
        randomId: randomId,
        normalizeText: normalizeText,
        serialized: serialized
      });
    }

    return api;
  }

  CA.data.createWorkspaceService = createWorkspaceService;
  CA.data.MESSAGES = MESSAGES;
})(typeof window !== 'undefined' ? window : globalThis);
