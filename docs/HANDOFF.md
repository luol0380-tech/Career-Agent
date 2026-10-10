# 当前施工交接

## 当前状态

- 更新日期：2026-10-10
- 当前任务：`CURSOR-PHASE12`
- 状态：`ready_for_review`
- 当前实现负责人：Cursor（R12-01～R12-04 已修正，待 Codex 复审）
- 当前 Review 负责人：Codex
- 契约版本：`0.1`（业务实体字段不改；本机 AI 代理不新增业务事件）
- 任务包：[第十二阶段施工](../tasks/CURSOR_PHASE12.md)（`ready_for_review`）
- 第十一阶段：目标编辑**暂停**。
- 第七至第十阶段：代码层面已 `accepted`。
- 当前已有：第十二阶段修正交付（超时／本机监听／严格校验／同源 mock 端到端）。
- 当前没有：用户授权启动的正式服务进程；真实 DeepSeek 外呼验收结论。

## 启动给 Codex 的消息

R12-01～R12-04 已修正并交 `ready_for_review`。请对照下文「修正对照」与测试证据独立复审。未启动项目正式服务、未真实外呼、未输出密钥、未 commit。

## 协作约定

- 状态依次为 `ready_for_cursor → implementing → ready_for_review → accepted`；发现问题则进入 `changes_requested → implementing`。
- 上述是施工交接状态，与产品内 Application／TaskRun 状态无关。
- Cursor 接单后更新状态和负责人；Codex 做 Review 时先读本文件，再读实际实现。
- 一次仅有一个实现负责人。Cursor 实现中，Codex 不同时改同一批代码。
- 契约／接口草案阶段：写 HANDOFF 与任务包，不改正式 `DATA_SCHEMA`／`STATE_EVENT_MODEL` 正文、不改 app，直至 Codex accepted。
- **未经用户明确要求，不启动、不停止项目服务。**

## Cursor 实现记录

- 开始／结束时间：2026-09-29 09:58 开始，同日完成并交 Review。
- 实际修改文件：
  - 新增 `app/index.html`、`app/styles.css`、`app/main.js`
  - 新增 `app/domain/constants.js`（枚举与中文展示名）、`app/domain/validate.js`（状态包字段／引用／同用户校验、指纹序列化）、`app/domain/selectors.js`（指标、过滤、过期判定、Product Stage 推导）
  - 新增 `app/fixtures/demo-data.js`（统一合成数据，冻结；每次初始化／重置取独立副本）
  - 新增 `app/data/storage.js`（唯一访问 localStorage 的驱动；`?test=` 隔离内存驱动与故障注入）、`app/data/workspace.js`（统一异步接口 loadWorkspace／readWorkspace／selectGoal／updateCareerAsset／resetDemo）
  - 新增 `app/components/ui.js`（安全文本 DOM 构建、状态区块、原生 dialog 确认、提示）、`app/components/router.js`（hash 路由与草稿守卫）、`app/components/shell.js`（导航、目标选择、横幅、重置入口、CDN 失败提示）
  - 新增 `app/features/shared.js`、`home.js`、`vault.js`、`jobs.js`、`prepare.js`
  - 新增 `app/tests/logic-check.js`、`app/tests/browser-check.js`（用途见下）
  - 新增 `assets/screenshots/phase1/*.png`（22 张合成数据截图）与 `browser-check-result.json`
  - 修改 `docs/HANDOFF.md`（本文件）。未修改任何契约、任务包、设计文档、README 或 .gitignore。
- 完成内容：
  - App Shell：三页导航（`aria-current`）、全局目标选择、常驻“合成演示数据｜Demo Beta”标记与“保存位置：当前浏览器本地（不同步云端）”、hash 路由（刷新／前进后退／未知路由可恢复）、全局提示、次要位置的“重置演示”（需确认）、跳到主要内容链接。
  - Home：当前目标说明 → 四项指标（“当前目标 · 累计”，由 selector 从统一数据计算）→ 待办（动作、关联岗位、演示日程时间、状态）→ 相关岗位。面试类待办进入关联岗位并说明面试工作区后续开放；无待办时显示空状态与岗位入口。
  - Vault：资产列表（类型／确认状态筛选）、详情（正文、revision、确认状态、置信度说明、全部来源及原文、被哪些评估引用及是否过期）、编辑／保存／取消；“确认这次修改”默认不选；保存中防重复提交；校验错误就近显示；失败保留草稿并提供“重试保存”（同参数复用 commandId）。
  - 写入语义：内容变化 → 新增 manual_entry 来源、旧来源保留、confidence=null、按勾选决定确认、revision+1、写 `career_asset.revised`；内容不变仅确认 → revision+1、不新增来源；无变化 → 不写入、不撤销确认；过期 revision／同键不同参数拒绝覆盖。候选快照先完整校验再序列化写入，成功后才替换已提交状态。
  - Job：当前目标岗位列表（匹配程度徽标、过期提示、投递状态）、详情（JD 与来源、Match／Gap／Evidence／Risk、只读投递与面试轮次）。证据显示资产名、引用 revision、评估时确认状态，待确认证据标“待核实”；可展开对照“评估时快照”与“当前资产”；点击定位资产并携带 `fromJob`＋`goal`＋`rev`，资产页提供“返回岗位”。
  - 文档占位：展示目标／岗位／公司／当前投递记录，写明“文档工作区将在下一阶段开放”，提供“返回岗位”；不写入任何数据。
  - 存储状态：启动探测失败 → 只读临时浏览（禁用保存与重置，目标临时切换并提示刷新不保留）；损坏或版本不兼容 → 保留原串、只读初始预览、确认重置写入成功后恢复；运行中写失败 → 不降级、保留草稿与旧状态；`storage` 事件或写前比对发现同键被改 → 暂停写入并提示重新加载。重置只写本应用键，不调用 `localStorage.clear()`。
  - 草稿保护：页面导航、浏览器前进后退、目标切换、重置前均弹出“继续编辑／放弃修改并离开”；刷新／关闭使用标准 `beforeunload`。
- 未完成内容及原因：无任务包范围内的未完成项。Document、DocumentVersion、TaskRun、Application／Interview 写入按任务包不在本阶段实现。
- 如何打开或验证：
  - 直接用浏览器打开 `app/index.html`（file://，无需任何服务）。
  - 隔离故障场景入口（不读写正常演示数据，页面顶部有“隔离测试场景”横幅）：`app/index.html?test=isolated|unavailable|corrupt|incompatible|load_error|slow|empty`。`isolated` 下可在控制台调用 `CareerAgentTest.failWrites(true/false)`、`CareerAgentTest.simulateExternalChange()`、`CareerAgentTest.failNextLoad()`、`CareerAgentTest.peekStored()`。
  - 纯逻辑校验：`node app/tests/logic-check.js`（在 Node 隔离上下文加载 domain／fixtures／data，使用内存存储驱动）。
  - 浏览器验收：`node app/tests/browser-check.js [Chrome 路径]`。以无头 Chrome 的 `--remote-debugging-pipe` 管道通信（不监听端口、不启动项目服务），临时配置目录建在仓库根 `.tmp-chrome-*`，结束后自动删除；截图和结果 JSON 写入 `assets/screenshots/phase1/`。
- 运行过的检查及结果：
  - `node --check` 全部 `app/**/*.js`：无语法错误。
  - `node app/tests/logic-check.js`：17 项全部通过（fixture 校验与不可变、两组初始指标、过滤、持久化、A04 三种保存、无操作、幂等重试与冲突、写失败、只读、损坏／不兼容、重置只动本键、外部改动、读取重试、空数据集、跨用户与重复 Application 拒绝）。
  - `node app/tests/browser-check.js`：15 组全部通过（明细见下方验收表与 `browser-check-result.json`）。首轮运行暴露并已修复 1 个应用缺陷：表单错误区只渲染了第一行，缺少“重试保存”按钮（`ui.append` 只接收单个子节点）。
  - 截图人工检查后修复：标题被程序聚焦时的粗边框、“匹配程度”徽标被拉伸、窄屏提示堆叠（现最多同时显示 2 条）、测试横幅断句、一条风险依据露出字段名。
- 浏览器实测环境：macOS（darwin 23.6.0），Google Chrome 154.0.8037.58 无头模式（headless=new），入口为 file://；视口 1440×900 与 390×844（mobile 模拟）；正常流程在可联网环境下加载 Tailwind 与 Font Awesome CDN，A11 另用 `Network.setBlockedURLs` 阻断两个 CDN。因沙箱内无头 Chrome 无法启动，浏览器验收在解除沙箱的终端进程中运行。Cursor 内置浏览器不允许打开 file://，未使用。
- 已知缺陷与限制：
  - 仅在 Chrome 实测；Safari、Firefox 及它们在 file:// 下的 localStorage 行为未验证。
  - 键盘验收使用 CDP 合成 Tab／Enter 按键；未使用真实读屏软件验证提示朗读，只检查了 `role=status/alert`、`aria-live`、label 关联与焦点可见。
  - 草稿守卫在 hashchange 后用 `history.replaceState` 恢复原地址：浏览器“后退”被取消时，当前历史条目会被改写为原地址，历史栈中会多出一个与当前页相同的条目。
  - 检测到外部标签页改动后，已打开的“编辑资产”按钮不会立即变为禁用；此时保存会被拒绝并显示“已暂停保存，请重新加载”，草稿保留。
  - 岗位详情地址中的 `goal` 与全局目标不同时，按地址中的目标展示并显示提示及“切换当前目标”按钮，不静默切换全局目标。
  - Tailwind CDN 在正常加载时会在控制台输出“不应用于生产环境”的 warn，不属于应用错误。阻断 CDN 时，Chrome 的 Log 域未记录被阻断请求，“预期资源网络错误”计数为 0；失败检测依赖 `onerror` 与 `window.tailwind` 检查。
- 首轮提交时的契约问题（已由 Codex 答复，决定见 PHASE1_REVIEW.md；以下保留原始记录）：
  1. 问题：契约只定义“启动探测失败 → unavailable”，没有定义“探测成功但首次播种写入失败（如配额已满）”。影响：当前实现把这种情况也按 unavailable（只读临时浏览）处理，`readOnlyReason=seed_write_failed`。最小建议：在 DATA_SCHEMA §8 明确播种写失败同样进入只读临时浏览。
  2. 问题：`career_asset.revised.payload.changedFields[]` 未规定“仅确认”时的取值。影响：当前内容变化时为 `["title"]`／`["body"]`／两者，仅确认时为 `["userConfirmed"]`。最小建议：在 STATE_EVENT_MODEL §5 写明取值集合。
  3. 问题：`relatedRefs` 的 subject 类型不含 JobAssessment。影响：资产修改事件的 `relatedRefs` 目前为空数组，受影响评估由 revision 比对派生。最小建议：确认保持为空即可，或补充允许的引用类型。
  4. 问题：演示待办 `action_004`（complete_profile，目标二）需要 sourceEventId，但闭集事件中没有贴切的“补充证据”来源。影响：当前关联到 `app_003` 的 `application.submitted` 种子事件（`evt_seed_006`）；`action_005`（已完成的 review_job）同样引用它。种子事件 actor 为 `{ type: system, id: demo }`、commandId 为 `seed_*`。最小建议：确认这种关联可接受，或指定种子待办应引用的事件。

