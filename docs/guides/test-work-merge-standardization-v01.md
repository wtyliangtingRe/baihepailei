# 临时测试 Work 合并与标准化 v0.1

状态：canonical 决定已形成，仅生成 merge dry-run。尚未执行数据库写入、Payload 写入、合并、硬删除、迁移或版本改写。

## 适用范围

本指南仅适用于用户明确确认的当前两组临时人工审核 / AI 评级测试记录：

- `Endro~!` 的来源分裂记录；
- `Soukou no Strain / 奏光之Strain` 的来源分裂记录。

现有人工审核、私有 AI Radar、历史 `rank`、测试反馈和派生公共 AI 候选均被用户明确判定为不准确。这个授权不能自动扩展到其他作品。

## Canonical 决定

### Endro~!

- 保留 Bangumi 基准、事实数据更完整且已有入站引用的 Work；
- 另一条 AniList 基准 Work 软归档并隐藏；
- 把 canonical 缺少的 MAL ID 等事实字段补入；
- AniList 来源和链接若 canonical 已存在语义等价行，则不重复复制；
- 保留旧记录、旧 slug、旧 siteId 和 Payload versions，作为历史追踪证据。

### Soukou no Strain / 奏光之Strain

- 保留 Bangumi 基准、事实数据、子表、引用和版本均明显更完整的 Work；
- 另一条 AniList 基准 Work 软归档并隐藏；
- 把 AniList ID、MAL ID 和 canonical 缺失的事实来源资料补入；
- 中文简介继续作为 canonical 当前简介；英文简介作为来源事实保留，不用旧测试评级决定覆盖关系；
- 保留旧记录和版本历史。

真实 Work ID 只在本地命令和被忽略的审计产物中出现，不写入本指南。

## 评级清理规则

两组内所有 Work 都统一执行以下语义计划：

```text
humanAssessment.status = pending
humanAssessment.grade = null
humanAssessment.note/source/evidence/assessedAt/assessedBy = null

legacy reviewStatus = pending
legacy humanReviewNote/humanReviewedAt/humanReviewedBy = null

private radarAssessment = null
radar matched rules / contradictions = empty
stored rank = unknown
ratingNotice = insufficient_information
evidenceStrength = unassessed
public AI conclusion to create = false
```

展示层因此回到：

```text
effectiveGrade = unknown
effectiveGradeSource = unknown
```

v02 会额外确认 `human_reviewed_at`、`human_reviewed_by_id` 等物理旧字段也被纳入清空计划，避免只处理 `human_review_*` 前缀而漏掉时间和人员字段。

## 反馈测试记录

与这两组 Work 关联、且属于本轮临时测试的反馈记录：

- 不作为人工证据；
- 不作为 AI 结论来源；
- 计划改为 `workflowStatus = archived`；
- 不重指向 canonical Work 来伪造有效证据链；
- 不物理删除，保留审计痕迹。

## 事实数据合并

可以迁入 canonical 的内容：

- canonical 为空而 merge-out 非空的外部 ID；
- semantic key 不重复的 candidate sources；
- semantic key 不重复的 source links；
- 真实别名和本地化标题；
- 真实创作者、组织和作品关系；
- 其他经 exact-before 确认的事实子表。

不能继承的内容：

- 人工审核等级、说明、审核人和审核时间；
- 私有 AI 等级、规则、来源摘要和评估批次；
- 旧 `rank`；
- Radar/manual review reasons；
- 测试反馈给出的等级、规则和结论。

## 软归档策略

被合并 Work：

```text
catalogStatus = archived
isLiteVisible = false
isFullVisible = false
Payload _status = 保持原值
```

明确不做：

- 不物理删除 Work；
- 不修改、重指向或删除历史版本；
- 不把旧 `status` 映射到 `_status`；
- 不恢复历史草稿；
- 不通过 Payload PATCH 发布整份 Work。

v02 先读取 `_works_v.parent_id` 建立 version ID → Work ID 映射，再统计版本子表；不会把版本子表 `_parent_id` 错当成 Work ID。

## Dry-run 入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-test-work-merge-dryrun-v02.ps1 `
  -IdentityAuditDirectory .\exports\canonical-work-identity-audit-<timestamp> `
  -Decision @('<merge-out>:<canonical>', '<merge-out>:<canonical>') `
  -DiscardTestAssessments
```

输出：

```text
exports/test-work-merge-dryrun-v02-<timestamp>/
exports/TEST-WORK-MERGE-DRYRUN-V02-<timestamp>.zip
```

主要文件：

- `canonical-merge-decisions.json`
- `field-merge-plan.jsonl`
- `relation-merge-plan.jsonl`
- `test-assessment-cleanup-plan.jsonl`
- `feedback-test-cleanup-plan.jsonl`
- `version-preservation-plan.jsonl`
- `exact-before-readonly.sql`
- `merge-preview-commented.sql`
- `merge-dryrun-summary.{json,md}`
- `manifest.json`

`merge-preview-commented.sql` 的每一行都必须是注释，不是可执行 SQL。

## 写入前仍需满足

1. 审阅 merge dry-run 的逐字段与逐关系决定；
2. 运行 exact-before，只允许完全匹配当前数据库状态；
3. 建立并验证新的可恢复 PostgreSQL 备份；
4. 确认反馈表、别名表、来源表的枚举和唯一约束；
5. 生成精确事务 SQL、回滚 SQL 和验收 SQL；
6. 逐行审阅；
7. 用户明确批准执行。
