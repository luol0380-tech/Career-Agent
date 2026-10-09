(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.lib = CA.lib || {};

  var PROVIDERS = {
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat'
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini'
    },
    compatible: {
      id: 'compatible',
      label: '自定义兼容接口',
      defaultBaseUrl: '',
      defaultModel: 'gpt-4o-mini'
    }
  };

  var testAdapter = null;
  var sessionConfig = null;
  var verifyState = { status: 'none', at: null, message: null, code: null };
  var lastSafeLog = [];

  function providerMeta(id) {
    return PROVIDERS[id] || null;
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var provider = String(raw.provider || '').trim().toLowerCase();
    var apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    if (!provider || !apiKey) return null;
    if (!PROVIDERS[provider]) return null;
    var meta = PROVIDERS[provider];
    var baseUrl = String(raw.baseUrl || meta.defaultBaseUrl || '').trim().replace(/\/$/, '');
    if (provider === 'compatible' && !baseUrl) return null;
    if (provider === 'deepseek' && !baseUrl) baseUrl = meta.defaultBaseUrl;
    // DeepSeek 文档：根为 https://api.deepseek.com，路径 /chat/completions
    var model = String(raw.model || meta.defaultModel || '').trim() || meta.defaultModel;
    return {
      provider: provider,
      apiKey: apiKey,
      baseUrl: baseUrl,
      model: model,
      timeoutMs: Math.min(Math.max(Number(raw.timeoutMs) || 45000, 5000), 120000)
    };
  }

  function maskKey(key) {
    var s = String(key || '');
    if (s.length <= 8) return '••••';
    return s.slice(0, 3) + '••••' + s.slice(-4);
  }

  function pushSafeLog(entry) {
    lastSafeLog.push(entry);
    if (lastSafeLog.length > 20) lastSafeLog.shift();
  }

  function readWindowBootstrap() {
    return normalizeConfig(root.CareerAgentAI);
  }

  function ensureSessionFromWindow() {
    if (sessionConfig) return sessionConfig;
    var boot = readWindowBootstrap();
    if (boot) {
      sessionConfig = boot;
      verifyState = { status: 'pending', at: null, message: '已从页面会话注入配置，尚未验证连接。', code: null };
    }
    return sessionConfig;
  }

  function setSessionConfig(raw) {
    var incoming = raw && typeof raw === 'object' ? Object.assign({}, raw) : {};
    if ((!incoming.apiKey || !String(incoming.apiKey).trim()) && sessionConfig && sessionConfig.apiKey) {
      incoming.apiKey = sessionConfig.apiKey;
    }
    var cfg = normalizeConfig(incoming);
    if (!cfg) {
      return { ok: false, error: '请填写有效的提供方、密钥；自定义接口还需填写服务地址。' };
    }
    sessionConfig = cfg;
    verifyState = {
      status: 'pending',
      at: new Date().toISOString(),
      message: '配置已保存在当前页面会话，刷新后会清除。请先验证连接。',
      code: null
    };
    pushSafeLog({
      at: verifyState.at,
      providerId: cfg.provider,
      model: cfg.model,
      status: 'config_saved',
      keyMasked: maskKey(cfg.apiKey)
    });
    return { ok: true, status: getStatus() };
  }

  function clearSessionConfig() {
    sessionConfig = null;
    verifyState = { status: 'none', at: new Date().toISOString(), message: '已清除本会话模型配置。', code: null };
    // 清除窗口注入，避免刷新前再次被读入
    try {
      if (root.CareerAgentAI) {
        delete root.CareerAgentAI.apiKey;
        root.CareerAgentAI = null;
      }
    } catch (e) {}
    pushSafeLog({ at: verifyState.at, status: 'config_cleared' });
    return getStatus();
  }

  function configPhase() {
    if (testAdapter) return 'verified';
    ensureSessionFromWindow();
    if (!sessionConfig) return 'unconfigured';
    if (verifyState.status === 'verified') return 'verified';
    if (verifyState.status === 'failed') return 'failed';
    return 'pending_verify';
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
        providers: PROVIDERS
      };
    }
    ensureSessionFromWindow();
    var phase = configPhase();
    if (!sessionConfig) {
      return {
        configured: false,
        configPhase: 'unconfigured',
        providerId: null,
        label: null,
        model: null,
        willCallExternal: false,
        source: 'none',
        reason: '尚未配置模型。可在下方填入 DeepSeek 等提供方与密钥（仅本页会话，不写入本地业务存储）。',
        keyMasked: null,
        verify: { status: 'none', message: verifyState.message, at: verifyState.at },
        providers: PROVIDERS,
        defaults: {
          provider: 'deepseek',
          model: PROVIDERS.deepseek.defaultModel,
          baseUrl: PROVIDERS.deepseek.defaultBaseUrl
        }
      };
    }
    var meta = PROVIDERS[sessionConfig.provider];
    return {
      configured: true,
      configPhase: phase,
      providerId: sessionConfig.provider,
      label: meta ? meta.label : sessionConfig.provider,
      model: sessionConfig.model,
      baseUrl: sessionConfig.baseUrl,
      willCallExternal: true,
      source: 'session',
      keyMasked: maskKey(sessionConfig.apiKey),
      verify: {
        status: verifyState.status,
        message: verifyState.message,
        at: verifyState.at,
        code: verifyState.code
      },
      providers: PROVIDERS,
      defaults: {
        provider: 'deepseek',
        model: PROVIDERS.deepseek.defaultModel,
        baseUrl: PROVIDERS.deepseek.defaultBaseUrl
      }
    };
  }

  function userFacingError(code, fallback) {
    var map = {
      auth: '密钥无效或没有权限。请检查 API Key，或清除后重新配置。',
      rate_limit: '调用次数或额度受限。请稍后再试，或更换额度充足的密钥。',
      timeout: '等待模型响应超时。请检查网络后重试。',
      format: '模型返回格式不符合要求（须引用简历原文）。请重试；若持续失败可改用本地演示建议。',
      not_configured: '尚未接入真实 AI：请先配置并验证模型。',
      no_adapter: '模型适配器不可用。请重新配置或清除后重试。'
    };
    if (code && String(code).indexOf('http_') === 0) {
      return '模型服务返回错误。请稍后重试；若刚配置密钥，可先点「验证连接」。';
    }
    return map[code] || fallback || '模型调用失败，请重试。';
  }

  function chatCompletions(cfg, messages, opts) {
    opts = opts || {};
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey
    };
    var body = {
      model: cfg.model,
      temperature: opts.temperature != null ? opts.temperature : 0.2,
      messages: messages
    };
    var url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
    var req = fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    if (controller) {
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {}
      }, cfg.timeoutMs);
    }
    return req
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          var code = res.status;
          if (code === 401 || code === 403) throw Object.assign(new Error(userFacingError('auth')), { code: 'auth' });
          if (code === 429) throw Object.assign(new Error(userFacingError('rate_limit')), { code: 'rate_limit' });
          throw Object.assign(new Error(userFacingError('http_' + code)), { code: 'http_' + code });
        }
        return res.json();
      })
      .then(function (data) {
        var content =
          data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        return { raw: data, content: content };
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          throw Object.assign(new Error(userFacingError('timeout')), { code: 'timeout' });
        }
        throw err;
      });
  }

  function createHttpAdapter(cfg) {
    var meta = PROVIDERS[cfg.provider] || { label: cfg.provider };
    return {
      id: cfg.provider,
      label: meta.label,
      model: cfg.model,
      willCallExternal: true,
      generateResumeSuggestions: function (payload) {
        var Prompt = CA.lib.revisePrompt;
        var started = Date.now();
        return chatCompletions(cfg, [
          { role: 'system', content: Prompt.buildSystemPrompt() },
          { role: 'user', content: Prompt.buildUserMessage(payload) }
        ])
          .then(function (res) {
            var suggestions;
            try {
              suggestions = Prompt.parseModelSuggestions(res.content, payload.resumeText);
            } catch (parseErr) {
              throw Object.assign(new Error(userFacingError('format', parseErr.message)), { code: 'format' });
            }
            pushSafeLog({
              at: new Date().toISOString(),
              providerId: cfg.provider,
              model: cfg.model,
              jobId: payload.job && payload.job.id,
              status: 'success',
              suggestionCount: suggestions.length,
              durationMs: Date.now() - started
            });
            return { suggestions: suggestions, providerId: cfg.provider, model: cfg.model };
          })
          .catch(function (err) {
            pushSafeLog({
              at: new Date().toISOString(),
              providerId: cfg.provider,
              model: cfg.model,
              jobId: payload.job && payload.job.id,
              status: 'failed',
              errorCode: (err && err.code) || 'failed',
              durationMs: Date.now() - started
            });
            throw Object.assign(new Error(userFacingError(err && err.code, err && err.message)), {
              code: (err && err.code) || 'failed'
            });
          });
      }
    };
  }

  function getAdapter() {
    if (testAdapter) return testAdapter;
    ensureSessionFromWindow();
    if (!sessionConfig) return null;
    return createHttpAdapter(sessionConfig);
  }

  function verifyConfig() {
    if (testAdapter) {
      verifyState = {
        status: 'verified',
        at: new Date().toISOString(),
        message: '测试适配器可用（不外呼）。',
        code: null
      };
      return Promise.resolve(getStatus());
    }
    ensureSessionFromWindow();
    if (!sessionConfig) {
      return Promise.reject(Object.assign(new Error(userFacingError('not_configured')), { code: 'not_configured' }));
    }
    verifyState = {
      status: 'pending',
      at: new Date().toISOString(),
      message: '正在验证连接…',
      code: null
    };
    var cfg = sessionConfig;
    var started = Date.now();
    // 验证只用极短探测，不发送用户简历正文
    return chatCompletions(
      cfg,
      [
        {
          role: 'user',
          content: '请只回复一个字：验'
        }
      ],
      { temperature: 0 }
    )
      .then(function () {
        verifyState = {
          status: 'verified',
          at: new Date().toISOString(),
          message: '连接验证成功。可以在确认发送范围后请求建议。',
          code: null
        };
        pushSafeLog({
          at: verifyState.at,
          providerId: cfg.provider,
          model: cfg.model,
          status: 'verify_ok',
          durationMs: Date.now() - started
        });
        return getStatus();
      })
      .catch(function (err) {
        verifyState = {
          status: 'failed',
          at: new Date().toISOString(),
          message: userFacingError(err && err.code, err && err.message),
          code: (err && err.code) || 'failed'
        };
        pushSafeLog({
          at: verifyState.at,
          providerId: cfg.provider,
          model: cfg.model,
          status: 'verify_failed',
          errorCode: verifyState.code,
          durationMs: Date.now() - started
        });
        throw Object.assign(new Error(verifyState.message), { code: verifyState.code });
      });
  }

  function generateResumeSuggestions(payload) {
    var status = getStatus();
    if (!status.configured) {
      pushSafeLog({
        at: new Date().toISOString(),
        providerId: null,
        jobId: payload && payload.job && payload.job.id,
        status: 'unavailable',
        errorCode: 'not_configured'
      });
      return Promise.reject(Object.assign(new Error(userFacingError('not_configured')), { code: 'not_configured' }));
    }
    var adapter = getAdapter();
    if (!adapter || typeof adapter.generateResumeSuggestions !== 'function') {
      return Promise.reject(Object.assign(new Error(userFacingError('no_adapter')), { code: 'no_adapter' }));
    }
    return adapter.generateResumeSuggestions(payload);
  }

  CA.lib.aiProvider = {
    PROVIDERS: PROVIDERS,
    getStatus: getStatus,
    setSessionConfig: setSessionConfig,
    clearSessionConfig: clearSessionConfig,
    verifyConfig: verifyConfig,
    generateResumeSuggestions: generateResumeSuggestions,
    userFacingError: userFacingError,
    maskKey: maskKey,
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
