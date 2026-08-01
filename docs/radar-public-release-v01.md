# Radar Public Release v01

`Radar Public Release v01` 是研究仓库与网站仓库之间的只读发布层。它让网站能够先上线可信子集，并在后续研究完成后持续增量更新，而不要求 35,610 条作品全部研究完毕。

## 边界

发布包只负责表达“当前允许网站读取的公开记录”，不直接执行任何数据库或网站写入：

- 不读取或写入 Payload；
- 不读取或写入 PostgreSQL；
- 不改变 `Works.humanAssessment`；
- 不把研究建议自动提升为正式评级；
- 不公开 `identity_review`；
- 不给 `needs_more_research` 强行生成评级；
- 不允许标题近似匹配或身份替换；
- 不包含密码、token、cookie、数据库 dump 或原始受限材料。

首阶段只有校验与 dry-run。数据库差异计划、人工批准和正式增量导入将在后续独立阶段实现。

## 包结构

每个发布目录必须是闭世界目录，只包含：

```text
manifest.json
records.jsonl
SHA256SUMS
```

`SHA256SUMS` 必须精确列出 `manifest.json` 与 `records.jsonl`，并使用 LF。`records.jsonl` 也必须使用 LF、无 BOM、以换行结尾。

## 三种公开状态

| publicState | 含义 | 是否允许评级 |
|---|---|---|
| `verified` | 当前公开字段已经达到发布门槛 | 只允许人工确认或明确批准公开的评级 |
| `partial` | 仅公开已有证据支持的事实，其他维度继续待查 | 可无评级；有评级时仍需正式批准 |
| `needs_more_research` | 已确认作品身份，但公开资料不足 | **禁止携带 assessment** |

`identity_review` 不属于公开状态，必须留在内部审核队列，不得进入 Public Release。

## 证据约束

每条公开事实必须：

1. 使用稳定的 `factId`；
2. 引用一个或多个存在的 `sourceRef`；
3. 至少有一条引用不是 `lead_only`；
4. 所有来源都声明 `exactIdentityBound: true`；
5. 来源 URL 使用 HTTPS。

D/E 社区资料可以作为检索线索或补充材料，但仅标为 `lead_only` 的来源不能单独支撑公开事实或评级。

## 评级约束

公开评级是可选字段。存在时必须：

- `track` 为 `human` 或 `radar`；
- `reviewStatus` 为 `human_verified` 或 `approved_for_publication`；
- 绑定 `policyVersion`、审核时间和证据引用；
- 不包含 suggested、provisional、bounded range、automatic grade 等候审字段。

研究档案、AI 建议、区间结论和标签提示仍可保留在内部数据层，但不会因为进入研究仓库就自动成为公开评级。

## 身份与增量更新

网站侧以精确的 `identityKey = workId|siteId` 对齐记录。发布导入不得：

- 用相似标题寻找替代作品；
- 把同系列、重制版、漫画版、动画版或不同路线互相替换；
- 覆盖人工验证内容；
- 删除网站中不在本次增量包里的条目。

后续增量导入将先生成差异计划，分别列出：新增、可安全更新、人工冲突、身份阻断和无变化；只有人工批准后的安全集合才能进入正式写入阶段。

## 校验命令

```powershell
node scripts/radar/validate-public-release-v01.mjs `
  --input "路径\RADAR-PUBLIC-RELEASE-0001"
```

默认报告写入：

```text
data_local/outputs/radar-public-release-v01/dry-run-report.json
```

输出报告明确保持：

```text
canImport=false
payloadWrite=false
postgresqlWrite=false
websiteMutation=false
publicationAction=false
```

校验器会拒绝 `--execute`、`--apply`、`--write`、`--patch`、`--confirm`、`--publish`、`--release`、`--production-apply`、`--approval-token`、`--migrate` 与 `--schema-push`。

## 闭环路线

```text
research-data canonical snapshot
→ Public Release exporter
→ checksum-bound release package
→ website validation dry-run
→ current Payload snapshot comparison
→ human conflict review
→ approved incremental apply package
→ one-shot database apply
→ public index rebuild
→ smoke test and rollback receipt
```

本版本完成的是发布契约与第一层 dry-run 校验。后续步骤必须继续保持独立 PR、独立安全门和可回滚回执。
