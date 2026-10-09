# Career Agent｜第九阶段任务包：面试改期与取消

状态：ready_for_review
日期：2026-10-01
前置：第八阶段已交 ready_for_review；用户授权连续施工

## 目标

按既有契约补齐 `rescheduleInterview` 与 `cancelInterview`，让用户在面试记录页能改期或取消未完成轮次，Application 状态按规则回退，不另造通用改态入口。

## 必须完成

1. 实现 `rescheduleInterview`：仅 interview_scheduled 上下文下的 invited／scheduled 轮；写 `interview.rescheduled`；不新增轮次。
2. 实现 `cancelInterview`：指定轮 → cancelled；有其他有效轮保持 interview_scheduled；否则有 completed → interview_completed，无则 → hr_responded；写 `interview.cancelled`。
3. 面试详情页提供改期／取消表单；失败可同 commandId 重试；文案用户可读。
4. 不修改契约；不启动服务；补充逻辑与浏览器验收；HANDOFF → `ready_for_review`。

## 不在本阶段

- 自动从邮件／邮件同步面试时间。
- ActionItem 自动重开或通用完成命令。
- 目标编辑、Quick Capture、云端。
