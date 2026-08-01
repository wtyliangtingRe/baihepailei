# Radar Public Records Plan v01

这一阶段把 `Radar Public Release v01` 转换为网站数据库的**只读差异计划**。它不会写入 Payload、PostgreSQL、Works、人工评级或旧 Radar 评级。

## 独立集合

`src/collections/RadarPublicRecords.ts` 定义新的 `radar-public-records` 集合。它专门保存无评级的公开研究投影：

- `verified`、`partial`、`needs_more_research` 资料状态；
- 已绑定精确作品身份的公开事实；
- HTTPS 证据与来源层级；
- 来源发布包、研究 commit、policy、快照和 SHA-256；
- 每个 Works 记录稳定使用 `publicationKey = work:<Works ID>`。

它不会包含：

- `humanAssessment`；
- `radarAssessment`；
- `compatibilityGrade` 或任何建议等级；
- 风险矩阵、关系结论或推断结局；
- 对 Works 的覆盖写入。

集合定义在本阶段只接受 schema review。它尚未注册进 `payload.config.ts`，也没有生成或运行数据库迁移；这两个动作必须在后续独立 migration PR 中完成。

## 精确身份匹配

Planner 同时要求：

```text
Public Release workId == Payload Works.id
Public Release siteId == Payload Works.siteId
```

两个索引必须指向同一个 Works 记录。以下情况全部阻断：

- 仅标题相同；
- work ID 不存在；
- siteId 不存在；
- work ID 与 siteId 分别指向不同作品；
- Works ID 或 siteId 重复；
- 已有公开记录绑定到不同身份；
- 同一个 `publicationKey` 存在多条 current 记录。

Planner 不创建 Works，也不尝试系列、版本或同名作品替换。

## 离线规划

```powershell
node scripts/radar/plan-public-release-v01.mjs `
  --input "D:\path\RADAR-PUBLIC-RELEASE-0001" `
  --works-file "data_local\payload\works-current.json" `
  --public-records-file "data_local\payload\radar-public-records-current.json"
```

若集合还没有数据，可以省略 `--public-records-file`。

## 连接本地 Payload 只读规划

```powershell
$env:RADAR_PAYLOAD_EMAIL = "你的本地管理员邮箱"
$env:RADAR_PAYLOAD_PASSWORD = "你的本地管理员密码"

node scripts/radar/plan-public-release-v01.mjs `
  --input "D:\path\RADAR-PUBLIC-RELEASE-0001" `
  --url "http://localhost:3000" `
  --allow-missing-public-collection
```

`--allow-missing-public-collection` 只用于迁移前：Works 仍会从 Payload 读取，而尚不存在的 `radar-public-records` 集合被视为空集合。它不会掩盖 Works 读取或身份匹配错误。

## 输出

输出固定留在 `data_local`：

```text
data_local/outputs/radar-public-release-v01/plan/
  radar-public-release-v01-plan.jsonl
  radar-public-release-v01-ready.jsonl
  radar-public-release-v01-blocked.jsonl
  radar-public-release-v01-already-current.jsonl
  radar-public-release-v01-plan-summary.json
```

计划状态：

- `ready_create`
- `ready_update`
- `already_current`
- `blocked_missing_exact_work`
- `blocked_identity_conflict`
- `blocked_duplicate_work_id`
- `blocked_duplicate_site_id`
- `blocked_duplicate_current_publication`
- `blocked_existing_publication_identity_conflict`

无论结果如何，summary 都保持：

```text
payloadWrite=false
postgresqlWrite=false
worksMutation=false
humanAssessmentMutation=false
radarAssessmentMutation=false
publicRecordMutation=false
canApply=false
```

## 后续闭环

1. 在本地 Payload / Docker 上运行真实 Works 只读规划；
2. 复核所有 identity blockers；
3. 生成并审查 additive schema migration；
4. 在隔离数据库进行 migration rehearsal；
5. 重新规划并生成 one-shot apply candidate；
6. 备份、执行一次、核对回执；
7. 前台读取 `radar-public-records`，展示资料状态、事实与来源；
8. smoke test、回滚演练与上线。
