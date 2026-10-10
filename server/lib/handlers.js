'use strict';

var deepseek = require('./deepseek');

var RESUME_MAX = 100000;
var JD_MAX = 50000;
var TITLE_MAX = 200;
var COMPANY_MAX = 200;
var LOCATION_MAX = 200;
var SALARY_MAX = 200;
var JOB_ID_MAX = 80;
var ASSESSMENT_SUMMARY_MAX = 2000;
var ASSESSMENT_GAPS_MAX = 20;
var ASSESSMENT_GAP_DESC_MAX = 500;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function requireString(value, field, maxLen, opts) {
  opts = opts || {};
  if (typeof value !== 'string') {
    return { ok: false, message: field + ' 类型不正确，须为文本。' };
  }
  if (value.length > maxLen) {
    return { ok: false, message: deepseek.userFacingError('bad_request') };
  }
  if (opts.required && !value.trim()) {
    return { ok: false, message: opts.emptyMessage || field + ' 不能为空。' };
  }
  return { ok: true, value: value };
}

function json(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safeLog(entry) {
  // 不含密钥与简历全文
  console.log(
    JSON.stringify({
      at: entry.at || new Date().toISOString(),
      route: entry.route,
      status: entry.status,
      code: entry.code || null,
      suggestionCount: entry.suggestionCount || 0,
      durationMs: entry.durationMs || null
    })
  );
}

function isAllowedOrigin(req, cfg) {
  var host = String(req.headers.host || '');
  var expected = cfg.host + ':' + cfg.port;
  if (host !== expected && host !== 'localhost:' + cfg.port && host !== '127.0.0.1:' + cfg.port) {
    return false;
  }
  var origin = req.headers.origin;
  if (!origin) return true;
  var allowed = [
    'http://' + cfg.host + ':' + cfg.port,
    'http://127.0.0.1:' + cfg.port,
    'http://localhost:' + cfg.port
  ];
  return allowed.indexOf(origin) >= 0;
}

function readJsonBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error(deepseek.userFacingError('bad_request')), { code: 'bad_request', http: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error(deepseek.userFacingError('bad_request')), { code: 'bad_request', http: 400 }));
      }
    });
    req.on('error', function () {
      reject(Object.assign(new Error(deepseek.userFacingError('bad_request')), { code: 'bad_request', http: 400 }));
    });
  });
}

function requireJsonPost(req, cfg) {
  if (!isAllowedOrigin(req, cfg)) {
    return { ok: false, http: 403, code: 'bad_request', message: '请求来源不被允许。' };
  }
  var ct = String(req.headers['content-type'] || '');
  if (ct.indexOf('application/json') < 0) {
    return { ok: false, http: 415, code: 'bad_request', message: '请使用 JSON 提交。' };
  }
  return { ok: true };
}

