# Work 数据库结构规范化运行手册 v0.1

状态：只读审计阶段。尚未执行数据库写入、schema push 或迁移。

## 已确认事实

2026-07-23 的只读审计确认：

- Works 总数：35,615；
- 实际 Work 相关表：24；
- 实际物理字段：303；
- 最新已提交迁移快照字段：276；
- 数据库独有字段：27；
- 快照独有字段：0。

因此实际 PostgreSQL 是已提交迁移快照的超集。数据库曾经通过迁移历史之外的方式继续演进，迁移快照不能直接作为当前结构真相。

## 字段收束结论

### 生命周期

保留：

- `catalogStatus`: `active | temporary | archived`
- Payload `_status`: `draft | published`

废止：

- 旧业务 `status`

理由：旧 `status` 与 `_status` 在 35,612 条 Works 上不一致，且含有一个超出旧 draft/published 语义的 `archived` 值。

不得把旧 `status` 映射或回填到 `_status`。该 `archived` 语义应由 `catalogStatus` 表达。

### 已删除业务概念

永久废止：

- `legacy_x_wiki_page`

全库非空数量为 0，不迁移到任何替代字段。

### 人工审核

权威字段：`humanAssessment`。

过渡字段：

- `reviewStatus`
- `humanReviewNote`
- `humanReviewedAt`
- `humanReviewedBy`

只有有意义的旧值才可进入规范化候选；默认 `pending` 本身不是证据。新旧值冲突时不得自动覆盖。

### 等级

有效公开等级只按以下顺序计算：

1. 有效人工等级；
2. 当前公共 AI Radar 结论；
3. `unknown`。

存储的 `rank` 只作为兼容输出，不能用作迁移证据或第三个真相源。

## 只读审计入口

### 根结构审计

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\audit-work-schema-root-v01.ps1
```

输出到：

```text
exports/schema-root-audit-<timestamp>/
```

### 规范化候选审计

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\audit-work-normalization-candidates-v01.ps1
```

输出到：

```text
exports/work-normalization-candidates-<timestamp>/
```

应包含：

- `counts.json`
- `human-normalization-candidates.jsonl`
- `schema-retirement-exceptions.jsonl`
- `rank-retirement-candidates.jsonl`
- `manifest.json`
- `summary.txt`

这些文件可能包含 Work ID、标题和审核说明，不提交到 Git。

## 规范化阶段

### Phase 0：只读证明

必须取得：

- 精确 Work ID；
- 迁移前值；
- 拟迁移后值；
- 记录数量；
- SHA-256；
- 冲突记录列表。

### Phase 1：人工字段统一

- 只复制非冲突且有意义的旧人工值；
- canonical 字段已有值时优先保留；
- 冲突记录单独人工决定；
- 暂不删除旧列。

### Phase 2：复核

重新运行所有只读审计，确认：

- 有意义的旧人工字段不再是唯一数据源；
- 冲突数量符合批准结果；
- 数据条数、关联和版本记录未意外变化。

### Phase 3：废止字段

在备份和逐行 SQL 审阅后，才可计划删除：

- `works.status` 及版本镜像；
- `legacy_x_wiki_page` 及版本镜像；
- 旧人工审核字段及版本镜像；
- 无剩余依赖的旧 enum。

### Phase 4：可信基线

只有在实际数据库、Payload 当前模型和规范化结果一致后，才建立新的可信迁移基线，并重新生成独立 `radar_public` 增量迁移。

## 写入前硬门槛

以下条件缺一不可：

- 新鲜且已验证可恢复的数据库备份；
- 所有目标 ID 和 before/after 值已导出；
- SQL dry-run 报告无未解释 DDL；
- 不包含 Works 草稿发布或版本恢复；
- 不从旧 `status` 推导 `_status`；
- 冲突行有明确人工决定；
- 回滚 SQL 与验收 SQL 已准备；
- 用户明确批准执行。

## 当前禁止事项

- 不运行 `payload migrate`；
- 不运行 Payload schema push；
- 不生成新的数据库迁移；
- 不 PATCH 或发布 Works；
- 不手动选择 Drizzle rename 选项；
- 不删除数据库列或 enum；
- 不把 `exports/` 中的真实记录提交到仓库。
