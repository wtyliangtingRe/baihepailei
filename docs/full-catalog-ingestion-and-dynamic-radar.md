# 全量资料库导入与动态排雷基础

本文档记录 Baihepailei 下一阶段的数据路线。它延续 Public Catalog structured review 阶段已经完成的安全原则和审计习惯，但把工作重心从“少量结构化复核队列”推进到“全量资料库导入、同作品多来源连接、开放状态标识、动态排雷和社区协作”。

## 1. 阶段定位

当前 Public Catalog structured review 工作已经证明：

- 可以把一批 Public Catalog 数据安全导入 Payload。
- 可以给作品补齐 `importBatch`、`ratingNotice`、`chosenBaseSource`、`reviewReasons`、`sourceConflictNotes` 等结构化字段。
- 可以通过 planner / apply / audit 形成可复查链路。
- 可以在 `/me/review/public-catalog` 中用只读 UI 展示复核原因、分级提示和导入批次。

下一阶段不再只围绕已经导入的 Public Catalog v0.2 工作，而是开始建立更完整的资料库底座：

```text
全量来源扫描
→ 来源记录标准化
→ 合理条目公开入库
→ 同作品多来源连接
→ 不确定状态公开标识
→ 动态排雷
→ 社区补充与人工守夜
```

本阶段目标不是立刻给所有作品做出排雷结论，而是让所有合理作品先进入资料库，同时清楚标明数据来源、身份连接状态、资料完整度和排雷状态。

## 2. 核心原则

### 2.1 不因未知而隐藏

只要条目显然属于动画、漫画、小说、轻小说、游戏、视觉小说、广播剧、同人作品、相关改编或相关衍生，就应尽可能进入资料库。

排雷未知不是隐藏理由。正确做法是显示状态：

- `not_evaluated`：尚未评估。
- `insufficient_information`：资料不足，无法判断。
- `ai_synthesized_pending_review`：AI 综合，待复核。
- `dynamic_tracking`：动态追踪中。
- `disputed`：存在争议。

### 2.2 排雷是状态，不是入库门槛

资料库收录和排雷判断应分开。作品可以先作为资料条目出现，即使当前无法判断关系走向、结局、雷点或百合相关性。

页面需要实事求是地告诉用户当前状态，而不是把冷门、资料少或身份不确定的作品藏起来。

### 2.3 合并不等于删除来源

同一作品来自多个来源时，应合并为一个作品条目，但保留所有来源记录。来源是证据，不应该在合并过程中被吞掉。

推荐逻辑：

```text
Work           公开作品条目
SourceRecord   原始/规范化来源记录
IdentityLink   来源记录与作品之间的身份连接
RadarAssessment 排雷判断及其版本、证据和状态
```

### 2.4 不确定身份也可以公开

如果两个来源疑似同一作品但不能确认，不应让它们永远停在审计队列里。可以先公开显示，并标记：

- `identity_unknown`：身份待确认。
- `possible_duplicate`：可能重复。
- `identity_conflict`：身份冲突。

页面可以提示：

```text
这个条目可能与另一个同名或相近条目是同一作品，当前尚未确认。
```

### 2.5 明显无关才隔离

只有以下情况应进入隔离或忽略清单，而不是进入作品资料库：

- 系统页面。
- 垃圾账号或广告页。
- 空页面。
- 明显非作品。
- 恶意数据。
- 纯人物、组织或术语，且无法关联到作品。

冷门、资料少、分类不确定不是隔离理由。

### 2.6 管理员是守夜人，不是最终裁判

Baihepailei 的目标是互助社区，不是一言堂的警察网站。

管理员职责是维护秩序、结构、证据和透明度：

- 防止垃圾数据污染。
- 防止恶意编辑。
- 防止无证据断言。
- 防止 AI 草稿被伪装成人工确认。
- 防止争议被伪装成结论。
- 防止作品因为不确定而被错误删除或隐藏。

## 3. 数据状态模型

### 3.1 作品资料状态：`dataStatus`

用于说明资料完整度，而不是排雷结论。

