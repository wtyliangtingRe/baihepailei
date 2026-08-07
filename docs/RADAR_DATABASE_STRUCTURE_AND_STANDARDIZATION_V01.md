# Radar 数据库结构与标准化参考 v01

> 状态：长期参考文档 / 只读审计结论。  
> 审计日期：2026-08-07。  
> 仓库：`wtyliangtingRe/baihepailei`。  
> 基准网站 `main`：`84ecc074a8ffd6065ace52301954382806a5c990`。  
> 数据源：候选上线 PostgreSQL Docker 数据库的 `pg_dump --schema-only`、精确表计数、Radar 只读统计与 identity crosswalk。  
> 本文不授权数据库迁移、删除、清理、生产导入或历史 Release 改写。

## 1. 为什么存在这份文档

Radar 数据库经历了多代 Research、Assessment、Public Release 和网站兼容流程。物理表名中存在若干容易误解的名称，尤其是：

- `radar_public_records`
- `radar_public_ratings`
- `radar_public`
- `radar_research_records`
- `works` 内嵌的 legacy Radar 字段

2026-08-07 对真实候选数据库完成只读 crosswalk 后已经确认：`radar_public` **不是** `radar_public_ratings` 的简单缓存，两者是不同数据流水线。因此后续查询、导入和 UI 不能再仅凭表名或总行数推断语义。

本文固定当前已确认的结构、字段语义和工程边界，供后续代码、迁移、查询、导入器和新会话直接引用。

---

## 2. 当前数据库快照

PostgreSQL：

- PostgreSQL `17.10`
- 数据库：`baihepailei`
- 候选数据库大小：约 `454 MB`
- `public` schema 表数：`102`

关键表精确行数：

| 表 | current / 精确行数 | 当前职责 |
| --- | ---: | --- |
| `works` | 35,615 | Canonical 网站作品目录 / Payload 主实体 |
| `radar_research_records` | 25,048 | Research 历史与 Assessment 输入 |
| `radar_public_records` | 10,563 | 历史正式 Public Record |
| `radar_public_ratings` | 10,563 | 历史正式 Public Rating |
| `radar_public` | 10,804 | v0.6 AI candidate / presentation 数据集 |
| `_works_v` | 82,898 | Payload Works 版本历史 |

隐私相关现状（仅用于 dump 安全边界）：

- `users`: 4
- `users_sessions`: 16
- `comments`: 4
- `feedback_submissions`: 9
- `audit_events`: 31,747
- `payload_preferences`: 30
- `payload_locked_documents`: 1
- `radar_public_ratings.human_review_reviewer_identity` 非空：0
- Works 人工 reviewer FK 非空：4

完整数据库 dump 不应默认包含上述账户、session、评论、反馈、审计、preferences、locked documents、token/hash 或 reviewer identity 数据。

---

## 3. 已确认的三轨模型

### Track A — `published_release`

物理表：

- `radar_public_records`
- `radar_public_ratings`

语义：

- 已形成正式 Public Record / Public Rating Release 的历史公开轨；
- 两表当前均为 10,563 identities；
- Record 与 Rating exact identity 集合 1:1 对齐；
- `record_without_rating = 0`；
- `rating_without_record = 0`；
- work ID snapshot / siteId / title snapshot mismatch = 0；
- 这是当前最可信的正式公开 lineage；
- 但其中大量结果来自旧政策，不能等同于当前 v0.5 新评级语义。

### Track B — `ai_candidate`

物理表：

- `radar_public`

逻辑角色：

- `ai_candidate_projection`

语义：

- v0.6 generalized dry-run / closeout / blocked-research 生成的 AI 候选数据集；
- current 10,804 identities；
- 9,926 条 `ai_synthesized_pending_review`；
- 878 条 `insufficient_information`；
- policy lineage 为 `radar-rating-policy-v0.6-generalized-dryrun`；
- 不是 Track A 的缓存；
- 不应静默覆盖正式 Public Rating；
- 查询/UI 必须显式保留 candidate / pending 身份。

### Track C — `research_history`

物理表：

- `radar_research_records`

语义：

