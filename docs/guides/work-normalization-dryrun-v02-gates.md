# Work 规范化 dry-run v02 语义门槛

状态：只读校正阶段。未执行数据库写入、Payload 写入、迁移、schema push 或 Works 发布。

## 为什么 v01 计划不能直接进入写入

v01 dry-run 的文件完整性、SHA-256 和只读 SQL 安全均通过，但语义复核发现三项必须先修正的问题。

### 非公开记录必须最先拦截

`catalogStatus = archived` 或 Payload `_status = draft` 的 Work 不得进入公共 AI 审阅队列，即使 Works 内仍保留私有 AI 字段。

判断顺序必须是：

```text
非公开生命周期拦截
→ 有效人工轨道
→ 私有 AI 候选
→ 旧 AI 候选
→ 无有效来源
```

非公开记录可以为备份和审计保留原值，但：

- `requiresPublicationReview = false`
- `automaticPublicationEligible = false`
- 公共有效等级保持 `unknown`

### canonical identity gate

任何人工字段复制或公共 AI 审阅候选，在写入前都必须确认 canonical Work ID。

原因：同一作品可能因 AniList、Bangumi、Steam、MangaDex 等来源被导入为多个 Work。人工结论和 AI 结论若分别写入不同 Work，会形成新的双轨分裂。

v02 至少使用以下只读信号生成身份复核提示：

- 完全一致的规范化标题；
- 不同语言标题中共享的显著 ASCII 标题词。

当前 dry-run 已直接识别两组提示：

- `Endro~!` 的两个来源记录；
- `Soukou no Strain / 奏光之Strain` 的两个来源记录。

这些提示只负责阻塞写入，不自动选择 canonical Work ID。最终决定还需结合外部 ID、来源、更新时间和既有合并规则。

### 时间必须按 `timestamptz` 比较

审计 JSON 使用 ISO 8601：

```text
2026-07-20T06:52:53.682+00:00
```

PostgreSQL `timestamptz::text` 通常使用空格及不同的时区格式。字符串比较可能产生假不一致。

v02 改为：

```sql
current_timestamp_column
IS NOT DISTINCT FROM expected_timestamp_text::timestamptz
```

不得用 `column::text` 与 ISO 字符串直接比较。

## v02 输出

```text
human-normalization-plan-v02.jsonl
rank-preservation-plan-v02.jsonl
public-ai-review-candidates-v02.jsonl
nonpublic-assessment-preservation.jsonl
canonical-identity-review-alerts.jsonl
schema-retirement-plan.json
phase1-human-normalization-dryrun-v02.sql
schema-retirement-dryrun-v02.sql
normalization-summary-v02.json
manifest.json
```

## 安全含义

v02 中：

- `previousAutomaticWriteEligibility` 只保留 v01 的计划历史；
- 实际 `automaticWriteEligible` 强制为 `false`，直到 canonical identity 通过；
- 公共 AI 候选仍全部 `automaticPublicationEligible = false`；
- SQL 只有 `BEGIN TRANSACTION READ ONLY`、`SELECT` 和 `ROLLBACK`；
- 不生成 UPDATE、INSERT、DELETE、ALTER、DROP 或迁移。

## 运行入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-dryrun-v02.ps1 `
  -DryRunDirectory .\exports\work-normalization-dryrun-<timestamp>
```

输出 ZIP 仍属于 `exports/` 审计产物，不提交到仓库。
