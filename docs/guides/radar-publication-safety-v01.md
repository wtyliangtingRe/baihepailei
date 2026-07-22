# Radar 公共结论与 Works 发布安全指南 v0.1

状态：安全规则已锁定；数据库迁移暂停。

## 事故结论

对 Works 执行带 `draft=false` 的更新，不是“只发布本次修改的几个字段”。Payload 会把完整草稿快照提升为发布版本，因此可能同时公开草稿中其他尚未批准的字段。

已经验证过一次：原本只希望发布 AI 相关修改，却同时提升了多项无关 Bangumi 元数据。

因此，任何 AI Radar 结论都不得再通过 Works 草稿发布路径公开。

## 安全架构

### Works

只保存作品事实、关系、人工审核 canonical 数据以及自身生命周期。

### 人工审核轨道

权威位置：`humanAssessment`。

人工轨道可以包含等级、证据、来源、冲突、说明和审核人。它优先于公共 AI 等级，但仍以“参考判断”而不是绝对结论的方式展示。

### 公共 AI Radar 轨道

权威位置：`radar-public-conclusions`。

要求：

- 与 Works 分表；
- 无 drafts；
- 无 versions；
- 每个 Work 使用稳定 `publicationKey = work:<id>`；
- 只有 `current` 记录对公众可见；
- 新 AI 结论更新同一条当前记录；
- 写入该集合不得触碰、发布或恢复 Works；
- 公开导出只允许 GET 读取。

### 有效公开等级

```text
有效人工等级
→ 否则当前公共 AI 等级
→ 否则 unknown
```

`rank` 只作为旧客户端兼容输出，由上述规则重新计算，不是第三个评级来源。

## 双轨展示要求

人工和 AI 使用相同展示字段，以便用户自行比较：

- 等级与状态；
- 摘要与来源摘要；
- 来源链接和数量；
- 证据状态、强度、覆盖度；
- 置信度；
- 规则版本、评估批次；
- 决定性规则和命中规则；
- 冲突与是否仍需人工复核；
- 评估时间、评估人；
- 最好、最可能、最坏等级；
- provenance。

字段缺失时保持为空，不伪造 `0`、`false` 或“无风险”。

## 严禁操作

- 用 Works `PATCH ?draft=false` 发布 AI 结论；
- 通过恢复旧 Work version 发布 AI 字段；
- 将私有或过时的 `works.radarAssessment` 当作公共结论；
- 为了生成 Radar 表迁移而接受与 Works 有关的 rename/drop DDL；
- 在迁移快照仍落后于实际数据库时生成或执行迁移；
- 让旧业务 `status` 参与 `_status` 或 `catalogStatus` 判断。

## 迁移恢复条件

只有满足以下条件，才允许重新讨论迁移生成：

1. Work 规范化候选记录已逐条审阅；
2. 旧人工字段已安全映射或明确放弃；
3. 已知冲突已做人工决定；
4. `status`、`legacy_x_wiki_page` 等废止字段有明确退役 SQL；
5. 数据库、Payload 模型和迁移基线三者一致；
6. 有新鲜可恢复备份；
7. 生成结果只包含批准的 schema；
8. SQL、回滚和验收查询均已逐行审阅。

## 当前入口

迁移入口已 fail closed：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\prepare-radar-public-conclusions-migration-v01.ps1
```

该命令应直接报错并指向只读候选审计，不得生成或执行迁移。
