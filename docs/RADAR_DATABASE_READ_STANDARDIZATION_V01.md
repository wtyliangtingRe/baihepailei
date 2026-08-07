# Radar 数据库读取标准化 v01

> 状态：网站读取层长期规范。  
> 日期：2026-08-07。  
> 适用仓库：`wtyliangtingRe/baihepailei`。  
> 上游结构审计：`docs/RADAR_DATABASE_STRUCTURE_AND_STANDARDIZATION_V01.md`。  
> 本文定义**如何读取和选择展示权威**；不授权数据库迁移、重评级、删除、历史 Release 改写或生产写入。

## 1. 目标

Radar 当前同时保存人工判断、历史 Published Release、AI Candidate、Research History 和 Works 兼容投影。它们可以属于同一作品，但不是同一种事实，也不能通过 `A || B || C` 互相补值。

本标准固定两个彼此独立的问题：

1. **哪些 lineage 与某个 exact work identity 匹配？**
2. **这些 lineage 共存时，谁拥有当前展示 authority？**

读取标准化不是重新评级。selector 只能选择已有结论，不能依据 Research 资料现场生成新等级。

---

## 2. Exact identity

唯一跨 lineage join 标准：

```text
identityKey = workId + "|" + siteId
```

读取层必须同时校验：

- `workIdSnapshot == expected workId`
- `workSiteId == expected siteId`
- 若数据行保存 `identityKey`，还必须等于 `workId|siteId`

硬规则：

- 禁止 title join；
- 禁止仅 `workId` join；
- 禁止仅 `siteId` join；
- `publicationKey` 只能用来缩小 Published 查询范围，不能替代 exact identity；
- `researchKey` 是研究记录版本键，不是作品 identity。

Published 查询允许先使用 `publicationKey = work:<Works id>`，但返回的 Record / Rating 必须再次通过 exact identity 校验；校验失败即拒绝该 Published 行。

---

## 3. 五条读取 lineage

### 3.1 Human Override

来源：Works 已存在的 `humanAssessment` / 人工复核兼容字段。

规则：

- 只有存在合法 grade 且状态不是 `pending` 的人工判断才拥有 authority；
- pending 表单不是人工结论；
- Human 获得 authority 时仍保留 Published、Candidate、Research 原始 lineage，禁止覆盖或删除。

### 3.2 Published

来源：

- `radar-public-records`
- `radar-public-ratings`

角色：正式 Published Release lineage。

成为 authority 的最低读取条件：

- Record 与 Rating 都存在；
- 两者 `recordStatus == current`；
- 两者都 exact identity 匹配；
- Rating 没有 `blocksPublication == true`。

旧 Published Release 不因为新 selector 上线而被重解释。旧行没有 `conclusionMode` 时：

- 若保存了合法且非单点的 `best / likely / worst`，读取层保留为 bounded range；
- 否则 `coreGrade` 只作为 legacy Published grade 投影；
- 不回写数据库；
- 不把历史 `D-UNCLEAR` 等模糊 token 强制转成固定 `D`。

### 3.3 AI Candidate

来源：`radar-public-conclusions`（物理表 `radar_public`）。

角色：AI Candidate / pending presentation lineage。

规则：

- 必须 `recordStatus == current`；
- 必须 exact identity 匹配；
- 即使 Candidate 有完整 bounded range，也仍然是 pending Candidate；
- Candidate 永远不能覆盖一个有效 Published authority；
- Candidate 的 grade 只能来自 Candidate 自己，不能从 Research `proposed*Grade` 补齐。

### 3.4 Research History

来源：`radar-research-records`。

角色：研究证据和后续队列历史。

规则：

- exact identity 查询；
- `proposedBestGrade / proposedLikelyGrade / proposedWorstGrade` 只是研究提案；
- Research-only 状态不得产生 public AI grade；
- selector 可以返回 `authority = research`，但 `grade = null`；
- 多条研究记录按时间排序并保留 history，不做破坏性去重。

### 3.5 Legacy Compatibility

来源：Works 的 `rank`、`radarAssessment`、`radarResearchPreview` 等历史/兼容投影。

角色：过渡兼容，不是新的 canonical authority。

规则：

- 只在 Human / Published / Candidate / Research 均没有更高 authority 时使用；
- 标记为 legacy/pending；
- `researchPreview.likelyGrade` 不得作为 `radarAssessment.suggestedGrade` 的 fallback；
- 新代码不得继续增加跨 lineage fallback。

---

## 4. Authority 顺序

固定顺序：

```text
valid Human Override
  > valid current Published Release
  > valid current AI Candidate (pending)
  > Research-only
  > Legacy Compatibility
  > Unassessed
```

这只是**展示 authority**，不是数据保留顺序。selector 输出必须保留完整 snapshot，因此：

- Published + Candidate：Published authority，Candidate 仍在 snapshot；
- Candidate + Research：Candidate authority/pending，Research 仍在 snapshot；
- Human + Published + Candidate：Human authority，其余 lineage 仍可追溯；
- Research-only：只表示存在研究资料，不生成 grade。

---

## 5. 结论模式

读取层接受以下模式：

### `fixed_grade`

- 一个合法等级；
- 读取 `coreGrade` 或 Candidate 的 `compatibilityGrade`；
- 非法 token 不自动修复。

### `bounded_range`

必须同时存在合法：

```text
bestGrade
likelyGrade
worstGrade
```

并满足由最好到最坏的顺序。`likelyGrade` 可作为单值兼容投影，但 `best/likely/worst` 必须全部保留，不能折叠成 midpoint 或只留下 `coreGrade`。

### `labels_only`

- 模式合法；
- grade 必须为空；
- 标签/风险信息仍可展示。

