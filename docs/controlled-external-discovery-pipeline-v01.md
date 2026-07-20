# 受控外部发现与本地 AI 数据管道 v0.1

## 1. 目标

这条管道把“网站已有但尚未 AI 审核的作品”与“外部来源发现的新作品候选”放进同一套可回滚、可复查的本地流程，但始终保留两种身份：

- **站内既有作品**：已有 `Works.id`，只允许 AI 刷新 `Works.radarAssessment`；
- **外部候选作品**：尚未成为 Works，只能先生成候选、重复检查和编辑草稿计划。

完整流程：

```text
网站拉取待处理 Works 快照
→ 从受控来源生成不可变来源快照
→ 统一标准化候选
→ 站内与候选去重，生成 create / update / duplicate / blocker 计划
→ 编辑批准后建立 temporary Works 或补充既有作品来源
→ AI 仅生成独立 radarAssessment
→ dry-run 审计
→ 新 checkpoint + 明确确认后 apply
→ API 回读核对
→ 重建前台搜索与详情索引
→ 导入后 checkpoint
```

本版本只实现到“统一标准化与只读计划”，不联网抓取、不写 Payload、不写 PostgreSQL、不创建 Works、不运行 AI、不发布。

## 2. 仓库现状与复用点

当前仓库已经具备以下基础，不应另造旁路：

- `pnpm radar:local-update`：生成 Works/AI 输入快照、清理输入、受控模型契约、AI 结果解析、Payload patch plan 和 dry-run；
- `Works.humanAssessment` 与 `Works.radarAssessment` 双轨隔离；
- armed release、checkpoint、回读与审计边界；
- Bangumi、Yurizukan、VNDB、Steam 的历史来源脚本和本地原始数据目录；
- `pnpm radar:plan-discovered-works`：外部候选与站内 Works 的只读重复检查；
- temporary / active / archived 生命周期与前台全量索引导出。

因此正式结构采用“适配既有来源产物 → 统一候选契约 → 统一计划器”，而不是替换已有抓取和清洗成果。

## 3. 四个受控来源的职责

| 来源 | 主要职责 | 可作为百合结论吗 | 默认门槛 |
| --- | --- | --- | --- |
| Bangumi | 动画、漫画、小说、游戏的广泛发现与基础元数据 | 不可单独作为最终结论 | 必须来自受控标签检索快照；保留标签计数与抓取时间 |
| Yurizukan | 高纯度百合作品发现锚点 | 可作为“值得收录/复核”的强候选信号，不等于本站评级 | 必须保留 Yurizukan 条目页；卷/系列合并仍需人工复核 |
| VNDB | 视觉小说身份、标题、发行信息与标签发现 | 不可单独决定本站等级 | 必须经过 Girl x Girl Romance 等标签门槛；敏感、sex-only、标题修复行单独复核 |
| Steam | 商店身份、发售页、语言与内容描述补充 | 不可作为唯一百合证据 | 只接受现有 p1–p4 发现桶；敏感或弱信号桶保留人工复核提示 |

四个来源都只能产生候选事实和来源提示。它们不能写人工轨道，也不能把“来源标记为百合”直接转换成本站 S/A/B/C/D/E 等级。

## 4. 本地目录与产物

建议每次运行都使用新的 run ID：

```text
data_local/staging/ai-radar/controlled-source-discovery-v01/<run-id>/
├─ normalized/
│  ├─ controlled-source-candidates-v01.jsonl
│  ├─ controlled-source-candidates-v01-blocked.jsonl
│  └─ controlled-source-candidates-v01-review.jsonl
├─ candidate-plan/
│  ├─ discovered-work-candidate-plan-v01.jsonl
│  ├─ discovered-work-candidate-plan-v01-ready-create.jsonl
│  ├─ discovered-work-candidate-plan-v01-ready-update.jsonl
│  ├─ discovered-work-candidate-plan-v01-possible-duplicate.jsonl
│  ├─ discovered-work-candidate-plan-v01-blocked.jsonl
│  └─ discovered-work-candidate-plan-v01-summary.json
└─ summary.json
```