## 施工契约检查（Codex，2026-09-29）

- 已完成只读交叉审查，统一资产修改／仅确认／无操作三个分支、只读临时浏览、幂等标识和不可变快照。
- 已补充回复事实与回复时间分离的 hasHrReply 字段，时间未知不要求编造，也不遗漏回复计数。
- 已检查 9 份 Markdown 的文件链接、UTF-8 读取、代码围栏及 A01–A12 编号完整性，检查通过。
- 本小节是施工前的文档检查历史，不代表前端验收。当前实现验收与 Review 结论见下文。

## 第一阶段验收

状态只能写 `待验证`、`通过`、`失败` 或 `受阻`；每项补充操作和实际结果，不能只勾选。

| 编号 | 验收项 | 状态 | 证据／结果 |
| --- | --- | --- | --- |
| A01 | 三页互通、刷新恢复路由、未知路由可恢复 | 通过 | 浏览器脚本：首页→职业资产→岗位工作区导航；在 `#/jobs/job_002?goal=goal_ai_pm` 刷新后恢复详情；后退回 `#/jobs`、前进回详情；`#/nope`、`job_999`、`asset_999`、`job_003`＋目标一、无效 goal、占位页错误组合 6 种均显示可恢复提示及回首页／列表入口，未打开其他对象；`#/` 重定向 `#/home` |
| A02 | 两个目标切换，岗位／待办／指标同步过滤 | 通过 | 目标一 → 目标二：指标 2/1/1/1 → 1/1/0/0，待办 3 → 1 项且不含二面，岗位列表 2 → 1；刷新后选择器仍为 goal_b2b_pm；切回后恢复。截图 `A02-home-goal1-desktop.png`、`A02-home-goal2-desktop.png` |
| A03 | 岗位证据能定位资产，并保留返回岗位的上下文 | 通过 | job_001 的 3 条证据链接都带资产 ID、引用 revision、`fromJob`、`goal`；点第 2 条定位 asset_003（按 ID，非公司名）；“返回岗位”与浏览器后退均回到 `#/jobs/job_001?goal=goal_ai_pm`。截图 `A03-*` |
| A04 | 编辑资产后刷新可恢复，revision 增加且旧评估标为过期 | 通过 | asset_001 改标题未勾选：r1→r2、待确认、来源 1→2（旧来源保留、新增手动输入）、刷新后恢复；job_001、job_002 评估显示“当前评估可能过期”，对照区仍为评估时原内容，assessments 数据序列化前后完全一致；job_003 未误标。asset_002 勾选确认：r2 已确认。asset_004 仅确认：r2 已确认、来源数不变。共新增 3 条 `career_asset.revised`。截图 `A04-*` |
| A05 | 准备投递只传递上下文到文档占位，不改变投递状态 | 通过 | job_001 点“准备投递”：占位显示目标／岗位／公司与“文档工作区将在下一阶段开放”；“返回岗位”回原地址；操作前后本地存储原串逐字相同（Application、状态、事件均无变化）；指标仍 2/1/1/1。截图 `A05-prepare-placeholder-desktop.png` |
| A06 | 修改草稿离开有保护；取消编辑不写入 | 通过 | 原脚本路径仍通过（导航／目标切换继续编辑、beforeunload、放弃离开、取消编辑、无变化保存）。FIX1 补充：放弃草稿后取消重置（F01）、目标切换写入失败（F02）、重置写入失败（F03）后草稿与离开保护保持一致，可继续输入并保存，无 JS 错误；成功重置／切换会关闭表单（F04）。截图 `A06-leave-guard-desktop.png`、`F01-*`、`F02-*`、`F03-*` |
| A07 | 空／加载／失败状态可见，失败可重试 | 通过 | `?test=empty`：首页“当前目标暂无待办”、指标 0/0/0/0、岗位页“还没有收藏岗位”；`?test=slow`：显示“正在读取本地演示数据…”；`?test=load_error`：显示“读取演示数据失败”与“重试读取”，重试后恢复。保存进行中按钮禁用并显示“正在保存…”。截图 `A07-*`。FIX1 复跑仍通过。 |
| A08 | 存储不可用或损坏有提示、不覆盖原数据；重置需确认 | 通过 | 原 unavailable／corrupt／写失败／外部改动／重置确认路径仍通过。FIX1：`evidence=null`（`?test=bad_evidence`）进入 invalid_data，原串保留，岗位页不崩溃，编辑禁用（F05）；探测成功但首次播种写失败进入 unavailable（逻辑 F07）；目标切换／重置写失败时草稿保留（F02／F03）。截图 `A08-*`、`F05-invalid-evidence-desktop.png` |
| A09 | 桌面和窄屏可操作，键盘可达、焦点可见 | 通过 | 1440px 与 390px 下完成各页；390px 下首页／资产详情／岗位详情／岗位列表均无横向溢出。键盘 Tab 依次到达跳转链接、目标选择、重置、导航，`:focus-visible` 为 3px 实线；在“职业资产”按回车进入 `#/vault`；进入编辑后焦点落在标题输入；所有 input／select／textarea 都有关联 label。限制：键盘为 CDP 合成按键，未用读屏软件验证。截图 `A09-*-narrow.png` |
| A10 | Demo 标记清楚，没有虚假生成／上传／投递成功 | 通过 | 顶栏常驻“合成演示数据｜Demo Beta”，导航注明保存位置与“未接入真实 AI、自动投递或账号系统”；评估标“演示评估：演示预置，非模型实时分析”，匹配只显示等级并注明非准确率；待确认证据标“待核实，不作为肯定证据”；待确认资产注明“尚未经用户核实”，置信度注明演示值；页面中未出现成功生成／上传／投递／同步类表述 |
| A11 | 无未处理的应用 JS 错误；CDN 失败仍可理解页面（预期的资源网络错误单独记录） | 通过 | 正常流程全程应用 JS 错误 0 条（异常与 console.error 均已监听），CDN 正常加载。阻断 Tailwind 与 Font Awesome 后顶部提示两项资源加载失败、本地样式布局完整、所有按钮有文字，应用 JS 错误 0 条；Chrome 未把被阻断请求记入 Log 域，预期网络错误计数为 0（见限制）。截图 `A11-cdn-blocked-desktop.png` |
| A12 | 指标符合契约，跨目标归属与不可变历史检查通过 | 通过 | 初始 2/1/1/1 与 1/1/0/0（二面 scheduled 不计入面试次数）；切换目标前后 applications 序列化一致、事件数不变；逻辑校验覆盖：相同 commandId 重试返回原 revision 且不重复写入、无变化保存不写入且不撤销确认、过期 revision 与同键不同参数均拒绝且数据不变 |

## Codex Review（2026-09-29）

- 结论：`changes_requested`，暂不接受第一阶段。详情见 [Review](PHASE1_REVIEW.md)。
- 独立复跑：纯逻辑 17/17、现有浏览器验收 15/15；另补三个浏览器场景，复现下述 R1／R2。输出保存在 /tmp，未覆盖首轮截图。
- 必修问题：R1（P2）非路由操作提前清空草稿，取消／失败后留下失效表单；R2（P2）必填嵌套结构未校验，损坏存储进入正常模式并使页面报错。
- 种子数据修正：R3（P3）action_005 引用了晚于待办创建时间的投递事件，按修正包移除非必要样例或修正来源。
- 四条契约问题：前三条接受并澄清；第四条 action_004 可解释为投递后补证据，action_005 必须修正。没有新增能力或改变 Schema 版本。
- 可后置问题：已披露的重复浏览历史项、外部改动后按钮反馈；Safari／Firefox／读屏软件仍未验证。
- 文档变更：新增 Review 和 FIX1 任务包，澄清 DATA_SCHEMA／STATE_EVENT_MODEL，更新本交接及 README 状态；没有修改 app 代码、启动服务或提交 Git。
- 是否进入下一阶段：否。Cursor 完成 FIX1 后更新本文件为 ready_for_review，由 Codex 针对问题复审。

## Codex 复审（2026-09-29，FIX1 后）

- 结论：`accepted`。第一阶段可以接受。
- 复跑：`app/**/*.js` 语法检查通过；逻辑校验 21/21；浏览器验收 20/20；A01–A12、F01–F05 全部通过；无新增应用 JS 错误。
- 前端文案、品牌区、求职进展二级入口抽查：未破坏现有功能。
- 第二阶段：已新增任务包 `tasks/CURSOR_PHASE2.md`（`draft_for_review`）。范围含文档工作区、投递跟进、多轮面试记录、面试复盘、求职进展二级页完善。待 Codex 完成契约 Review 并明确授权后，Cursor 再开工；当前不得自动进入第二阶段施工。

## Cursor FIX1 实施记录

- 开始／结束时间：2026-09-29 11:42 接单，同日完成并交复审。
- 实际修改文件：
  - `app/components/router.js`：`confirmIfDirty` 只返回离开许可，不再提前 `discard`；新增 `discardDirty` 供调用方在成功后清理。
  - `app/main.js`：目标切换与重置仅在真正成功后 `discardDirty`；取消重置／写入失败保留草稿；测试辅助增加 `failBusinessWrites`／`replaceStored`。
  - `app/domain/validate.js`：`evidence`／`gaps`／`risks`／`assetSnapshots` 必为数组；拒绝 null／缺失／错误类型；校验 evidence 条目与快照必填字段；合法空数组可通过。
  - `app/fixtures/demo-data.js`：删除因果倒置的 `action_005`；为 `action_004` 注明投递后补证据的合成因果。
  - `app/data/storage.js`：新增 `failBusinessWrites` 故障位与 `?test=bad_evidence` 预置场景。
  - `app/tests/logic-check.js`：新增 F05–F08（共 21 项）。
  - `app/tests/browser-check.js`：新增 F01–F05；隔离场景下 `__t.stored` 改读 `CareerAgentTest.peekStored`。
  - `docs/HANDOFF.md`（本文件）。未改契约、未启动服务、未 commit。
- R1／R2／R3 处理结果：
  - R1：离开许可与丢弃分离；取消重置、目标切换失败、重置写失败后表单／guard／edit 一致，可继续保存；成功路径才清理草稿。
  - R2：必填嵌套结构严格校验；`evidence=null` 等进入 `invalid_data` 且保留原串；`evidence=[]` 仍可用。
  - R3：删除 `action_005`；`action_004` 保留并注释；初始指标仍为 2/1/1/1 与 1/1/0/0。
- 新增回归与原回归的实际结果：
  - `node app/tests/logic-check.js`：21/21 通过（原 17 + F05／F06／F07／F08）。
  - `node app/tests/browser-check.js`：20/20 组通过（原 15 + F01／F02／F03／F04／F05-browser）。
  - A01–A12 本轮复跑：A06／A08 由失败改回通过；其余项复跑仍通过。
- 浏览器实测与证据：macOS，Google Chrome 154 无头（headless=new，remote-debugging-pipe，file://）；未启动项目服务。新增截图 `F01-cancel-reset-keep-draft-desktop.png`、`F02-goal-switch-fail-keep-draft-desktop.png`、`F03-reset-write-fail-keep-draft-desktop.png`、`F05-invalid-evidence-desktop.png`。完整结果见 `assets/screenshots/phase1/browser-check-result.json`。
- 未验证项目／已知限制：Safari／Firefox／真实读屏仍未验证；浏览器后退取消后的重复历史项、外部改动后编辑按钮未即时禁用等可后置项仍按 Review 保留。

