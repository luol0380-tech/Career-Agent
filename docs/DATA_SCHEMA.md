# V1 数据契约

版本：`0.1`；日期：2026-09-29。这里定义字段语义，不要求第一阶段建数据库或实现全部对象的编辑界面。

## 1. 通用约定

- 对象名使用 PascalCase，字段使用 camelCase，枚举值使用 snake_case，事件类型使用 `对象.已发生动作`。中文展示名与代码标识分离。
- `id` 为稳定、无业务含义的字符串，不能以数组位置、公司名或标题代替。合成 fixture 可用 `job_001` 等固定 ID。
- 除 User 外的业务记录都有 `userId`。所有引用必须存在且属于同一用户；不会因 Mock 只有一个用户而免除校验。
- 时间戳使用带偏移量的 ISO 8601，如 `2026-09-30T15:00:00+08:00`；界面按 User.timeZone 显示。不明确的时间使用 null，不猜测。
- `createdAt` 表示记录创建时间；可编辑实体另有 `updatedAt`。历史发生时间独立记录，不用 createdAt 代替。
- 未知值为 null，集合为空用 `[]`；`0`、空文本、null 不互相冒充。必填引用不能为 null。
- `revision` 从 1 开始，每次实际保存事实内容或确认状态变化递增；取消或无变化保存不递增。
- 第一阶段只实现下述对象中当前页面所需的字段、读取和职业资产编辑。第二阶段对象只冻结语义，不预先实现空框架。

## 2. User 与 CareerGoal

| 对象 | 字段 | 规则 |
| --- | --- | --- |
| User | id、displayName、timeZone、createdAt | 演示用户，不代表完成登录；timeZone 默认 Asia/Shanghai |
| CareerGoal | id、userId、title、targetRoles[]、cities[]、salaryExpectation、status、revision、createdAt、updatedAt | 一人多目标；status 为 active／archived；salaryExpectation 为说明文本或 null，不自行换算薪资口径 |

`selectedGoalId` 存在独立 UI 偏好中，不是 User 的业务状态。切换目标不能修改 Application、Interview 或 Document 的归属。已被历史记录引用的目标归档后仍保留。

## 3. 来源、事实与职业资产

Career Vault 是当前用户 CareerAsset、来源以及文档入口的聚合视图，无需创建一个包含所有内容的可变大对象。

### SourceRecord

字段：`id、userId、kind、label、rawText、capturedAt、createdAt`。

- kind：`demo_fixture | manual_entry | pasted_text | pdf_upload`。
- `pdf_upload`：对应当地选择的 PDF 简历上传；rawText 为用户粘贴／编辑的文本摘录（可空字符串），**不代表已完成版式解析或 OCR**。
- rawText：合成来源或用户手工输入原文；保存后不可直接覆盖，修正创建新来源。
- capturedAt：原始输入被记录的时间；不自动代表现实事件发生时间。

### ResumeFile（第三阶段：本地 PDF 简历文件记录）

字段：`id、userId、fileName、byteSize、mimeType、status、readError、textDraft、sourceId、documentId、createdAt、updatedAt`。

- 仅保存元信息与用户可编辑文本草稿；**不**把 PDF 二进制写入业务存储包（避免配额与隐私风险）。
- status：`pending_read | pending_confirm | confirmed | read_failed`。
  - `pending_read`：已选择文件、正在校验可读性。
  - `pending_confirm`：文件可读（或已接受元信息），内容待用户确认；界面必须标「待确认」，不得当作肯定职业事实。
  - `confirmed`：用户明确确认后；此时须有关联 `sourceId`，并允许同步到基础简历 Document 的新版本（该版本的 userConfirmed 随确认动作）。
  - `read_failed`：选择后无法读取；`readError` 为面向用户的原因文案；**不得**覆盖或删除上一份非失败记录作为当前材料。