function createHandlers(deps) {
  var cfg = deps.config;
  var Prompt = deps.prompt;
  var chat = deps.chatCompletions || deepseek.chatCompletions;
  var fetchImpl = deps.fetchImpl;

  function statusPayload() {
    return {
      configured: !!cfg.configured,
      providerId: 'deepseek',
      model: cfg.model,
      willCallExternal: !!cfg.configured,
      source: 'server'
    };
  }

  function handleStatus(req, res) {
    json(res, 200, statusPayload());
  }

  function handleVerify(req, res) {
    var gate = requireJsonPost(req, cfg);
    if (!gate.ok) {
      json(res, gate.http, { ok: false, code: gate.code, message: gate.message });
      return Promise.resolve();
    }
    if (!cfg.configured) {
      json(res, 503, { ok: false, code: 'not_configured', message: deepseek.userFacingError('not_configured') });
      return Promise.resolve();
    }
    var started = Date.now();
    return readJsonBody(req, cfg.maxBodyBytes)
      .then(function () {
        return chat(
          cfg,
          [{ role: 'user', content: '请只回复一个字：验' }],
          { temperature: 0, fetchImpl: fetchImpl }
        );
      })
      .then(function () {
        safeLog({ route: 'verify', status: 'ok', durationMs: Date.now() - started });
        json(res, 200, {
          ok: true,
          providerId: 'deepseek',
          model: cfg.model,
          message: '连接验证成功。确认发送范围后可请求建议。'
        });
      })
      .catch(function (err) {
        var code = (err && err.code) || 'upstream';
        var http = err && err.http ? err.http : code === 'not_configured' ? 503 : 502;
        safeLog({ route: 'verify', status: 'failed', code: code, durationMs: Date.now() - started });
        json(res, http, {
          ok: false,
          code: code,
          message: deepseek.userFacingError(code, err && err.message)
        });
      });
  }

  function sanitizeAssessment(raw) {
    if (raw == null) return { ok: true, value: null };
    if (!isPlainObject(raw)) {
      return { ok: false, message: '本地评估摘要格式不正确。' };
    }
    var out = {};
    if (raw.match != null) {
      if (!isPlainObject(raw.match)) {
        return { ok: false, message: '本地评估摘要格式不正确。' };
      }
      var level = raw.match.level;
      var summary = raw.match.summary;
      if (level != null && typeof level !== 'string') {
        return { ok: false, message: '本地评估摘要格式不正确。' };
      }
      if (summary != null && typeof summary !== 'string') {
        return { ok: false, message: '本地评估摘要格式不正确。' };
      }
      if ((level && level.length > 80) || (summary && summary.length > ASSESSMENT_SUMMARY_MAX)) {
        return { ok: false, message: deepseek.userFacingError('bad_request') };
      }
      out.match = {
        level: typeof level === 'string' ? level : '',
        summary: typeof summary === 'string' ? summary : ''
      };
    }
    if (raw.gaps != null) {
      if (!Array.isArray(raw.gaps)) {
        return { ok: false, message: '本地评估摘要格式不正确。' };
      }
      if (raw.gaps.length > ASSESSMENT_GAPS_MAX) {
        return { ok: false, message: deepseek.userFacingError('bad_request') };
      }
      var gaps = [];
      for (var i = 0; i < raw.gaps.length; i++) {
        var g = raw.gaps[i];
        if (!isPlainObject(g) || typeof g.description !== 'string') {
          return { ok: false, message: '本地评估摘要格式不正确。' };
        }
        if (g.description.length > ASSESSMENT_GAP_DESC_MAX) {
          return { ok: false, message: deepseek.userFacingError('bad_request') };
        }
        gaps.push({ description: g.description });
      }
      out.gaps = gaps;
    }
    return { ok: true, value: out.match || out.gaps ? out : null };
  }

  function validateReviseInput(body) {
    if (!isPlainObject(body)) {
      return { ok: false, message: deepseek.userFacingError('bad_request') };
    }
    var resumeCheck = requireString(body.resumeText, '简历正文', RESUME_MAX, {
      required: true,
      emptyMessage: '请先准备可读的简历正文。'
    });
    if (!resumeCheck.ok) return resumeCheck;

    var job = body.job;
    if (!isPlainObject(job)) {
      return { ok: false, message: '请指定目标岗位。' };
    }

    if (job.title != null && typeof job.title !== 'string') {
      return { ok: false, message: '岗位名称类型不正确，须为文本。' };
    }
    var titleCheck = requireString(job.title == null ? '' : job.title, '岗位名称', TITLE_MAX, {
      required: true,
      emptyMessage: '请指定目标岗位。'
    });
    if (!titleCheck.ok) return titleCheck;

    if (job.jdText != null && typeof job.jdText !== 'string') {
      return { ok: false, message: '岗位要求类型不正确，须为文本。' };
    }
    var jdCheck = requireString(job.jdText == null ? '' : job.jdText, '岗位要求', JD_MAX, {
      required: true,
      emptyMessage: '请提供岗位要求（JD），否则无法做岗位定向生成。'
    });
    if (!jdCheck.ok) return jdCheck;

    if (job.companyName != null && typeof job.companyName !== 'string') {
      return { ok: false, message: '公司名称类型不正确，须为文本。' };
    }
    if (job.location != null && typeof job.location !== 'string') {
      return { ok: false, message: '工作地点类型不正确，须为文本。' };
    }
    if (job.salaryText != null && typeof job.salaryText !== 'string') {
      return { ok: false, message: '薪资表述类型不正确，须为文本。' };
    }
    var companyCheck = requireString(job.companyName == null ? '' : job.companyName, '公司名称', COMPANY_MAX);
    if (!companyCheck.ok) return companyCheck;
    var locationCheck = requireString(job.location == null ? '' : job.location, '工作地点', LOCATION_MAX);
    if (!locationCheck.ok) return locationCheck;
    var salaryCheck = requireString(job.salaryText == null ? '' : job.salaryText, '薪资表述', SALARY_MAX);
    if (!salaryCheck.ok) return salaryCheck;

    var jobId = null;
    if (job.id != null) {
      if (typeof job.id !== 'string' && typeof job.id !== 'number') {
        return { ok: false, message: '岗位标识格式不正确。' };
      }
      jobId = String(job.id);
      if (!jobId.trim() || jobId.length > JOB_ID_MAX) {
        return { ok: false, message: deepseek.userFacingError('bad_request') };
      }
    }

    var assessmentPack = sanitizeAssessment(body.assessment);
    if (!assessmentPack.ok) return assessmentPack;

    return {
      ok: true,
      payload: {
        resumeText: resumeCheck.value,
        job: {
          id: jobId,
          title: titleCheck.value,
          companyName: companyCheck.value,
          location: locationCheck.value,
          salaryText: salaryCheck.value,
          jdText: jdCheck.value
        },
        assessment: assessmentPack.value
      }
    };
  }

  function handleRevise(req, res) {
    var gate = requireJsonPost(req, cfg);
    if (!gate.ok) {
      json(res, gate.http, { ok: false, code: gate.code, message: gate.message });
      return Promise.resolve();
    }
    if (!cfg.configured) {
      json(res, 503, { ok: false, code: 'not_configured', message: deepseek.userFacingError('not_configured') });
      return Promise.resolve();
    }
    var started = Date.now();
    return readJsonBody(req, cfg.maxBodyBytes)
      .then(function (body) {
        var checked = validateReviseInput(body);
        if (!checked.ok) {
          var bad = new Error(checked.message);
          bad.code = 'bad_request';
          bad.http = 400;
          throw bad;
        }
        var payload = checked.payload;
        return chat(
          cfg,
          [
            { role: 'system', content: Prompt.buildSystemPrompt() },
            { role: 'user', content: Prompt.buildUserMessage(payload) }
          ],
          { temperature: 0.2, fetchImpl: fetchImpl }
        ).then(function (result) {
          var suggestions;
          try {
            suggestions = Prompt.parseModelSuggestions(result.content, payload.resumeText);
          } catch (parseErr) {
            var ferr = new Error(deepseek.userFacingError('format', parseErr.message));
            ferr.code = 'format';
            throw ferr;
          }
          safeLog({
            route: 'revise',
            status: 'ok',
            suggestionCount: suggestions.length,
            durationMs: Date.now() - started
          });
          json(res, 200, {
            ok: true,
            providerId: 'deepseek',
            model: cfg.model,
            suggestions: suggestions
          });
        });
      })
      .catch(function (err) {
        var code = (err && err.code) || 'upstream';
        var http = err && err.http ? err.http : code === 'bad_request' ? 400 : code === 'not_configured' ? 503 : 502;
        safeLog({ route: 'revise', status: 'failed', code: code, durationMs: Date.now() - started });
        json(res, http, {
          ok: false,
          code: code,
          message: deepseek.userFacingError(code, err && err.message)
        });
      });
  }

  return {
    handleStatus: handleStatus,
    handleVerify: handleVerify,
    handleRevise: handleRevise,
    statusPayload: statusPayload,
    validateReviseInput: validateReviseInput,
    isAllowedOrigin: function (req) {
      return isAllowedOrigin(req, cfg);
    }
  };
}

module.exports = {
  createHandlers: createHandlers,
  readJsonBody: readJsonBody
};