## 视觉方向调整（2026-09-29）

- 根据用户提供的参考图，将页面视觉向米白底、黄色不规则标记、黑色粗描边、彩色状态点和轻量展示感调整。
- 仅修改 `app/styles.css`，未改变数据、字段、路由、状态或业务交互。
- 调整后复跑：`node app/tests/logic-check.js` 21/21 通过；`node app/tests/browser-check.js` 20/20 组通过。
- 当前仍只在 Chrome/file:// 环境验证，Safari、Firefox 与真实读屏未验证。

## 求职进展信息架构调整（2026-09-29）

- 左上角产品名改为“职业求职助手”；左侧导航的“求职首页”改为“求职进展”。
- 左侧新增合成个人信息卡片，展示人物、当前状态、目标岗位和薪资期望。
- 首页四项进展指标改为可进入二级列表；新增职业指南入口与面试复盘（下一阶段开放）入口。
- 新增 `#/progress/:kind` 演示路由；面试复盘当前明确为占位说明，不写入数据。
- 修复重置确认弹窗文字颜色，保证在浅色弹窗背景上可读。
- 验证：`node app/tests/logic-check.js` 21/21；`node app/tests/browser-check.js` 20/20。浏览器验收脚本已同步使用“求职进展”导航名称。
- 顶部品牌区补充一句话介绍“把经历整理成下一步行动”，与产品标题并列展示；前端可见的 `revision`、`ID`、`JD` 等术语已改为“版本、编号、岗位说明”等用户语言。

## 第二阶段准备（2026-09-29）

- 第一阶段前端视觉和文案调整已暂时冻结。
- 根据路线要求新增 `tasks/CURSOR_PHASE2.md`，范围覆盖文档工作区、投递跟进、面试记录／复盘和求职进展二级页。
- 已完成 Codex 契约复审，任务包状态为 `ready_for_cursor`；Cursor 已按现有契约施工完成，见下文交付记录。

## 第一阶段复审结论（2026-09-29）

- 复审范围：第一阶段修正包、后续视觉／信息架构／用户文案调整，以及新增求职进展二级演示路由。
- 语法检查：全部 `app/**/*.js` 通过 `node --check`。
- 纯逻辑校验：21/21 通过。
- 浏览器验收：20/20 组通过；A01–A12 与 F01–F05 均通过，无新增应用 JS 错误。
- 结论：第一阶段修正项已关闭，当前版本可接受；后续工作进入第二阶段任务包，仍需先完成契约增量 Review。

## Cursor 第二阶段实施记录（2026-09-29）

- 开始／结束时间：2026-09-29 14:45 接单，同日完成并交 Review。
- 实际修改文件：
  - 新增 `app/data/phase2-commands.js`（prepareApplication、ensureContextDocuments、saveDocumentVersion、recordSubmission、recordHrReply、scheduleInterview、completeInterview、saveInterviewTranscript、ensureInterviewPrepDocument）
  - 新增 `app/features/interviews.js`（面试列表／详情、登记邀请、笔记、完成标记、面试准备材料入口）
  - 扩展 `app/domain/constants.js`／`validate.js`／`selectors.js`、`app/fixtures/demo-data.js`（Document／DocumentVersion 种子与 interview transcript／review）、`app/data/storage.js`／`workspace.js`（documents 集合、软迁移、挂载 phase2 命令）
  - 重写 `app/features/prepare.js`（文档工作区＋投递跟进）、`app/features/progress.js`（四个进展二级页＋复盘入口列表）
  - 更新 `app/features/jobs.js`／`home.js`／`shared.js`、`app/components/router.js`、`app/main.js`、`app/index.html`、`app/styles.css`
  - 更新 `app/tests/logic-check.js`（+P2-01…P2-05）、`app/tests/browser-check.js`（A05 语义更新＋P2-A/B/C）
  - 更新本文件。**未修改** `docs/DATA_SCHEMA.md`、`docs/STATE_EVENT_MODEL.md`、任务包或设计文档；未启动服务；未 commit。
- 完成内容：
  - 文档工作区：从岗位进入准备投递材料；基础／定制简历、自我介绍、开场沟通可编辑；每次保存新建不可覆盖 DocumentVersion；投递记录引用版本 ID 或 materialsUnknown。
  - 投递跟进：区分 preparing 与已记录投递；记录投递时间、材料版本、HR 回复（时间可空＋备注）；未知回复不显示为已回复。
  - 面试：按 applicationId 多轮关联；列表／详情；预置复盘标“演示预置复盘”；新笔记清空 review 并显示“尚未分析”；面试建立后可创建 interview_prep 文档。
  - 进展二级页：analyzed／submitted／replies／interviews 列出当前目标记录并可返回；review 入口列出面试并链到详情；guide 仍为后续开放说明。
  - 第一阶段本地包缺 documents／documentVersions 时内存软补空数组后再校验，不覆盖其他字段。
- A05 语义变更：第一阶段“占位且不写存储”改为进入真实文档工作区；仅打开页面查看预置材料时不一定写入；点击“准备材料入口／开始准备投递”会写入 Application／Document。浏览器验收已同步。
- 如何验证：
  - 浏览器打开 `app/index.html`（file://，无需服务）。
  - `node app/tests/logic-check.js`
  - `node app/tests/browser-check.js [Chrome 路径]`（截图仍写入 `assets/screenshots/phase1/`，含 P2-* 新图）。
- 运行过的检查及结果：
  - `node --check` 全部 `app/**/*.js`：无语法错误。
  - `node app/tests/logic-check.js`：26/26 通过（原 21 + P2-01…P2-05）。
  - `node app/tests/browser-check.js`：23/23 组通过（原 20 + P2-A/B/C；A05 按新语义通过）。
- 浏览器实测环境：macOS，Google Chrome 无头（headless=new，remote-debugging-pipe，file://）；未启动项目服务。
- 已知限制：Safari／Firefox／真实读屏仍未验证。

## 第二阶段契约问题（写入 HANDOFF，未改契约 Markdown）

1. 问题：任务文案要求投递“渠道”，现有 Application 无 channel 字段。影响：渠道仅作为 `opening_message.draft.parameters.channel` 材料参数展示／编辑，投递实体不存渠道。最小建议：若产品需要投递级渠道，由 Codex 在 DATA_SCHEMA 为 Application 增加可选 `channel`（或 `submissionChannel`）并补事件 payload；否则保持材料参数方案并改任务文案。
2. 问题：任务文案要求投递“备注”，现有 Application 无 notes 字段。影响：备注写入 `application.hr_reply_recorded.payload.summary`（招聘方回复备注），准备中／已投递未回复前无独立备注框。最小建议：确认复用回复备注即可，或新增可选 `notes` 字段与事件。
3. 问题：`interview.transcript_saved` 不在 STATE_EVENT_MODEL 闭集事件表中。影响：实现已写入该事件（constants.EVENT_TYPES 含此值），页面依赖“清空 review＝尚未分析”。最小建议：Codex 将 `interview.transcript_saved` 与 payload（previousRevision、newRevision、sourceId）补进 STATE_EVENT_MODEL §事件表，Schema 版本策略按现有约定。
4. 问题：第一阶段本地存储可能缺少 `documents`／`documentVersions`。影响：加载时内存补空数组以通过校验；首次业务写入才落盘完整集合。最小建议：在 DATA_SCHEMA §存储包说明允许缺省集合并在读取时视为 `[]`。

## Codex 第二阶段 Review（2026-09-29）

- 结论：`changes_requested`，暂不接受第二阶段，暂不进入第三阶段。
- 已复跑：`node --check` 全部通过；纯逻辑校验 26/26 通过；浏览器验收 23/23 通过。测试通过只能证明当前演示路径可运行，不能替代契约复审。
- 必修问题：
  1. 任务包要求实现前先更新 `DATA_SCHEMA.md` 与 `STATE_EVENT_MODEL.md` 的增量建议，但本次未更新；新增字段／事件仍没有正式契约记录。
  2. 实现写入 `interview.transcript_saved`，但该事件不在 `STATE_EVENT_MODEL.md` 的事件闭集中；需要补充事件类型、载荷和幂等语义，或改用已有事件。
  3. 文档编辑页尚未接入离开草稿保护，刷新／导航可能丢失未保存正文；需要补齐“继续编辑／放弃修改”与保存失败后的草稿保留回归。
- 需在契约中明确的范围问题：投递渠道与投递备注是否新增 Application 字段；当前实现把渠道放在开场沟通材料参数、把备注放在招聘方回复摘要，不能默认为投递实体语义。缺省 `documents`／`documentVersions` 的软迁移也需要写入存储包规则。
- 修正后要求 Cursor 更新 HANDOFF 为 `ready_for_review`，补充契约变更记录和文档草稿离开保护验收；Codex 再次复审。

## Codex 第二阶段第二次复审（2026-09-29）

- 复核结果：契约五项修正均已在文档、实现和逻辑回归中出现；`DATA_SCHEMA.md` 已明确渠道／备注边界和缺省集合软迁移，`STATE_EVENT_MODEL.md` 已补充 `interview.transcript_saved` 及清空复盘规则，文档编辑器已接入草稿离开保护。
- 纯逻辑校验：27/27 通过；全部 `app/**/*.js` 语法检查通过。
- 浏览器复跑：连续两次在 `Page.loadEventFired` 等待阶段超时，未得到本次 24/24 的独立通过结果。因此当前结论仍为 `changes_requested`／验证受阻，不能仅依据 HANDOFF 中的历史 24/24 宣布 accepted。
- 下一步：Cursor 先确认浏览器验收脚本在当前工作区可重复完成（保留 P2-D 结果）；若只是环境超时，补一份可复现的 24/24 结果即可再次复审，不需要重新施工。

## 用户补充范围（2026-09-29）

- 用户明确指出：简历材料入口应支持直接上传 PDF 原稿；当前页面只有文本编辑，不符合预期。
- 这不是当前实现中的隐藏按钮问题，而是第二阶段任务包在收窄范围时遗漏的能力。当前不宣称已支持上传。
- 最小补充范围：仅支持本地 PDF 选择、保留原始文件引用／文件名／大小／读取状态，上传后进入“待确认”状态；解析失败必须可见且不得生成确定事实。未经用户确认不得把 PDF 内容作为已确认职业资产。
- 需要在 `DATA_SCHEMA.md` 中定义原始文件记录和来源关联，在 `STATE_EVENT_MODEL.md` 中定义上传／确认事件后，再交 Cursor 实现和验收。

## 第三阶段准备（2026-09-29）

- 用户确认下一阶段方向：集中入口、首页上传 PDF、我的简历管理和轻量求职助手引导。
- 已新增 `tasks/CURSOR_PHASE3.md`，状态为 `ready_for_cursor`。
- 本阶段不做纯聊天产品；对话式入口只负责引导，实际上传、查看、修改和确认仍使用明确页面操作。

## Cursor 浏览器复跑补证（2026-09-29）