- mimeType 期望为 `application/pdf`；演示阶段拒绝非 PDF。
- byteSize 为正整数；超过演示上限（见 LIMITS）时拒绝写入并提示。
- documentId：关联的基础简历 Document（variant=base）；可在确认时绑定。
- sourceId：确认成功后指向 `pdf_upload` 来源；未确认时为 null。
- textDraft：用户粘贴或编辑的简历文本；确认前可反复保存草稿；确认时写入来源 rawText 与文档版本。
- 「当前简历」派生规则：优先最新一份 `confirmed`；若无则取最新 `pending_confirm`／`pending_read`；`read_failed` 不当作当前可用材料，但保留在历史上传列表中供查看失败原因。
- 重新上传：新建 ResumeFile，不原地覆盖旧记录；旧 confirmed 记录仍可在历史中查看。

### Provenance（嵌入字段，不单独成表）

`sourceIds[]、confidence、userConfirmed、confirmedAt`。

- confidence：0～1 或 null，表示提取的自报置信度，不是事实真实性或模型准确率；没有提取过程时为 null。
- userConfirmed 只在用户明确确认后为 true；confidence 高不能自动确认。
- confirmedAt 在 userConfirmed 为 false 时必须为 null。
- 合成 fixture 可以预置“演示人物已确认”的状态，整个界面仍须标为合成演示，不冒充当前使用者确认。

### CareerAsset

字段：`id、userId、kind、title、body、provenance、revision、createdAt、updatedAt`。

- kind：`work_experience | project_experience | skill_evidence | portfolio`。
- title、body 是纯文本；第一阶段无需复杂履历表单或真实文件解析。
- provenance 针对当前整个资产版本。暂不混合一个资产内不同字段的确认状态；拆分独立事实可用不同资产。
- 编辑时显示来源和确认状态。“确认这次修改”为可选勾选项，发生内容修改后默认不选；未选也能保存，但修改后的版本 userConfirmed 为 false。
- title／body 发生变化时创建 manual_entry 来源，记录本次输入；新来源加入 sourceIds，旧来源不删除，confidence=null，revision 递增。
- 内容不变且 confirmFacts=true 时，可以把待确认资产变为已确认，revision 递增但不虚造新输入来源；内容不变且未要求新增确认时为无操作，不撤销原确认、不新增事件。
- 不做全量资产版本管理界面；已被引用的内容由下述快照保留。不得在更改资产后重写旧快照。
- 基础简历／定制简历属于 Document，Vault 的简历入口指向文档，不再维护另一套 ResumeVersion。

### AssetSnapshot（嵌入）

`assetId、revision、title、body、provenance`。引用时复制值，不保留可变对象引用。前端证据可同时查看“评估当时的内容”和“当前资产”；当前 revision 不同则标记旧结果可能过期。

## 4. Job 与 JobAssessment

### Job

字段：`id、userId、goalIds[]、companyName、title、location、salaryText、jdText、provenance、revision、createdAt、updatedAt`。

- goalIds 表示用户把该岗位收藏到哪些目标，不是岗位本身的招聘条件；同一个 Job 可以关联多个 Goal。
- 改变收藏目标不能改写历史 Application.goalId；关联目标必须属于同一用户。
- revision 跟踪招聘内容变化。单纯增加／移除收藏目标不递增 JD revision。
- Job 与 Application 分开：收藏、评估岗位不代表投递。

### JobAssessment

字段：`id、userId、jobId、goalId、jobSnapshot、goalSnapshot、assetSnapshots[]、match、gaps[]、evidence[]、risks[]、origin、createdAt`。

- 每份评估绑定一个 Goal。jobSnapshot 至少保存 jobId、revision、companyName、title、jdText；goalSnapshot 保存 goalId、revision、title、targetRoles、cities、salaryExpectation。
- match：`{ level, summary }`，level 为 `high | medium | low | unknown`。第一阶段不展示虚构的精确匹配百分比。
- gaps／risks：`{ description, basis }[]`，basis 说明来自哪条 JD、证据或缺失信息。缺失证据不等于没有能力。
- evidence：`{ requirement, assetId, assetRevision, excerpt }[]`，必须能在 assetSnapshots 找到对应项，excerpt 不得超出来源事实。
- origin：`demo_fixture | model_generated | user_authored`；第一阶段仅使用 demo_fixture。
- 评估保存后不可变。当前 Job、Goal 或被引用资产的 revision 不同，或引用失效时，派生 `isStale=true`，提示重新评估；不静默改写旧结论。
- 同一 jobId＋goalId 可以有多份历史评估；展示最新一份，计数时岗位去重。重新评估需要真正生成新结果，不能替换时间戳冒充更新。