每个来源输入文件记录：

- 文件路径；
- SHA-256；
- 字节数；
- 文件修改时间；
- 读取行数；
- 每个候选对应的来源文件和行号。

输出目录必须位于 Git 忽略的 `data_local/`，且拒绝复用已有 run 目录。

## 5. 统一候选契约

标准化后的每一行至少包含：

```json
{
  "version": "controlled-source-discovery-v0.1",
  "discoveryId": "source:sourceRecordId",
  "source": "bangumi | yurizukan | vndb | steam",
  "sourceRecordId": "...",
  "sourceSnapshotAt": "...",
  "sourceInput": {
    "path": "...",
    "sha256": "...",
    "rowNumber": 1
  },
  "title": "...",
  "originalTitle": "...",
  "aliases": [],
  "mediaGroup": "...",
  "mediaType": "...",
  "format": "...",
  "firstPublishedAt": "...",
  "firstPublishedPrecision": "day | month | year | unknown",
  "externalIds": {},
  "sourceLinks": [],
  "discoverySignals": {},
  "discoveryBlockers": [],
  "discoveryWarnings": [],
  "sourcePolicy": {}
}
```

模型不能参与生成这些身份字段。候选身份、来源页、输入哈希、来源策略和阻断项都由本地代码固定生成。

## 6. 去重与计划优先级

站内匹配使用固定优先级：

1. 本站 `siteId`；
2. 外部 ID；
3. slug；
4. 标题 + 媒介大类 + 媒介类型 + 日期。

处理规则：

- `siteId`、外部 ID 或 slug 唯一命中：`ready_for_editor_update`；
- 标题 + 类型 + 日期命中：`possible_duplicate`；
- 标题 + 类型命中但日期缺失或冲突：仍保守进入 `possible_duplicate`，附警告；
- 不同身份层级指向不同 Works：`blocked`，原因 `identity_tier_conflict`；
- 无匹配且无阻断：`ready_for_editor_draft`；
- 标题匹配绝不自动合并。

同一批候选若跨来源出现相同“标题 + 类型 + 日期”，只增加 `cross_source_title_type_date_candidate` 提示和关联 discovery ID，不自动合并候选。

## 7. 运行方式

先准备站内 Works 快照。可以让现有本地 AI 总入口在没有 assessor 的情况下只生成输入：

```powershell
pnpm radar:local-update -- --url "http://127.0.0.1:3001" --scope unassessed
```

也可以使用已生成的 `all-packets.jsonl` 或 `ai-radar-clean-input-v01.jsonl`。然后把已有四来源产物交给统一入口：

```powershell
node scripts/radar/prepare-controlled-source-discovery-v01.mjs `
  --works "data_local/staging/ai-radar/local-update-v01/<run-id>/input-audit/ai-radar-clean-input-v01.jsonl" `
  --bangumi "data_local/raw/bangumi/...jsonl" `
  --yurizukan "data_local/staging/yurizukan-work-integration-v02/yurizukan-work-integration-v02-create.jsonl" `
  --vndb "data_local/staging/vndb-yuri-create-candidates/vndb-yuri-create-candidates-v03.rows.jsonl" `
  --steam "data_local/staging/steam-work-integration/create-v02"