```text
source_only   仅来源收录
minimal       基础资料
partial       部分资料
adequate      资料较完整
conflicting   资料冲突
```

### 3.2 身份连接状态：`identityStatus`

用于说明同作品多来源连接是否可靠。

```text
single_source            单来源
multi_source_confirmed   多来源已确认
possible_duplicate       可能重复
identity_conflict        身份冲突
identity_unknown         身份待确认
```

### 3.3 排雷状态：`radarStatus`

用于说明当前排雷信息的成熟度。

```text
not_evaluated                    尚未评估
insufficient_information          资料不足
ai_synthesized_pending_review     AI 综合，待复核
human_reviewed                    人工已复核
disputed                          存在争议
dynamic_tracking                  动态追踪中
stale                             可能过期
```

### 3.4 社区状态：`communityStatus`

用于提示用户如何参与补充。

```text
needs_evidence             需要证据
needs_identity_review      需要身份确认
needs_radar_review         需要排雷复核
needs_ending_confirmation  需要结局确认
has_user_submission        有用户投稿待处理
```

## 4. 推荐数据模型

本阶段可以先通过文档和审计脚本验证模型，不要求一次性改 collection schema。后续若进入写入阶段，再拆分 PR 实现。

### 4.1 `Work`

公开作品条目。

```ts
type Work = {
  id: string
  siteId: string
  title: string
  slug: string
  aliases?: string[]
  mediaType?: string
  mediaGroup?: string
  lifecycleStatus?: string
  visibilityStatus?: string
  dataStatus?: string
  identityStatus?: string
  radarStatus?: string
  reviewStatus?: string
  chosenBaseSource?: string
  importBatch?: string
  sourceCount?: number
  createdAt?: string
  updatedAt?: string
}
```

### 4.2 `SourceRecord`

每个外部来源或旧站来源的规范化记录。

```ts
type SourceRecord = {
  id: string
  sourceName: string
  sourceId?: string
  sourceUrl?: string
  sourceTitle: string
  sourceMediaType?: string
  rawPayloadPath?: string
  normalizedPayload?: unknown
  importedAt?: string
  lastFetchedAt?: string
  sourceUpdatedAt?: string
  confidence?: number
  importBatch?: string
  status?: string
}
```

### 4.3 `IdentityLink`

来源记录与作品之间的连接。

```ts
type IdentityLink = {
  id: string
  workId: string
  sourceRecordId: string
  matchType: string
  confidence?: number
  evidence?: string
  status: 'confirmed' | 'possible' | 'rejected' | 'conflict'
  reviewedBy?: string
  reviewedAt?: string
}
```

### 4.4 `RadarAssessment`

排雷判断及其状态、证据、时间戳和复核信息。

```ts
type RadarAssessment = {
  id: string
  workId: string
  status: string
  summary?: string
  relationshipSignals?: string[]
  riskSignals?: string[]
  confidence?: number
  spoilerLevel?: string
  evidenceRefs?: string[]
  sourceType?: 'ai' | 'human' | 'community' | 'imported'
  createdBy?: string
  reviewedBy?: string
  validAsOf?: string
  lastCheckedAt?: string
}
```

## 5. 多来源合并策略

不要使用单一的“总来源优先级”覆盖全部字段。不同来源擅长不同字段，应按字段决定优先级。

### 5.1 身份合并优先级

#### 最高可信

- Steam appid 相同。
- MangaDex UUID 相同。
- VNDB v-id 相同。
- Bangumi subject id 相同。
- ISBN 相同。
- 官方站 ID 相同。

#### 高可信

多个外部身份互相指向，例如：

- Bangumi ↔ Wikidata。
- VNDB ↔ Steam。
- MangaDex ↔ AniList。
- ISBN ↔ NDL / Wikidata。

Wikidata 可以作为身份依据，但不应自动成为排雷依据，也不应自动覆盖人工判断。

#### 中高可信

标题、作者或制作方、年份、媒体类型均一致。

#### 中可信

标题和媒体类型一致，但缺少强身份或作者年份依据。进入 `possible_match`，不要自动合并。