## 5. Application 与 Interview

### Application

字段：`id、userId、goalId、jobId、status、submittedAt、hasHrReply、firstHrReplyAt、submittedDocumentVersionIds[]、materialsUnknown、createdAt、updatedAt`。

- goalId、jobId 创建后固定。V1 同一 userId＋goalId＋jobId 只保留一条 Application；重复操作打开原记录。重新投递轮次留待后续设计。
- status 使用状态契约，不依据当前页面或 TaskRun 状态推断。
- submittedAt：用户明确记录已在外部投递的发生时间，未投递为 null；以后拒绝、撤回仍保留。
- hasHrReply：是否明确记录过招聘方回复；用户自己发消息不算。邀请、Offer、拒绝也算回复；即使具体回复时间未知仍为 true。
- firstHrReplyAt：已知招聘方回复发生时间中的最早值；新记录更早时取 min，否则保留；全部未知时为 null。不得用系统记录时间代替。hasHrReply=false 时必须为 null。
- submittedDocumentVersionIds：提交时的不可变材料版本，不能引用 Document.latest，也不能在后续编辑文档时替换。
- materialsUnknown：补录外部历史投递但不知道材料版本时为 true，并允许版本列表为空；不能虚构版本。该状态须在界面说明“未记录投递材料”。
- 系统内准备的新投递应先选定至少一个已确认的文档版本再记录已投递；补录路径显式选择材料未知。
- **本阶段不设 Application 级「投递渠道」或「投递备注」字段。** 不得把其他对象的字段默认解释为投递实体属性：
  - `opening_message.draft.parameters.channel`／对应 DocumentVersion.parameters.channel 仅表示开场沟通材料模板参数，不是 Application 的投递渠道。
  - `application.hr_reply_recorded.payload.summary` 仅表示招聘方回复备注，不是 Application 的通用投递备注；未记录回复时不得为此伪造回复事件。
  - 若产品后续需要投递级渠道或备注，须新增正式字段与事件载荷后再实现 UI，不能静默复用上述字段。

### Interview

字段：`id、userId、applicationId、roundNumber、label、status、scheduledAt、completedAt、prepDocumentVersionIds[]、transcript、review、createdAt、updatedAt`。

- applicationId 必填。goalId、jobId 通过 Application 读取，不重复维护。
- roundNumber 为正整数，applicationId＋roundNumber 唯一。二面新建第 2 轮；改期修改同一记录的 scheduledAt。
- scheduledAt、completedAt 可为 null；仅知道“收到邀请”但没有时间时保留空值，并安排补充时间的待办。
- status 与准备任务状态分离；文档正在生成不改变面试已经收到邀请的事实。
- prepDocumentVersionIds 引用当前面试对应的面试准备文档版本。
- transcript 为 null 或 `{ text, sourceId, revision, capturedAt }`，只能来自用户输入或合成样例。修订后 revision 递增。
- review 为 null 或 `{ summary, strengths[], improvements[], nextActions[], transcriptRevision, transcriptSnapshot, origin, createdAt }`。revision 不一致显示复盘过期；新输入未分析则 review 为 null，不能套固定样例。
- 复盘中的“可能薄弱点”是推断，不能自动写为已确认的职业资产。

## 6. Document 与 DocumentVersion（第二阶段）

Document 字段：`id、userId、kind、title、goalId、jobId、applicationId、interviewId、draft、createdAt、updatedAt`。

