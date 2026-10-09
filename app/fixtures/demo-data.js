(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.fixtures = CA.fixtures || {};

  // 全部人物、公司与经历均为虚构合成内容；日期为固定的“演示日程”，不随真实日期移动。
  var U = 'user_demo';
  var SEEDED = '2026-09-01T10:00:00+08:00';

  function confirmed(sourceIds, at) {
    return { sourceIds: sourceIds, confidence: null, userConfirmed: true, confirmedAt: at || SEEDED };
  }

  var goals = [
    {
      id: 'goal_ai_pm',
      userId: U,
      title: 'AI 产品经理',
      targetRoles: ['AI 产品经理', '大模型应用产品经理'],
      cities: ['上海', '杭州'],
      salaryExpectation: '25k–35k／月（演示设定）',
      status: 'active',
      revision: 1,
      createdAt: SEEDED,
      updatedAt: SEEDED
    },
    {
      id: 'goal_b2b_pm',
      userId: U,
      title: 'B 端 SaaS 产品经理',
      targetRoles: ['B 端产品经理', 'SaaS 产品经理'],
      cities: ['上海'],
      salaryExpectation: null,
      status: 'active',
      revision: 1,
      createdAt: SEEDED,
      updatedAt: SEEDED
    }
  ];

  var sources = [
    {
      id: 'src_asset_001',
      userId: U,
      kind: 'demo_fixture',
      label: '合成履历样例：智能客服项目',
      rawText:
        '（虚构样例）2024 年在虚构科技负责智能客服知识库问答项目：梳理 6 类高频咨询场景，与算法同事制定答案可用性的人工抽检规则，上线后人工转接率由 38% 降到 29%（演示数字）。',
      capturedAt: SEEDED,
      createdAt: SEEDED
    },
    {
      id: 'src_asset_002',
      userId: U,
      kind: 'demo_fixture',
      label: '合成履历样例：销售数据看板',
      rawText:
        '（虚构样例）主导销售数据看板改版：访谈 12 位区域销售，重做指标口径与权限分层，看板周活跃用户数由 40 增至 95（演示数字）。',
      capturedAt: SEEDED,
      createdAt: SEEDED
    },
    {
      id: 'src_asset_003',
      userId: U,
      kind: 'demo_fixture',
      label: '合成履历样例：工作经历',
      rawText: '（虚构样例）2023.07–2025.08 虚构科技有限公司，产品助理，负责客服与内部运营工具的需求整理、原型和上线验收。',
      capturedAt: SEEDED,
      createdAt: SEEDED
    },
    {
      id: 'src_asset_004',
      userId: U,
      kind: 'pasted_text',
      label: '合成样例：自述笔记（未核对）',
      rawText: '（虚构样例）做过不少用户访谈，大概二十多场，能整理需求文档和优先级。',
      capturedAt: '2026-09-02T21:30:00+08:00',
      createdAt: '2026-09-02T21:30:00+08:00'
    },
    {
      id: 'src_job_001',
      userId: U,
      kind: 'demo_fixture',
      label: '合成 JD 样例：星河智能',
      rawText: '（虚构 JD）负责智能客服产品规划；熟悉大模型应用落地；能设计效果评测方案；有 B 端客户沟通经验者优先。',
      capturedAt: '2026-09-05T11:00:00+08:00',
      createdAt: '2026-09-05T11:00:00+08:00'
    },
    {
      id: 'src_job_002',
      userId: U,
      kind: 'demo_fixture',
      label: '合成 JD 样例：青松数据',
      rawText: '（虚构 JD）负责大模型数据分析助手；要求有数据产品经验；理解指标体系；能与算法团队协作迭代。',
      capturedAt: '2026-09-06T15:20:00+08:00',
      createdAt: '2026-09-06T15:20:00+08:00'
    },
    {
      id: 'src_job_003',
      userId: U,
      kind: 'demo_fixture',
      label: '合成 JD 样例：云帆软件',
      rawText: '（虚构 JD）负责 SaaS 审批与权限模块；需要复杂业务流程抽象能力；有 ToB 客户需求调研经验。',
      capturedAt: '2026-09-12T10:10:00+08:00',
      createdAt: '2026-09-12T10:10:00+08:00'
    },
    {
      id: 'src_transcript_001',
      userId: U,
      kind: 'demo_fixture',
      label: '合成样例：青松数据一面转写',
      rawText: '（虚构转写）面试官询问了智能客服项目的评测方式与跨团队协作；候选人对指标体系作了说明。',
      capturedAt: '2026-09-18T16:00:00+08:00',
      createdAt: '2026-09-18T16:00:00+08:00'
    },
    {
      id: 'src_doc_base',
      userId: U,
      kind: 'demo_fixture',
      label: '合成样例：基础简历草稿',
      rawText: '林小舟｜产品助理\n虚构科技有限公司｜2023.07–2025.08\n智能客服知识库问答、销售数据看板改版。',
      capturedAt: '2026-09-03T10:00:00+08:00',
      createdAt: '2026-09-03T10:00:00+08:00'
    }
  ];

  var assets = [
    {
      id: 'asset_001',
      userId: U,
      kind: 'project_experience',
      title: '智能客服知识库问答项目',
      body:
        '梳理 6 类高频咨询场景，与算法同事制定答案可用性的人工抽检规则；上线后人工转接率由 38% 降到 29%（演示数字）。',
      provenance: confirmed(['src_asset_001']),
      revision: 1,
      createdAt: SEEDED,
      updatedAt: SEEDED
    },
    {
      id: 'asset_002',
      userId: U,
      kind: 'project_experience',
      title: '销售数据看板改版',
      body: '访谈 12 位区域销售，重做指标口径与权限分层；看板周活跃用户数由 40 增至 95（演示数字）。',
      provenance: confirmed(['src_asset_002']),
      revision: 1,
      createdAt: SEEDED,
      updatedAt: SEEDED
    },
    {
      id: 'asset_003',
      userId: U,
      kind: 'work_experience',
      title: '虚构科技有限公司｜产品助理（2023.07–2025.08）',
      body: '负责客服与内部运营工具的需求整理、原型设计和上线验收，对接算法、研发与运营团队。',
      provenance: confirmed(['src_asset_003']),
      revision: 1,
      createdAt: SEEDED,
      updatedAt: SEEDED
    },
    {
      id: 'asset_004',
      userId: U,
      kind: 'skill_evidence',
      title: '用户访谈与需求整理',
      body: '自述做过约二十场用户访谈，能输出需求文档与优先级排序。访谈次数尚未核对。',
      provenance: {
        sourceIds: ['src_asset_004'],
        confidence: 0.62,
        userConfirmed: false,
        confirmedAt: null
      },
      revision: 1,
      createdAt: '2026-09-02T21:30:00+08:00',
      updatedAt: '2026-09-02T21:30:00+08:00'
    }
  ];

  var jobs = [
    {
      id: 'job_001',
      userId: U,
      goalIds: ['goal_ai_pm'],
      companyName: '星河智能（虚构公司）',
      title: 'AI 产品经理（智能客服方向）',
      location: '上海',
      salaryText: '20k–30k · 14 薪（JD 所写）',
      jdText:
        '职责：负责智能客服产品规划与迭代；推动大模型能力在客服场景落地。\n要求：熟悉大模型应用；能设计效果评测方案；有 B 端客户沟通经验者优先。',
      provenance: confirmed(['src_job_001'], '2026-09-05T11:00:00+08:00'),
      revision: 1,
      createdAt: '2026-09-05T11:00:00+08:00',
      updatedAt: '2026-09-05T11:00:00+08:00'
    },
    {
      id: 'job_002',
      userId: U,
      goalIds: ['goal_ai_pm'],
      companyName: '青松数据（虚构公司）',
      title: '大模型应用产品经理',
      location: '杭州',
      salaryText: null,
      jdText: '职责：负责大模型数据分析助手的产品设计。\n要求：有数据产品经验；理解指标体系；能与算法团队协作迭代。',
      provenance: confirmed(['src_job_002'], '2026-09-06T15:20:00+08:00'),
      revision: 1,
      createdAt: '2026-09-06T15:20:00+08:00',
      updatedAt: '2026-09-06T15:20:00+08:00'
    },
    {
      id: 'job_003',
      userId: U,
      goalIds: ['goal_b2b_pm'],
      companyName: '云帆软件（虚构公司）',
      title: 'B 端 SaaS 产品经理（审批与权限）',
      location: '上海',
      salaryText: '面议（JD 所写）',
      jdText: '职责：负责 SaaS 审批流与权限模块。\n要求：复杂业务流程抽象能力；有 ToB 客户需求调研经验。',
      provenance: confirmed(['src_job_003'], '2026-09-12T10:10:00+08:00'),
      revision: 1,
      createdAt: '2026-09-12T10:10:00+08:00',
      updatedAt: '2026-09-12T10:10:00+08:00'
    }
  ];

  function assetSnapshot(assetId) {
    var a = assets.filter(function (x) {
      return x.id === assetId;
    })[0];
    return {
      assetId: a.id,
      revision: a.revision,
      title: a.title,
      body: a.body,
      provenance: JSON.parse(JSON.stringify(a.provenance))
    };
  }

  function jobSnapshot(jobId) {
    var j = jobs.filter(function (x) {
      return x.id === jobId;
    })[0];
    return { jobId: j.id, revision: j.revision, companyName: j.companyName, title: j.title, jdText: j.jdText };
  }

  function goalSnapshot(goalId) {
    var g = goals.filter(function (x) {
      return x.id === goalId;
    })[0];
    return {
      goalId: g.id,
      revision: g.revision,
      title: g.title,
      targetRoles: g.targetRoles.slice(),
      cities: g.cities.slice(),
      salaryExpectation: g.salaryExpectation
    };
  }

  var assessments = [
    {
      id: 'assess_001',
      userId: U,
      jobId: 'job_001',
      goalId: 'goal_ai_pm',
      jobSnapshot: jobSnapshot('job_001'),
      goalSnapshot: goalSnapshot('goal_ai_pm'),
      assetSnapshots: [assetSnapshot('asset_001'), assetSnapshot('asset_003'), assetSnapshot('asset_004')],
      match: {
        level: 'medium',
        summary: '客服场景的项目经历与岗位方向一致；效果评测方案与大模型落地深度缺少直接证据。'
      },
      gaps: [
        {
          description: '缺少“设计大模型效果评测方案”的直接证据。',
          basis: 'JD 要求“能设计效果评测方案”；现有资产只提到人工抽检规则，未涉及评测指标体系。'
        },
        {
          description: 'B 端客户沟通经验尚无可引用资产。',
          basis: 'JD 写“有 B 端客户沟通经验者优先”；资产中对接对象为内部团队。缺少证据不等于没有此能力。'
        }
      ],
      evidence: [
        {
          requirement: '负责智能客服产品规划与迭代',
          assetId: 'asset_001',
          assetRevision: 1,
          excerpt: '梳理 6 类高频咨询场景，与算法同事制定答案可用性的人工抽检规则'
        },
        {
          requirement: '推动能力在业务场景落地',
          assetId: 'asset_003',
          assetRevision: 1,
          excerpt: '负责客服与内部运营工具的需求整理、原型设计和上线验收'
        },
        {
          requirement: '需求调研与整理（待核实）',
          assetId: 'asset_004',
          assetRevision: 1,
          excerpt: '自述做过约二十场用户访谈'
        }
      ],
      risks: [
        {
          description: '薪资区间来自 JD 文字，是否包含绩效部分未知。',
          basis: 'JD 仅写“20k–30k · 14 薪”，未说明构成。'
        },
        {
          description: '用户访谈能力的依据尚未确认，暂不作为肯定证据。',
          basis: '资产“用户访谈与需求整理”为待确认状态。'
        }
      ],
      origin: 'demo_fixture',
      createdAt: '2026-09-05T12:00:00+08:00'
    },
    {
      id: 'assess_002',
      userId: U,
      jobId: 'job_002',
      goalId: 'goal_ai_pm',
      jobSnapshot: jobSnapshot('job_002'),
      goalSnapshot: goalSnapshot('goal_ai_pm'),
      assetSnapshots: [assetSnapshot('asset_001'), assetSnapshot('asset_002')],
      match: {
        level: 'high',
        summary: '数据看板与智能客服项目分别覆盖指标体系和算法协作两项要求。'
      },
      gaps: [
        {
          description: '缺少“数据分析助手”类产品的直接经历。',
          basis: 'JD 职责为大模型数据分析助手；现有资产为数据看板与客服问答。'
        }
      ],
      evidence: [
        {
          requirement: '理解指标体系',
          assetId: 'asset_002',
          assetRevision: 1,
          excerpt: '重做指标口径与权限分层'
        },
        {
          requirement: '能与算法团队协作迭代',
          assetId: 'asset_001',
          assetRevision: 1,
          excerpt: '与算法同事制定答案可用性的人工抽检规则'
        }
      ],
      risks: [
        {
          description: 'JD 未写明薪资，无法判断是否符合目标预期。',
          basis: 'JD 未写明薪资。'
        }
      ],
      origin: 'demo_fixture',
      createdAt: '2026-09-06T16:00:00+08:00'
    },
    {
      id: 'assess_003',
      userId: U,
      jobId: 'job_003',
      goalId: 'goal_b2b_pm',
      jobSnapshot: jobSnapshot('job_003'),
      goalSnapshot: goalSnapshot('goal_b2b_pm'),
      assetSnapshots: [assetSnapshot('asset_002'), assetSnapshot('asset_003')],
      match: {
        level: 'medium',
        summary: '权限分层与内部工具经历相关；审批流等复杂流程抽象缺少证据。'
      },
      gaps: [
        {
          description: '缺少审批流程设计的直接证据。',
          basis: 'JD 要求“复杂业务流程抽象能力”；现有资产未提及审批或工作流。'
        }
      ],
      evidence: [
        {
          requirement: '权限模块',
          assetId: 'asset_002',
          assetRevision: 1,
          excerpt: '重做指标口径与权限分层'
        },
        {
          requirement: 'ToB 需求整理',
          assetId: 'asset_003',
          assetRevision: 1,
          excerpt: '负责客服与内部运营工具的需求整理'
        }
      ],
      risks: [
        {
          description: '薪资为“面议”，与目标期望的差距未知。',
          basis: 'JD 仅写“面议”，目标也未设置薪资期望。'
        }
      ],
      origin: 'demo_fixture',
      createdAt: '2026-09-12T11:00:00+08:00'
    }
  ];

  var applications = [
    {
      id: 'app_001',
      userId: U,
      goalId: 'goal_ai_pm',
      jobId: 'job_001',
      status: 'preparing',
      submittedAt: null,
      hasHrReply: false,
      firstHrReplyAt: null,
      submittedDocumentVersionIds: [],
      materialsUnknown: false,
      createdAt: '2026-09-06T09:00:00+08:00',
      updatedAt: '2026-09-06T09:00:00+08:00'
    },
    {
      id: 'app_002',
      userId: U,
      goalId: 'goal_ai_pm',
      jobId: 'job_002',
      status: 'interview_scheduled',
      submittedAt: '2026-09-08T10:30:00+08:00',
      hasHrReply: true,
      firstHrReplyAt: '2026-09-11T14:05:00+08:00',
      submittedDocumentVersionIds: [],
      materialsUnknown: true,
      createdAt: '2026-09-08T10:40:00+08:00',
      updatedAt: '2026-09-22T18:00:00+08:00'
    },
    {
      id: 'app_003',
      userId: U,
      goalId: 'goal_b2b_pm',
      jobId: 'job_003',
      status: 'submitted',
      submittedAt: '2026-09-15T20:00:00+08:00',
      hasHrReply: false,
      firstHrReplyAt: null,
      submittedDocumentVersionIds: [],
      materialsUnknown: true,
      createdAt: '2026-09-15T20:10:00+08:00',
      updatedAt: '2026-09-15T20:10:00+08:00'
    }
  ];

  var interviews = [
    {
      id: 'interview_001',
      userId: U,
      applicationId: 'app_002',
      roundNumber: 1,
      label: '一面（业务面）',
      status: 'completed',
      scheduledAt: '2026-09-18T14:00:00+08:00',
      completedAt: '2026-09-18T15:00:00+08:00',
      prepDocumentVersionIds: [],
      transcript: {
        text: '（虚构转写）面试官询问了智能客服项目的评测方式与跨团队协作；候选人对指标体系作了说明。',
        sourceId: 'src_transcript_001',
        revision: 1,
        capturedAt: '2026-09-18T16:00:00+08:00'
      },
      review: {
        summary: '业务场景叙述清楚；评测方案深度仍可加强。',
        strengths: ['能讲清客服场景与人工抽检规则'],
        improvements: ['补充大模型效果评测指标的准备'],
        nextActions: ['整理二面可能被追问的评测问题'],
        transcriptRevision: 1,
        transcriptSnapshot: '（虚构转写）面试官询问了智能客服项目的评测方式与跨团队协作；候选人对指标体系作了说明。',
        origin: 'demo_fixture',
        createdAt: '2026-09-18T17:00:00+08:00'
      },
      createdAt: '2026-09-11T14:10:00+08:00',
      updatedAt: '2026-09-18T17:00:00+08:00'
    },
    {
      id: 'interview_002',
      userId: U,
      applicationId: 'app_002',
      roundNumber: 2,
      label: '二面（负责人面）',
      status: 'scheduled',
      scheduledAt: '2026-10-09T15:00:00+08:00',
      completedAt: null,
      prepDocumentVersionIds: [],
      transcript: null,
      review: null,
      createdAt: '2026-09-22T18:00:00+08:00',
      updatedAt: '2026-09-22T18:00:00+08:00'
    }
  ];

  function seedEvent(id, type, subject, relatedRefs, occurredAt, payload) {
    return {
      id: id,
      userId: U,
      type: type,
      schemaVersion: 1,
      subject: subject,
      relatedRefs: relatedRefs,
      actor: { type: 'system', id: 'demo' },
      sourceId: null,
      occurredAt: occurredAt,
      recordedAt: occurredAt,
      commandId: 'seed_' + id,
      requestFingerprint: 'demo_fixture',
      payload: payload
    };
  }

  var APP2_REFS = [
    { type: 'application', id: 'app_002' },
    { type: 'job', id: 'job_002' },
    { type: 'career_goal', id: 'goal_ai_pm' }
  ];

  var events = [
    seedEvent(
      'evt_seed_001',
      'application.prepared',
      { type: 'application', id: 'app_001' },
      [
        { type: 'job', id: 'job_001' },
        { type: 'career_goal', id: 'goal_ai_pm' }
      ],
      '2026-09-06T09:00:00+08:00',
      { goalId: 'goal_ai_pm', jobId: 'job_001' }
    ),
    seedEvent(
      'evt_seed_002',
      'application.submitted',
      { type: 'application', id: 'app_002' },
      [
        { type: 'job', id: 'job_002' },
        { type: 'career_goal', id: 'goal_ai_pm' }
      ],
      '2026-09-08T10:30:00+08:00',
      { submittedAt: '2026-09-08T10:30:00+08:00', documentVersionIds: [], materialsUnknown: true }
    ),
    seedEvent(
      'evt_seed_003',
      'interview.invitation_recorded',
      { type: 'interview', id: 'interview_001' },
      APP2_REFS,
      '2026-09-11T14:05:00+08:00',
      {
        applicationId: 'app_002',
        roundNumber: 1,
        scheduledAt: '2026-09-18T14:00:00+08:00',
        invitationAt: '2026-09-11T14:05:00+08:00'
      }
    ),
    seedEvent(
      'evt_seed_004',
      'interview.completed',
      { type: 'interview', id: 'interview_001' },
      APP2_REFS,
      '2026-09-18T15:00:00+08:00',
      { completedAt: '2026-09-18T15:00:00+08:00' }
    ),
    seedEvent(
      'evt_seed_005',
      'interview.invitation_recorded',
      { type: 'interview', id: 'interview_002' },
      APP2_REFS,
      '2026-09-22T17:40:00+08:00',
      {
        applicationId: 'app_002',
        roundNumber: 2,
        scheduledAt: '2026-10-09T15:00:00+08:00',
        invitationAt: '2026-09-22T17:40:00+08:00'
      }
    ),
    seedEvent(
      'evt_seed_006',
      'application.submitted',
      { type: 'application', id: 'app_003' },
      [
        { type: 'job', id: 'job_003' },
        { type: 'career_goal', id: 'goal_b2b_pm' }
      ],
      '2026-09-15T20:00:00+08:00',
      { submittedAt: '2026-09-15T20:00:00+08:00', documentVersionIds: [], materialsUnknown: true }
    )
  ];

  var actionItems = [
    {
      id: 'action_001',
      userId: U,
      goalId: 'goal_ai_pm',
      kind: 'prepare_interview',
      title: '准备青松数据二面（负责人面）',
      status: 'open',
      jobId: 'job_002',
      applicationId: 'app_002',
      interviewId: 'interview_002',
      dueAt: '2026-10-08T20:00:00+08:00',
      sourceEventId: 'evt_seed_005',
      createdAt: '2026-09-22T18:00:00+08:00',
      updatedAt: '2026-09-22T18:00:00+08:00'
    },
    {
      id: 'action_002',
      userId: U,
      goalId: 'goal_ai_pm',
      kind: 'prepare_documents',
      title: '为星河智能岗位准备投递材料',
      status: 'open',
      jobId: 'job_001',
      applicationId: 'app_001',
      interviewId: null,
      dueAt: '2026-10-03T18:00:00+08:00',
      sourceEventId: 'evt_seed_001',
      createdAt: '2026-09-06T09:00:00+08:00',
      updatedAt: '2026-09-06T09:00:00+08:00'
    },
    {
      id: 'action_003',
      userId: U,
      goalId: 'goal_ai_pm',
      kind: 'complete_interview_review',
      title: '整理青松数据一面复盘',
      status: 'open',
      jobId: 'job_002',
      applicationId: 'app_002',
      interviewId: 'interview_001',
      dueAt: null,
      sourceEventId: 'evt_seed_004',
      createdAt: '2026-09-18T15:30:00+08:00',
      updatedAt: '2026-09-18T15:30:00+08:00'
    },
    {
      id: 'action_004',
      userId: U,
      goalId: 'goal_b2b_pm',
      kind: 'complete_profile',
      title: '补充审批流程相关的职业证据',
      status: 'open',
      jobId: 'job_003',
      applicationId: 'app_003',
      interviewId: null,
      dueAt: '2026-10-06T21:00:00+08:00',
      // 合成场景：投递（evt_seed_006，9/15 20:00）之后，按缺口提示补充审批相关证据；不是 Agent 规划器运行记录。
      sourceEventId: 'evt_seed_006',
      createdAt: '2026-09-15T20:10:00+08:00',
      updatedAt: '2026-09-15T20:10:00+08:00'
    }
  ];

  var documents = [
    {
      id: 'doc_base_resume',
      userId: U,
      kind: 'resume',
      title: '基础简历（演示）',
      goalId: null,
      jobId: null,
      applicationId: null,
      interviewId: null,
      draft: {
        body: '林小舟｜产品助理\n虚构科技有限公司｜2023.07–2025.08\n\n项目：智能客服知识库问答；销售数据看板改版。\n（合成演示文稿，非真实简历）',
        parameters: { variant: 'base' },
        inputSnapshot: { assetSnapshots: [assetSnapshot('asset_001'), assetSnapshot('asset_002'), assetSnapshot('asset_003')], jobSnapshot: null, goalSnapshot: null },
        origin: 'demo_fixture',
        userEdited: false,
        userConfirmed: true
      },
      createdAt: '2026-09-03T10:00:00+08:00',
      updatedAt: '2026-09-03T10:05:00+08:00'
    },
    {
      id: 'doc_tailored_job001',
      userId: U,
      kind: 'resume',
      title: '定制简历｜星河智能 AI 产品经理',
      goalId: 'goal_ai_pm',
      jobId: 'job_001',
      applicationId: 'app_001',
      interviewId: null,
      draft: {
        body: '面向智能客服方向的定制简历草稿：突出客服知识库项目与算法协作。\n（合成演示文稿）',
        parameters: { variant: 'tailored' },
        inputSnapshot: {
          assetSnapshots: [assetSnapshot('asset_001'), assetSnapshot('asset_003')],
          jobSnapshot: jobSnapshot('job_001'),
          goalSnapshot: goalSnapshot('goal_ai_pm')
        },
        origin: 'demo_fixture',
        userEdited: false,
        userConfirmed: true
      },
      createdAt: '2026-09-06T09:30:00+08:00',
      updatedAt: '2026-09-06T09:40:00+08:00'
    },
    {
      id: 'doc_intro_ai',
      userId: U,
      kind: 'self_introduction',
      title: '1 分钟自我介绍｜AI 产品经理目标',
      goalId: 'goal_ai_pm',
      jobId: null,
      applicationId: null,
      interviewId: null,
      draft: {
        body: '我是林小舟，做过智能客服知识库与销售看板，希望继续做 AI 应用产品。（合成演示）',
        parameters: { durationSeconds: 60 },
        inputSnapshot: { assetSnapshots: [assetSnapshot('asset_001')], jobSnapshot: null, goalSnapshot: goalSnapshot('goal_ai_pm') },
        origin: 'demo_fixture',
        userEdited: false,
        userConfirmed: false
      },
      createdAt: '2026-09-06T10:00:00+08:00',
      updatedAt: '2026-09-06T10:00:00+08:00'
    },
    {
      id: 'doc_opening_job001',
      userId: U,
      kind: 'opening_message',
      title: 'Boss 开场白｜星河智能',
      goalId: 'goal_ai_pm',
      jobId: 'job_001',
      applicationId: 'app_001',
      interviewId: null,
      draft: {
        body: '您好，我关注到星河智能的 AI 产品经理岗位，曾负责智能客服知识库落地，希望进一步沟通。（合成演示）',
        parameters: { channel: 'boss' },
        inputSnapshot: {
          assetSnapshots: [assetSnapshot('asset_001')],
          jobSnapshot: jobSnapshot('job_001'),
          goalSnapshot: goalSnapshot('goal_ai_pm')
        },
        origin: 'demo_fixture',
        userEdited: false,
        userConfirmed: true
      },
      createdAt: '2026-09-06T10:20:00+08:00',
      updatedAt: '2026-09-06T10:20:00+08:00'
    }
  ];

  var documentVersions = [
    {
      id: 'dver_base_1',
      userId: U,
      documentId: 'doc_base_resume',
      versionNumber: 1,
      body: documents[0].draft.body,
      parameters: { variant: 'base' },
      inputSnapshot: documents[0].draft.inputSnapshot,
      origin: 'demo_fixture',
      userEdited: false,
      userConfirmed: true,
      createdAt: '2026-09-03T10:05:00+08:00'
    },
    {
      id: 'dver_tailored_job001_1',
      userId: U,
      documentId: 'doc_tailored_job001',
      versionNumber: 1,
      body: documents[1].draft.body,
      parameters: { variant: 'tailored' },
      inputSnapshot: documents[1].draft.inputSnapshot,
      origin: 'demo_fixture',
      userEdited: false,
      userConfirmed: true,
      createdAt: '2026-09-06T09:40:00+08:00'
    },
    {
      id: 'dver_opening_job001_1',
      userId: U,
      documentId: 'doc_opening_job001',
      versionNumber: 1,
      body: documents[3].draft.body,
      parameters: { channel: 'boss' },
      inputSnapshot: documents[3].draft.inputSnapshot,
      origin: 'demo_fixture',
      userEdited: false,
      userConfirmed: true,
      createdAt: '2026-09-06T10:20:00+08:00'
    }
  ];

  var envelope = {
    schemaVersion: '0.1',
    data: {
      users: [
        {
          id: U,
          displayName: '林小舟（虚构人物）',
          timeZone: 'Asia/Shanghai',
          createdAt: SEEDED
        }
      ],
      goals: goals,
      sources: sources,
      assets: assets,
      jobs: jobs,
      assessments: assessments,
      applications: applications,
      interviews: interviews,
      actionItems: actionItems,
      events: events,
      documents: documents,
      documentVersions: documentVersions,
      files: []
    },
    ui: { selectedGoalId: 'goal_ai_pm' }
  };

  var frozen = CA.domain.freezeDeep(envelope);

  CA.fixtures.demo = {
    // 每次初始化或重置都取独立副本，fixture 本身不可变。
    createEnvelope: function () {
      return JSON.parse(JSON.stringify(frozen));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
