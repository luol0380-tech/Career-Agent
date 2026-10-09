(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.domain = CA.domain || {};

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function byTimeAsc(field) {
    return function (a, b) {
      var ta = a[field] ? Date.parse(a[field]) : Infinity;
      var tb = b[field] ? Date.parse(b[field]) : Infinity;
      return ta - tb;
    };
  }

  function uniqueCount(list, keyFn) {
    var seen = Object.create(null);
    list.forEach(function (item) {
      seen[keyFn(item)] = true;
    });
    return Object.keys(seen).length;
  }

  var S = {
    user: function (data) {
      return data.users[0] || null;
    },
    goal: function (data, goalId) {
      return byId(data.goals, goalId);
    },
    activeGoals: function (data) {
      return data.goals.filter(function (g) {
        return g.status === 'active';
      });
    },
    asset: function (data, assetId) {
      return byId(data.assets, assetId);
    },
    job: function (data, jobId) {
      return byId(data.jobs, jobId);
    },
    source: function (data, sourceId) {
      return byId(data.sources, sourceId);
    },
    jobsForGoal: function (data, goalId) {
      return data.jobs.filter(function (j) {
        return j.goalIds.indexOf(goalId) >= 0;
      });
    },
    jobBelongsToGoal: function (job, goalId) {
      return !!job && job.goalIds.indexOf(goalId) >= 0;
    },

    latestAssessment: function (data, jobId, goalId) {
      var list = data.assessments.filter(function (a) {
        return a.jobId === jobId && a.goalId === goalId;
      });
      list.sort(function (a, b) {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
      return list[0] || null;
    },

    // 派生 isStale：Job、Goal 或被引用资产的当前 revision 与评估快照不同，或引用失效。
    assessmentStaleness: function (data, assessment) {
      var reasons = [];
      var changedAssets = [];
      var job = byId(data.jobs, assessment.jobId);
      if (!job) reasons.push('评估引用的岗位已不存在');
      else if (job.revision !== assessment.jobSnapshot.revision) reasons.push('岗位内容已更新');
      var goal = byId(data.goals, assessment.goalId);
      if (!goal) reasons.push('评估引用的目标已不存在');
      else if (goal.revision !== assessment.goalSnapshot.revision) reasons.push('求职目标已更新');
      assessment.assetSnapshots.forEach(function (snap) {
        var current = byId(data.assets, snap.assetId);
        if (!current) {
          reasons.push('引用的职业资产已不存在');
          changedAssets.push({ assetId: snap.assetId, snapshotRevision: snap.revision, currentRevision: null });
        } else if (current.revision !== snap.revision) {
          changedAssets.push({ assetId: snap.assetId, snapshotRevision: snap.revision, currentRevision: current.revision });
        }
      });
      if (changedAssets.length) reasons.push('引用的职业资产已更新');
      return { isStale: reasons.length > 0, reasons: reasons, changedAssets: changedAssets };
    },

    assessmentsReferencingAsset: function (data, assetId) {
      return data.assessments.filter(function (a) {
        return a.assetSnapshots.some(function (snap) {
          return snap.assetId === assetId;
        });
      });
    },

    applicationFor: function (data, goalId, jobId) {
      for (var i = 0; i < data.applications.length; i++) {
        var app = data.applications[i];
        if (app.goalId === goalId && app.jobId === jobId) return app;
      }
      return null;
    },

    interviewsForApplication: function (data, applicationId) {
      return data.interviews
        .filter(function (iv) {
          return iv.applicationId === applicationId;
        })
        .sort(function (a, b) {
          return a.roundNumber - b.roundNumber;
        });
    },

    openActionItemsForGoal: function (data, goalId) {
      return data.actionItems
        .filter(function (ai) {
          return ai.goalId === goalId && ai.status === 'open';
        })
        .sort(byTimeAsc('dueAt'));
    },

    // 首页四项指标，口径见 DATA_SCHEMA §9；只统计当前目标的累计值。
    goalMetrics: function (data, goalId) {
      var goalApps = data.applications.filter(function (app) {
        return app.goalId === goalId;
      });
      var goalAppIds = Object.create(null);
      goalApps.forEach(function (app) {
        goalAppIds[app.id] = true;
      });
      return {
        analyzedJobs: uniqueCount(
          data.assessments.filter(function (a) {
            return a.goalId === goalId;
          }),
          function (a) {
            return a.jobId;
          }
        ),
        submitted: uniqueCount(
          goalApps.filter(function (app) {
            return app.submittedAt !== null;
          }),
          function (app) {
            return app.id;
          }
        ),
        hrReplies: uniqueCount(
          goalApps.filter(function (app) {
            return app.hasHrReply === true;
          }),
          function (app) {
            return app.id;
          }
        ),
        completedInterviews: uniqueCount(
          data.interviews.filter(function (iv) {
            return iv.status === 'completed' && goalAppIds[iv.applicationId];
          }),
          function (iv) {
            return iv.id;
          }
        )
      };
    },

    // Product Stage 仅由当前目标＋岗位上下文推导用于展示，不写回任何实体。
    productStageForJob: function (data, goalId, jobId) {
      var app = S.applicationFor(data, goalId, jobId);
      if (!app) {
        return S.latestAssessment(data, jobId, goalId) ? 'job_evaluation' : 'profile_building';
      }
      var interviews = S.interviewsForApplication(data, app.id);
      var hasUpcoming = interviews.some(function (iv) {
        return iv.status === 'invited' || iv.status === 'scheduled';
      });
      if (app.status === 'preparing') return 'document_preparation';
      if (hasUpcoming) return 'interview_preparation';
      if (app.status === 'interview_completed') return 'interview_review';
      return 'application_tracking';
    },

    findEventByCommand: function (data, userId, commandId) {
      for (var i = 0; i < data.events.length; i++) {
        var ev = data.events[i];
        if (ev.userId === userId && ev.commandId === commandId) return ev;
      }
      return null;
    },

    document: function (data, documentId) {
      return byId(data.documents || [], documentId);
    },
    documentVersion: function (data, versionId) {
      return byId(data.documentVersions || [], versionId);
    },
    interview: function (data, interviewId) {
      return byId(data.interviews, interviewId);
    },
    application: function (data, applicationId) {
      return byId(data.applications, applicationId);
    },

    documentsForJobContext: function (data, goalId, jobId) {
      return (data.documents || []).filter(function (doc) {
        if (doc.kind === 'interview_prep') return false;
        if (doc.kind === 'resume' && doc.draft && doc.draft.parameters && doc.draft.parameters.variant === 'base') return true;
        if (doc.goalId && doc.goalId !== goalId) return false;
        if (doc.jobId && doc.jobId !== jobId) return false;
        return doc.goalId === goalId || (doc.kind === 'resume' && doc.draft.parameters.variant === 'base');
      });
    },

    versionsForDocument: function (data, documentId) {
      return (data.documentVersions || [])
        .filter(function (v) {
          return v.documentId === documentId;
        })
        .sort(function (a, b) {
          return b.versionNumber - a.versionNumber;
        });
    },

    latestVersion: function (data, documentId) {
      var list = S.versionsForDocument(data, documentId);
      return list[0] || null;
    },

    confirmedVersionsForSubmission: function (data, goalId, jobId) {
      return (data.documentVersions || []).filter(function (ver) {
        if (!ver.userConfirmed) return false;
        var doc = byId(data.documents || [], ver.documentId);
        if (!doc || doc.kind === 'interview_prep') return false;
        if (doc.kind === 'resume' && doc.draft.parameters.variant === 'base') return true;
        if (doc.goalId && doc.goalId !== goalId) return false;
        if (doc.jobId && doc.jobId !== jobId) return false;
        return true;
      });
    },

    applicationsForGoal: function (data, goalId) {
      return data.applications.filter(function (app) {
        return app.goalId === goalId;
      });
    },

    submittedApplicationsForGoal: function (data, goalId) {
      return data.applications.filter(function (app) {
        return app.goalId === goalId && app.submittedAt !== null;
      });
    },

    hrReplyApplicationsForGoal: function (data, goalId) {
      return data.applications.filter(function (app) {
        return app.goalId === goalId && app.hasHrReply === true;
      });
    },

    interviewsForGoal: function (data, goalId) {
      var appIds = Object.create(null);
      data.applications.forEach(function (app) {
        if (app.goalId === goalId) appIds[app.id] = true;
      });
      return data.interviews
        .filter(function (iv) {
          return appIds[iv.applicationId];
        })
        .sort(function (a, b) {
          return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        });
    },

    analyzedJobsForGoal: function (data, goalId) {
      var jobIds = Object.create(null);
      data.assessments.forEach(function (a) {
        if (a.goalId === goalId) jobIds[a.jobId] = true;
      });
      return data.jobs.filter(function (j) {
        return jobIds[j.id];
      });
    },

    documentLabel: function (doc) {
      var C = CA.domain.constants;
      if (doc.kind === 'resume') {
        var variant = doc.draft && doc.draft.parameters && doc.draft.parameters.variant;
        return (variant === 'tailored' ? C.RESUME_VARIANT.tailored : C.RESUME_VARIANT.base) + '｜' + doc.title;
      }
      return (C.DOCUMENT_KIND[doc.kind] || doc.kind) + '｜' + doc.title;
    },

    resumeFile: function (data, fileId) {
      return byId(data.files || [], fileId);
    },

    baseResumeDocument: function (data) {
      return (data.documents || []).filter(function (doc) {
        return doc.kind === 'resume' && doc.draft && doc.draft.parameters && doc.draft.parameters.variant === 'base';
      })[0] || null;
    },

    resumeFilesNewestFirst: function (data) {
      return (data.files || []).slice().sort(function (a, b) {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    },

    // 当前简历：优先最新已确认；否则最新待确认／待读取；失败记录不作为当前可用。
    currentResumeFile: function (data) {
      var list = S.resumeFilesNewestFirst(data);
      var confirmed = list.filter(function (f) {
        return f.status === 'confirmed';
      })[0];
      if (confirmed) return confirmed;
      return (
        list.filter(function (f) {
          return f.status === 'pending_confirm' || f.status === 'pending_read';
        })[0] || null
      );
    }
  };

  CA.domain.selectors = S;
})(typeof window !== 'undefined' ? window : globalThis);