- 真实研究历史；
- 保存来源、风险信号、未解决问题、proposed range 和下一步队列；
- 不等同于“当前一作品一条最终结论”；
- 当前 25,048 current rows；
- 当前 crosswalk 中 distinct identity 也是 25,048，暂无重复，但 schema 仍应允许历史上同 identity 多次 Research；
- Research 不得直接写正式 Public Rating。

---

## 4. Crosswalk 最终结论

Track A Public Ratings 与 Track B `radar_public`：

- `radar_public`: 10,804
- `radar_public_ratings`: 10,563
- exact `workId|siteId` overlap: 12
- siteId overlap: 12
- current `work_id` overlap: 12
- `work_id + siteId` overlap: 12
- `radar_public` only: 10,792
- Public Rating only: 10,551
- 两边 duplicate siteId: 0

两边 identity 本身均健康：

- Track B：`work_id_snapshot == work_id` 为 10,804 / 10,804；
- Track B：`work_id + siteId` 精确回到 `works` 为 10,804 / 10,804；
- Track A Ratings：`work_id_snapshot == work_id` 为 10,563 / 10,563；
- Track A Ratings：`work_id + siteId` 精确回到 `works` 为 10,563 / 10,563。

因此：

> 两套集合不是 ID 损坏，也不是同一 population 的编码漂移，而是两条不同的数据流水线。

此前“`radar_public` 只是 Public Ratings 的可重建缓存”的旧假设已废弃。

---

## 5. Exact identity 标准

跨仓库、Research、Assessment、Release、数据库导入统一使用：

```text
identityKey = workId + "|" + siteId
```

数据库字段语义：

| 字段 | 语义 |
| --- | --- |
| `works.id` / `work_id` | 当前数据库内部 FK；不能在另一套新数据库中盲目当作稳定 surrogate |
| `work_id_snapshot` | 该记录冻结时的 canonical work ID snapshot |
| `work_site_id` / `site_id` | 稳定站点 identity |
| `identity_key` | Track A Records / Ratings 已显式保存的 exact join key |
| `publication_key` | 某条发布记录的稳定 key，不是作品 identity |
| `research_key` | 某次 Research record 的稳定 key，不是作品 identity |

当前候选库内 Track A/B 均满足 `work_id_snapshot == work_id`，但未来导入器仍必须通过 Canonical registry / Works exact identity 映射验证，不能假设另一数据库自动生成的 surrogate ID 保持不变。

硬规则：

- 禁止标题 join；
- 禁止仅凭标题相同合并作品；
- 禁止把 `publication_key` 或 `research_key` 当成作品 identity；
- 导入时必须验证 `workId|siteId` exact membership。

---

## 6. `works` 主表关键字段

`works` 是网站 Canonical / Payload 主实体。关键字段组如下。

### Identity / catalog

```text
id
title
slug
original_title
site_id
media_type
media_group
format
catalog_status
status
_status
updated_at
created_at
```

### External IDs

```text
external_ids_bangumi_subject_id
external_ids_anilist_media_id
external_ids_vndb_id
external_ids_wikidata_qid
external_ids_mal_id
external_ids_official_url
```

### Group / import

```text
work_group_key
work_group_title
work_group_relation
work_group_order_label
work_group_source
work_group_confidence
work_group_note
import_batch
```

### Legacy / compatibility Radar fields

```text
rating_notice
chosen_base_source
source_conflict_notes
radar_assessment_confidence_percent
radar_assessment_evidence_coverage_percent
radar_assessment_evidence_status
radar_assessment_source_summary
radar_assessment_policy_version
radar_assessment_assessed_at
radar_assessment_source_count
radar_assessment_assessment_batch
radar_assessment_suggested_grade
radar_assessment_decisive_rule_code
radar_assessment_decisive_rule_reason
radar_assessment_requires_human_review
```

这些 `works.radar_assessment_*` 字段是 legacy / compatibility 投影，不具备完整的 `best / likely / worst + conclusionMode` 模型，后续不能作为 AI Public Rating 的唯一权威来源。

### Human review / human assessment

```text
human_review_note
human_reviewed_at
human_reviewed_by_id
human_assessment_grade
human_assessment_status
human_assessment_note
human_assessment_source_summary
human_assessment_evidence_status
human_assessment_assessed_at
human_assessment_assessed_by_id
```