- kind：`resume | self_introduction | opening_message | interview_prep`。
- 基础简历允许所有上下文引用为 null；定制简历必须有 goalId、jobId；自我介绍和开场白至少有 goalId，jobId 可空。
- interview_prep 必须有 interviewId，由面试反查并填入相同的 applicationId、goalId、jobId。
- applicationId 不为空时，Document 的 goalId／jobId 必须与其一致。
- draft 是可变工作稿：`body、parameters、inputSnapshot、origin、userEdited、userConfirmed`；正文、参数、输入快照或尚可变的上下文引用发生变化后 userConfirmed 重置为 false，显式确认后才能用于记录投递。
- parameters 为不同 kind 的判别结构：resume `{ variant: base | tailored }`；self_introduction `{ durationSeconds: 30 | 60 | 120 }`；opening_message `{ channel: boss | headhunter | referral | hr }`；interview_prep `{}`。其中 opening_message 的 channel 是材料参数（见 §5 Application 边界），界面不得标成「投递渠道」。
- inputSnapshot：`assetSnapshots[]、jobSnapshot、goalSnapshot`；不适用的上下文为 null。只把已确认资产作为肯定事实写入草稿，未确认内容可作为待补充提示。
- origin：`demo_fixture | model_generated | user_authored`。修改示例或模型草稿后保持原 origin，并设置 userEdited=true，不能消除其来源。

DocumentVersion 字段：`id、userId、documentId、versionNumber、body、parameters、inputSnapshot、origin、userEdited、userConfirmed、createdAt`。

- 每次“保存版本”复制完整草稿快照，新建版本；documentId＋versionNumber 唯一且递增。
- 版本保存后不可变，不允许就地修改正文、参数、事实来源或确认状态。版本确认和正文修改都通过保存新版本完成。
- Document 的 kind 和归属引用一旦有已保存版本就不可变；切换到其他岗位或面试应新建 Document。
- Application／Interview 引用具体 versionId；跨用户、错误岗位／目标／面试的引用必须拒绝。
- 基础简历可被同用户多个投递使用；有 goalId 或 jobId 的文档必须匹配投递上下文；面试准备文档不能充当投递材料。

## 7. ActionItem、TaskRun 与 Event

| 对象 | 字段 | 说明 |
| --- | --- | --- |
| ActionItem | id、userId、goalId、kind、title、status、jobId、applicationId、interviewId、dueAt、sourceEventId、createdAt、updatedAt | 用户待办；三个上下文引用按需可空，有引用必须互相一致；status 为 open／done／dismissed；sourceEventId 记录产生原因 |
| TaskRun | id、userId、skillName、context、status、attempt、inputSnapshot、outputRef、error、createdAt、updatedAt | 第二阶段才实现的执行记录；context 为明确对象引用；status 见状态契约；重试不创建重复业务实体 |
| Event | id、userId、type、schemaVersion、subject、relatedRefs、actor、sourceId、occurredAt、recordedAt、commandId、requestFingerprint、payload | 已确认业务变化；不可变；详细字段约束见状态事件契约 |

ActionItem.kind 先使用 `review_job | complete_profile | prepare_documents | prepare_interview | complete_interview_review`。当前第一阶段只展示预置待办，不实现动态规划器。

sourceEventId 在真实操作产生的待办中必填；演示种子待办也配对应的合成事件，不能伪装运行了 Agent。第一阶段无需显示事件时间线。

## 8. 第一阶段数据访问边界

统一接口使用 Promise；返回数据为拷贝，视图不能借对象引用修改底层状态：

| 操作 | 输入 | 输出与效果 |
| --- | --- | --- |
| loadWorkspace | 无 | 当前演示快照与 UI 偏好，含 schemaVersion；另返回运行时 storageStatus（available／unavailable／invalid_data，不写入存储） |
| selectGoal | goalId | 校验目标属于当前用户且 active；正常模式保存 UI 偏好，只读临时浏览时仅变更本次 UI 并明确不持久化 |
| updateCareerAsset | assetId、expectedRevision、title、body、confirmFacts、commandId | 校验并保存资产＋必要的新来源＋事件；返回 newRevision；无操作返回当前 revision、不写入；冲突时拒绝覆盖 |
| resetDemo | 明确确认后的调用 | 只清理本应用的命名存储键并恢复初始 fixture；不得 localStorage.clear() |

无需为每个对象编写仓储类；统一读取接口＋纯 selector＋少量命令足够。状态保存键为 `career-agent.demo.v1`，快照包含 `schemaVersion: "0.1"`、`data`、`ui`。

