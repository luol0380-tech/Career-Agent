(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.lib = CA.lib || {};

  function splitParagraphs(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function includesAny(haystack, needles) {
    var lower = String(haystack || '').toLowerCase();
    for (var i = 0; i < needles.length; i++) {
      if (needles[i] && lower.indexOf(String(needles[i]).toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function findTargetParagraph(paragraphs, keywords) {
    var i;
    for (i = 0; i < paragraphs.length; i++) {
      if (includesAny(paragraphs[i], keywords)) return paragraphs[i];
    }
    return paragraphs.length ? paragraphs[0] : null;
  }

  function jdKeywords(job) {
    var raw = ((job && job.jdText) || '') + ' ' + ((job && job.title) || '');
    var tokens = raw
      .replace(/[：:，。；、\n\/（）()·]/g, ' ')
      .split(/\s+/)
      .filter(function (t) {
        return t.length >= 2 && '职责要求熟悉优先有能与'.indexOf(t) < 0;
      });
    var uniq = [];
    tokens.forEach(function (t) {
      if (uniq.indexOf(t) < 0) uniq.push(t);
    });
    return uniq.slice(0, 12);
  }

  function clip(text, max) {
    var s = String(text || '').trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  /**
   * 基于岗位评估与简历段落生成 3–5 条演示建议（非模型输出）。
   * @returns {{ok:boolean, reason?:string, suggestions:Array}}
   */
  function buildDemoSuggestions(input) {
    input = input || {};
    var resumeText = String(input.resumeText || '').trim();
    var job = input.job;
    if (!job) return { ok: false, reason: 'missing_job', suggestions: [] };
    if (!resumeText) return { ok: false, reason: 'empty_resume', suggestions: [] };

    var paragraphs = splitParagraphs(resumeText);
    if (!paragraphs.length) return { ok: false, reason: 'empty_resume', suggestions: [] };

    var assessment = input.assessment || null;
    var keywords = jdKeywords(job);
    var company = job.companyName || '目标公司';
    var title = job.title || '目标岗位';
    var suggestions = [];
    var usedTargets = {};

    function pushSuggestion(item) {
      if (!item || !item.targetExcerpt) return;
      if (usedTargets[item.targetExcerpt] && suggestions.length >= 2) return;
      usedTargets[item.targetExcerpt] = true;
      item.id = 'sug_' + (suggestions.length + 1);
      suggestions.push(item);
    }

    if (assessment && Array.isArray(assessment.gaps)) {
      assessment.gaps.forEach(function (gap) {
        if (suggestions.length >= 5) return;
        var desc = (gap && gap.description) || '';
        var basis = (gap && gap.basis) || '';
        var gapKeys = desc.split(/[“”"‘’、，。；\s]+/).filter(function (w) {
          return w.length >= 2;
        });
        var target = findTargetParagraph(paragraphs, gapKeys.concat(keywords.slice(0, 4)));
        if (!target) return;
        pushSuggestion({
          kind: 'gap',
          title: '补强与岗位缺口相关的表述',
          reason:
            '演示建议：岗位评估提示「' +
            clip(desc, 48) +
            '」。这不是模型实时分析，只把缺口说明改写成可编辑句子。',
          targetExcerpt: target,
          proposedReplacement:
            target +
            '\n（演示改写）补充说明：围绕「' +
            clip(desc.replace(/^缺少|^缺少“|”的直接证据。$/g, ''), 36) +
            '」补充可核验做法与结果；依据仅为合成评估文案——' +
            clip(basis, 40)
        });
      });
    }

    if (assessment && Array.isArray(assessment.evidence)) {
      assessment.evidence.slice(0, 2).forEach(function (ev) {
        if (suggestions.length >= 5) return;
        var excerpt = (ev && ev.excerpt) || '';
        var requirement = (ev && ev.requirement) || '';
        var target = findTargetParagraph(paragraphs, [excerpt].concat(excerpt.split(/[，。、\s]+/).filter(Boolean)));
        if (!target) target = findTargetParagraph(paragraphs, keywords);
        if (!target) return;
        pushSuggestion({
          kind: 'evidence',
          title: '把已有经历对齐到岗位要求',
          reason:
            '演示建议：评估里提到要求「' +
            clip(requirement, 40) +
            '」，可把对应经历写得更贴近岗位用语。非真实 AI 生成。',
          targetExcerpt: target,
          proposedReplacement:
            target.replace(/。$/, '') +
            '；面向「' +
            clip(requirement, 28) +
            '」可强调：' +
            clip(excerpt || '相关协作与落地结果', 42) +
            '。（演示改写）'
        });
      });
    }

    var highlightTarget = findTargetParagraph(paragraphs, keywords.length ? keywords : paragraphs);
    if (highlightTarget && suggestions.length < 5) {
      pushSuggestion({
        kind: 'highlight',
        title: '在开头点明目标岗位方向',
        reason: '演示建议：让招聘方更快看到你与「' + company + '｜' + title + '」的相关性。内容为固定模板，不是模型输出。',
        targetExcerpt: highlightTarget,
        proposedReplacement:
          '求职方向：' +
          title +
          '（' +
          company +
          '）\n' +
          highlightTarget +
          '\n（演示改写）用一句话概括与该岗位最相关的 1–2 个成果。'
      });
    }

    if (suggestions.length < 3) {
      var second = paragraphs[Math.min(1, paragraphs.length - 1)];
      pushSuggestion({
        kind: 'clarify',
        title: '把成果写得更可核对',
        reason: '演示建议：用「做了什么 → 怎么做 → 结果」补全段落。此为固定句式，不代表真实改写质量。',
        targetExcerpt: second,
        proposedReplacement: second + '\n（演示改写）补充可核对信息：协作对象、关键动作、可验证结果（演示数字请勿当作真实业绩）。'
      });
    }

    if (suggestions.length < 3) {
      var third = paragraphs[Math.min(2, paragraphs.length - 1)];
      pushSuggestion({
        kind: 'jd',
        title: '呼应岗位 JD 关键词',
        reason: '演示建议：从 JD 抽取的关键词仅用于提示，不会自动编造经历。',
        targetExcerpt: third,
        proposedReplacement:
          third +
          '\n（演示改写）若属实，可点到这些岗位用语：' +
          keywords.slice(0, 4).join('、') +
          '；没有的经历请跳过，不要虚构。'
      });
    }

    var list = suggestions.slice(0, 5);
    if (list.length < 3) {
      // 正文极短时仍给满 3 条，全部指向同一段并说明演示性质
      while (list.length < 3) {
        var base = paragraphs[0];
        list.push({
          id: 'sug_' + (list.length + 1),
          kind: 'demo_fill',
          title: '演示补充建议 ' + (list.length + 1),
          reason: '正文较短，这条仍是固定演示文案，请人工判断是否属实后再采纳。',
          targetExcerpt: base,
          proposedReplacement: base + '\n（演示改写 ' + (list.length + 1) + '）仅作编辑练习，不代表岗位匹配结论。'
        });
      }
    }

    return { ok: true, suggestions: list.slice(0, 5) };
  }

  function applySuggestionToDraft(draft, suggestion, replacement) {
    var source = String(draft || '');
    var target = suggestion && suggestion.targetExcerpt ? String(suggestion.targetExcerpt) : '';
    var next = replacement != null ? String(replacement) : suggestion.proposedReplacement;
    if (!target || source.indexOf(target) < 0) {
      return { ok: false, draft: source, error: '正文里找不到建议指向的段落，请先核对原文或手动改写。' };
    }
    return { ok: true, draft: source.replace(target, next) };
  }

  CA.lib.reviseSuggestions = {
    buildDemoSuggestions: buildDemoSuggestions,
    applySuggestionToDraft: applySuggestionToDraft,
    splitParagraphs: splitParagraphs
  };
})(typeof window !== 'undefined' ? window : globalThis);
