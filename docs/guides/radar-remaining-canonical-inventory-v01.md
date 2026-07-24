# 剩余 canonical Works 只读 inventory v0.1

## 目标

在公共 AI Radar 已稳定为 10,804 条 current 结论后，重新读取当前 Works 与公共结论，生成下一阶段研究所需的唯一、可恢复 inventory。

本阶段只回答：

- 哪些 canonical Works 已有结构完整的 current 公共 AI 结论；
- 哪些 canonical Works 完全缺少 current 结论；
- 哪些已有结论因作品身份快照、publication key、等级或 SHA 完整性异常而需要 supersede；
- 哪些 Works 因归档、未发布、缺失双快照等原因应排除；
- 首个 2,500 条研究包及内部 10 × 250 子波次如何稳定切分。

它不研究作品、不重新评级、不写 Payload 内容、不执行 PostgreSQL DML，也不生成 apply、rollback、migration 或 deploy 包。

## 输入

runner 从固定分支 HEAD 的短路径 detached worktree 启动专用 Next 服务，并通过 Payload API 只读获取：

1. `works?draft=true`：最新草稿快照；
2. `works?draft=false`：当前发布快照；
3. `radar-public-conclusions`：公共 AI 结论全集。

Payload 登录 POST 仅用于取得读取 token；之后集合访问全部为 GET。`PAYLOAD_DB_PUSH` 固定为 `false`。

初始 V01 默认绑定：

```text
main baseline             e9ee3cddf9e0dd058814a6f807ac36cc6d91eaf0
expected current public   10804
research batch size       2500
wave size                  250
wave count                  10
```

## canonical Works 判定

以发布快照为公共身份基准。一个 Work 进入 canonical inventory 必须同时满足：

- draft 与 published 双快照均存在；
- published `catalogStatus === active`。

`draft=false` 的 live snapshot 是否存在本身就是发布身份门槛；不再依赖响应中可能省略的 `_status` 字段二次判断。`isLiteVisible` 与 `isFullVisible` 也不决定 AI 记录是否存在，因此不会导致排除。归档 merge-out、未进入 live snapshot 的记录以及快照身份缺失记录进入 `excluded-works.jsonl`。

不根据标题包含“测试”等模糊文本自动排除，避免误伤真实作品。测试污染必须通过已经固化的 canonical/archived 状态解决。

## 四类 inventory

### `already_current`

canonical Work 恰有一条相关 current 公共结论，并且：

- `publicationKey === work:<Work ID>`；
- relationship Work ID 与 snapshot Work ID 均一致；
- `recordStatus === current`；
- compatibility grade 为 `S` 至 `F`；
- `conclusionSha256` 是合法 64 位十六进制；
- title 与 siteId 快照匹配当前 published Work。

这些作品不会进入本轮研究包。

### `missing_current`

canonical Work 没有任何 current 公共结论。它们进入研究候选队列。

### `supersede_candidate`

canonical Work 已有关联 current 结论，但出现至少一种完整性信号：

- current 结论数量不是 1；
- publication key、relationship 或 Work ID snapshot 不匹配；
- 等级为 `X`、`unknown` 或其他非公开研究等级；
- conclusion SHA 格式非法；
- title 或 siteId 快照已变化。

这些作品优先于完全缺失作品进入首个研究包，但 inventory 本身不会生成新结论。

### `excluded`

包括归档、未发布、缺少双快照或没有 canonical 目标的 Works/公共结论。撤回结论也会保留在排除清单中供审计。

## 研究包排序与恢复

候选顺序固定为：

1. `supersede_candidate`；
2. `missing_current`；
3. 同类内按 Work 数据库 ID 升序。

首个 `research-batch-0001.jsonl` 固定取前 2,500 条，并分为：

```text
wave-01  250
wave-02  250
...
wave-10  250
```

每个波次拥有独立 JSONL 与 manifest，记录：

- 行数；
- 首尾 Work ID；
- bytes；
- SHA-256；
- `independentlyRecoverable = true`。

任何一个子波次失败，只需重跑该 250 条，不使其他波次失效。

## 输出

```text
inventory-summary.json
already-current.jsonl
missing-current.jsonl
supersede-candidate.jsonl
excluded-works.jsonl
excluded-public-conclusions.jsonl
research-batch-0001.jsonl
research-batch-0001-wave-manifest.json
waves/wave-01.jsonl
waves/wave-01.manifest.json
...
waves/wave-10.jsonl
waves/wave-10.manifest.json
snapshots/works-draft.json
snapshots/works-published.json
snapshots/radar-public-conclusions.json
inventory-run-validation.json
manifest.json
```

runner 最后生成 ZIP 与外层 SHA-256。完整快照和研究输入包只写入本地 `exports`，不提交 Git。

## 运行

在 PR 分支上执行：

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-radar-remaining-canonical-inventory-v01.ps1 `
  -ExpectedBranchHead '<当前 PR 分支 40 位 HEAD>'
```

若 `.env` / `.env.local` 或当前进程没有可用审计凭据，runner 会交互询问邮箱和密码；密码不会显示，也不会写回 `.env`。

成功门槛：

```text
PublicCurrentRows          10804
ResearchBatchRows           2500
ResearchWaveCount             10
GlobalBlockers                  0
ReadyForResearchPackaging    True
PayloadContentWrite          False
PostgreSQLWrite              False
ProductionApplyPackage       False
DedicatedInventoryServer    Stopped
```

## 失败行为

- 失败时不自动 reset、switch、apply 或 rollback；
- 失败的短路径 worktree 保留，便于诊断；
- 只有全部校验、manifest 和 ZIP 完成后才删除 worktree；
- 当前用户工作树中的 `next-env.d.ts`、`payload-types.ts` 和其他脏文件不被触碰；
- 若 public current 不再是 10,804，runner 明确失败，必须先审阅变化，不能静默改变 baseline。

## 后续阶段

inventory 通过后，才允许开始 10 个 250 条研究子波次。研究结果完成后仍需统一 assembly、hash/manifest 复核、隔离 lab、production read-only gate 与独立写入授权；本 PR 不提前创建这些执行材料。