人工轨优先级必须独立于 AI candidate / AI Public Rating。

---

## 7. `radar_research_records` 结构

主表关键字段：

```text
id
research_key
title
program_id
import_batch
batch_id
wave
lane
milestone
work_id
work_id_snapshot
work_site_id
record_shape
research_status
yuri_relevance
proposed_best_grade
proposed_likely_grade
proposed_worst_grade
source_summary
confidence_percent
recommended_next_action
recommended_next_queue
research_note
source_response_sha256
imported_at
record_status
updated_at
created_at
```

子表：

### Sources

`radar_research_records_sources`

```text
_order
_parent_id
id
title
url
source_type
```

### Risk signals

`radar_research_records_risk_signals`

```text
order
parent_id
value
id
```

### Unresolved questions

`radar_research_records_unresolved_questions`

```text
_order
_parent_id
id
value
```

Research 当前状态：

- `partial`: 24,561
- `insufficient`: 474
- `resolved`: 13

`recommendedNextQueue = full_assessment` 当前有 2,797 条；这些记录的 proposed grades 均缺失，因此含义是“适合进入 Assessment”，不是“评级已完成”。

---

## 8. Research proposed range 的真实状态

当前 Research proposed 三值统计：

- raw proposed bounded: 1,430
- fixed: 11
- 任意 proposed grade 缺失: 23,607

1,430 个 raw bounded 中：

- 1,105 条为 S/A/B/C/D/E/F 的合法有序范围；
- 325 条为旧 `unknown / D / unknown`；
- 1,105 条合法范围全部满足 `best <= likely <= worst`；
- 1,103 条合法范围仍为 `partial`；
- 2 条合法范围为 `resolved`。

两个 resolved bounded identity：

```text
33306|VNDB-V18419  C -> D -> D
33312|VNDB-V18550  D -> D -> E
```

重要规则：

- `unknown` 不是 v0.5 grade；
- 325 个 `unknown / D / unknown` 不得机械转换为例如 `C / D / E`；
- 1,103 个 partial valid ranges 是 Assessment candidate，不得直接公开；
- 2 个 resolved valid ranges 应优先进入新 policy Assessment review；
- 不得从 `unresolved_dimensions` 自动编造区间。

Crosswalk 还确认：1,430 个 Research raw bounded identities 全部存在于 Track B `radar_public`，但与 Track A Public Ratings 的 exact/siteId/current-FK overlap 均为 0。这证明 Research range 流向了旧 v0.6 candidate 轨，而没有形成历史正式 Public Rating Release。

---

## 9. `radar_public_records` 结构 — Track A Public Fact

主表关键字段：

```text
id
publication_key
work_id
identity_key
work_id_snapshot
work_site_id
title
public_state
research_status
page_notice
source_release_id
source_commit_sha
source_policy_version
research_snapshot_id
record_sha256
release_records_sha256
source_reviewed_at
imported_at
record_status
updated_at
created_at
```

重要唯一索引：

```text
identity_key UNIQUE
publication_key UNIQUE
```

关键子表：

### Facts

`radar_public_records_facts`

```text
_order
_parent_id
id
fact_id
fact_type
value
```

### Fact source refs

`radar_public_records_facts_source_refs`

```text
_order
_parent_id
id
value
```

### Evidence

`radar_public_records_evidence`

```text
_order
_parent_id
id
source_ref
tier
role
url
title
exact_identity_bound
```

Public Record 是公开事实/evidence 权威层，不承担评级决定本身。

---

## 10. `radar_public_ratings` 结构 — Track A Public Rating

主表关键字段：

### Identity

```text
id
publication_key
work_id
identity_key
work_id_snapshot
work_site_id
title
```

### Grade / range

```text
core_grade
best_grade
likely_grade
worst_grade
confidence
confidence_percent
evidence_coverage_percent
reasoning_summary
classification_rule
benefit_of_doubt_baseline_applied
```

当前 schema 尚无一等 `conclusion_mode` 字段。

当前兼容推导：

```text
best == likely == worst -> fixed_grade
否则                     -> bounded_range
```

注意 PostgreSQL 中四个 grade 字段由 Payload 生成了不同 enum 类型，SQL 互相比较时必须使用 `::text`，例如：

