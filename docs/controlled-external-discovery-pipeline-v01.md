# 联网发现与本地 AI 自动扩库管道 v0.2

## 1. 真正目标

这条管道不是一次性导入，也不是要求站务人员长期手工准备来源文件。它的长期目标是：

> 每隔一段时间执行尽可能少的命令，由代码联网发现近期新增或变化的百合作品，自动生成基础作品资料、完成去重、运行 AI 排雷、做 dry-run，并在一次批次级确认后把符合门槛的作品写入网站。

人工数量有限，因此正常路径应由代码与 AI 完成；人工只负责：

- 批次开始前确认 checkpoint；
- 查看总量、异常和高风险摘要；
- 输入一次明确确认短语；
- 处理 `possible_duplicate`、`blocked` 和低置信度例外。

不应要求人工逐条填写标题、来源、类型、别名、基础简介或 AI 评级，也不应要求每次手工串联十几个旧脚本。

最终目标命令形态：

```powershell
# 周期性快速更新：联网抓取、生成计划与 dry-run，不写网站
pnpm radar:refresh-online -- --url "http://127.0.0.1:3001" --profile quick

# 定期完整扫描
pnpm radar:refresh-online -- --url "http://127.0.0.1:3001" --profile full

# 后续 release 阶段完成后：验证 checkpoint，批次确认后自动写回并重建索引
pnpm radar:refresh-online -- --url "http://127.0.0.1:3001" --profile quick --apply --confirm "APPLY CONTROLLED CATALOG REFRESH <run-id>"
```

本 PR 已实现前两种命令所需的联网抓取、站内快照、标准化和只读计划核心。`--apply` 仍被明确拒绝；它会在下一阶段接入 checkpoint、AI candidate contract、批量写入、API 回读与索引重建后再开放。

## 2. 完整自动化流程

```text
一条本地命令启动
→ 从网站拉取全部 Works 身份与当前双轨状态
→ 联网抓取 Bangumi / Yurizukan / VNDB / Steam
→ 每个来源保存不可变快照、参数与抓取摘要
→ 标准化作品身份、类型、日期、别名、外部 ID 与来源
→ 跨来源聚合与站内去重
→ 生成 create / update / duplicate / blocker 计划
→ AI 为可创建候选生成基础资料和独立 radarAssessment
→ 规则引擎判定 auto-eligible / review / blocked
→ 完整 Payload dry-run
→ 新 checkpoint 并验证恢复列表
→ 一次批次确认
→ 创建 temporary Works、补充既有 Works、写 AI 轨道
→ API 回读比对
→ 重建搜索与详情索引
→ 校验作品、创作者、机构总数
→ 建立导入后 checkpoint
```

每个阶段都产生文件；外部网页或 API 响应永远不能直接写 Payload。

## 3. 人工轨道与自动轨道

### 代码和 AI 可以做

- 发现候选作品；
- 生成标题、原名、别名、媒介类型、格式、日期和外部 ID；
- 汇总可追溯来源；
- 生成摘要草稿、搜索文本和来源说明；
- 判定重复候选；
- 创建 `catalogStatus=temporary` 的作品；
- 写入或刷新 `Works.radarAssessment`；
- 自动把高可信批次写回网站；
- 重建前台索引。

### 代码和 AI 永远不能做

- 写入、覆盖或清空 `humanAssessment`；
- 把外部来源的“百合”标签冒充成人工确认等级；
- 把新作品标记为人工已复核；
- 按标题自动合并两个 Works；
- 忽略身份冲突继续写下一条；
- 在没有 checkpoint 和明确批次确认时 apply。

因此“主要由 AI/代码维护”与“双轨安全”并不矛盾：自动内容进入 AI 轨道和 temporary 生命周期，人工轨道仍保留为更高优先级的独立结论。

## 4. 四个联网来源

| 来源 | 联网方式 | 主要用途 | 自动收录信号 |
| --- | --- | --- | --- |
| Bangumi | 复用仓库现有 `/v0/search/subjects` 与 subject detail 抓取器 | 动画、漫画、小说、游戏广覆盖，中文名、原名、标签与基础资料 | 单来源默认需较强标签信号或第二来源/AI 佐证 |
| Yurizukan | 低频抓取“新着作品”列表和公开详情页 | 高纯度百合作品发现、关系/题材与媒介提示 | 可作为强候选锚点；系列/卷册仍需代码聚合与重复检查 |
| VNDB | 官方 Kana HTTPS API `POST /vn` | 视觉小说、标题、发行日期、标签、敏感内容分流 | `g97` Girl x Girl Romance 可进入普通候选；`g82` sex-only 与敏感行单独分流 |
| Steam | 商店搜索结果发现 app ID，再读取 appdetails | 新游戏发现、商店身份、描述、年龄与类型提示 | Steam 单来源不直接成为正式百合结论；强文本信号可生成 temporary 候选 |

