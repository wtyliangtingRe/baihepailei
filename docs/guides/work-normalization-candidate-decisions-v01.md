# Work 规范化候选决定 v0.1

状态：基于 2026-07-23 UTF-8/Base64 验证审计包形成的只读决策。尚未执行数据库写入、迁移、schema push 或 Works 发布。

## 输入完整性

可信输入必须同时满足：

- ZIP SHA-256 与运行终端输出一致；
- `manifest.json` 中每个文件的字节数和 SHA-256 匹配；
- `validation.json.jsonValidated = true`；
- `validation.json.transport = postgres_utf8_base64_to_powershell_utf8`；
- 8 条人工候选、1 条结构例外和 56 条等级候选均能逐行解析为 JSON。

首个乱码候选包不属于迁移证据。

## 人工审核候选

8 条候选分为：

- `copy_semantic_legacy_to_canonical`: 1
  - canonical 为空，旧轨道包含有意义的 `disputed/reviewed` 状态与说明；
  - 仅此类可进入后续受保护写入候选；当前仍未生成可执行 UPDATE。
- `metadata_only_no_copy`: 2
  - 旧轨道只有默认 `pending`、时间和人员；
  - 复制会伪造“已完成审核”的含义，因此只在备份中保留。
- `canonical_keep_legacy_metadata_only`: 1
  - canonical 已含有语义内容；旧时间/人员不回填到 pending 评估。
- `canonical_equivalent_no_write`: 2
  - 新旧语义一致，canonical 已完整，无需写入。
- `deprecated_legacy_requires_discard_approval`: 2
  - 旧说明混有隐藏、恢复或生命周期日志；
  - 不得复制进 `humanAssessment`；删除旧列前需明确放弃或转入独立审计归档。

canonical 值始终优先，冲突旧值不得覆盖。

## 等级候选

56 条候选分为：

- `canonical_human`: 2
  - 已有有效人工等级，继续作为有效公开等级。
- `private_ai_requires_publication_review`: 6
  - Works 内存在私有 AI 建议；
  - 只有审阅并进入 `radar-public-conclusions` 后才能公开。
- `legacy_ai_candidate_requires_review`: 47
  - 原审计只能确认它们缺少 canonical 人工或私有 AI 字段；
  - 但 `public-catalog-import-v02` 与 `ai_synthesized_pending_review` 共同构成强来源信号；
  - 这些值作为旧 AI 候选保留，不能冒充人工结论，也不能自动公开。
- `archived_nonpublic_legacy_rank`: 1
  - 已归档/草稿测试记录，不继承为公开等级。

因此共有 53 条公共 AI 审阅候选，但自动发布资格均为 false。

存储的 `rank` 现在不能删除。必须先完成公共 AI 候选审阅、切换所有读取方到 `effectiveGrade`，再单独批准退役迁移。

## 状态与废止字段

唯一 `status = archived` 例外同时满足：

- Payload `_status = draft`；
- `catalogStatus = archived`。

决定：

- 不将旧 `status` 映射到 `_status`；
- 保留现有 `_status` 与 `catalogStatus`；
- 备份及验收后删除旧 `status`；
- `legacy_x_wiki_page` 全库为空，删除时不提供替代字段。

## 只读计划生成

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-dryrun-v01.ps1
```

该入口只读取最新通过验证的候选目录，并生成：

- 人工规范化逐条计划；
- 需明确决定的人工记录；
- 等级来源保留计划；
- 公共 AI 审阅候选；
- 状态/废止字段计划；
- 只读 before-value 验证 SQL；
- SHA-256 清单。

生成器不会输出可执行 UPDATE、DELETE、ALTER 或 DROP SQL。

## 下一阶段门槛

进入任何写入前，仍需：

1. 运行并审阅 dry-run 计划包；
2. 对两条 deprecated 旧说明作出保留/放弃决定；
3. 对 53 条 AI 候选确定批次与公开策略；
4. 准备并验证可恢复备份；
5. 单独生成带 exact-before guards 的最小写入 SQL；
6. 准备回滚与验收查询；
7. 获得明确执行批准。
