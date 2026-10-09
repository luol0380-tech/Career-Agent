# 状态与事件契约

版本：`0.1`；日期：2026-09-29。完整转换规则用于后续闭环；第一阶段只实现职业资产保存、目标选择和演示重置，不建设真实状态机或事件总线。

## 1. 三类状态独立

| 类别 | 值／来源 | 原则 |
| --- | --- | --- |
| Product Stage | profile_building、job_evaluation、document_preparation、application_tracking、interview_preparation、interview_review | 当前业务上下文推导的展示阶段，不写为 User 唯一全局状态 |
| Entity State | Application.status、Interview.status、ActionItem.status | 已发生的业务事实或显式用户选择 |
| TaskRun State | pending、running、waiting_for_user、completed、failed、cancelled | 执行过程，不代表投递或面试已经发生 |

TaskRun 合法转换：pending→running／cancelled；running→waiting_for_user／completed／failed／cancelled；waiting_for_user→running／cancelled；failed→pending（用户重试、attempt 递增）。completed／cancelled 为本次运行终态，新任务另建记录。等待用户期间保存 context 和输入快照，不丢失关联对象。

## 2. Application

| 状态 | 中文语义 |
| --- | --- |
| preparing | 准备投递，尚未记录外部投递 |
| submitted | 用户已记录外部投递 |
| hr_responded | 已有招聘方回复，尚无后续面试状态 |
| interview_scheduled | 至少一轮已邀请／排期且未完成的面试 |
| interview_completed | 已完成面试，当前没有未完成的有效邀请 |
| offer_received | 已记录录用意向／Offer |
| rejected | 招聘方拒绝，流程结束 |
| withdrawn | 用户退出，流程结束 |
| accepted | 用户已接受 Offer，流程结束 |

### 允许的操作

| 命令 | 允许前态 | 结果与约束 |
| --- | --- | --- |
| prepareApplication | 无记录 | 新建 preparing；已有同用户＋目标＋岗位记录则返回原记录，不重复创建 |
| recordSubmission | preparing | →submitted；记录 submittedAt 和固定材料版本或显式材料未知标志 |
| recordHrReply | submitted／hr_responded／interview_scheduled／interview_completed／offer_received | submitted→hr_responded；其他保持状态；hasHrReply=true，firstHrReplyAt 取已知发生时间的最早值 |
| scheduleInterview | submitted／hr_responded／interview_scheduled／interview_completed | 创建新轮或为已有 invited 轮补时间；Application→interview_scheduled；邀请算招聘方回复 |
| completeInterview | interview_scheduled | 指定轮→completed；有其他 invited／scheduled 轮则保持，否则→interview_completed |
| rescheduleInterview | interview_scheduled | 修改同一 Interview 的时间，不增加轮次、不新增邀请实体 |
| cancelInterview | interview_scheduled | 指定轮→cancelled；有其他有效轮则保持，否则有 completed 轮→interview_completed，无则→hr_responded |
| recordOffer | submitted／hr_responded／interview_scheduled／interview_completed | →offer_received；填回复时间，未结束面试改 cancelled，关闭其准备待办 |
| recordRejection | submitted／hr_responded／interview_scheduled／interview_completed／offer_received | →rejected；填回复时间，取消未结束面试和关闭待办 |
| withdrawApplication | preparing／submitted／hr_responded／interview_scheduled／interview_completed／offer_received | →withdrawn；取消未结束面试和关闭待办 |
| acceptOffer | offer_received | →accepted |
| recordResumeFileUpload | — | 新建 ResumeFile；可读则 status=pending_confirm，读失败则 read_failed；不覆盖旧记录 |
| saveResumeFileText | pending_confirm／confirmed（仅未改 status 的文本草稿） | 更新 textDraft；confirmed 文件若改文本则降为 pending_confirm 并清空 sourceId 绑定前的“已确认展示”，需重新确认 |
| confirmResumeFile | pending_confirm | →confirmed；创建 pdf_upload 来源；可选同步基础简历 Document 新版本（userConfirmed=true） |
| markResumeFileReadFailed | pending_read／pending_confirm | →read_failed；保留 readError；不得删除上一份 confirmed 材料 |

取消文件选择、选择非 PDF、超限文件：不写业务事件，仅 UI 提示。同一 commandId 重试必须幂等。

preparing 下收到邀请时，先显式补录外部投递；不能静默捏造 submittedAt。V1 不提供拖拽到任意状态、终态重开或撤销历史事件的通用入口。数据误录的纠正流程作为后续单独契约评审，不能通过直接改 status 绕过。

以上操作只管理用户记录，不发送消息、不向外部招聘平台投递。页面按钮使用“准备投递”“记录已投递”“记录面试邀请”等准确文案。

## 3. Interview