```

可以只提供其中一个或多个来源。命令不接受 `--fetch`、`--apply`、`--execute`、`--confirm`、`--write` 或 `--patch`。

## 8. 编辑批准与未来 apply 设计

下一阶段的编辑 apply 不应直接把候选变成正式人工确认作品。建议动作：

### ready_for_editor_draft

- 创建 `catalogStatus=temporary` 的 Works；
- `reviewStatus=pending`；
- 保留来源快照摘要、source links、external IDs、import batch 和 discovery ID；
- `humanAssessment` 为空；
- `radarAssessment` 为空，等待下一次 AI 管道；
- 不因来源声称“百合”而自动写正式 rank。

### ready_for_editor_update

- 只追加/修复来源、别名、外部 ID 和可确认基础元数据；
- 不清空现有字段；
- 不修改 `humanAssessment`；
- 不修改已有 `radarAssessment`，除非另行进入 AI 重评批次；
- 一次 update 只能命中唯一 Works，否则阻断。

### possible_duplicate / blocked

- 不允许批量 apply；
- 进入人工重复候选或来源修复队列；
- 合并必须走现有单组预览、审计和明确确认流程。

## 9. AI 评估包要求

作品成为站内 temporary/active Works 后，AI 包至少记录：

- 策略版本；
- assessment batch / run ID；
- 输入文件 SHA-256；
- `workId` 与 `siteId`；
- 来源摘要与来源数量；
- 规则命中；
- 置信度；
- evidence coverage；
- evidence status；
- 矛盾与限制；
- assessedAt。

AI 输出必须一行对应一行，未知 ID、重复 ID、少行、多行、身份变化或来源字段被模型改写时立即停止。

## 10. apply 前后验证门槛

正式写回前至少检查：

1. 新 checkpoint 已创建并验证可恢复；
2. 所有输入与候选文件均有 SHA-256；
3. `would_create`、`would_update`、`possible_duplicate`、`blocked` 数量明确；
4. 来源 host 与 source policy 一致；
5. 已有 `humanAssessment` 在计划前后完全相同；
6. 新作品只建立 temporary Works，不自动标为人工已确认；
7. 每条写入带 import batch、operator、discovery ID 和 AuditEvent；
8. apply 遇到首个错误即停止，不继续静默写后续行；
9. apply 后重新读取 API，对比创建、更新、已当前、阻断数量；
10. 重建完整索引，核对作品、创作者、机构总数与数据库一致；
11. 抽样检查人工/AI 双轨、来源链接、搜索命中和规则展示；
12. 建立导入后 checkpoint。

## 11. 分阶段 PR

### PR 1：统一候选与只读计划（本 PR）

- 正式流程报告；
- 四来源策略注册；
- 读取既有来源快照并生成统一候选；
- 来源文件哈希与行级追踪；
- create / update / duplicate / blocked 计划；
- 固定身份匹配优先级；
- 测试。

### PR 2：四来源快照编排

- 把现有 Bangumi/Yurizukan/VNDB/Steam 抓取与计划脚本包装成统一的 snapshot-only 入口；
- 记录请求参数、分页、速率限制、抓取开始/结束时间和完整文件哈希；
- 不允许外部请求结果直接进入 Payload。

### PR 3：checkpoint-gated 编辑 apply

- 只处理明确 allowlist；
- 单条预览与批次确认；
- temporary draft 创建和来源更新；
- 审计事件、失败即停、API 回读；
- 断言人工轨道不变。

### PR 4：新作品 AI 扫雷与 armed release

- temporary Works 自动进入 `unassessed`；
- AI 独立轨道；
- dry-run、arm、execute-once、回读与重评支持。

### PR 5：索引重建与批次验收

- 前台索引总数核对；
- 抽样报告；
- 导入前后 checkpoint 清单；
- 可重复运行手册。

## 12. 当前还需要的本地资料

继续实现与真实 dry-run 时，最有用的是以下**非敏感文件**：

- 最近一次 `radar:local-update` 生成的 Works 输入 JSONL、`summary.json` 和输入审计摘要；
- Bangumi 标签抓取 JSONL 与其 summary；
- `yurizukan-work-integration-v02-create.jsonl` 与 summary；
- VNDB v03 rows/first-wave/review 文件与 summary；
- Steam p1–p4 全量候选文件、compact 文件与 summary；
- 当前数据库 checkpoint 的验证摘要和恢复文件清单；
- 最近一次完整前台索引导出的总数摘要。

不要上传数据库 dump、真实 `.env`、密码、token、cookie、私钥、生产证书或完整用户数据。