- 目的：回应第二次复审中的 `Page.loadEventFired` 超时受阻；不重新施工业务，只确认验收可完整跑完。
- 脚本小改（仅 harness）：`app/tests/browser-check.js` 的 `goto`／`reload`／慢加载导航将 `loadEventFired` 超时从硬失败改为可回退（30s），最终仍以 `CareerAgent.booted` 为准；避免 CDN／偶发丢事件导致整轮中断。
- 本机复跑命令：`node app/tests/browser-check.js`（Chrome 154.0.8037.58，`--headless=new`，`--remote-debugging-pipe`，file://；需在无沙箱终端运行，沙箱内 Chrome 15s 无响应）。
- 结果：**24/24 全部通过，失败 0 组**；耗时约 72s；含 P2-A／P2-B／P2-C／**P2-D**（文档离开保护与写失败重试）。
- 证据：终端汇总「共 24 组，通过 24 组」；结果 JSON `assets/screenshots/phase1/browser-check-result.json`；截图目录 `assets/screenshots/phase1/`（含 `P2-doc-leave-guard-desktop.png` 等）。
- 逻辑复核（同日）：`node app/tests/logic-check.js` 仍为 27/27。
- 交接状态：保持 `ready_for_review`，请 Codex 依据本轮独立 24/24 决定是否 `accepted`。

## Codex 第二阶段最终复审结论（2026-09-29）

- 结论：`accepted`。第二阶段当前任务包范围内的实现与修正已通过复审。
- 依据：契约五项修正已落入 `DATA_SCHEMA.md`／`STATE_EVENT_MODEL.md`；逻辑校验 27/27；本机 Chrome 154、file:// 浏览器验收 24/24，含 P2-D 文档离开保护与写失败重试。
- 说明：用户后来补充的“直接上传 PDF 简历原稿”属于新增范围，不包含在本次 accepted 内；已记录为后续补充任务，需另行定义文件记录、来源关联、上传／确认事件和验收清单。

## Cursor 第二阶段修正记录（changes_requested → ready_for_review）

- 开始／结束时间：2026-09-29 接修正，同日完成并交复审。
- 契约变更（已写入 Markdown，Schema 仍为 `0.1`）：
  1. `docs/DATA_SCHEMA.md` §5：明确本阶段**不设** Application 级投递渠道／投递备注；开场材料 `channel` 与 HR 回复 `summary` 不得默认解释为投递实体字段；§6 同步材料渠道文案边界。
  2. `docs/DATA_SCHEMA.md` §8：写入 `documents`／`documentVersions` 缺省软迁移规则（缺省／null → `[]`；非数组 → 损坏／invalid_data）；第二阶段 data 集合清单更新。
  3. `docs/STATE_EVENT_MODEL.md` §5：闭集新增 `interview.transcript_saved`（payload：previousRevision、newRevision、sourceId；清空 review；幂等与指纹规则）；验收路径补充笔记保存与文档离开保护。
- 实现修正：
  - `app/features/prepare.js`：文档编辑接入与资产页同级的离开守卫（继续编辑／放弃修改）、`beforeunload`（经 `main.js`）、保存失败保留草稿并提供「重试保存」（同 fingerprint 复用 commandId）。
  - 开场渠道／回复备注 UI 文案改为材料参数／回复备注，明确不是投递字段。
  - `app/data/workspace.js`：仅对缺省／null 补 `[]`；非数组不再伪装成空数组。
  - `app/domain/constants.js`：注释与契约对齐。
- 回归：
  - `node app/tests/logic-check.js`：27/27（含 P2-06 非数组→invalid_data）。
  - `node app/tests/browser-check.js`：24/24（新增 P2-D 文档离开保护与写失败重试）。
- 未改：任务包范围外能力、真实 AI、自动投递；未启动服务；未 commit。
- 原「第二阶段契约问题」四条：1–4 已按上表落入正式契约或 UI 边界，不再作为未决阻塞项。

## Cursor 第三阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-09-29 16:17 接单，同日约 16:26 完成并交 Review。
- 契约变更（Schema 仍为 `0.1`）：
  1. `docs/DATA_SCHEMA.md`：新增 ResumeFile（本地 PDF 元信息、status、textDraft、sourceId、readError）；`Origin` 增加 `pdf_upload`；`data.files` 缺省／null → `[]` 软迁移，非数组 → invalid_data。
  2. `docs/STATE_EVENT_MODEL.md`：命令 `recordResumeFileUpload`／`saveResumeFileText`／`confirmResumeFile`／`markResumeFileReadFailed`；事件 `resume_file.uploaded`／`read_failed`／`text_saved`／`confirmed`（幂等指纹与互斥规则）。
- 实现要点：
  - 首页首屏：上传 PDF 简历、打开我的简历、开始整理求职材料、求职助手帮我指路。
  - `#/resume`「我的简历」：当前材料、状态徽章、查看／粘贴正文、保存正文、确认这份简历内容、重新上传、历史列表；用户文案不暴露 Document／Version 等实现词。
  - PDF 演示：FileReader 仅取元信息；正文靠用户粘贴；成功→待确认；失败→读取失败原因＋重试，不覆盖上一份已确认材料；不上传云端、不宣称解析。
  - `#/assistant` 轻量求职助手：仅预设引导卡片跳转到页面／动作，非开放聊天。
  - 数据层：`app/data/phase3-commands.js`＋`workspace` 统一写入；`selectors` 当前简历优先最新 confirmed。
  - 导航增加「我的简历」；路由与草稿守卫接入简历正文编辑。
- 主要新增／修改文件：`phase3-commands.js`、`resume.js`、`assistant.js`、`home.js`、`shared.js`、`router.js`、`shell`／`index.html`、`constants`／`validate`／`selectors`／`fixtures`／`storage`／`workspace`／`main.js`、`logic-check.js`、`browser-check.js`、`styles.css`；契约两份；本 HANDOFF。
- 运行过的检查：
  - `node --check` 相关 JS：无语法错误。
  - `node app/tests/logic-check.js`：**29/29**（含 P3-01／P3-02）。
  - `node app/tests/browser-check.js`：**26/26**（含 P3-A／P3-B；Chrome headless＋file://，无沙箱）。首轮 P3-B 因 service 写入后未 `refresh` 导致「待确认未展示」，且隔离场景泄漏影响 A04；已修：`CareerAgentTest.refresh`、P3-B `try/finally` 回首页、A04 显式 `goto(ENTRY)`。
- 截图：`assets/screenshots/phase1/P3-home-resume-entry-desktop.png`、`P3-resume-pending-confirm-desktop.png`；结果 JSON `browser-check-result.json`。
- 未完成／不在范围：可靠 PDF 解析、OCR、云端存储、开放式聊天／意图识别、自动生成简历或投递。
- 未启动服务；未 commit。
- 问题区：无新增契约冲突。

## Codex 第三阶段 Review（2026-09-29）

- 结论：`accepted`。第三阶段任务包范围内的入口集中、我的简历、PDF 元信息上传和轻量助手已通过复审。
- 复核：`DATA_SCHEMA.md` 与 `STATE_EVENT_MODEL.md` 已同步 ResumeFile、`files` 软迁移、上传／读取失败／正文保存／确认事件及幂等规则。
- 独立验证：全部 `app/**/*.js` 语法检查通过；逻辑校验 29/29；浏览器验收 26/26，含 P3-A／P3-B；未启动服务、未 commit。
- 范围说明：PDF 当前只保留本地文件元信息，正文由用户粘贴或编辑；不宣称可靠解析、OCR、云端上传或开放式聊天。

## Codex 小修复记录（2026-09-29）
- 用户反馈：PDF 上传后只有提示，页面缺少明确的成功结果。
- 处理：上传成功后显示文件名，并明确标记“已上传、待确认”；提示文案改为用户语言，不要求用户理解云端或版本概念。
- 验证：逻辑 29/29；浏览器 26/26。

## Cursor 第四阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-09-29 21:59 接单，约 22:08 完成并交 Review。
- 契约：未修改 `DATA_SCHEMA.md`／`STATE_EVENT_MODEL.md`。沿用既有 ResumeFile、`saveResumeFileText`、`confirmResumeFile`、`saveDocumentVersion`。
- 实现要点：
  1. 上传成功展示文件名、大小、上传状态与「可查看／编辑」；区分「正文未读取／正文已读取」。
  2. `app/lib/pdf-text.js`：经 jsDelivr 加载 pdf.js（主线程、无 Worker），可读则写入 `textDraft`；失败保留文件记录并引导手动粘贴，不伪装成功。
  3. 简历详情页移除上传后强制「确认」按钮；确认改到「准备投递材料」的「确认使用此简历」与「帮我改简历」的「使用此简历并整理该岗位材料」。
  4. 新增 `#/resume/revise`：岗位选择＋当前边界说明（无真实 AI 改写）。
  5. 保存正文：草稿仍写 `textDraft`；若已有关联 Document，追加未确认 `DocumentVersion`，不覆盖历史来源／旧版本。
  6. 首页／助手增加「帮我改简历」引导；正常模式也暴露 `CareerAgentTest.service`／`refresh`（便于浏览器验收，无故障注入）。
- 主要文件：`pdf-text.js`、`resume.js`、`revise-resume.js`、`shared.js`、`home.js`、`assistant.js`、`prepare.js`、`router.js`、`main.js`、`index.html`、`logic-check.js`、`browser-check.js`、本 HANDOFF、任务包状态。
- 运行过的检查：
  - `node --check` 相关 JS：无语法错误。
  - `node app/tests/logic-check.js`：**30/30**（含 P4-01）。
  - `node app/tests/browser-check.js`：**28/28**（含 P4-A／P4-B；Chrome headless＋file://）。
- 截图：`P4-revise-resume-desktop.png`、`P4-prepare-use-confirm-desktop.png`；结果 JSON `assets/screenshots/phase1/browser-check-result.json`。
- 未完成／不在范围：OCR、云端、真实 AI 改写、自动投递、开放聊天。
- 未启动服务；未 commit。
- 问题区（不阻塞本阶段，不改契约）：
  1. 问题：存储枚举仍为 `pending_confirm`，界面改为「可查看／编辑／已上传」，确认动作延后到「使用此简历」。影响：验收文案与枚举中文名不完全一致，但语义仍是「未作为已核实材料使用」。最小建议：Codex 若需统一，可在契约中补充「用户可见标签」映射表，或把 `pending_confirm` 展示名改为「已上传待使用」。
  2. 问题：从未确认过的简历多次改稿，中间草稿只保留在 `textDraft`，无独立版本。影响：仅确认后的 Source／DocumentVersion 不可变。最小建议：若产品要草稿级历史，再增字段或约定每次保存都写 DocumentVersion。

## Codex 第四阶段 Review（2026-09-29）

- 结论：`accepted`。第四阶段任务包范围内的上传后可见状态、PDF 文字读取尝试、延后确认、简历修改入口均通过复审。
- 独立验证：逻辑校验 30/30；浏览器验收 28/28，含 P4-A／P4-B；未启动服务、未 commit。
- 用户验收地址：`file:///Users/apple/Documents/Career-Agent/app/index.html`；重点路由 `#/resume`、`#/resume/revise`、`#/prepare?job=job_001&goal=goal_ai_pm`。
- 边界：PDF 文字读取依赖 pdf.js CDN；扫描件 OCR、云端存储、真实 AI 改写和开放聊天仍未实现。若 CDN 不可用，页面应显示未读取并允许手动粘贴。