data 包含 users、goals、sources、assets、jobs、assessments、applications、interviews、actionItems、events、documents、documentVersions 数组。第三阶段起还应包含 `files`（ResumeFile）数组；taskRuns 仍可不创建。ui 包含 selectedGoalId；路由使用 hash 单独保存。

**缺省集合软迁移（读取兼容，不改写未授权字段）：** 第一阶段写入的本地包可能缺少 `data.documents` 或 `data.documentVersions`；第二阶段包可能缺少 `data.files`。加载时若字段**缺省或为 null**，视为 `[]` 并仅在内存校验用的候选对象上补齐后再跑一致性校验；不得因此改写其他集合或 UI 偏好。只有后续业务写入成功时，落盘快照才带上这些空或已填充数组。缺省不等于损坏：不得仅因缺少上述集合进入 invalid_data。若字段**存在但类型非法（非数组）**，则按损坏数据处理（`invalid_data`），不得伪装成空数组。

本地持久化限定单标签页演示；检测到外部同键变更应提示重新加载，不静默覆盖。不同浏览器或 file:// 环境的存储可用性必须实际验收；未来多用户并发不以此方案替代。

启动时探测存储（只用本应用临时探测键，并清理）失败，storageStatus=unavailable：使用独立 fixture 副本进入**只读临时浏览**，显示“本地保存不可用，当前仅供浏览”；禁用资产保存和演示重置，不接受业务内存提交。仍可浏览和临时切换目标，但明确刷新不保留选择。

探测成功但首次种子数据写入失败时，同样进入 unavailable／只读临时浏览，可用 seed_write_failed 记录诊断原因；不能显示初始化保存成功。这不改变正常运行中一次写入失败的处理规则。

可读存储含损坏数据或不兼容版本，storageStatus=invalid_data：保留原始内容、不覆盖，提供只读 fixture 预览；只有用户明确确认重置才尝试写入初始状态。成功才恢复 available，失败继续只读并保留原串。

正常模式运行中单次写入失败，不自动转入临时模式；保留已提交状态和草稿并允许重试。不能把“保存到内存”显示为保存成功。

## 9. 首页指标与统一样例

所有指标按当前 selectedGoalId 过滤，并显示“当前目标 · 累计”，不是过去 7 天或全用户汇总：

- 已分析岗位：该目标存在 JobAssessment 的不同 jobId 数，过期评估仍算已分析，但详情提示过期。
- 已投递：该目标 submittedAt 非空的不同 Application 数，之后拒绝或撤回仍计入。
- HR 回复：该目标 hasHrReply=true 的不同 Application 数；时间未知仍计入，不按消息数或事件数重复计。
- 面试次数：该目标 Interview.status=completed 的不同面试数；排期另在待办显示，不计作已完成面试。

初始合成样例固定关系（显示名和履历文案由 Cursor 编写，并明确为虚构）：

| 记录 | 关系／状态 |
| --- | --- |
| user_demo | 唯一合成用户；全部记录属于此用户 |
| goal_ai_pm、goal_b2b_pm | 两个 active 目标；初始选择前者 |
| job_001、job_002 | goalIds=[goal_ai_pm]，各有一份该目标评估 |
| job_003 | goalIds=[goal_b2b_pm]，有一份该目标评估 |
| app_001 | goal_ai_pm＋job_001；preparing；hasHrReply=false；submittedAt／firstHrReplyAt 为 null |
| app_002 | goal_ai_pm＋job_002；interview_scheduled；已投递且 hasHrReply=true、回复时间已知；历史材料未知 |
| app_003 | goal_b2b_pm＋job_003；submitted；已投递、hasHrReply=false、firstHrReplyAt=null；历史材料未知 |
| interview_001、interview_002 | 均属 app_002；roundNumber 分别为 1／2；第一轮 completed，第二轮 scheduled |

至少 4 个职业资产：两个项目、一段经历、一项能力证据；至少一个待确认资产。评估中的肯定证据引用已确认资产，待确认部分展示为待核实。

初始 goal_ai_pm 指标为 **2／1／1／1**；goal_b2b_pm 为 **1／1／0／0**。日期采用明确的合成时间，页面写“演示日程”，不随真实今天移动而悄悄改写历史事实。