### `blocked`

- 模式合法；
- 无可公开 grade；
- 保留阻塞状态和 provenance。

### unknown / legacy

- 原样保留 raw mode / raw grade；
- 不猜测新语义；
- `D-UNCLEAR` 不转换为 `D`。

---

## 6. 标准读取结构

代码入口：

- `src/lib/radar/readStandardization.ts`
- `src/app/(frontend)/_lib/radar-read-repository.ts`

逻辑结构：

```text
RadarReadSnapshot
├─ identity { workId, siteId }
├─ humanOverride
├─ published
│  ├─ record
│  └─ rating
├─ candidate
├─ research
│  ├─ latest
│  ├─ history[]
│  └─ truncated
└─ legacyCompatibility
```

repository 只负责读取、exact binding 和 lineage 保留；`selectRadarAuthority()` 才负责选择 authority。不要在 repository 内按 grade 质量、置信度或来源数量重评级。

---

## 7. Payload 查询规则

### Published

第一层：

```text
publicationKey = work:<Works id>
recordStatus = current
```

第二层（必须）：

```text
workIdSnapshot == expected workId
workSiteId == expected siteId
identityKey == expected workId|siteId   # 字段存在时
```

### Candidate

直接 exact query：

```text
workIdSnapshot == expected workId
workSiteId == expected siteId
recordStatus = current
```

### Research

直接 exact query：

```text
workIdSnapshot == expected workId
workSiteId == expected siteId
recordStatus = current
sort importedAt descending
```

当前 repository 的 snapshot history 有读取上限，并通过 `research.truncated` / diagnostics 显式报告，不应把“只拿到前 N 条”伪装成完整历史。

---

## 8. 禁止的代码模式

禁止：

```ts
radarAssessment?.suggestedGrade || researchPreview?.likelyGrade
```

禁止：

```ts
publishedGrade || candidateGrade || researchProposedGrade
```

禁止：

```ts
where: { title: { equals: title } }
```

禁止把 Public Rating 映射回 Works 字段之后，再假装这些 Works 字段就是原始 lineage。旧 bridge 可以继续作为 legacy adapter，但新 authority 判断必须使用标准 snapshot。

---

## 9. 回归测试门禁

`tests/radar-database-read-standardization.test.mjs` 至少覆盖：

1. Published + Candidate -> Published authority，二者均保留；
2. Candidate + Research -> Candidate pending，Research 保留；
3. Research-only -> 无 public AI grade；
4. same workId / different siteId -> 不匹配；
5. same siteId / different workId -> 不匹配；
6. identityKey 不一致 -> 不匹配；
7. publicationKey 命中但 exact identity 错误 -> Published 被拒绝；
8. bounded range 保留完整 endpoints；
9. bounded range 缺失或逆序 -> 不发明 fixed grade；
10. `labels_only` -> 无 grade；
11. `blocked` -> 无 grade；
12. `D-UNCLEAR` -> legacy raw value，不变成 D；
13. valid Human -> Human authority；
14. pending Human -> 不覆盖 Published；
15. Research likely grade -> 不再成为 AI suggestion；
16. repository 不做 title query。

CI：`.github/workflows/validate-radar-database-read-standardization-v01.yml`。

---

## 10. 与旧 bridge / UI 的关系

`radar-public-rating-bridge.ts` 是历史兼容 adapter：它把 Published Rating 映射为 Works-shaped fields，供旧 detail/search 展示代码使用。它不能继续扩张为统一 authority layer，因为这种映射会隐藏 Published provenance。

迁移原则：

1. 新 selector/repository 先独立落地；
2. UI worker 可逐步改为消费 `RadarReadSnapshot + RadarAuthoritySelection`；
3. 在所有 detail/search/list 页面迁移完成前保留旧 bridge；
4. 最后再删除不再使用的 cross-lineage compatibility fallback。

这样可以避免数据库读取标准化 branch 与 UI 标准化 branch 同时改同一组件造成冲突。

---

## 11. 新数据源接入要求

未来任何新的 rating / candidate / research source 必须先回答：

- 它属于哪个 lineage？
- exact `workId|siteId` 从哪里来？
- 是否允许成为 authority？
- authority 位于当前顺序哪一层？
- 它是 canonical data 还是 compatibility projection？
- 如何保留 provenance / version / source hash？
- 与现有 lineage 重叠时是否共存？

如果这些问题没有明确答案，不得通过 fallback 把它接入公开 grade。

---

## 12. Schema / migration 边界

v01 是 read-layer standardization：

- 不新增 PostgreSQL view；
- 不迁移现有行；
- 不更新 `recordStatus`；
- 不回填 conclusionMode；
- 不改旧 Release；
- 不写 Works projection；
- 不清理重叠 identities。

若未来需要 schema 统一，应单独设计 migration proposal，并以本标准中的 lineage 与 exact identity 规则为前置门禁。

---

## 13. 维护者检查清单

修改 Radar 读取逻辑前检查：

- [ ] 是否使用 `workId + siteId` exact identity？
- [ ] 是否把 `publicationKey` 误当 identity？
- [ ] 是否出现 title join？
- [ ] Research 是否可能变成 Candidate grade？
- [ ] Candidate 是否可能覆盖 Published？
- [ ] bounded range 是否完整保留？
- [ ] labels-only / blocked 是否仍无 grade？
- [ ] legacy token 是否被擅自标准化？
- [ ] selector 是否保留所有 lineage provenance？
- [ ] 变更是否仍为 read-only？
- [ ] regression tests 是否覆盖新增 source/模式？

只要其中任一项无法确认，就不应把变更视为读取标准化完成。