#### 低可信

只有标题相似，尤其是短标题、常见词、翻译标题、合集标题、卷标题、副标题和同人标题。只能进入人工复核。

### 5.2 字段级来源优先级

#### 标题和原名

优先官方、平台、出版来源。不同来源标题应保留到 aliases，不应互相删除。

#### 媒体类型

优先平台强类型：

```text
Steam   → game
MangaDex → manga
VNDB    → visual_novel
ISBN/NDL → book / novel / manga_volume
Bangumi → anime / book / game 等
AniList → anime / manga
```

冲突时标记 `media_type_conflict`，不要无提示覆盖。

#### 发行日期和状态

优先官方、平台、出版数据库，再参考社区来源。连载中、更新中、DLC 未检查、改编未完结等情况应标记 `dynamic_tracking`。

#### 简介

不要直接互相覆盖。建议保留 `descriptionBySource`，公开页默认展示一个 chosen description，并允许展开来源差异。

#### 排雷信息

排雷信息优先级应独立于普通资料字段：

```text
人工复核证据
旧站人工资料
有明确证据的用户投稿
垂直百合资料来源
AI 综合草稿
普通平台 tag
标题/简介关键词推测
```

普通平台 tag 和关键词推测只能作为信号，不能作为确定结论。

## 6. 动态排雷

动态排雷不是频繁随意改变结论，而是让每个判断都有来源、时间、置信度、复核状态和过期风险。

### 6.1 每个判断都应带时间

公开页面应尽量显示：

- 当前排雷状态。
- 最近检查时间。
- 状态来源。
- 复核状态。
- 是否可能过期。

### 6.2 连载和更新作品特殊标记

以下情况应进入动态追踪：

- 连载中。
- 未完结。
- 游戏仍在更新。
- DLC 或追加剧情未检查。
- 动画改编未完结。
- 小说原作、漫画、动画、游戏改编之间状态不同。

页面提示示例：

```text
该作品仍在更新，排雷信息可能随后续内容变化。
```

### 6.3 社区重新检查

后续社区功能可以支持：

- 请求复核。
- 补充证据。
- 报告过期。
- 报告错误合并。
- 报告雷点变化。
- 报告剧透或成人内容标记问题。

用户提交不应直接覆盖公开结论，应进入待复核流程。

## 7. 公开显示策略

作品卡片和详情页应展示状态，而不是隐藏不确定性。

### 7.1 来源标签

- 来源：MangaDex。
- 来源：Steam。
- 来源：Yurizukan。
- 来源：Bangumi。
- 来源：AniList。
- 来源：VNDB。
- 来源：Wikidata。
- 单来源收录。
- 多来源已连接。

### 7.2 资料状态标签

- 资料较完整。
- 资料不足。
- 仅来源收录。
- 来源冲突。
- 身份待确认。
- 可能重复。

### 7.3 排雷状态标签

- 未评估。
- AI 综合，待复核。
- 资料不足，无法判断。
- 人工已复核。
- 存在争议。
- 动态追踪中。
- 可能过期。

### 7.4 社区状态标签

- 等待补充。
- 有用户投稿。
- 需要证据。
- 需要身份确认。
- 需要结局确认。
- 需要成人内容标记。

## 8. 全量导入流水线

### 8.1 来源覆盖审计

新增只读脚本建议：

```text
scripts/import/audit-source-coverage-v01.mjs
```

输出：

```text
data_local/staging/source-coverage/source-coverage-v01.json
data_local/staging/source-coverage/source-coverage-v01-summary.json
data_local/staging/source-coverage/source-coverage-v01.md
```

统计内容：

- 本地 raw sources 清单。
- candidate / deduped / import_ready / staging 文件清单。
- 每个来源候选数量。
- 每个来源媒体类型分布。
- 哪些已进入 Public Catalog。
- 哪些只是 identity evidence。
- 哪些只是 radar evidence。
- 哪些需要 quarantine。
- 下一批导入优先级建议。

### 8.2 SourceRecord 标准化