```sql
best_grade::text = likely_grade::text
```

### Human review

```text
human_review_status
human_review_reviewer_identity
human_review_reviewed_at
human_review_decision
human_review_proposed_core_grade
human_review_reasoning
human_review_moderation_state
human_review_blocks_analysis
human_review_blocks_publication
```

### Release / lineage

```text
source_release_id
source_commit_sha
source_policy_version
research_snapshot_id
source_rating_campaign_id
source_rating_decision_hash
release_rating_hash
release_ratings_sha256
imported_at
record_status
```

### Metrics

```text
metrics_policy_version
source_metrics_policy_version
relationship_evidence_state
metrics_source_release_id
metrics_calculation_basis_sha256
requires_metric_review
```

重要唯一索引：

```text
identity_key UNIQUE
publication_key UNIQUE
```

关键子表：

```text
radar_public_ratings_confirmation_basis
radar_public_ratings_evidence_refs
radar_public_ratings_fact_refs
radar_public_ratings_matched_classes
radar_public_ratings_public_tag_hints
radar_public_ratings_public_warning_template_ids
radar_public_ratings_unresolved_dimensions
radar_public_ratings_human_review_additional_evidence_refs
radar_public_ratings_human_review_proposed_profile_changes
```

其中 `public_tag_hints` 字段：

```text
_order
_parent_id
id
key
group
value
warning_template_id
```

当前 Track A Rating 状态：

- fixed: 10,563
- bounded: 0
- `coreGrade != likelyGrade`: 0
- `D-UNCLEAR`: 9,811（约 92.88%）
- B: 658
- D: 9,893
- E: 12
- unresolved dimension child rows: 111,857

旧 `D-UNCLEAR` 不能解释为“明确 D 级”，也不能机械转换为新范围。它们必须由新 Research/Assessment/Release 分流。

---

## 11. `radar_public` 结构 — Track B AI candidate

主表关键字段：

### Identity / state

```text
id
publication_key
work_id
work_id_snapshot
work_site_id
title
record_status
```

### Conclusion

```text
conclusion_mode
compatibility_grade
best_grade
likely_grade
worst_grade
rating_notice
evidence_strength
```

`conclusion_mode` schema 当前已有至少：

```text
fixed_grade
bounded_range
```

### Compatibility assessment projection

```text
radar_assessment_confidence_percent
radar_assessment_evidence_coverage_percent
radar_assessment_evidence_status
radar_assessment_source_summary
radar_assessment_source_count
radar_assessment_policy_version
radar_assessment_assessment_batch
radar_assessment_suggested_grade
radar_assessment_decisive_rule_code
radar_assessment_decisive_rule_reason
radar_assessment_requires_human_review
radar_assessment_assessed_at
```

### Source / candidate lineage

```text
source_kind
source_package_id
source_package_sha256
conclusion_sha256
publication_version
published_at
updated_at
created_at
```

关键子表：

```text
radar_public_radar_assessment_contradictions
radar_public_radar_assessment_matched_rules
radar_public_review_reasons
```

重要：

- `radar_public` 有 `publication_key` 唯一语义，但没有 Track A 那样的显式 `identity_key UNIQUE` 字段；
- 当前 crosswalk 已确认它自身 siteId 无重复且 identity 健康；
- 它当前属于 AI candidate/presentation 轨，不应被命名或展示为“正式 Public Rating”。

---

## 12. v0.5 / 后续 conclusion semantics

新政策设计要求把“固定 AI 等级”和“AI 暂定范围”重新区分。

目标 conclusion modes：

```text
fixed_grade
bounded_range
labels_only
blocked
```

规则：

### `fixed_grade`

```text
bestGrade == likelyGrade == worstGrade
coreGrade == likelyGrade
```

### `bounded_range`

```text
bestGrade <= likelyGrade <= worstGrade
coreGrade == likelyGrade   # 仅兼容投影
```

UI 必须显示范围，不能把 `coreGrade` 当成固定评级。

### `labels_only`

只有可公开事实 / warnings / labels，证据不足以给合法 grade/range。

### `blocked`

身份、policy 或其它强门禁阻止生成结论。

机器不得把 X 写入 grade/range；X 仍为人工专属。机器只能生成独立的 `X 风险候选` warning 并强制人工复核。

