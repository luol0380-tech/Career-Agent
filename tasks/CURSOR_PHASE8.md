# Career Agent｜第八阶段任务包：投递结果闭环

状态：ready_for_review
日期：2026-10-01
前置：第七阶段已交 ready_for_review；用户授权连续施工

## 目标

按既有 `STATE_EVENT_MODEL` 补齐投递结果记录：Offer、拒绝、退出、接受 Offer。用户能在准备材料／投递页明确记录外部已发生的结果，首页指标与岗位状态随之更新；不伪造自动投递或招聘平台回写。

## 必须完成

1. 实现命令（契约已有，本阶段补齐实现与 UI）：
   - `recordOffer`：前态 submitted／hr_responded／interview_scheduled／interview_completed → `offer_received`；写 `application.offer_recorded`；未结束面试改为 cancelled；关闭相关准备待办。
   - `recordRejection`：允许前态含 offer_received → `rejected`；写 `application.rejected`；取消未结束面试并关闭待办。
   - `withdrawApplication`：允许 preparing 及进行中状态 → `withdrawn`；写 `application.withdrawn`；取消未结束面试并关闭待办。
   - `acceptOffer`：仅 `offer_received` → `accepted`；写 `application.offer_accepted`。
2. 在投递／准备材料页提供清晰表单：时间、可选原因；进行中防重复提交；失败保留草稿并可同 commandId 重试。
3. 终态（rejected／withdrawn／accepted）不再提供互相跳转的通用改态入口。
4. 文案站在用户视角：记录外部结果，不是“系统帮你投递成功”。
5. 不修改契约枚举与事件载荷语义；不落盘密钥；不启动服务。
6. 补充逻辑与浏览器验收；更新 HANDOFF 为 `ready_for_review`。

## 不在本阶段

- 真实招聘平台对接、邮件抓取、自动改态。
- ActionItem 通用完成命令（若需独立事件，另开契约评审）。
- 目标编辑页、云端、发布上线。
- 修改第七阶段 AI 配置语义（第七阶段仍待 Codex 复审）。

## 验收重点

- 从已投递路径可记录 Offer／拒绝／退出；Offer 后可接受。
- preparing 可直接退出，不会变成已投递。
- 未结束面试在 Offer／拒绝／退出后变为已取消。
- 指标与列表状态与 Application.status 一致。
- 幂等重试与写失败重试可用。