将所有来源转成统一候选格式：

```json
{
  "sourceName": "bangumi",
  "sourceId": "12345",
  "sourceUrl": "...",
  "title": "...",
  "mediaType": "anime",
  "aliases": [],
  "creators": [],
  "releaseDate": null,
  "rawPath": "...",
  "normalizedAt": "...",
  "eligibleForCatalog": true,
  "excludeReason": null
}
```

### 8.3 入库资格判断

每条 SourceRecord 标记为：

```text
eligible_for_catalog
maybe_catalog
not_catalog
quarantine
```

动画、漫画、小说、游戏及相关衍生应默认进入 `eligible_for_catalog` 或 `maybe_catalog`。明显无关或垃圾才进入 `not_catalog` / `quarantine`。

### 8.4 身份合并 dry-run

生成合并计划：

```text
auto_merge
possible_merge
identity_conflict
no_match_create_new
```

不确定身份不应阻塞公开入库；可以创建公开条目并标记身份状态。

### 8.5 写入节奏

继续沿用安全纪律：

```text
dry-run
single apply
audit
small batch apply
audit
full apply
audit
```

## 9. 推荐来源接入顺序

### 第一批：当前 Public Catalog 主线附近

- MangaDex。
- Steam。
- Yurizukan。
- 现有 merge-groups-v2 candidates。
- 现有 public-catalog import preview。

### 第二批：Bangumi

Bangumi 适合作为全量资料库扩展重点，覆盖动画、书籍、游戏等多种类型，但类型较杂，需要谨慎标准化。

### 第三批：AniList

用于 anime / manga 补充，与 Bangumi、MangaDex 会有重叠，适合作为 source enrichment。

### 第四批：VNDB

用于视觉小说和游戏类，与 Steam 可互相补充。

### 第五批：Wikidata / Wikipedia / Moegirl / NDL

更适合作为 identity evidence、别名、外部链接、创作者、出版事实和 ISBN 等资料来源。除非唯一来源且明显是作品，否则不应一开始主导 Work 创建。

## 10. PR 拆分建议

后续不要把导入、schema、UI 和写入混在一个 PR。建议拆分：

1. `audit-source-coverage-v01`：只读来源覆盖审计。
2. `normalize-source-records-v01`：统一 SourceRecord 候选格式。
3. `plan-full-catalog-ingestion-v01`：全量入库计划 dry-run。
4. `plan-identity-links-v01`：同作品多来源连接计划。
5. `apply-full-catalog-sample-v01`：单条或小批量 Payload 写入验证。
6. `audit-full-catalog-v01`：全量导入后审计。
7. `ui-catalog-status-labels-v01`：公开状态标签展示。
8. `review-identity-links-v01`：身份连接人工复核 UI。
9. `review-radar-assessments-v01`：动态排雷复核 UI。

## 11. 安全边界

继续保持：

- 不直接写 PostgreSQL。
- 不提交 `data_local` 输出。
- 不提交真实 `.env`、密码、token、私钥。
- 不提交 `payload-types.ts`、`pnpm-lock.yaml`、`tsconfig.tsbuildinfo`，除非某个 PR 明确需要并单独说明。
- Payload 写入必须先 dry-run、单条验证、再小批量、最后全量。
- 生产 apply 必须单独规划，不能因为本地成功就直接全量执行。
- PR 继续使用 `[skip ci]`，除非该 PR 明确需要 CI。

## 12. 本阶段完成标准

本阶段完成时，应能回答：

- 本地到底有哪些来源？
- 每个来源有多少候选？
- 哪些来源已经进入资料库？
- 哪些来源只是身份或证据辅助？
- 哪些条目是单来源？
- 哪些条目是多来源已连接？
- 哪些条目身份待确认？
- 哪些条目排雷未评估？
- 哪些条目 AI 综合待复核？
- 哪些条目动态追踪中？
- 哪些条目需要社区补充？

最终目标：

```text
不因未知而隐藏。
不因争议而删除。
不因 AI 草稿而冒充结论。
不因管理员判断而堵死社区修正。
```