注意：

- Bangumi 与 VNDB 有明确 API；请求必须带稳定 User-Agent、分页、重试和延迟。
- Yurizukan 没有公开 API，本管道只访问公开列表和详情页，设置低并发与延迟；正式全量运行前还应再次核对网站条款和 robots 配置。
- Steam 商店搜索/appdetails 不是稳定的正式分类 API，页面或字段变化必须导致抓取阶段失败或阻断，不能返回空数据后继续 apply。后续可以在配置 `STEAM_WEB_API_KEY` 时加入官方 `IStoreService.GetAppList` 增量入口，但分类仍需商店详情或其他来源。

## 5. quick 与 full

### quick

适合每周或每几周执行：

- Bangumi 少量标签分页；
- Yurizukan 最近若干页新着作品；
- VNDB 前若干分页的标签候选；
- Steam 每个关键词少量搜索页；
- 完整站内去重；
- 默认不写网站。

### full

适合每月、季度或规则变化后执行：

- 扩大四来源分页和候选上限；
- 重新验证较早候选；
- 允许发现旧条目后补上的标签或来源；
- 仍然先产生新的 run 目录和 dry-run，不复用旧结果。

首次建立基线应运行 full；日常使用 quick。后续将加入来源游标与定期回扫窗口，减少重复网络请求，同时避免漏掉旧 ID 后补标签的作品。

## 6. 当前一条命令入口

当前 PR 新增：

```powershell
node scripts/radar/run-controlled-online-refresh-v01.mjs `
  --url "http://127.0.0.1:3001" `
  --profile quick
```

它会自动：

1. 从本地网站读取全部 Works；
2. 生成并审计 Works 身份快照；
3. 联网抓取四个受控来源；
4. 生成每来源 JSONL 快照与摘要；
5. 统一标准化候选；
6. 跨来源标记；
7. 按固定身份优先级生成 create / update / duplicate / blocked 计划；
8. 写出总 `summary.json`。

可只运行部分来源：

```powershell
node scripts/radar/run-controlled-online-refresh-v01.mjs `
  --url "http://127.0.0.1:3001" `
  --profile quick `
  --sources "bangumi,yurizukan,vndb"