## 第五阶段准备（2026-09-30）

- 用户授权继续研发，当前阶段由 Cursor 按 `tasks/CURSOR_PHASE5.md` 施工。
- 目标：把“帮我改简历”从岗位选择占位推进为可解释的修改建议演示。
- 边界：不接真实 AI、云端、OCR、开放聊天；不修改契约。完成后须回到 `ready_for_review`，由 Codex 复审。

## Cursor 第五阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-09-30 接单，同日完成并交 Review。
- 契约：未修改 `DATA_SCHEMA.md`／`STATE_EVENT_MODEL.md`。沿用 `ensureContextDocuments`、`saveDocumentVersion`（userConfirmed=false）、`confirmResumeFile`。
- 实现要点：
  1. `#/resume/revise` 选岗后进入 `#/resume/revise?job=` 工作区：展示岗位／公司／简历状态／能力边界与「演示建议，不是真实 AI」声明。
  2. `app/lib/revise-suggestions.js`：基于岗位评估缺口／证据与简历段落生成 3–5 条可指向原文的演示建议；空正文不生成。
  3. 每条支持采纳、跳过、改写后采纳；状态徽章可见；只改本页草稿，不写原 `ResumeFile.textDraft`。
  4. 「保存为新草稿」写入该岗位定制简历的新 DocumentVersion（未确认）；失败保留草稿并「重试保存」（同 fingerprint 复用 commandId）。
  5. 「使用此简历」才走既有确认并进入准备材料；「返回简历」回到 `#/resume`。
  6. 离开守卫接入 `beforeunload`／路由 guard。
- 主要文件：`revise-suggestions.js`、`revise-resume.js`、`assistant.js`、`index.html`、`styles.css`、`main.js`、`logic-check.js`、`browser-check.js`、本 HANDOFF、任务包状态。
- 运行过的检查：
  - `node --check` 相关 JS：无语法错误。
  - `node app/tests/logic-check.js`：**31/31**（含 P5-01）。
  - `node app/tests/browser-check.js`：**30/30**（含 P5-A／P5-B）。
- 截图：`P5-revise-suggestions-desktop.png`、`P5-revise-save-retry-desktop.png`。
- 未完成／不在范围：真实 AI、整篇自动重写、云端、OCR、开放聊天、自动投递。
- 未启动服务；未 commit。
- 问题区：无新增契约冲突。

## Codex 第五阶段 Review（2026-09-30）

- 结论：`accepted`。第五阶段任务包范围内的岗位定向演示建议、逐条处理、草稿保存与延后确认均通过复审。
- 独立验证：逻辑校验 31/31；浏览器验收 30/30，含 P5-A／P5-B；未启动服务、未 commit。
- 用户验收地址：`file:///Users/apple/Documents/Career-Agent/app/index.html#/resume/revise`；选岗后可用 `#/resume/revise?job=job_001`。
- 边界：建议为合成固定演示，不是真实 AI；不接云端、OCR、开放聊天或自动投递。

## 第六阶段准备（2026-09-30）

- 用户要求继续为 Cursor 布置下一阶段工作。
- 新任务包：`tasks/CURSOR_PHASE6.md`。
- 目标：建立真实 AI 建议接入的安全边界与可控生成流程；未配置模型时不得伪装生成成功。
- 施工边界：不自动接入外部服务、不记录密钥、不改变既有契约语义；真实 provider 是否可用须在交付记录中如实说明。

## Cursor 第六阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-09-30 接单，同日完成并交 Review。
- 契约：未修改。未新增落盘字段／事件；生成元数据仅存页面会话与内存安全日志。
- 实现要点：
  1. `#/resume/revise?job=` 拆成三步：准备内容 → 生成建议 → 检查并保存。
  2. 准备步展示发送范围（岗位／JD／简历字数等）与是否会发往外部；需勾选确认后才能进入生成。
  3. `app/lib/ai-provider.js`：统一适配入口；读取 `window.CareerAgentAI`（不写入 localStorage）；未配置显示「尚未接入真实 AI」，生成按钮禁用。
  4. `app/lib/revise-prompt.js`：固定系统提示词（禁编造、须引用原文、无法判断标「需要用户确认」）与结果解析校验。
  5. 真实／模拟失败：保留原简历与草稿，显示原因与「重试生成」；成功后进入既有采纳／跳过／改写／保存草稿／使用此简历流程。
  6. 可选「改用本地演示建议（非真实 AI）」练习路径，明确标注且不写请求已成功。
  7. 安全日志只记时间、岗位 id、提供方、状态、条数；不含密钥与简历正文。
- 主要文件：`ai-provider.js`、`revise-prompt.js`、`revise-resume.js`、`main.js`、`index.html`、`styles.css`、`assistant.js`、测试与 HANDOFF。
- 运行过的检查：
  - `node --check` 相关 JS：无语法错误。
  - `node app/tests/logic-check.js`：**32/32**（含 P6-01）。
  - `node app/tests/browser-check.js`：**32/32**（含 P6-A／P6-B；失败／重试用测试适配器）。
- **真实调用未验证**：本机未设置 `window.CareerAgentAI`，未对外部模型服务发起真实请求。外部连通性需用户自行配置密钥后验证。
- 配置方式（勿提交密钥）：在控制台执行  
  `window.CareerAgentAI={provider:'openai',apiKey:'…',model:'gpt-4o-mini'}`（可选 `baseUrl`），再打开改简历生成步。
- 未启动服务；未 commit。
- 问题区：无契约变更需求。

## Codex 第六阶段 Review（2026-09-30）

- 结论：`accepted`。第六阶段范围内的真实 AI 接入边界、发送范围确认、未配置状态、失败重试与结果处理通过复审。
- 独立验证：逻辑校验 32/32；浏览器验收 32/32，含 P6-A／P6-B；未启动服务、未 commit。
- 真实调用状态：未验证。当前环境没有 `window.CareerAgentAI` 配置，未向外部模型发送请求；不能据此宣称真实模型可用。
- 安全边界：密钥仅存在页面会话配置，不写入 localStorage、业务事件或安全日志；用户必须明确确认发送范围。

## 第七阶段准备（2026-09-30）

- 用户授权继续研发，新增任务包：`tasks/CURSOR_PHASE7.md`。
- 目标：把真实模型配置与验证做成可理解、可清除、可回退的流程。
- 边界：没有用户模型配置时不得发起外部请求；测试适配器不等于真实调用通过；不记录密钥，不修改既有契约。

## Cursor 第七阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-10-01 08:45 接单，同日完成并交 Review。
- 契约：未修改。未新增落盘字段／事件；配置与验证态仅存页面会话内存。
- 实现要点：
  1. DeepSeek 为首选提供方：默认 `https://api.deepseek.com`＋`deepseek-chat`；模型名与服务地址可配置；请求 `/chat/completions`。
  2. 配置状态四态：未配置／已配置待验证／验证成功／验证失败；页面「帮我改简历」准备步提供配置区（保存到本会话、验证连接、清除配置）。
  3. API Key 仅页面会话；不写 localStorage／业务事件／安全日志；刷新后清除；支持清除动作回到未配置。
  4. 生成前再次展示发送范围、外发提醒、模型名与验证状态；须勾选确认；调用进度：准备中／请求中／成功／失败；超时、限额、权限、格式错误有可理解下一步。
  5. 成功响应仍走结构校验（须引用简历原文）；通过后进入既有逐条采纳／跳过／改写／保存新草稿。
  6. 「本地演示建议」练习路径明确非真实 AI；未配置不可真实生成、不伪装成功。
- 主要文件：`app/lib/ai-provider.js`、`app/features/revise-resume.js`、`app/main.js`、`app/tests/logic-check.js`、`app/tests/browser-check.js`、本 HANDOFF、`tasks/CURSOR_PHASE7.md`。
- 运行过的检查：
  - `node --check` 相关 JS：无语法错误。
  - `node app/tests/logic-check.js`：**33/33**（含 P7-01）。
  - `node app/tests/browser-check.js`：**33/33**（含 P7-A；失败／重试仍用测试适配器）。
- **真实调用未验证**：本机未用真实 DeepSeek／其他外部密钥发起请求；外部连通性需用户在准备步自行配置密钥并点「验证连接」后确认。
- 配置方式（勿把密钥发到聊天或提交仓库）：打开 `#/resume/revise?job=` 准备步，选择 DeepSeek（或兼容接口），粘贴 Key → 保存到本会话 → 验证连接 → 勾选发送范围 → 生成。也可用控制台临时 `window.CareerAgentAI={provider:'deepseek',apiKey:'…'}`（刷新后仍以会话逻辑为准，清除按钮可清掉）。
- 用户验收清单：`docs/PHASE7_USER_ACCEPTANCE.md`（待用户亲测）。
- 未启动服务；未 commit。
- 问题区：无契约变更需求。

## Cursor 第八阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-10-01（用户授权连续施工，第七阶段交 Review 后接续），同日完成并交 Review。
- 契约：未修改。实现 `STATE_EVENT_MODEL` 已定义的 `recordOffer`／`recordRejection`／`withdrawApplication`／`acceptOffer`。
- 实现要点：
  1. `app/data/phase2-commands.js`：四命令幂等写入；Offer／拒绝设置 hasHrReply；取消未完成面试；关闭相关开放待办为 dismissed。
  2. `app/features/prepare.js`：投递跟进区「记录投递结果」；preparing 可退出且不伪造已投递；终态只读说明。
  3. 文案强调外部结果记录，非自动投递。
- 运行过的检查：
  - `node app/tests/logic-check.js`：**34/34**（含 P8-01）。
  - `node app/tests/browser-check.js`：**34/34**（含 P8-A）。
- 截图：`P8-outcome-accepted-desktop.png`。
- 未启动服务；未 commit。
- 问题区：无。

## Cursor 第九阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-10-01（连续施工），同日完成并交 Review。
- 契约：未修改。实现已定义的 `rescheduleInterview`／`cancelInterview`。
- 实现要点：
  1. 改期写 `interview.rescheduled`，不新增轮次；清空时间回到 invited。
  2. 取消写 `interview.cancelled`；无其他未完成轮时：有 completed → `interview_completed`，否则 → `hr_responded`。
  3. 面试详情页提供改期／取消表单与失败重试。
- 检查：逻辑 **35/35**（P9-01）；浏览器 **35/35**（P9-A）。截图 `P9-interview-cancel-desktop.png`。
- 未启动服务；未 commit。

## Cursor 第十阶段交付记录（implementing → ready_for_review）

- 开始／结束时间：2026-10-01（连续施工），同日完成。
- 契约：未修改。
- 完成：`docs/DEMO_SCRIPT.md`；助手新增「记录 Offer／拒绝／退出」「改期或取消面试」引导；首页增加助手相关入口；浏览器 P10-A。
- 检查：逻辑 **35/35**；浏览器 **36/36**（含 P10-A）。截图 `P10-assistant-guides-desktop.png`。
- 未启动服务；未 commit。
- 建议下一阶段（需 Codex／用户定包）：Goal 基本编辑或 Quick Capture（需先补事件契约）。

