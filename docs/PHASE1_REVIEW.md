# 第一阶段 Codex Review

日期：2026-09-29。结论：**changes_requested**。主路径和已有测试通过，但补充场景发现两处必须修复的问题，以及一处种子数据因果关系错误。第一阶段暂不接受，不进入第二阶段。

## 验证依据

- 独立运行 `node app/tests/logic-check.js`：17/17 通过。
- 独立运行现有浏览器验收脚本：15/15 组通过。仅把输出与临时 Chrome 配置目录重定向到 `/tmp`，测试逻辑与应用未修改；没有启动项目服务，也没有覆盖 Cursor 的截图。
- 人工查看了本次复跑的桌面首页、桌面岗位详情和窄屏职业资产详情截图，未发现这三个状态的布局阻塞。
- 补充浏览器复现：取消重置、目标切换失败、结构损坏数据三个场景全部复现问题，详见 R1、R2。
- 复跑产物：`/tmp/career-agent-codex-review-mvEwgP/screenshots/browser-check-result.json`。
- 补充复现产物：`/tmp/career-agent-edge-review-z4VGcg/edge-review-result.json`，同目录含复现截图。临时文件不作为永久交接依赖，下文提供完整操作步骤。
- 本轮未修改 `app/`，未 commit，未启动或停止项目服务。

## R1｜P2：非路由动作提前销毁草稿，取消或失败后留下失效表单

定位：`app/components/router.js:118–123`；相关调用为 `app/main.js:42–99`，异常出现在 `app/features/vault.js:227–234`。

路径一：

1. 打开 `app/index.html?test=isolated#/vault/asset_001`。
2. 点击“编辑资产”，修改标题。
3. 点击“重置演示”，在草稿提示中选择“放弃修改并离开”。
4. 在随后出现的重置确认框中点击“取消”。
5. 继续在仍然可见的标题框输入，再点击“保存修改”。

实际结果：`isEditing()` 为 false，表单仍可见，草稿保护已失效；继续输入抛出 `Cannot read properties of null (reading 'draft')`，保存直接返回，数据仍为 revision 1。

路径二：步骤 2 后用隔离测试辅助 `CareerAgentTest.failWrites(true)` 注入写入失败，再切换目标，选择放弃草稿。目标未切换，但同样留下失效表单并抛错。

原因：`confirmIfDirty()` 在后续操作尚未成功时调用 `discard()`。取消重置和切换失败分支既没有恢复草稿，也没有把旧表单切换成一致的查看状态。

修正要求：把“允许继续动作”与“实际丢弃草稿”分开。取消重置／切换失败应保留草稿并继续可编辑；成功执行重置或用户最终离开时才丢弃。不能仅在输入监听器加判空来隐藏错误。回归还应覆盖重置写失败和成功路径，保证画面、guard、edit 对象一致。

## R2｜P2：缺少必填嵌套结构校验，损坏存储被当成可写正常数据

定位：`app/domain/validate.js:163–172`；渲染异常出现在 `app/features/jobs.js:207`。

复现：在专用测试浏览器／隔离存储中，从合法 fixture 复制状态，把 `data.assessments[0].evidence` 改为 null，保存为本应用状态后重新加载岗位 job_001。不要在用户正常演示数据上做此破坏性验证。

实际结果：`validateEnvelope()` 返回 `[]`，`loadWorkspace()` 返回 available／writable；进入岗位页抛出 `Cannot read properties of null (reading 'length')` 并显示“页面渲染出错”，没有进入契约要求的 invalid_data 恢复流程。

原因：校验使用 `(as.evidence || [])`，把必填数据缺失／null 当作空数组通过，渲染却直接访问 `as.evidence.length`。同段快照校验也只检查部分引用而未覆盖渲染所依赖的必填结构。

修正要求：补齐当前页面实际读取的嵌套字段类型和必填集合校验，包括 evidence 必须为数组、条目和快照结构有效。缺失、null、错误类型应稳定返回校验错误，而不是静默补默认值或向外抛 TypeError。不要扩展成数据库／第二阶段通用 Schema 平台。

验收：上述损坏状态进入 invalid_data，只读显示 fixture，原始存储串保持不变；用户取消重置不改变原串，确认重置成功才恢复可写。合法的空 evidence 数组仍可展示“没有引用证据”，不得误判为损坏。

## R3｜P3：演示待办不能由未来事件产生

定位：`app/fixtures/demo-data.js:626–629`。

`action_005` 的 createdAt 为 9 月 12 日，dueAt 为 9 月 14 日，但其 sourceEventId 指向 9 月 15 日才发生并记录的 `evt_seed_006`（application.submitted）。这与 sourceEventId 表示产生原因的契约矛盾。

最小修正：删除该非必要、已完成且不参与首页待办或四项指标的合成样例。若选择保留，就必须提供因果和时间均自洽的前置事件，不能只是替换成另一个能通过外键检查的 ID。不要求新增事件类型或待办编辑能力。

`action_004` 创建于投递之后，可以保留同一投递事件作为“投递后补充相关证据”的触发原因；在 fixture 旁说明该合成场景的因果关系，不宣称系统实际运行了规划器。

## Cursor 提出的四条契约问题

| 问题 | Codex 决定 |
| --- | --- |
| 首次播种写入失败 | 接受按 unavailable／只读临时浏览处理；保留 seed_write_failed 诊断原因，不显示保存成功，不自动提交到可写内存。补上探测成功、实际播种失败的测试。 |
| 仅确认时 changedFields | 接受 `["userConfirmed"]`。这里是本次变更原因的业务标识：文本修改记录 title／body；仅确认记录 userConfirmed。完整新确认值仍由 payload.userConfirmed 表达，不把此列表当作数据库全字段 diff。 |
| 资产事件 relatedRefs 为空 | 接受。subject 已指向资产，受影响评估从引用 revision 派生；无需增加 JobAssessment 引用类型或把推导关系复制进事件。 |
| 目标二待办事件来源 | action_004 可按投递后跟进解释并保留；action_005 不能引用未来事件，按 R3 修正。sourceEventId 表示触发原因，不证明待办已经完成。 |

前三条属于既有语义的澄清，不新增能力、不改变 Schema 版本；已补入相应契约说明。第四条按最小 fixture 修正处理。

## 可后置项与验收边界

- 浏览器“后退”被取消后产生重复历史项，是已披露的导航体验问题，本轮不因此要求重写路由。
- Safari、Firefox、真实读屏软件未验证，不据 Chrome 结果宣称跨浏览器或无障碍全面通过。
- 外部标签页变化后编辑按钮未及时禁用但保存已被可靠拒绝，本轮可以后置优化按钮反馈。
- 本轮未验收真实 AI、账号、云端同步、文档生成或部署能力。

## 下一步

Cursor 只执行 [第一阶段修正包](../tasks/CURSOR_PHASE1_FIXES.md)，修复 R1／R2、整理 R3，补最小回归并更新 HANDOFF 为 ready_for_review。无需重做已验收的页面或更换技术栈。