```

当前命令明确拒绝：

```text
--apply
--auto-apply
--execute
--confirm
--write
--patch
--publish
```

这不是长期目标的终点，而是让真实联网结果先经过完整仓库和本地数据库验证后，再安全接上自动写回。

## 7. Run 目录

```text
data_local/staging/ai-radar/online-catalog-refresh-v01/<run-id>/
├─ works-snapshot/
│  ├─ all-packets.jsonl
│  ├─ all-packets-summary.json
│  └─ audit/
├─ source-fetch/
│  ├─ bangumi/
│  ├─ yurizukan/
│  ├─ vndb/
│  ├─ steam/
│  └─ summary.json
├─ discovery-plan/
│  ├─ normalized/
│  ├─ candidate-plan/
│  └─ summary.json
└─ summary.json
```

每个来源快照保留：

- 抓取开始和结束时间；
- 请求范围与分页；
- User-Agent；
- 成功、失败和拒绝数量；
- 原始来源 ID；
- canonical source URL；
- 文件 SHA-256；
- 候选对应的输入文件与行号。

每次运行使用新目录，禁止复用旧 run 目录。

## 8. 去重优先级

站内匹配固定为：

1. 本站 `siteId`；
2. 外部 ID；
3. slug；
4. 标题 + 媒介大类 + 媒介类型 + 日期；
5. 标题 + 类型但日期缺失或冲突，仅作为弱候选。

输出：

- `ready_for_editor_draft`：没有站内命中，可进入自动创建资格判断；
- `ready_for_editor_update`：外部 ID、siteId 或 slug 唯一命中，可生成增量补资料计划；
- `possible_duplicate`：标题/类型/日期或跨语言信号疑似重复；
- `blocked`：来源缺失、身份层冲突、多重命中、格式错误等。

标题相似永远不会自动合并。高身份层与低身份层指向不同 Works 时，使用 `identity_tier_conflict` 阻断整个候选。

## 9. 自动创建资格

下一阶段不会把所有 `ready_for_editor_draft` 无条件写入。代码先分为：

### auto_eligible

满足全部基础条件：

- 标题、类型和 canonical source URL 完整；
- 至少一个稳定外部 ID；
- 没有站内重复和身份冲突；
- 来源快照可追溯；
- AI 输出完整且符合契约；
- AI 置信度与 evidence coverage 达到策略门槛；
- 没有未知规则、严重矛盾或禁止自动发布的内容状态。

并满足至少一种强信号：

- Yurizukan 强候选，且系列/卷册聚合没有冲突；
- VNDB `g97` 普通 romance 候选；
- 两个以上来源指向同一身份；
- Bangumi 高标签信号并由第二来源或 AI 证据确认；
- Steam 强文本信号并由另一受控来源或更高 AI 证据覆盖确认。

### review_required

- Steam 单来源；
- Bangumi 弱标签；
- VNDB sensitive、sex-only 或标题修复行；
- 只有标题匹配；
- 日期缺失；
- 系列/卷册关系不清楚；
- AI 置信度不足。

这些行可以自动保存为本地候选，不自动写 Payload。

### blocked

- 外部 ID 冲突；
- 多个 Works 命中；
- 来源 URL 域名不符；
- 模型改写身份字段；
- 输入或输出行数不一致；
- 人工轨道差异；
- 规则不存在或来源不可追溯。

## 10. 自动写回后的作品状态

新建作品：

```text
catalogStatus = temporary
_status = published
reviewStatus = pending
humanAssessment = unchanged / empty
radarAssessment = AI 结果
ratingNotice = ai_synthesized_pending_review
importBatch = controlled-refresh:<run-id>
```

这意味着作品可以进入网站、搜索和后续更新，但前台明确显示它是 AI 辅助、待人工复核，而不是人工确认。

既有作品更新只允许增量追加：

- 外部 ID；
- 来源链接；
- 可信别名；
- 可确认的类型和日期；
- 搜索文本；
- AI 轨道刷新。

不得用空值覆盖非空值，不得清除现有来源，不得改人工轨道。

## 11. AI candidate contract

外部候选在创建 Works 前也需要独立 AI 契约。模型只可返回白名单字段：

- 建议标题与别名排序；
- 简介草稿；
- 媒介与系列关系建议；
- evidence coverage / status；
- source summary；
- rule assessments；
- contradictions；
- assessment notes；
- confidence。

模型不能改写：

- discovery ID；
- source record ID；
- source URL；
- 文件 SHA-256；
- 站内匹配；
- write protection；
- humanAssessment；
- policy version。

输出必须与输入一行一行严格对应。少行、多行、未知 ID、重复 ID或身份变化立即停止。

## 12. 批次级人工操作

长期日常流程应只有两次主要交互：

1. 运行默认命令，查看摘要；
2. 确认 checkpoint 后输入一次批次确认短语。

用户不需要逐条审核 `auto_eligible`。摘要应重点显示：

```text
fetched
new_candidates
would_create_temporary
would_update
already_current
review_required
possible_duplicate
blocked
AI_confidence_distribution
source_failures
human_track_changes = 0
```

只有异常队列需要以后慢慢处理；它们不阻挡其他已经通过门槛的作品，但正式 apply 遇到写入错误仍在首个错误停止，并保留可恢复进度。

## 13. apply 门槛

正式写回必须：

1. 创建并验证导入前 checkpoint；
2. 验证所有输入 SHA-256；
3. 外部抓取阶段没有静默空响应；
4. dry-run 完成；
5. `humanAssessment` 差异为零；
6. 自动创建行全部为 `auto_eligible`；
7. 明确确认短语包含 run ID；
8. 每条写入生成 AuditEvent；
9. 首个错误停止；
10. API 回读创建、更新、已当前和阻断数量；
11. 重建完整索引并核对总数；
12. 建立导入后 checkpoint。

## 14. PR 分段

### 当前 PR #281

- 正式流程与来源策略；
- 四来源联网抓取；
- quick / full 入口；
- Works 自动快照；
- 统一候选与来源哈希；
- create / update / duplicate / blocked 计划；
- 禁止直接写入；
- parser 和安全边界测试。

### 下一阶段

- 外部候选 AI contract；
- 自动资格策略；
- temporary Works create/update plan；
- Payload dry-run；
- checkpoint 验证与批次确认；
- apply、API 回读和 AuditEvent；
- 创建后自动运行 `radar:local-update`；
- 重建索引；
- 导入后 checkpoint。

### 再下一阶段

- 来源游标与重叠回扫窗口；
- 每月自动 full、平时 quick；
- 失败来源单独恢复；
- 统计趋势和异常队列页面；
- 自动测试来源页面结构变化。

## 15. 当前仍需本地验证

联网抓取依赖你的真实网络、本地 Payload 和既有数据库，因此合并前需要在完整 checkout 中：

```powershell
node --test tests/controlled-source-online-fetch.test.mjs
node --test tests/controlled-source-discovery.test.mjs
node --test tests/discovered-work-candidate-plan.test.mjs
node --test tests/bangumi-tag-fetcher.test.mjs

node scripts/radar/run-controlled-online-refresh-v01.mjs `
  --url "http://127.0.0.1:3001" `
  --profile quick `
  --sources "bangumi,yurizukan,vndb,steam"
```

第一次真实联网建议把分页和 app 数量调小。确认四个来源都能生成非空且合理的候选后，再扩大到 quick 默认值和 full。任何来源结构变化、HTTP 失败或异常空结果都只允许停止在本地计划阶段，不能进入未来 apply。
