(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.lib = CA.lib || {};

  var SYSTEM_PROMPT =
    '你是求职简历修改助手，只根据用户提供的简历原文和目标岗位信息给出可编辑的修改建议。\n' +
    '硬性规则：\n' +
    '1. 只基于简历原文与岗位信息；不得编造经历、公司、数字、技能或成果。\n' +
    '2. 每条建议必须引用简历中真实存在的原文段落（targetExcerpt 必须是原文子串）。\n' +
    '3. 输出 3 到 5 条结构化建议；若无法判断，将该条 needsUserConfirm 设为 true，并在 reason 中写「需要用户确认」。\n' +
    '4. 不要输出与简历无关的空话，不要声称已核实用户事实。\n' +
    '5. 只返回 JSON 数组，不要 Markdown 围栏或其他说明。数组元素字段：' +
    'id,title,reason,targetExcerpt,proposedReplacement,needsUserConfirm。';

  function buildSystemPrompt() {
    return SYSTEM_PROMPT;
  }

  function buildUserMessage(input) {
    input = input || {};
    var job = input.job || {};
    var assessment = input.assessment;
    var parts = [];
    parts.push('【目标岗位】');
    parts.push('公司：' + (job.companyName || ''));
    parts.push('岗位：' + (job.title || ''));
    parts.push('地点：' + (job.location || '未写明'));
    parts.push('薪资表述：' + (job.salaryText || '未写明'));
    parts.push('JD：\n' + (job.jdText || ''));
    if (assessment && assessment.match) {
      parts.push('【本地演示评估摘要｜非模型结论】');
      parts.push('匹配程度：' + (assessment.match.level || '') + '；' + (assessment.match.summary || ''));
      if (Array.isArray(assessment.gaps) && assessment.gaps.length) {
        parts.push(
          '缺口：' +
            assessment.gaps
              .map(function (g) {
                return g.description;
              })
              .join('；')
        );
      }
    }
    parts.push('【用户确认发送的简历正文】');
    parts.push(String(input.resumeText || ''));
    parts.push('请按系统规则返回 JSON 数组。');
    return parts.join('\n');
  }

  function describeSendScope(input) {
    input = input || {};
    var job = input.job || {};
    var text = String(input.resumeText || '');
    return {
      jobTitle: job.title || '',
      companyName: job.companyName || '',
      location: job.location || '',
      salaryText: job.salaryText || '',
      jdPreview: String(job.jdText || '').slice(0, 160),
      jdLength: String(job.jdText || '').length,
      resumeCharCount: text.length,
      resumeParagraphCount: text
        .split(/\n+/)
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean).length,
      includesAssessmentSummary: !!(input.assessment && input.assessment.match)
    };
  }

  function extractJsonArray(raw) {
    var s = String(raw || '').trim();
    if (!s) throw new Error('模型返回为空');
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var start = s.indexOf('[');
    var end = s.lastIndexOf(']');
    if (start < 0 || end < 0 || end <= start) throw new Error('返回格式不是建议列表');
    var parsed = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('返回格式不是建议列表');
    return parsed;
  }

  function normalizeSuggestions(rawList, resumeText) {
    var text = String(resumeText || '');
    var list = [];
    (rawList || []).forEach(function (item, index) {
      if (!item || typeof item !== 'object') return;
      var target = String(item.targetExcerpt || '').trim();
      var proposed = String(item.proposedReplacement || '').trim();
      var title = String(item.title || '').trim() || '修改建议';
      var reason = String(item.reason || '').trim() || '需要用户确认';
      if (!target || text.indexOf(target) < 0) return;
      if (!proposed) return;
      var needs = item.needsUserConfirm === true || reason.indexOf('需要用户确认') >= 0;
      list.push({
        id: String(item.id || 'ai_' + (index + 1)),
        kind: needs ? 'needs_confirm' : 'model',
        title: title,
        reason: needs && reason.indexOf('需要用户确认') < 0 ? reason + '（需要用户确认）' : reason,
        targetExcerpt: target,
        proposedReplacement: proposed,
        needsUserConfirm: needs
      });
    });
    if (list.length < 1) throw new Error('有效建议不足：没有能对应到原文的条目');
    return list.slice(0, 5);
  }

  function parseModelSuggestions(raw, resumeText) {
    var arr = extractJsonArray(raw);
    return normalizeSuggestions(arr, resumeText);
  }

  CA.lib.revisePrompt = {
    buildSystemPrompt: buildSystemPrompt,
    buildUserMessage: buildUserMessage,
    describeSendScope: describeSendScope,
    parseModelSuggestions: parseModelSuggestions,
    normalizeSuggestions: normalizeSuggestions
  };
})(typeof window !== 'undefined' ? window : globalThis);
