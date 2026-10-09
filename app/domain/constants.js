(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.domain = CA.domain || {};

  function freezeDeep(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.keys(value).forEach(function (key) {
        freezeDeep(value[key]);
      });
    }
    return value;
  }

  // 枚举值与契约 docs/DATA_SCHEMA.md、docs/STATE_EVENT_MODEL.md 保持一致；页面只从这里读取。
  CA.domain.constants = freezeDeep({
    SCHEMA_VERSION: '0.1',
    EVENT_PAYLOAD_VERSION: 1,
    STORAGE_KEY: 'career-agent.demo.v1',
    STORAGE_PROBE_KEY: 'career-agent.demo.v1.__probe',

    STORAGE_STATUS: {
      AVAILABLE: 'available',
      UNAVAILABLE: 'unavailable',
      INVALID_DATA: 'invalid_data'
    },

    GOAL_STATUS: ['active', 'archived'],

    SOURCE_KIND: {
      demo_fixture: '合成演示样例',
      manual_entry: '手动输入',
      pasted_text: '粘贴文本',
      pdf_upload: 'PDF 上传'
    },

    RESUME_FILE_STATUS: {
      pending_read: '待读取',
      pending_confirm: '待确认',
      confirmed: '已确认',
      read_failed: '读取失败'
    },

    ASSET_KIND: {
      work_experience: '工作经历',
      project_experience: '项目经历',
      skill_evidence: '能力证据',
      portfolio: '作品集'
    },

    DOCUMENT_KIND: {
      resume: '简历',
      self_introduction: '自我介绍',
      opening_message: '开场沟通',
      interview_prep: '面试准备'
    },

    RESUME_VARIANT: {
      base: '基础简历',
      tailored: '定制简历'
    },

    INTRO_DURATION: {
      30: '30 秒',
      60: '1 分钟',
      120: '2 分钟'
    },

    OPENING_CHANNEL: {
      boss: 'Boss 直聘',
      headhunter: '猎头',
      referral: '内推',
      hr: 'HR 邮箱／表单'
    },

    MATCH_LEVEL: {
      high: '较高',
      medium: '中等',
      low: '较低',
      unknown: '无法判断'
    },

    ORIGIN: {
      demo_fixture: '演示预置',
      model_generated: '模型生成',
      user_authored: '用户撰写'
    },

    APPLICATION_STATUS: {
      preparing: '准备投递',
      submitted: '已记录投递',
      hr_responded: '招聘方已回复',
      interview_scheduled: '面试已排期',
      interview_completed: '面试已完成',
      offer_received: '已收到 Offer',
      rejected: '已被拒绝',
      withdrawn: '已退出',
      accepted: '已接受 Offer'
    },

    INTERVIEW_STATUS: {
      invited: '已邀请，时间待定',
      scheduled: '已排期',
      completed: '已完成',
      cancelled: '已取消'
    },

    ACTION_ITEM_STATUS: {
      open: '待处理',
      done: '已完成',
      dismissed: '已忽略'
    },

    ACTION_ITEM_KIND: {
      review_job: '复核岗位',
      complete_profile: '补充资产',
      prepare_documents: '准备材料',
      prepare_interview: '准备面试',
      complete_interview_review: '面试复盘'
    },

    PRODUCT_STAGE: {
      profile_building: '整理职业资产',
      job_evaluation: '岗位判断',
      document_preparation: '准备投递材料',
      application_tracking: '投递跟进',
      interview_preparation: '面试准备',
      interview_review: '面试复盘'
    },

    TASK_RUN_STATUS: ['pending', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'],

    EVENT_TYPES: [
      'career_asset.revised',
      'application.prepared',
      'application.submitted',
      'application.hr_reply_recorded',
      'interview.invitation_recorded',
      'interview.rescheduled',
      'interview.completed',
      'interview.cancelled',
      'application.offer_recorded',
      'application.rejected',
      'application.withdrawn',
      'application.offer_accepted',
      'document.version_saved',
      // PHASE2：已写入 STATE_EVENT_MODEL 闭集。
      'interview.transcript_saved',
      'resume_file.uploaded',
      'resume_file.read_failed',
      'resume_file.text_saved',
      'resume_file.confirmed'
    ],

    SUBJECT_TYPES: ['user', 'career_goal', 'career_asset', 'job', 'application', 'interview', 'document', 'resume_file'],

    DATA_COLLECTIONS: [
      'users',
      'goals',
      'sources',
      'assets',
      'jobs',
      'assessments',
      'applications',
      'interviews',
      'actionItems',
      'events',
      'documents',
      'documentVersions',
      'files'
    ],

    LIMITS: {
      ASSET_TITLE_MAX: 120,
      ASSET_BODY_MAX: 4000,
      DOCUMENT_BODY_MAX: 12000,
      TRANSCRIPT_MAX: 8000,
      REPLY_SUMMARY_MAX: 500,
      RESUME_FILE_MAX_BYTES: 5 * 1024 * 1024,
      RESUME_FILE_NAME_MAX: 200
    }
  });

  CA.domain.freezeDeep = freezeDeep;
})(typeof window !== 'undefined' ? window : globalThis);
