# Work 规范化候选决定 v0.1

状态：基于 2026-07-23 UTF-8/Base64 验证审计包形成的只读决策，并经 dry-run v02 语义门槛校正。尚未执行数据库写入、迁移、schema push 或 Works 发布。

## 输入完整性

可信输入必须同时满足：

- ZIP SHA-256 与运行终端输出一致；
- `manifest.json` 中每个文件的字节数和 SHA-256 匹配；
- `validation.json.jsonValidated = true`；
- `validation.json.transport = postgres_utf8_base64_to_powershell_utf8`；
- 8 条人工候选、1 条结构例外和 56 条等级候选均能逐行解析为 JSON。

首个乱码候选包不属于迁移证据。

## 人工审核候选

8 条候选的 v01 分类为：

- `copy_semantic_legacy_to_canonical`: 1
  - canonical 为空，旧轨道包含有意义的 `disputed/reviewed` 状态与说明；
  - 只具备“计划资格”，不能在 canonical Work identity 未确认时自动写入。
- `metadata_only_no_copy`: 2
  - 旧轨道只有默认 `pending`、时间和人员；
  - 复制会伪造“已完成审核”的含义，因此只在备份中保留。
- `canonical_keep_legacy_metadata_only`: 1
  - canonical 已含有语义内容；旧时间/人员不回填到 pending 评估。
- `canonical_equivalent_no_write`: 2
  - 新旧语义一致，canonical 已完整，无需写入。
- `deprecated_legacy_requires_discard_approval`: 2
  - 旧说明混有隐藏、恢复或生命周期日志；
  - 不得复制进 `humanAssessment`；删除旧列前需在备份/审计归档中保留后明确放弃。

canonical 值始终优先，冲突旧值不得覆盖。

v02 将全部实际 `automaticWriteEligible` 强制为 `false`。原本唯一的复制候选必须先通过 canonical identity gate。

## 等级候选

56 条等级记录的来源保护保持不变：

- 有效 canonical 人工记录：2；
- 公开目录导入形成的旧 AI 候选：47；
- Works 私有 AI 字段候选：6；
- 归档/草稿且无公开来源的旧等级：1。

v01 曾把 6 条私有 AI 候选全部计入公共 AI 审阅队列，因此得到 53 条。

v02 语义复核发现其中一条同时满足：

```text
Payload _status = draft
catalogStatus = archived
```

非公开生命周期必须优先于私有 AI 分支，所以该记录改为：

```text
archived_nonpublic_private_ai
requiresPublicationReview = false
automaticPublicationEligible = false
```

校正后的公共 AI 审阅候选为 **52 条**，且全部仍需 canonical identity gate，自动发布资格均为 false。

存储的 `rank` 现在不能删除。必须先完成公共 AI 候选审阅、canonical Work 合并判断、所有读取方切换到 `effectiveGrade`，再单独批准退役迁移。

## canonical Work identity

当前 dry-run 数据已经直接提示至少两组同作品分裂记录：

- `Endro~!` 的 AniList / Bangumi 记录；
- `Soukou no Strain / 奏光之Strain` 的 AniList / Bangumi 记录。

这意味着：

- 人工说明不能先复制到一个 Work，而 AI 候选留在另一个 Work；
- 同一作品的两个 AI 等级不能分别成为两条公共结论；
- v02 只生成身份复核提示，不自动选择 canonical Work ID；
- 最终选择必须结合外部 ID、来源、更新时间与既有合并规则。

## 状态与废止字段

唯一 `status = archived` 例外同时满足：

- Payload `_status = draft`；
- `catalogStatus = archived`。

决定：

- 不将旧 `status` 映射到 `_status`；
- 保留现有 `_status` 与 `catalogStatus`；
- 备份及验收后删除旧 `status`；
- `legacy_x_wiki_page` 全库为空，删除时不提供替代字段。

## 只读计划校正

v01 生成基础只读计划：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-dryrun-v01.ps1
```

随后必须通过 v02 语义门槛：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-dryrun-v02.ps1 `
  -DryRunDirectory .\exports\work-normalization-dryrun-<timestamp>
```

v02 会：

- 先拦截 draft / archived 记录；
- 为人工复制与公共 AI 候选增加 canonical identity gate；
- 输出同作品分裂提示；
- 将时间比较改为 `timestamptz` 类型比较；
- 继续保证 SQL 只有只读事务与 SELECT。

## 下一阶段门槛

进入任何写入前，仍需：

1. 运行并审阅 v02 dry-run 校正包；
2. 对两条 deprecated 生命周期日志采用“备份归档后不迁移到 humanAssessment”的决定；
3. 解决所有 canonical identity 提示；
4. 对 52 条公共 AI 候选确定 canonical Work ID、批次和公开策略；
5. 准备并验证可恢复备份；
6. 单独生成带 exact-before guards 的最小写入 SQL；
7. 准备回滚与验收查询；
8. 获得明确执行批准。