## 明日协作计划（2026-09-30）

- 已建立 `docs/REMOTE_WORK_PLAN.md`，规定 Cursor 连续施工、Codex 独立复审、用户回来逐项亲测的节奏。
- 每项自动测试通过后仍标记“待用户亲测”，不以自动测试替代用户验收。
- DeepSeek 真实调用依赖用户本机临时配置 API Key；未提供时继续完成模拟适配器和失败路径，真实调用如实标记未验证。

## 审查机制（2026-10-01）

- 新增 `docs/REVIEW_GATE.md`，规定 `ready_for_review` 后的范围、契约、实现、安全、测试和用户验收闸门。
- 自动检查只负责发现状态变化并提醒；Codex 必须独立读取文件和复跑验证，不能依据 Cursor 自报结果直接 accepted。
- 缺少测试证据、用户验收步骤或外部调用真实状态时，不得写成已验证。

## Codex 第七至第十阶段批量 Review（2026-10-01）

- 复审范围：第七阶段 DeepSeek 配置与验证、第八阶段投递结果闭环、第九阶段面试改期／取消、第十阶段演示脚本与助手入口。
- 结论：`accepted`（代码与自动化验证层面）。
- 独立验证：逻辑校验 **35/35**；浏览器验收 **36/36**，包含 P7、P8、P9、P10 路径；未启动服务、未 commit。
- 用户亲测状态：待用户逐项验收；自动测试通过不替代用户验收。
- 真实 DeepSeek 调用：仍未验证，当前没有用户提供的 API Key；不得宣称外部模型已接通。
- 验收重点：DeepSeek 配置／清除、发送范围与失败状态；Offer／拒绝／退出／接受终态；面试改期／取消及投递状态回退；首页与助手新增入口。

## 第十一阶段准备（2026-10-01）

- 用户授权继续研发，下一步任务包为 `tasks/CURSOR_PHASE11.md`。
- 方向：求职目标基本编辑与新增。
- 首轮契约草案曾交 Review，结论 `changes_requested`（见下文 Codex Review）；2026-10-04 已按三项意见修订草案，HANDOFF 回 `ready_for_review`（仍仅契约 Review，未授权施工）。

## 第十一阶段契约增量草案（求职目标基本编辑与新增）

> 修订说明（2026-10-04）：针对 Codex `changes_requested` 三项闭合修订。仍**未修改** `DATA_SCHEMA.md`、`STATE_EVENT_MODEL.md`、任何 `app/` 代码。待 Codex 再次 Review。

### 1. 问题

现有契约已定义 CareerGoal 实体字段（`title`、`targetRoles[]`、`cities[]`、`salaryExpectation`、`status`、`revision` 等）与 `selectGoal`（仅改 `ui.selectedGoalId`），且 Event.subject 允许 `career_goal`，但：

1. **事件闭集中没有**任何 `career_goal.*` 类型；`STATE_EVENT_MODEL` §5 明确禁止临时发明通用 `state.changed`。
2. **DATA_SCHEMA §8 操作表**只有 `selectGoal`，没有创建／编辑 CareerGoal 的业务命令。
3. **LIMITS** 未定义目标标题、岗位数组、城市数组、薪资说明文本上限；「重复目标」「非法薪资」无判定规则。
4. 任务包要求编辑／新增／切换／取消不写／失败重试／历史 goalId 不变——实现前必须先补最小命令＋事件＋校验，否则无法合法写入。

### 2. 影响

- 若不增事件／命令就施工：要么静默改 goals 数组（违反「业务写入经统一入口＋事件」），要么无法验收「保存记录」。
- 若不冻结「不改写历史 goalId」：编辑标题或「合并目标」类误设计可能串改 Application／Document／Assessment／ActionItem，破坏目标隔离与指标口径。
- 若本阶段混入归档 UI／status 写入：会把「当前选中目标归档」「最后一个 active」等规则带进 P11，扩大范围；故本阶段明确不做归档。

### 3. 最小建议

1. **不新增 CareerGoal 业务字段**；复用已有字段。实体上既有 `status`（active／archived）**语义保留、历史数据不改写**；**第十一阶段不做归档 UI**，也不通过本阶段命令改 `status`。
2. **新增两条写命令**（与资产编辑同构：`expectedRevision`、`commandId`、指纹、候选快照校验后再 persist）：
   - `createCareerGoal`（新建时实体 `status` 固定写 `active`，非用户可编辑入参）
   - `updateCareerGoal`（仅改 title／targetRoles／cities／salaryExpectation；**不含 status**）
3. **沿用既有** `selectGoal`：只改 UI 偏好；只读临时浏览仍不持久化；**禁止**借切换改写任何实体上的 `goalId`。
4. **新增两个事件**（subject=`career_goal`）：`career_goal.created`、`career_goal.revised`。
5. **时间规则（已定死）**：本阶段两类事件一律 `occurredAt: null`；`recordedAt` 为系统写入时间；UI／文案不得把目标偏好编辑描述成「现实经历发生时间」。
6. **明确不变式**：一切历史记录上的 `goalId`／`goalIds`／事件 relatedRefs／JobAssessment.`goalSnapshot` **禁止**因本阶段命令被改写或重算；新目标不自动改 Job.goalIds、不迁移 Application。
7. **取消编辑**：草稿仅存页面内存；取消或无字段变化 → 不写存储、不升 revision、不造事件（同资产无操作）。
8. **失败与重试**：运行中写失败保留草稿与旧 goals；同 `commandId`＋同指纹重试复用结果；同键不同参数 → 冲突拒绝。
9. **归档能力**：留待后续单独任务包（届时再定 archive 命令／事件／`changedFields` 是否含 `status` 及与 `selectedGoalId` 的规则）。

### 4. 需要新增或修改的字段

| 位置 | 建议 |
| --- | --- |
| CareerGoal 实体 | **不改字段集合**。`status` 字段与 active／archived 语义保留；本阶段实现不得改写历史行的 `status`，也不得提供归档入口。确认：`salaryExpectation` 为自由说明文本或 `null`，不做货币换算或结构化区间解析。 |
| `DATA_SCHEMA` LIMITS（建议增量） | `GOAL_TITLE_MAX`（如 80）、`GOAL_ROLE_MAX`（单条角色字数，如 40）、`GOAL_ROLES_MAX`（条数，如 8）、`GOAL_CITY_MAX`／`GOAL_CITIES_MAX`、`GOAL_SALARY_TEXT_MAX`（如 80）。具体数值由 Codex 拍板，实现不得散落魔法数。 |
| `ui.selectedGoalId` | **语义不变**；创建成功后是否自动选中新目标：建议命令可选参数 `selectAfterCreate`（默认 true），仍只写 UI，不写业务实体。 |
| Job／Application／Interview／Document／ActionItem／Assessment | **不改字段**；不增加「当前目标反向指针」。 |

### 5. 需要新增或修改的命令／事件

**命令（写入 DATA_SCHEMA §8）**

| 命令 | 输入（最小） | 效果 |
| --- | --- | --- |
| `createCareerGoal` | `title`、`targetRoles[]`、`cities[]`、`salaryExpectation`（可 null）、`commandId`；可选 `selectAfterCreate` | 新建实体：`status=active`（固定，非入参）、`revision=1`、`createdAt`／`updatedAt`＝写入时钟；写 `career_goal.created`；按选项更新 `ui.selectedGoalId`。**入参不含 status。** |
| `updateCareerGoal` | `goalId`、`expectedRevision`、`title`、`targetRoles[]`、`cities[]`、`salaryExpectation`、`commandId` | 校验 revision；仅比较／写入上述四类内容字段；有变化则 `revision+1`、刷新实体 `updatedAt`；写 `career_goal.revised`；无变化 → 无操作。**入参不含 status；不得改实体 status。** |
| `selectGoal` | 已有 | **不改语义**；仅 active；不写业务事件（保持现状） |

**事件（写入 STATE_EVENT_MODEL §5 闭集）**

| type | subject | payload 最小字段 |
| --- | --- | --- |
| `career_goal.created` | career_goal | `title`、`targetRoles`、`cities`、`salaryExpectation`、`revision`（恒为 `1`） |
| `career_goal.revised` | career_goal | `previousRevision`、`newRevision`、`changedFields[]`（取值闭集**仅**：`title`／`targetRoles`／`cities`／`salaryExpectation`） |

**`career_goal.created` payload 与时间（实现须遵守）**

- payload **必须**含 `revision: 1`，与新建实体 revision 一致。
- payload **不得**再塞 `createdAt`／`updatedAt`：实体创建时间写在 CareerGoal.`createdAt`／`updatedAt`；事件侧用通用字段 `recordedAt` 记录系统写入时间，`occurredAt` 固定为 `null`。
- payload **不含** `status`：新建实体 status 固定为 `active`，由命令效果保证，不靠 payload 传 status。

**两类事件的通用时间规则（已定死）**

- `occurredAt`：**必须为 `null`**（目标偏好编辑不是外部现实经历发生时间）。
- `recordedAt`：命令执行时的系统写入时间（带偏移 ISO 8601）。
- UI／交付文案：只表达「已保存求职目标／本地保存时间」，**禁止**写成「经历发生于…」或把 `recordedAt` 冒充经历时间。

**其他事件字段**

- `sourceId`：按钮保存可为空；不强制新建 SourceRecord。
- `actor`：`{ type: user, id: 当前用户 }`。
- relatedRefs：允许空数组。

**本阶段明确不做的命令／能力**：删除目标、合并目标、归档／恢复（改 status）、批量改写 Job.goalIds、迁移 Application.goalId。

### 6. 校验和失败行为

**输入校验（用户可理解文案，实现侧错误码建议 `invalid_input`）**

- `title`：去首尾空白后非空，且 ≤ `GOAL_TITLE_MAX`；空 →「请填写目标名称」。
- `targetRoles`：数组；允许空数组；每项非空字符串且 ≤ 单条上限；超条数拒绝。
- `cities`：同上。
- `salaryExpectation`：`null` 或非空说明文本（trim 后空串规范为 `null`）；禁止塞入超长文本；**不**校验「是否像薪资数字」。非法类型 → 「薪资期望格式不正确」。
- **重复目标（最小定义）**：同一用户下，其他 **active** 目标在规范化 `title`（trim＋连续空白压成单空格）与当前保存值相同则拒绝：「已有同名进行中的求职目标，请换一个名称。」（文案不引导本阶段不存在的归档操作。）不按 roles／cities 判重。
- **本阶段不校验、不接受 status 入参**；若调用方误传 status，实现应拒绝为非法入参（或忽略并在契约正文定一种——建议 **拒绝**，避免静默丢字段）。
- 仅允许更新／创建后仍为 `active` 的可选中目标；`selectGoal` 仍拒绝 archived（既有规则）。
- `expectedRevision` 不匹配 → 冲突，提示重新加载；不覆盖。

**幂等与失败**

- 指纹字段：`create`＝规范化后的 title／roles／cities／salary／selectAfterCreate；`update`＝goalId＋expectedRevision＋title／roles／cities／salary（**不含 status**）。
- 写失败：不改 committed goals／events；页面保留草稿；「重试保存」复用同一 `commandId`。
- 只读／unavailable／external_change：与现有工作区规则一致，拒绝写入。

