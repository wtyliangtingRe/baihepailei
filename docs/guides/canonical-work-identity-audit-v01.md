# Canonical Work 身份审计指南 v0.1

状态：只读证据阶段。尚未选择 canonical Work ID，尚未执行合并、引用重写、数据库写入或迁移。

## 为什么需要单独审计

评级规范化候选中可能同时出现同一作品的多个 Work：

- 人工审核在一个来源记录上；
- AI Radar 候选在另一个来源记录上；
- AniList、Bangumi 或其他来源分别导入成独立 Work；
- 两个记录可能有不同更新时间、外部 ID、子表、版本和被引用情况。

仅凭标题相似、ID 大小、来源名称或更新时间选择 canonical Work 都不安全。

## 决策原则

选择 canonical Work 前必须比较：

1. 标题、原名、别名和本地化标题；
2. 外部 ID 与来源字段；
3. 主表非空字段覆盖；
4. 子表和关系行；
5. Payload version 数量与版本子表；
6. 其他表对每个 Work 的入站引用；
7. 人工审核和 AI 候选分别落在哪个记录；
8. 选择某个 ID 后需要重指向或保留的内容。

更新时间只是证据之一，不能单独决定 canonical ID。

## 临时测试记录覆盖规则

当用户明确确认某一 identity alert 组是人工审核或 AI 评级测试产物，并授权重新标准化时：

- 现有人工审核等级、状态、说明、时间和审核人不作为 canonical ID 选择依据；
- 现有私有 AI、历史 `rank` 和公共 AI 候选不作为可信结论继承；
- 合并计划可将人工轨道重置为 `pending / unknown`；
- 合并计划不得从旧测试记录自动生成公共 AI 结论；
- canonical ID 仍必须依据作品事实、外部 ID、关系、引用和版本负担选择；
- 有用的作品事实可以合并，测试评级可以明确丢弃；
- 在备份、exact-before 校验和回滚方案完成前，仍不得直接执行数据库写入。

该覆盖规则只适用于用户明确指定的当前审计组，不能自动扩展到未来发现的其他重复作品。

## 推荐入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-canonical-work-identity-audit-v02.ps1 `
  -DryRunV02Directory .\exports\work-normalization-dryrun-v02-<timestamp>
```

v02 是当前唯一推荐入口。它在临时副本中修正 v01 的 PowerShell 字符串插值解析边界，执行后立即删除临时文件；原始脚本、数据库和 dry-run 产物保持不变。

入口会从 v02 dry-run 的 `canonical-identity-review-alerts.jsonl` 自动读取目标组和 Work ID，因此真实 ID 不写入仓库脚本或指南。

## 审计内容

审计会动态读取：

- 目标 `works` 完整物理行；
- 所有外键指向 `works` 的表；
- Payload `works_*` 子表中缺少外键但具有父 ID 形态的候选列；
- `_works_v` 版本行；
- 所有外键指向 `_works_v` 的版本子表；
- 每组主表字段差异；
- 每个 Work 的非空字段数、拥有的子表行、入站引用数和版本数。

字符传输沿用：

```text
PostgreSQL UTF-8 JSON
→ Base64 ASCII
→ PowerShell UTF-8
→ 逐行 JSON 校验
```

## 输出

输出目录与 ZIP 位于：

```text
exports/canonical-work-identity-audit-<timestamp>/
exports/CANONICAL-WORK-IDENTITY-AUDIT-<timestamp>.zip
```

主要文件：

- `input-identity-alerts.jsonl`
- `work-rows.jsonl`
- `relation-locators.json`
- `related-rows.jsonl`
- `version-relation-locators.json`
- `version-related-rows.jsonl`
- `identity-comparison.json`
- `identity-comparison.md`
- `validation.json`
- `manifest.json`

## 明确不做的事情

本审计不会：

- 自动选择 canonical Work；
- 合并或删除 Work；
- 修改外部 ID、别名、关系或版本；
- 搬迁人工审核；
- 发布 AI 结论；
- 执行 Payload PATCH、版本恢复、schema push 或迁移；
- 生成可执行写入 SQL。

## 进入合并计划前的门槛

每个身份组必须形成明确决定：

- canonical Work ID；
- 被合并 Work ID；
- 标量字段 latest-wins / canonical-wins 规则；
- 数组和关系的替换或保留规则；
- 人工审核的目标记录；
- AI 候选的目标记录；
- 所有引用重写清单；
- 版本历史保留策略；
- exact-before 校验、回滚和验收方案；
- 新鲜且已验证可恢复的备份；
- 用户明确批准执行。

真实作品记录和审计 ZIP 继续留在被忽略的 `exports/`，不得提交到仓库。