---

## 13. v0.5 加速排雷 warning 设计

新 warning group：

```text
加速排雷
```

setting / identity warning IDs：

```text
accelerated-radar-setting-ts
accelerated-radar-setting-futa
accelerated-radar-setting-abo
accelerated-radar-setting-otokonoko-crossdressing
accelerated-radar-setting-queer-general
accelerated-radar-core-identity-boundary
```

X risk：

```text
accelerated-radar-x-risk-candidate
```

规则：

- setting warning 本身不改变 core grade；
- 不单凭 setting warning 声称欺诈；
- 必须绑定 exact-work affirmative evidence；
- `X 风险候选` 不是 X grade；
- machine 不得写 X；
- public X-risk warning 需要足够的直接/独立证据并强制 human review。

Creator attitude/safety 已从本轮 v0.5 公共 assurance 中移出，未来另做作者管理政策。

---

## 14. 标准查询语义

业务代码以后必须显式选择轨道。

### Published

来源：

```text
radar_public_records
+
radar_public_ratings
```

用途：历史/当前正式 Public Release。

### Candidate

来源：

```text
radar_public
```

用途：AI candidate / insufficient projection；必须保留 pending 标识。

### Research

来源：

```text
radar_research_records
```

用途：研究历史、proposed range、下一步队列；不直接当正式评级。

建议未来只读逻辑 surfaces：

```text
radar_v2_identity_current
radar_v2_published_record_current
radar_v2_published_rating_current
radar_v2_ai_candidate_current
radar_v2_research_history
radar_v2_research_latest
radar_v2_work_status
```

注意：这是逻辑合同。若实现为 PostgreSQL `CREATE VIEW`，仍然属于数据库 schema 写入，必须走独立 migration PR、dry-run、备份和明确授权。

---

## 15. 网站展示优先级

推荐 effective display authority：

1. 有效人工 override；
2. active formal Published Release；
3. AI candidate，必须明确显示 AI / pending；
4. Research-only / labels-only 状态；
5. unassessed。

已有旧正式 Rating 时，AI candidate 不得静默覆盖。新 v0.5/vNext Assessment 只有在形成新的正式 Release 后才进入正式 Published authority。

对于同时存在于 Track A 和 Track B 的 12 个 identity，应保留来源并由明确优先级选择，而不是 `COALESCE` 后丢掉 lineage。

---

## 16. 标准导入包

### 16.1 Published Release package

```text
manifest.json
identities.jsonl
public-records.jsonl
public-ratings.jsonl
SHA256SUMS
```

这是唯一允许写正式 Public Record / Public Rating 的包。

### 16.2 Assessment Candidate package

```text
manifest.json
identities.jsonl
assessment-candidates.jsonl
research-links.jsonl
SHA256SUMS
```

不得直接写 Public Rating。

### 16.3 Research package

```text
manifest.json
identities.jsonl
research-records.jsonl
source-index.jsonl
SHA256SUMS
```

不得直接写 Public Rating。

三类包的 `manifest.json` 至少必须保存：

```text
packageKind
schemaVersion
policyBundleId
policyBundleSha256
identityInventorySha256
sourceRepository
sourceCommit
rowCounts
memberHashes
```

不得仅根据 ZIP 文件名猜 package 类型。

---

## 17. Published Release 标准导入流程

推荐固定流程：

1. 校验 archive / manifest / member SHA；
2. 校验 exact identity inventory；
3. 校验 `workId|siteId` 对 Canonical / Works exact membership；
4. 验证 Public Record identities == Public Rating identities；
5. staging；
6. dry-run diff；
7. 备份；
8. transaction + DB lock；
9. upsert Public Records；
10. upsert Public Ratings；
11. 刷新/重建读取模型；
12. exact readback；
13. 写 apply receipt。

禁止：

- title join；
- candidate 包写正式 Rating；
- Research 包写正式 Rating；
- 用 `radar_public` 作为第三份独立 Published input 再导一次；
- 无 dry-run / backup / readback 的生产 apply。

---

## 18. Unicode / CSV 导出标准

2026-08-07 审计发现：把包含中文/日文标题的 PostgreSQL `COPY` 输出经过：

