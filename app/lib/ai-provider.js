(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.lib = CA.lib || {};

  var testAdapter = null;
  var lastSafeLog = [];
  var backendSnap = {
    checked: false,
    reachable: false,
    configured: false,
    providerId: 'deepseek',
    model: 'deepseek-chat',
    willCallExternal: false,
    verify: { status: 'none', message: null, at: null, code: null },
    reason: null
  };

  function pushSafeLog(entry) {
    lastSafeLog.push(entry);
    if (lastSafeLog.length > 20) lastSafeLog.shift();
  }

  function isFileProtocol() {
    try {
      return !!(root.location && root.location.protocol === 'file:');
    } catch (e) {
      return false;
    }
  }

  function apiBase() {
    // 同源相对路径；file:// 下不可用
    return '';
  }

  function userFacingError(code, fallback) {
    var map = {
      auth: '模型密钥无效或没有权限。请检查本机服务使用的 .env 配置。',
      rate_limit: '调用次数或额度受限。请稍后再试。',
      timeout: '等待模型响应超时。请检查网络后重试。',
      format: '模型返回格式不符合要求（须引用简历原文）。请重试；若持续失败可改用本地演示建议。',
      not_configured: '本机助手服务尚未配置模型密钥（DEEPSEEK_API_KEY）。',
      offline: '本机助手服务未连接。请通过已授权启动的本机地址打开本页（不要用本地文件直接打开）。',
      no_adapter: '模型适配器不可用。请稍后重试或改用本地演示建议。',
      bad_request: '请求内容不完整或过长。请检查后再试。',
      upstream: '模型服务暂时不可用。请稍后重试。'
    };
    return map[code] || fallback || '模型调用失败，请重试。';
  }

  function getStatus() {
    if (testAdapter) {
      return {
        configured: true,
        configPhase: 'verified',
        providerId: testAdapter.id || 'test',
        label: testAdapter.label || '测试用模型适配器',
        model: testAdapter.model || 'mock',
        willCallExternal: !!testAdapter.willCallExternal,
        source: 'test',
        keyMasked: null,
        verify: { status: 'verified', message: '测试适配器已就绪（不外呼）。', at: null },
        mode: 'test',
        reason: null
      };
    }
    if (isFileProtocol()) {
      return {
        configured: false,
        configPhase: 'unconfigured',
        providerId: null,
        label: null,
        model: null,
        willCallExternal: false,
        source: 'offline',
        mode: 'offline',
        reason: userFacingError('offline'),
        verify: { status: 'none', message: userFacingError('offline'), at: null }
      };
    }
    if (!backendSnap.checked) {
      return {
        configured: false,
        configPhase: 'unconfigured',
        providerId: 'deepseek',
        label: 'DeepSeek（本机服务）',
        model: backendSnap.model,
        willCallExternal: false,
        source: 'server',
        mode: 'server',
        reason: '正在检查本机助手服务…',
        verify: { status: 'none', message: '正在检查本机助手服务…', at: null }
      };
    }
    if (!backendSnap.reachable) {
      return {
        configured: false,
        configPhase: 'unconfigured',
        providerId: 'deepseek',
        label: 'DeepSeek（本机服务）',
        model: backendSnap.model,
        willCallExternal: false,
        source: 'offline',
        mode: 'offline',
        reason: backendSnap.reason || userFacingError('offline'),
        verify: backendSnap.verify
      };
    }
    if (!backendSnap.configured) {
      return {
        configured: false,
        configPhase: 'unconfigured',
        providerId: 'deepseek',
        label: 'DeepSeek（本机服务）',
        model: backendSnap.model,
        willCallExternal: false,
        source: 'server',
        mode: 'server',
        reason: userFacingError('not_configured'),
        verify: {
          status: 'none',
          message: userFacingError('not_configured'),
          at: backendSnap.verify.at
        }
      };
    }
    var phase =
      backendSnap.verify.status === 'verified'
        ? 'verified'
        : backendSnap.verify.status === 'failed'
          ? 'failed'
          : 'pending_verify';
    return {
      configured: true,
      configPhase: phase,
      providerId: backendSnap.providerId || 'deepseek',
      label: 'DeepSeek（本机服务）',
      model: backendSnap.model,
      willCallExternal: true,
      source: 'server',
      mode: 'server',
      reason: null,
      verify: backendSnap.verify
    };
  }

  function refreshStatus() {
    if (testAdapter) {
      return Promise.resolve(getStatus());
    }
    if (isFileProtocol()) {
      backendSnap.checked = true;
      backendSnap.reachable = false;
      backendSnap.configured = false;
      backendSnap.reason = userFacingError('offline');
      backendSnap.verify = { status: 'none', message: userFacingError('offline'), at: new Date().toISOString() };
      return Promise.resolve(getStatus());
    }
    return fetch(apiBase() + '/api/ai/status', { method: 'GET', credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('status_http');
        return res.json();
      })
      .then(function (data) {
        backendSnap.checked = true;
        backendSnap.reachable = true;
        backendSnap.configured = !!data.configured;
        backendSnap.providerId = data.providerId || 'deepseek';
        backendSnap.model = data.model || 'deepseek-chat';
        backendSnap.willCallExternal = !!data.willCallExternal;
        backendSnap.reason = backendSnap.configured ? null : userFacingError('not_configured');
        if (!backendSnap.configured) {
          backendSnap.verify = {
            status: 'none',
            message: userFacingError('not_configured'),
            at: new Date().toISOString()
          };
        } else if (backendSnap.verify.status === 'none') {
          backendSnap.verify = {
            status: 'pending',
            message: '本机服务已配置。建议先验证连接，再确认发送范围。',
            at: new Date().toISOString()
          };
        }
        return getStatus();
      })
      .catch(function () {
        backendSnap.checked = true;
        backendSnap.reachable = false;
        backendSnap.configured = false;
        backendSnap.reason = userFacingError('offline');
        backendSnap.verify = {
          status: 'none',
          message: userFacingError('offline'),
          at: new Date().toISOString()
        };
        return getStatus();
      });
  }

  function parseApiError(res, data) {
    var code = (data && data.code) || (res && !res.ok ? 'upstream' : 'failed');
    var message = (data && data.message) || userFacingError(code);
    return Object.assign(new Error(message), { code: code });
  }

  function verifyConfig() {
    if (testAdapter) {
      backendSnap.verify = {
        status: 'verified',
        at: new Date().toISOString(),
        message: '测试适配器可用（不外呼）。',
        code: null
      };
      return Promise.resolve(getStatus());
    }
    return refreshStatus().then(function (st) {
      if (!st.configured || st.mode === 'offline') {
        return Promise.reject(Object.assign(new Error(st.reason || userFacingError('offline')), { code: 'offline' }));
      }
      backendSnap.verify = {
        status: 'pending',
        at: new Date().toISOString(),
        message: '正在验证连接（不会发送简历正文）…',
        code: null
      };
      var started = Date.now();
      return fetch(apiBase() + '/api/ai/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { res: res, data: data };
          });
        })
        .then(function (pack) {
          if (!pack.res.ok || !pack.data || pack.data.ok !== true) {
            throw parseApiError(pack.res, pack.data);
          }
          backendSnap.verify = {
            status: 'verified',
            at: new Date().toISOString(),
            message: pack.data.message || '连接验证成功。',
            code: null
          };
          pushSafeLog({
            at: backendSnap.verify.at,
            providerId: 'deepseek',
            model: backendSnap.model,
            status: 'verify_ok',
            durationMs: Date.now() - started
          });
          return getStatus();
        })
        .catch(function (err) {
          var code = (err && err.code) || 'upstream';
          backendSnap.verify = {
            status: 'failed',
            at: new Date().toISOString(),
            message: userFacingError(code, err && err.message),
            code: code
          };
          pushSafeLog({
            at: backendSnap.verify.at,
            providerId: 'deepseek',
            model: backendSnap.model,
            status: 'verify_failed',
            errorCode: code,
            durationMs: Date.now() - started
          });
          throw Object.assign(new Error(backendSnap.verify.message), { code: code });
        });
    });
  }

  function generateResumeSuggestions(payload) {
    if (testAdapter) {
      return testAdapter.generateResumeSuggestions(payload);
    }
    var st = getStatus();
    if (!st.configured) {
      var code = st.mode === 'offline' ? 'offline' : 'not_configured';
      pushSafeLog({
        at: new Date().toISOString(),
        providerId: null,
        jobId: payload && payload.job && payload.job.id,
        status: 'unavailable',
        errorCode: code
      });
      return Promise.reject(Object.assign(new Error(userFacingError(code, st.reason)), { code: code }));
    }
    var started = Date.now();
    var body = {
      resumeText: payload.resumeText,
      job: payload.job
        ? {
            id: payload.job.id,
            title: payload.job.title,
            companyName: payload.job.companyName,
            location: payload.job.location,
            salaryText: payload.job.salaryText,
            jdText: payload.job.jdText
          }
        : null,
      assessment: payload.assessment || null
    };
    return fetch(apiBase() + '/api/ai/revise-suggestions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (pack) {
        if (!pack.res.ok || !pack.data || pack.data.ok !== true) {
          throw parseApiError(pack.res, pack.data);
        }
        var suggestions = pack.data.suggestions;
        // 前端再校一次：须引用原文
        try {
          suggestions = CA.lib.revisePrompt.normalizeSuggestions(suggestions, payload.resumeText);
        } catch (parseErr) {
          throw Object.assign(new Error(userFacingError('format', parseErr.message)), { code: 'format' });
        }
        pushSafeLog({
          at: new Date().toISOString(),
          providerId: pack.data.providerId || 'deepseek',
          model: pack.data.model || backendSnap.model,
          jobId: payload.job && payload.job.id,
          status: 'success',
          suggestionCount: suggestions.length,
          durationMs: Date.now() - started
        });
        return {
          suggestions: suggestions,
          providerId: pack.data.providerId || 'deepseek',
          model: pack.data.model || backendSnap.model
        };
      })
      .catch(function (err) {
        var code = (err && err.code) || 'upstream';
        pushSafeLog({
          at: new Date().toISOString(),
          providerId: 'deepseek',
          model: backendSnap.model,
          jobId: payload.job && payload.job.id,
          status: 'failed',
          errorCode: code,
          durationMs: Date.now() - started
        });
        // 禁止静默降级为直连或演示成功
        throw Object.assign(new Error(userFacingError(code, err && err.message)), { code: code });
      });
  }

  // 兼容旧测试名：不再接受页面粘贴密钥作为产品路径
  function setSessionConfig() {
    return { ok: false, error: '已改为本机服务读取密钥，页面不再保存 API Key。' };
  }

  function clearSessionConfig() {
    backendSnap.verify = { status: 'none', message: null, at: null, code: null };
    return getStatus();
  }

  CA.lib.aiProvider = {
    getStatus: getStatus,
    refreshStatus: refreshStatus,
    setSessionConfig: setSessionConfig,
    clearSessionConfig: clearSessionConfig,
    verifyConfig: verifyConfig,
    generateResumeSuggestions: generateResumeSuggestions,
    userFacingError: userFacingError,
    setTestAdapter: function (adapter) {
      testAdapter = adapter || null;
    },
    getTestAdapter: function () {
      return testAdapter;
    },
    getSafeLogs: function () {
      return lastSafeLog.slice();
    },
    clearSafeLogs: function () {
      lastSafeLog = [];
    },
    createMockAdapter: function (opts) {
      opts = opts || {};
      return {
        id: opts.id || 'mock',
        label: opts.label || '模拟模型（测试）',
        model: opts.model || 'mock',
        willCallExternal: false,
        generateResumeSuggestions: function (payload) {
          if (opts.fail) {
            pushSafeLog({
              at: new Date().toISOString(),
              providerId: 'mock',
              jobId: payload.job && payload.job.id,
              status: 'failed',
              errorCode: opts.failCode || 'mock_fail'
            });
            return Promise.reject(
              Object.assign(new Error(opts.failMessage || '模拟：模型调用失败'), {
                code: opts.failCode || 'mock_fail'
              })
            );
          }
          var list =
            opts.suggestions ||
            CA.lib.reviseSuggestions.buildDemoSuggestions({
              resumeText: payload.resumeText,
              job: payload.job,
              assessment: payload.assessment
            }).suggestions;
          list = (list || []).map(function (s) {
            return Object.assign({}, s, {
              kind: 'mock_model',
              reason: (s.reason || '') + '（模拟模型返回，非外部服务）'
            });
          });
          pushSafeLog({
            at: new Date().toISOString(),
            providerId: 'mock',
            jobId: payload.job && payload.job.id,
            status: 'success',
            suggestionCount: list.length
          });
          return Promise.resolve({ suggestions: list, providerId: 'mock', model: 'mock' });
        }
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