- 状态：`invited | scheduled | completed | cancelled`。
- 已确认收到邀请但时间未定：invited，scheduledAt=null；时间明确：scheduled。
- invited→scheduled／completed／cancelled；scheduled→scheduled（改期）／completed／cancelled。
- completed／cancelled 为本轮终态；补录 completedAt 时必须有真实用户确认的发生时间。
- 同一 applicationId＋roundNumber 唯一。下一轮用新 roundNumber，重复导入不能新建重复面试。
- 面试准备工作通过 ActionItem 和 TaskRun 表示，不能把 Interview.status 改成 preparing／generating。
- 输入转写、保存复盘、生成准备文档都不自动证明面试已完成；必须另有明确的完成记录。

## 4. Event 信封

事件不可变；事件类型当前使用以下闭集，新增必须补充语义、载荷和校验。UI 导航、切换目标、打开面板不写业务 Event。

| 字段 | 约束 |
| --- | --- |
| id、userId | 唯一事件 ID、事实所属用户 |
| type、schemaVersion | 如 career_asset.revised；当前事件载荷版本为 1 |
| subject | `{ type, id }`，主要变化对象；type 为 user／career_goal／career_asset／job／application／interview／document／resume_file |
| relatedRefs | 同样结构的数组，关联实体，不以名称匹配 |
| actor | `{ type: user | system, id }`，系统 ID 可以是 demo；模型不是可直接授权事实写入的用户 |
| sourceId | 对应 SourceRecord 或 null；自由文本／邀请补录必须保留来源，明确按钮可为空 |
| occurredAt | 用户确认的现实发生时间；未知时 null，并在 UI 明示 |
| recordedAt | 系统记录时间，不替代 occurredAt |
| commandId | 本次操作的幂等键，重试原操作必须复用；唯一性为 userId＋commandId |
| requestFingerprint | 规范化命令参数的稳定序列化值；同一键重试时核对，不包含临时 UI 状态。第一阶段不要求密码学哈希 |
| payload | 类型特定结构；不得只存一段供模型猜测的描述 |

SourceRecord 是输入证据，Event 是已确认业务变化；两者不得混用。删除／修正旧数据不能编辑旧事件伪造历史。

## 5. 事件与载荷

| type | 主体 | payload 最小字段 |
| --- | --- | --- |
| career_asset.revised | career_asset | previousRevision、newRevision、changedFields[]、sourceId（仅确认时可空）、userConfirmed |
| application.prepared | application | goalId、jobId |
| application.submitted | application | submittedAt、documentVersionIds[]、materialsUnknown |
| application.hr_reply_recorded | application | repliedAt、summary |
| interview.invitation_recorded | interview | applicationId、roundNumber、scheduledAt（可空）、invitationAt |
| interview.rescheduled | interview | previousScheduledAt、scheduledAt |
| interview.completed | interview | completedAt |
| interview.cancelled | interview | reason |
| application.offer_recorded | application | receivedAt |
| application.rejected | application | rejectedAt、reason（可空） |
| application.withdrawn | application | withdrawnAt、reason（可空） |
| application.offer_accepted | application | acceptedAt |
| document.version_saved | document | versionId、versionNumber |
| interview.transcript_saved | interview | previousRevision、newRevision、sourceId |
| resume_file.uploaded | resume_file | fileName、byteSize、mimeType、status（pending_confirm 或 read_failed） |
| resume_file.read_failed | resume_file | readError、fileName |
| resume_file.text_saved | resume_file | textLength（规范化后长度，不含全文以免指纹过大） |
| resume_file.confirmed | resume_file | sourceId、documentId、versionId（可空若仅确认文件未同步文档） |

`resume_file.uploaded`：用户成功登记一次本地 PDF 选择结果。指纹含 fileName、byteSize、mimeType、status、readError。失败上传（read_failed）也写此事件或单独 `resume_file.read_failed`——实现须二选一并在校验中一致；推荐：可读成功写 uploaded（status=pending_confirm），读失败写 read_failed，二者互斥。幂等重放返回原 fileId。

`resume_file.text_saved`：保存 textDraft。指纹为 fileId＋规范化文本。同键重试不重复事件。

`resume_file.confirmed`：用户确认当前 textDraft。必须创建 pdf_upload SourceRecord；若存在基础简历 Document 则另存 DocumentVersion 并写 document.version_saved 关联（可作为 relatedRefs，同一 commandId 下主事件仍为 resume_file.confirmed）。确认前页面不得把内容标为已确认事实。

邀请、Offer、拒绝事件在同一业务更新里设置 hasHrReply=true，按已知最早时间更新 firstHrReplyAt，无须额外创建一条 hr_reply_recorded 事件。回复时间未知时相关载荷时间字段可为 null，不影响回复计数。同一 commandId 只产生一条主事件，关联实体变化由该事件载荷和 relatedRefs 解释。

邀请尚未确定时间时记录 interview.invitation_recorded，之后确认时间使用 interview.rescheduled（previousScheduledAt=null）。重复设置相同时间无变化，不再造事件。