```text
Docker stdout -> PowerShell string -> 再写 UTF-8
```

会有 mojibake / CSV quoting 损坏风险。

后续含正文/标题的导出应使用：

1. 容器内执行 `COPY (...) TO STDOUT WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')`；
2. 直接重定向到容器 `/tmp/...` 文件；
3. 使用 `docker cp` 原字节复制到 Windows；
4. 不让 PowerShell 捕获并重新编码 CSV 正文；
5. 对结果生成 SHA-256。

汇总 JSON 若经过 stdout，必须使用 `psql -A -t` 或等价 tuples-only / unaligned 输出，避免列名和分隔线污染 JSON。

---

## 19. Payload 版本历史

`_works_v` 当前约 82,898 rows，主表约 98 MB，连同其版本子表占据数据库相当一部分空间。

这不是立即删除理由。

未来只能在：

- 备份已验证；
- restore 演练通过；
- 明确版本保留规则；
- 能区分人工重要版本和批量机械导入版本；
- 独立迁移/清理 PR；

之后再考虑压缩或清理。

---

## 20. 当前不应执行的事情

在查询层和 policy 合并完成前，不应：

- 清空或删除 `radar_public`；
- 把 Track B candidate 批量提升成 Track A Published Rating；
- 把 9,811 个 `D-UNCLEAR` 机械映射为 B、D 或某个区间；
- 把 325 个 `unknown / D / unknown` 机械变成合法 range；
- 根据 unresolved dimensions 编造 best/worst；
- 对生产候选库直接执行 review-draft `CREATE VIEW`；
- 改写历史 immutable Release；
- 把旧 Track A 和 Track B 通过标题合并。

---

## 21. 当前工程顺序

推荐顺序：

1. 修复并完成 v0.5 policy 双仓库 PR；
2. 网站仓库实现只读 Track A/B/C repository/query layer；
3. 先通过代码级 selector + tests 标准化读取，不碰生产数据；
4. 增加 published / candidate / research parity tests；
5. 对 9,811 个历史 `D-UNCLEAR` 生成 v0.5 reassessment inventory；
6. 对 1,105 个合法 Research ranges 生成 Assessment candidate inventory；
7. 新 Assessment 产生正式新 Release；
8. 另开 production migration/apply PR；
9. 最后才决定旧 candidate projection / Payload history 的归档与清理。

---

## 22. 相关政策状态（记录于 2026-08-07）

网站 v0.5 compatibility PR：

- PR `#339`
- branch: `agent/radar-policy-v0.5-website-compatibility-v01`
- head（审计时）：`d1e5cb1f044e978459d89c597f80d060bbf6dfca`
- 仅 docs/config；尚未实现 runtime UI parity；无 DB migration / Payload/PostgreSQL write。

Research-data v0.5 policy PR：

- PR `#315`
- branch: `agent/radar-policy-v0.5-unification-v01`
- 审计时曾因 Markdown trailing whitespace 触发 `git diff --check` failure；新会话必须重新实时验证，不能从本文假设它仍失败或已经合并。

因此：

> v0.5 是否“已正式 active”必须由新会话重新验证两个仓库最新 main、PR、CI 和 website runtime parity；本文不把瞬时 PR 状态当作长期事实。

---

## 23. 审计依据与可重复性

本轮数据库只读审计使用过以下包/检查：

- schema + table inventory；
- exact table counts + privacy check；
- Radar standardization diff；
- identity crosswalk；
- Research proposed range crosswalk。

关键已验证事实：

- schema 文件和 inventory SHA 匹配；
- exact audit archive member SHA 匹配；
- standardization diff archive member SHA 匹配；
- identity crosswalk archive member SHA 匹配；
- 数据库审计过程不执行持久化写入。

若未来数据库内容发生生产迁移，本文的数字即成为历史 snapshot；字段职责和三轨逻辑仍应作为迁移时的比较基准，新的审计结果应另建版本而不是静默覆盖本文件。

---

## 24. 一句话原则

> `works` 管身份；Research 管研究历史；`radar_public` 当前管 AI candidate；Public Records + Public Ratings 管正式 Release。任何查询和导入都必须显式知道自己正在操作哪一轨，并始终用 `workId|siteId` 做 exact identity。