'use strict';

function userFacingError(code, fallback) {
  var map = {
    auth: '模型密钥无效或没有权限。请检查本机 .env 中的 DEEPSEEK_API_KEY。',
    rate_limit: '调用次数或额度受限。请稍后再试。',
    timeout: '等待模型响应超时。请检查网络后重试。',
    format: '模型返回格式不符合要求（须引用简历原文）。请重试；也可改用本地演示建议。',
    not_configured: '本机尚未配置 DEEPSEEK_API_KEY，无法接入真实模型。',
    upstream: '模型服务暂时不可用。请稍后重试。',
    bad_request: '请求内容不完整或过长。请检查简历正文与岗位信息后重试。'
  };
  return map[code] || fallback || '模型调用失败，请重试。';
}

function chatCompletions(cfg, messages, opts) {
  opts = opts || {};
  var fetchFn = opts.fetchImpl || fetch;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  var settled = false;
  var url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
  var body = JSON.stringify({
    model: cfg.model,
    temperature: opts.temperature != null ? opts.temperature : 0.2,
    messages: messages
  });

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  if (controller) {
    timer = setTimeout(function () {
      try {
        controller.abort();
      } catch (e) {}
    }, cfg.timeoutMs || 60000);
  }

  return Promise.resolve()
    .then(function () {
      return fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey
        },
        body: body,
        signal: controller ? controller.signal : undefined
      });
    })
    .then(function (res) {
      // 超时必须覆盖响应体读取与解析，不能在收到响应头时清除
      if (!res.ok) {
        var code = res.status;
        if (code === 401 || code === 403) {
          var authErr = new Error(userFacingError('auth'));
          authErr.code = 'auth';
          throw authErr;
        }
        if (code === 429) {
          var rateErr = new Error(userFacingError('rate_limit'));
          rateErr.code = 'rate_limit';
          throw rateErr;
        }
        var upErr = new Error(userFacingError('upstream'));
        upErr.code = 'upstream';
        throw upErr;
      }
      return res.json();
    })
    .then(function (data) {
      var content =
        data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return { content: content };
    })
    .catch(function (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        var tErr = new Error(userFacingError('timeout'));
        tErr.code = 'timeout';
        throw tErr;
      }
      throw err;
    })
    .finally(function () {
      if (!settled) {
        settled = true;
        clearTimer();
      }
    });
}

module.exports = {
  chatCompletions: chatCompletions,
  userFacingError: userFacingError
};