`interview.transcript_saved`：用户保存或修订面试笔记／转写。成功时：新建或替换 Interview.transcript（revision＝previousRevision＋1，previousRevision 在首次保存时为 0）、写入对应 SourceRecord（sourceId 入载荷）、**将 review 置为 null**（界面显示「尚未分析」，不得保留或套用旧复盘／演示样例）。幂等：同一 userId＋commandId 且 requestFingerprint 一致时重放返回原 newRevision，不新增版本、不重复来源；同键不同参数拒绝为冲突。指纹规范化字段为 interviewId＋规范化后的 text。relatedRefs 至少含所属 application。

第一阶段只会新增 career_asset.revised。第二阶段可新增 document.version_saved、interview.transcript_saved 以及任务包已启用的投递／面试事件；第三阶段可新增 resume_file.* 事件。其他类型仍可作为合成历史种子。不得临时发明通用 `state.changed`。

career_asset.revised 的 changedFields 是变更原因的业务标识列表：文本变化记录 title／body；内容不变、仅新增确认时记录 userConfirmed。它不是完整的存储字段 diff；新确认结果以 payload.userConfirmed 为准。该事件的 subject 已指向资产，relatedRefs 允许为空；评估过期仍由 revision 引用派生，不为此扩展 JobAssessment 引用类型。

ActionItem.sourceEventId 表示待办产生的触发原因，不代表待办已经完成；合成待办也不能指向发生并记录于自身创建之后的事件。投递事件可以触发“投递后补充证据”的预置待办，但需说明合成场景的因果关系，不能只是挂到任意存在的事件上。

## 6. 保存、幂等与失败

一次业务命令的执行顺序：

1. 用 userId＋commandId 查是否已成功执行。相同参数重试返回原结果；相同键不同参数拒绝为冲突。
2. 校验引用同属用户、对象存在、当前状态允许、expectedRevision 匹配以及必要的用户确认。
3. 在独立的候选快照里构造新事实、事件和待办，不修改当前共享状态。
4. 第一阶段将候选快照序列化为一个 localStorage 状态包并保存；成功后才替换内存快照和显示成功。未来后端改为数据库事务。
5. 保存失败时保留旧状态及用户编辑草稿，显示原因并允许重试。不能事件成功、实体失败，或反过来。
6. 事实提交成功后才触发生成任务。生成失败保留事实与待办，只重试执行任务，不重复创建面试／Application。

启动时 storageStatus 不为 available 则不进入业务命令提交链路：只读浏览的行为以数据契约为准，临时目标选择只是 UI 变化。运行中的写入失败不能自动切换到内存提交方式。

第一阶段通过同一状态包里的事件保存 commandId、requestFingerprint 和本次更新的载荷／来源；据此核对重试请求并返回原 newRevision。尚未保存成功的键不算执行成功。生成类调用的去重与尝试次数由第二阶段 TaskRun 补充。

storage 事件检测到其他标签页变更时先阻止继续写入，提示重新加载；本地适配不宣称具备跨标签页事务锁。真实并发和权限以后由后端保证。

显式演示重置会删除本应用所有演示业务与事件并重新播种，不是业务撤销功能，不写成用户职业事件。必须先提示将丢失本浏览器的演示修改并获得确认。

## 7. 示例与验收

“刚才那个公司让我周三二面”：先记录原文；上下文不唯一时选择 Application；确认具体日期、时区、轮次后再提交。仅知道日期却不知道时刻时不能默认 09:00，保留 invited 并在来源中保存日期说明，等待补充确切时间。

同一条确认操作成功后：创建第 2 轮 Interview，Application→interview_scheduled，写入邀请事件及 prepare_interview 待办。重复点击返回相同记录。第一轮的完成状态和文档引用不变。

最低验收路径：

- 切换 Goal 后历史 Application.goalId 和文档引用不变。
- 修改职业资产后 revision＋1；旧评估仍能展示原证据，且显示过期。
- 准备材料不会设置 submittedAt，生成成功不会记录已投递。
- 记录相同 commandId 两次只产生一个结果；不同参数复用同一键得到冲突。
- 模拟保存失败时，实体、来源与事件均保持旧状态，草稿仍在。
- 第二轮不会覆盖第一轮；改期不增加 Interview 数。
- 面试准备生成失败不撤销邀请，重试不新增面试或重复待办。
- 文档新版本不会改变已经投递的版本快照。
- 保存面试笔记写入 interview.transcript_saved，清空 review；同 commandId 重试不重复升 revision。
- 文档编辑离开／刷新有草稿保护；保存失败时保留正文草稿并允许同 commandId 重试。
- 首页可见上传 PDF；上传后显示文件名与待确认；读取失败不显示成功且保留上一份材料；确认前不把 PDF 文本当作已确认事实。

第一阶段只实际验证适用的路径；未实现的后续路径标记“第二阶段”，不能为了全勾选而提前开发。