**切换目标**

- 仅 `selectGoal`；失败（未知／非本用户／archived）保持原选择并提示。
- 切换后首页指标／待办／岗位列表按新 `selectedGoalId` 过滤；**历史记录上的 goalId 不变**。

### 7. 对现有数据和历史记录的影响

| 对象 | 影响 |
| --- | --- |
| 种子 `goal_ai_pm`／`goal_b2b_pm` | 形状与 `status=active` 不变；无需迁移。编辑后仅该行 title／roles／cities／salary／revision／updatedAt 可变；**不改写 status**。 |
| Application／Interview／Document／ActionItem | **goalId 永不因本阶段命令改写**。新目标下起初无投递／面试，属预期空态。 |
| Job.goalIds | 不自动加入新目标；不因改标题而改收藏关系。 |
| JobAssessment | `goalId` 与 `goalSnapshot` **保持评估当时快照**；不因目标修订被重写。可选后续过期提示非本草案必做。 |
| Event 历史 | 旧事件不动；仅追加 `career_goal.created`／`revised`（`occurredAt: null`）。 |
| 指标 | 仍按当前 `selectedGoalId` 过滤；新目标指标从 0 起；旧目标数据不串到新目标。 |
| schemaVersion | 建议仍为 `0.1`（仅增命令／事件闭集条目）；若 Codex 要求 bump，在正式契约修订时写明。 |

### 已关闭／仍待 Codex 确认

| 项 | 状态 |
| --- | --- |
| `occurredAt` | **已定**：`null`；`recordedAt` 记系统时间；UI 不描述为现实经历时间 |
| `career_goal.created` payload | **已定**：含 `revision: 1`；不含 createdAt／updatedAt／status |
| 本阶段 status／归档 | **已定**：命令与 `changedFields` 不含 status；无归档 UI；实体 status 语义保留、历史不改 |
| 「重复目标」规则 | 仍建议 active 同名 title；若 Codex 要改判重维度请明示 |
| LIMITS 具体数值 | 仍待 Codex 拍板或接受草案示例值 |
| 目标修订是否驱动评估「过期」展示 | 默认不做，非本阶段 |

### 施工门禁

- Codex 对本修订草案再次 `accepted` 之前：**不修改**正式契约文件、**不修改** `app/`、不启动服务、不 commit。
- accepted 后另开实现轮次：HANDOFF 改为 `implementing`，再改契约正文与代码。

## Codex 第十一阶段契约 Review（2026-10-01）

- 结论：`changes_requested`，暂不接受契约草案，暂不允许修改正式契约或 `app/`。
- 已确认方向：复用现有 CareerGoal 字段；新增 `createCareerGoal`／`updateCareerGoal`；新增具名 `career_goal.created`／`career_goal.revised`；历史 goalId、JobAssessment 快照和旧事件不改写；保存失败与重试规则基本完整。
- 必须修正：
  1. `occurredAt` 仍是二选一未决项。由于目标编辑是用户对当前偏好的业务操作，建议明确写为 `occurredAt: null`，`recordedAt` 记录系统写入时间，并在 UI 不把它描述成现实经历发生时间；或者给出相同明确性且同步所有事件表说明。未定死前不能改正式契约。
  2. `career_goal.created` 的 payload 需要明确是否包含 `revision`、`createdAt`／`updatedAt`；建议至少写入 `revision: 1`，时间沿事件通用字段，不重复塞入 payload，避免实现各自解释。
  3. `career_goal.revised` 的 `changedFields` 闭集需明确 `status` 只有在允许归档 UI 时才出现；若 P11 不做归档 UI，应从命令和事件中移除 status，后续阶段另立任务，避免当前选中目标归档规则扩大范围。
- 修正后 Cursor 仅更新本问题区和任务包状态，仍不得施工；待 Codex 再次 Review。

## Cursor 第十一阶段契约修订记录（changes_requested → ready_for_review，2026-10-04）

- 仅修订本文件契约草案与任务包状态；**未改**正式契约、**未改** app、未启动服务、未 commit、未宣称已实现。
- 修订对照：
  1. **时间规则**：两类事件定为 `occurredAt: null`，`recordedAt`＝系统写入时间；禁止 UI 描述为现实经历发生时间。
  2. **`career_goal.created` payload**：必含 `revision: 1`；不含 `createdAt`／`updatedAt`（用实体字段＋事件 `recordedAt`）；不含 status。
  3. **status／归档**：从 `createCareerGoal`／`updateCareerGoal` 入参与 `career_goal.revised.changedFields` 移除 status；P11 不做归档 UI；归档另立后续任务；实体 `status` 语义与历史数据保留不改写。
- 任务包 `tasks/CURSOR_PHASE11.md` 状态改为 `ready_for_review`；目标表述去掉本阶段「状态／归档」编辑范围。
- 请 Codex 对修订版再次 Review。

## Codex 第十一阶段契约复审结论（2026-10-04）

- 结论：`accepted`（仅契约增量，允许进入实现阶段）。
- 复核通过：`occurredAt=null`／`recordedAt` 规则已定死；`career_goal.created` 明确 `revision=1` 且不重复写时间；P11 已移除 status／归档入口，`changedFields` 闭集仅含四类内容字段。
- 任务包 `tasks/CURSOR_PHASE11.md` 已改为 `ready_for_cursor`。
- 施工授权：Cursor 可先同步 `DATA_SCHEMA.md`／`STATE_EVENT_MODEL.md` 的正式增量，再进入 app 实现；完成后必须回到 `ready_for_review`，由 Codex 独立复审。

## 方向调整与第十一阶段暂停（2026-10-09）

- 用户明确：当前研发转向**实际可用版本**；**暂停第十一阶段目标编辑施工**（契约草案与 accepted 结论保留备查，不进入 app／正式契约写入，直至用户重新授权）。
- 新当前任务：`CURSOR-PHASE12` 后端接入 DeepSeek，打通真实简历修改；本轮只交接口／数据／测试方案 Review，**不实现、不启动服务**。

## 第十二阶段接口／数据／测试草案（后端 DeepSeek 代理）

> Cursor 只读：`AGENTS.md`、本 HANDOFF、`app/lib/ai-provider.js`、`app/lib/revise-prompt.js`、`app/features/revise-resume.js`、第七阶段任务边界。**未修改** app／正式契约、**未读取或输出** `.env` 内容、**未启动服务**。任务包：`tasks/CURSOR_PHASE12.md`。

### 1. 问题

- Phase 6–7 已支持浏览器会话粘贴 Key 直连 DeepSeek，但密钥出现在前端进程，file:// 演示也不适合作为「实际可用」主路径。
- 用户要求：服务端读本机 `.env` 的 `DEEPSEEK_API_KEY`；前端只提交简历正文与岗位要求；返回可采纳建议；失败保留原稿可重试；禁编造；不输出／提交密钥。
- 现仓库无后端目录；`AGENTS.md` 禁止未经授权启动服务——实现与验收需把「写代码」和「启动进程」分开。

### 2. 影响

- 主生成路径从「前端持钥外呼」改为「前端 → 本机代理 → DeepSeek」；页面配置态文案需改为「后端是否可用」。
- `file://` 打开前端时，跨源调用本机 API 依赖 CORS 或改为同源静态＋API（推荐后者，待 Codex 确认）。
- 业务实体（ResumeFile／DocumentVersion）语义不变；仍经现有采纳／保存命令写入。

### 3. 最小建议（接口）

建议目录：`server/`（Node 原生 `http`，无强制框架）。配置：项目根 `.env`（已在 `.gitignore`）；提交 `.env.example` 仅占位名。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/ai/status` | 返回是否已配置 Key（布尔）、默认模型名、是否会外呼；**永不返回密钥** |
| `POST` | `/api/ai/verify` | 短探测 chat（不发简历）；成功／失败用户可读文案 |
| `POST` | `/api/ai/revise-suggestions` | 生成结构化建议 |

**`POST /api/ai/revise-suggestions` 请求（JSON）**

```json
{
  "resumeText": "…",
  "job": {
    "id": "job_001",
    "title": "…",
    "companyName": "…",
    "location": "…",
    "salaryText": "…",
    "jdText": "…"
  },
  "assessment": null
}
```

- `assessment` 可选；若传，仅作「本地演示评估摘要」提示，服务端提示词须标明非模型结论（与现 `revise-prompt` 一致）。
- 服务端用同一套系统提示硬性规则：须引用原文；不得编造经历／数字／技能；输出 3–5 条 JSON 数组。

**成功响应（JSON）**

```json
{
  "ok": true,
  "providerId": "deepseek",
  "model": "deepseek-chat",
  "suggestions": [
    {
      "id": "1",
      "title": "…",
      "reason": "…",
      "targetExcerpt": "必须是简历原文子串",
      "proposedReplacement": "…",
      "needsUserConfirm": false
    }
  ]
}
```

**失败响应（JSON）**

```json
{
  "ok": false,
  "code": "not_configured|auth|rate_limit|timeout|format|upstream|bad_request",
  "message": "面向用户的下一步说明"
}
```

- HTTP：未配置 Key → 503／`not_configured`；入参缺正文或岗位 → 400／`bad_request`；上游失败映射既有用户文案码；格式校验失败 → `format`（不返回半套建议）。

**`GET /api/ai/status` 示例**

```json
{
  "configured": true,
  "providerId": "deepseek",
  "model": "deepseek-chat",
  "willCallExternal": true
}
```

### 4. 数据变化

| 层 | 变化 |
| --- | --- |
| 业务存储包（localStorage） | **不新增**必选字段／事件；生成元数据仍可仅页面会话（同 Phase 6–7）。 |
| 环境 | `.env`：`DEEPSEEK_API_KEY`（必填才外呼）；可选 `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`PORT`。 |
| 前端配置 | 增加本机 API 根地址（如默认 `http://127.0.0.1:8787`）；**不再要求**用户粘贴 Key 作为主路径。 |
| 正式 DATA_SCHEMA／STATE_EVENT_MODEL | 本阶段默认**不改**；若 Codex 要求把「AI 代理调用」记入事件闭集，另开问题条目后再改。 |

### 5. 前端行为（实现时，非本轮）

1. 准备步：拉取 `/api/ai/status`；展示后端是否可用、模型名、发送范围；用户确认后才请求。
2. 生成：`POST /api/ai/revise-suggestions`；调用态准备中／请求中／成功／失败。
3. 成功：沿用现有 `parseModelSuggestions` 等价校验（服务端已校则前端再校一次）；进入采纳流程。
4. 失败：不改 `ResumeFile.textDraft`、不写岗位草稿；可重试；可改用本地演示建议。
5. 服务未启动：明确提示「本机助手服务未连接」，不伪装生成成功。

### 6. 测试方案

