# Career Agent｜AI 求职工作台

把职业资产、求职目标、岗位判断、投递材料和面试反馈串成可追踪的求职流程。

## 当前状态

2026-09-29：第一阶段已实现，Codex Review 发现两处待修复问题及一处种子数据关联问题，状态为 changes_requested。应用可在本地直接打开，尚无在线 URL 或真实 AI 服务。实时交接状态见 [HANDOFF](docs/HANDOFF.md)，修正内容见 [Review](docs/PHASE1_REVIEW.md)。

第一阶段只实现 App Shell、求职首页、职业资产库和岗位工作台，使用合成 Mock 数据。HTML + 原生 JavaScript + Tailwind CDN，暂不引入后端或构建框架。

## 从哪里开始

1. 阅读 [项目规则](AGENTS.md)。
2. 查看 [当前交接](docs/HANDOFF.md)。
3. Cursor 当前按 [第一阶段修正包](tasks/CURSOR_PHASE1_FIXES.md) 处理 Review；原始范围见 [第一阶段施工任务](tasks/CURSOR_PHASE1.md)。
4. Codex 根据交接记录、实际文件和验收项 Review；用户负责产品与视觉验收。

无需分别复制整套需求给两个工具。它们读取本仓库的同一套契约，交付记录也写回本仓库。

## 核心文档

- [架构与 V1 范围](docs/ARCHITECTURE.md)
- [数据契约](docs/DATA_SCHEMA.md)
- [状态与事件](docs/STATE_EVENT_MODEL.md)
- [前端信息架构](design/FRONTEND_IA.md)
- [逐日计划](docs/ROADMAP.md)

## 交付口径

- 2026-10-06：目标为在线演示 Beta，具有完整合成用户、核心闭环、本地保存和演示重置。
- 2026-10-09：目标为可展示版本，补齐验收、README、架构说明、演示脚本与已知限制。
- 完成程度以验收记录为准，日期不等于承诺全部真实服务已经可用。
- 真实 LLM 接入是闭环完成后的条件性增量。用户输入必须得到真实处理，才能宣称真实能力；固定示例始终标明演示。
- 本地演示存储不提供账号、多设备同步或真实用户数据隔离，不应收集真实求职资料。

## 运行与验证

直接用浏览器打开 `app/index.html`，无需启动项目服务。运行纯逻辑校验：`node app/tests/logic-check.js`；浏览器验收：`node app/tests/browser-check.js`（需要本机 Chrome，以管道方式运行临时无头浏览器，不启动项目服务；会更新验收截图）。

现有测试复跑通过，但补充场景发现了 Review 中的问题；不能据原脚本结果认定第一阶段已经验收通过。未经用户明确要求，不启动或停止项目服务。
