# Radar blocked assembly dry-run v0.1

状态：用于已完成研究分流的 683 条 blocked Radar 行，生成全离线的 AI 快照组装、公共 create 候选和 storage-normalized 数据计划。

## 输入绑定

本流程只接受以下三个不可变 ZIP：

```text
RADAR-BLOCKED-ASSEMBLY-DRYRUN-INPUT-20260724.zip
SHA-256 ECD2B30F925C2C20EF40F69A000D3BBD3950C6E42917AECAD0449F7E79DD4D68

RADAR-BLOCKED-RESEARCH-ALL-1805-20260724.zip
SHA-256 BFD991789B582FAF4E780C973804D7EE8AF4669F7DDB9724C3C52F9133D680A1

RADAR-PUBLIC-BLOCKED-REMEDIATION-20260724-025848.zip
SHA-256 954C595E92C91F140B568389022C529196F5B4DBAC00A83964377166B9EEE729
```

三个包缺一不可：

- assembly 输入包固定 683 条研究决定；
- 完整研究包提供严格 JSONL、完整 selected candidate ledger、来源家族和人工覆盖层；
- remediation 包绑定首次 9,000 条公共结论基线和 latest-wins 冲突策略。

assembly 输入包本身不含完整历史快照，因此不得单独用它生成公共记录。

## 参考的既有 dry-run 模式

本流程复用项目中已经验证的做法：

1. 输入文件和计划必须绑定精确 SHA-256；
2. 输出分成 `all / ready / blocked / warnings / summary`；
3. Work ID、publication key、candidate SHA 和 expected-before hash 必须一致；
4. 模拟结果记录 changed fields、before hash、after hash 和安全标志；
5. 任意 blocker 都阻止该行进入 ready；
6. dry-run 不包含 execute、apply、write、patch、publish 或 restore 模式。

与早期 Works 定向发布 dry-run 不同，本流程不读取实时 Payload。它完全基于已经验收的不可变输入执行。

## AI 快照组装

每条 ready 行从 ledger 中选定的 latest structurally valid candidate 开始，并生成一份新的完整 AI 快照。

固定规则：

```text
current = 身份确定且结构有效的最新 AI 快照
history = 全部旧快照、哈希、冲突与替换关系
```

组装时：

- 保留 grade、decisive rule、matched rules、contradictions、confidence、coverage、policyVersion 和 requiresHumanReview；
- `assessmentBatch` 更新为 `RADAR-BLOCKED-ASSEMBLY-20260724`；
- `assessedAt` 绑定完整研究包的生成时间；
- `sourceCount` 更新为独立 provider family 的真实数量；
- 20 条人工核验记录使用人工 findings 作为新的 source summary；
- 663 条结构化交叉验证记录保留 warning：`structured_source_evidence_is_triage_not_manual_page_review`。

结构化 warning 不会改变等级或规则，也不能被解释为逐页人工阅读已经完成。

## Whole-snapshot replacement

新 AI 快照必须整体覆盖旧 AI 快照：

- 所有 14 个快照字段都显式写出；
- 新值为 `null` 时清除旧值；
- 数组和对象完整替换；
- 禁止从历史候选补回新版未保留的字段；
- 旧候选、冲突与来源只保存在 bound ledger/history 中。

私有计划会重新计算语义 changed fields 和 patch SHA-256，但本阶段不向 Payload 发出请求。

## 公共 create 候选

当前 683 条在已接受基线中均没有 current public record，因此本次预期全部分类为：

```text
ready_public_ai_create = 683
ready_public_ai_update = 0
already_current_public_ai = 0
blocked = 0
```

公共记录继续使用独立 `radar-public-conclusions` 结构，不写入或发布 Works 草稿。

## Storage normalization

公共记录首先生成 pre-storage 版本，再调用现有 `public-conclusion-storage-v01.mjs`：

```text
assessedAt
→ PostgreSQL timestamp(3) 等价 UTC 毫秒

conclusionSha256
→ 基于实际可存储 publicRecord 重算
```

storage normalization 只允许改变：

```text
publicRecord.radarAssessment.assessedAt
publicRecord.conclusionSha256
```

任何其他业务字段变化都会让整包失败。

## 输出

```text
radar-blocked-assembly-dryrun.jsonl
ready-for-offline-assembly.jsonl
private-ai-whole-snapshot-plan.jsonl
public-ai-pre-storage-ready.jsonl
public-ai-storage-ready.jsonl
public-conclusion-storage-rewrite-map.jsonl
bound-selected-ledger.jsonl
warnings.jsonl
blocked.jsonl
radar-blocked-assembly-dryrun-summary.json
assembly-dryrun-validation.json
assembly-dryrun-run-receipt.json
bound-inputs/
manifest.json
README.md
```

所有 JSONL 使用 ASCII-safe 序列化，保证一个物理行只包含一个 JSON 对象。

## 本地入口

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-and-package-radar-blocked-assembly-dryrun-v01.ps1" `
  -ExpectedBranchHead "<reviewed branch head>"
```

runner 会：

1. 核对当前 Git HEAD；
2. 校验三个输入 ZIP 的固定 SHA-256；
3. 运行 builder、storage normalization 和 regression tests；
4. 解压后递归校验三个 manifest；
5. 生成并验证 683 条全离线 dry-run；
6. 检查 683 条唯一 Work/publication identity；
7. 生成递归 manifest 与最终 ZIP。

## 通过门槛

```text
rows                         683
readyForOfflineAssembly      683
privateAIWholeSnapshotPlans  683
readyPublicAICreate          683
storageNormalized            683
warnings                     663
blocked                        0
globalBlockers                 0
productionPublicBaseline    9000
```

同时要求：

- candidate SHA bindings = 683；
- current public overlap = 0；
- lifecycle / visibility passed = 683；
- human-track protection passed = 683；
- whole-snapshot / explicit-null / no-residual-merge = 683；
- pre-storage 和 storage hashes 全部可重现；
- storage changed fields 只有 timestamp 与 conclusion hash。

## 安全边界

- 不联网；
- 不启动 Next；
- 不读取或写入 Payload；
- 不读取或写入 PostgreSQL；
- 不运行 Docker；
- 不生成生产执行授权；
- 不修改现有 9,000 条公共结论；
- 不把 warning 当作已完成的人工审阅。

本 dry-run 通过后，下一阶段仍只是生成并审阅数据级隔离 PostgreSQL lab 计划。必须另行完成 fresh dump、无网络恢复、create/acceptance/exact rollback 和 baseline 恢复，才可以讨论新的 production gate。