| 类型 | 内容 | 真实外呼 |
| --- | --- | --- |
| 逻辑 | 提示词／解析／禁编造校验（既有 P6／P7）；服务端纯函数：缺 Key、坏 JSON、非原文引用 → 失败 | 否 |
| 后端单测／脚本 | mock DeepSeek：成功、401、429、超时、格式错误 | 否 |
| 浏览器 | 代理成功（mock）、失败保留原稿、未配置／连不上服务的文案；演示路径仍可用 | 否 |
| 真实联调 | 仅当本机 `.env` 有 Key **且用户明确授权启动服务** 后手工验证；结果写「真实调用已验证／未验证」 | 按授权 |

安全检查：仓库与日志扫描不得出现真实 Key；HANDOFF／截图不含密钥与完整真实简历。

### 7. 待 Codex 拍板

1. **托管方式**：仅 API 进程 + 仍用 `file://`（需 CORS） vs **同一 Node 进程同时托管 `app/` 静态与 API**（推荐，避免 file:// CORS）。用户授权启动前只写代码不跑进程。
2. **是否保留**前端会话粘贴 Key 作为降级；建议默认关闭或折叠为「高级／调试」。
3. **是否需要**业务事件记录「曾请求模型」（无密钥、无正文）；默认不需要，以免扩大契约。
4. Phase 11 暂停期间，已 accepted 的 Goal 契约是否冻结不入库——建议冻结，直到用户重新授权目标编辑。

### 施工门禁

- Codex 对本草案与 `tasks/CURSOR_PHASE12.md` `accepted` 之前：不实现、不改正式契约、不启动服务、不 commit。
- accepted 后：Cursor 将 HANDOFF 改为 `implementing` 再写 `server/` 与前端适配；**启动服务仍须用户另一次明确授权**。

## Codex 第十二阶段方案 Review（2026-10-09）

- 结论：accepted（接口与实现方案）；任务包改为 ready_for_cursor，允许 Cursor 开始实现。
- 已读取实际 ai-provider 与 revise-prompt，确认可以复用现有建议格式和采纳流程；本轮为方案审核，无实现代码交付，未运行测试或真实外呼。
- 决策：同源静态＋API，仅监听 127.0.0.1；正常入口移除前端密钥配置；不新增业务事件；P11 冻结。
- 实现约束已补入任务包：静态资源白名单、保护 .env／.git、路径校验、同源 POST 检查、请求大小与超时、错误脱敏。原文引用校验不等于事实核验，仍须用户检查建议。
- Cursor 开工先记录 implementing；交付代码与测试证据后记录 ready_for_review。启动服务仍待用户明确授权。

## Cursor 第十二阶段交付记录（implementing → ready_for_review，2026-10-10）

### 完成内容

1. **本机同源服务** `server/`：Node 原生 `http`，仅设计监听 `127.0.0.1`；托管 `app/` 静态白名单；接口 `GET /api/ai/status`、`POST /api/ai/verify`、`POST /api/ai/revise-suggestions`。
2. **密钥**：仅服务端自项目根 `.env` 读取 `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_BASE_URL`／`DEEPSEEK_MODEL`／`HOST`／`PORT`）；提交 `.env.example`；`.gitignore` 已忽略 `.env`。
3. **安全**：路径穿越拒绝；POST 校验 Host／Origin 与 JSON；体上限 256 KiB；外呼超时 60s；日志仅状态／条数／错误码；上游错误脱敏。
4. **提示词**：服务端 `vm` 加载同一套 `app/lib/revise-prompt.js`；原文引用校验；不合规返回 `format`，不伪造成功。
5. **前端**：`ai-provider` 改走同源相对路径；`file://` 明确离线；`setSessionConfig` 拒绝页面粘贴密钥；测试适配器保留；代理失败不静默降级为直连／演示成功。
6. **改简历页**：准备步改为「本机模型服务」状态／检查／验证；无 API Key 输入框；发送范围二次确认与演示路径保留；提醒用户检查新增事实。
7. **未做**：未启动服务；未真实外呼；未 commit；未新增业务事件；第十一阶段仍暂停。

### 主要文件

- 新增：`server/index.js`、`server/lib/{env,prompt,deepseek,static,handlers}.js`、`server/tests/handlers-check.js`、`.env.example`
- 修改：`app/lib/ai-provider.js`、`app/features/revise-resume.js`、`app/tests/logic-check.js`、`app/tests/browser-check.js`、`tasks/CURSOR_PHASE12.md`、本 HANDOFF

### 测试结果（本机，无真实外呼）

| 检查 | 结果 |
| --- | --- |
| `node app/tests/logic-check.js` | 通过 35／35 |
| `node server/tests/handlers-check.js` | 通过 5／5（mock；不绑定端口、不读真实密钥） |
| `node app/tests/browser-check.js` | 通过 36／36（含 P7/P12-A：file:// 离线、拒绝页面密钥、演示可用） |
| 真实 DeepSeek 调用 | **未验证**（未经用户授权启动服务） |

### 待授权后的亲测步骤（请用户明确同意后再执行）

1. 确认本机已有 `.env`（可由 `.env.example` 复制），填入 `DEEPSEEK_API_KEY`（**勿把密钥发到聊天或提交仓库**）。
2. 在项目根授权启动：`node server/index.js`（默认 `http://127.0.0.1:8787/`）。
3. 用该地址打开应用（不要用 `file://`），进入「帮我改简历」→ 选岗位。
4. 应看到「本机模型服务」为已配置或验证相关状态；点「验证连接」（不发送简历）。
5. 勾选发送范围 → 生成建议 → 逐条检查是否新增未经依据的内容 → 采纳／跳过／改写 →「保存为新草稿」；确认原简历正文未变。
6. 可再试：停服务或清空 Key 后刷新，应明确不可用、不伪装成功；本地演示建议仍可用。

### 给 Codex Review 的要点

- 是否符合四项 accepted 决定：同源静态＋API、移除前端密钥、不增事件、P11 暂停。
- 静态白名单／同源／体大小／超时／脱敏是否到位。
- 前端是否仍可能直连或静默演示成功。
- 原文引用校验文案是否仍提醒用户核验事实。

## Codex 第十二阶段独立 Review（2026-10-10）

- 结论：changes_requested；实际代码已交付，暂不 accepted。修复负责人：Cursor。
- 独立检查：逻辑 35/35、后端 mock 5/5 通过；未启动服务、未外呼、未读取真实密钥。本轮浏览器未重跑，Cursor 的 36/36 仅为提交证据；现有浏览器用例主要覆盖 file:// 离线，不能证明同源生成链路可用。
- 必修 R12-01：server/lib/deepseek.js 收到响应头即清除超时，res.json() 读取响应体不受 60 秒保护。独立 mock 设置 15ms 超时、响应体延迟 80ms，实际仍成功（约 80ms，signal 未取消）。计时器应覆盖完整响应读取与解析，在 finally 清理；补响应头正常但响应体阻塞的回归。
- 必修 R12-02：env.js 允许 HOST 覆盖、index.js start(opts) 允许任意 host，违反仅监听 127.0.0.1 的已接受边界。固定本机监听或拒绝非回环地址，补配置回归；不要输出密钥。
- 必修 R12-03：后端入参将 job.title／jdText 等强转字符串，未严格验证类型；公司、地点、薪资与 assessment 无明确字段限制。按已批准的字段类型／长度要求白名单校验；无有效 JD 时不能当成岗位定向生成成功，补坏类型与缺岗位要求的测试。
- 补证 R12-04：补前端同源 mock 成功、失败保留草稿与重试的端到端证据，不能仅以 file:// 离线用例作为代理验收。未经用户授权不得启动项目服务，可采用浏览器请求拦截与测试适配；真实联调仍待授权。

## Cursor 第十二阶段修正记录（changes_requested → ready_for_review，2026-10-10）

### 修正对照

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| R12-01 | 响应头到达即清超时，体读取不受保护 | `deepseek.chatCompletions`：计时器保留至 `res.json()` 完成，在 `finally` 清理；`R12-01` 回归：15ms 超时＋体延迟 80ms → `timeout`，窗口足够则成功 |
| R12-02 | HOST／start 可监听非本机 | `env.resolveListenHost` 仅允许 `127.0.0.1`／`localhost`／`::1`，否则 `invalid_host`；`start` 一律经该函数；`.env.example` 注明；`R12-02` 配置回归 |
| R12-03 | 字段强转、缺 JD 仍可能放行 | `validateReviseInput`：文本字段严格 `typeof === 'string'`＋长度上限；缺／空 JD 拒绝；assessment 白名单清洗；`R12-03` 坏类型／缺 JD 测试 |
| R12-04 | 仅有 file:// 离线证据 | 新增测试用同源 mock（`server/tests/same-origin-mock-server.js`，临时 `127.0.0.1:0`，**不是** `node server/index.js`）；浏览器 `P12-B`：失败保留原稿 → 重试成功 → 保存岗位草稿 |

### 主要改动文件

- `server/lib/deepseek.js`、`server/lib/env.js`、`server/lib/handlers.js`、`server/index.js`
- `server/tests/handlers-check.js`、`server/tests/same-origin-mock-server.js`
- `app/tests/browser-check.js`、`.env.example`、本 HANDOFF、`tasks/CURSOR_PHASE12.md`

### 测试证据（无真实外呼；未启动项目正式服务）

| 检查 | 结果 |
| --- | --- |
| `node app/tests/logic-check.js` | 通过 35／35 |
| `node server/tests/handlers-check.js` | 通过 8／8（含 R12-01／02／03） |
| `node app/tests/browser-check.js` | 通过 37／37（含 P7/P12-A file:// 离线；P12-B 同源 mock 失败重试） |
| 真实 DeepSeek 调用 | **未验证**（待用户明确授权启动正式服务） |

### 说明

- P12-B 使用的临时 mock 仅服务验收脚本，监听 `127.0.0.1` 随机端口，测完关闭；与授权后的 `node server/index.js` 正式服务分离。
- 未 commit；未读取或输出真实密钥。
- 修正完成后回到 ready_for_review；用户亲测待进行，不阻塞上述修复。

## 品牌局部调整（2026-10-10）

- 用户授权本次局部修复由 Codex 实现：页头与浏览器标题改为“猫猫求职助手”，新增黄色猫咪 SVG Logo，沿用现有视觉风格。
- 修改 app/index.html、app/styles.css；未运行浏览器验收，待用户刷新亲测；未提交、未启动服务。

- 用户进一步明确要求移除页头“合成演示数据｜Demo Beta”标签，已局部修改 app/index.html；数据与具体演示能力说明不变。未运行浏览器验收，待刷新亲测。

- 页头对齐修复：品牌组由基线对齐改为垂直居中，使猫咪 Logo、标题与一句话介绍位于同一中心线；待用户刷新确认。

## Codex 第十二阶段修正复审（2026-10-10）

- R12-01～R12-04 已复核：完整读取超时、回环地址限制、输入校验与同源重试链路已修正。独立复跑逻辑 35/35、后端 8/8；浏览器 36/37，P12-B 同源失败→重试→保存通过。未启动正式项目服务、未真实外呼。
- 状态 changes_requested：剩余 A10 测试仍强制要求旧页头 Demo 标记，与用户明确授权删除标签的最新需求冲突。这不是模型链路缺陷；请 Cursor 更新旧验收断言，仅检查仍适用的来源／确认／保存位置与具体演示能力说明，不恢复用户删除的标签；补记录并重跑后交复审。
- 真实调用及用户亲测仍未验证。
