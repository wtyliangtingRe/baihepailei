# Global Work Lineage 新 Work / Provenance insert-only writer v01

状态：实现完成，production gate 模板默认关闭。

这个 writer 只解决两种物理写入：

1. 插入此前不存在的 immutable provenance supporting object；
2. 插入此前不存在的 exact `workId` current WorkLineage row。

它不是 Discovery、Identity、Research、Publication 或 Work-ID allocator。输入必须来自 research-data 仓库已经验收的 exact Published release；网站不判断作品事实，也不把 Candidate/TEMP 变成 Published。

## 1. 与 existing-row delta 的分工

| 目标 | 命令 | 数据库动作 | 冲突行为 |
| --- | --- | --- | --- |
| 已存在 `workId` | `apply_global_work_lineage_delta_v01.py` | UPDATE one existing row with base SHA CAS | 不存在或 SHA 不符则整批失败 |
| 新 `workId` / 新 provenance object | `provision_global_work_lineage_rows_v01.py` | INSERT only | 任一 ref、workId 或 document SHA 已存在则整批失败 |

两个 writer 都禁止 delete、merge、upsert、自动 retry、自动 rollback 和兼容层。不能用 provision writer 更新旧 row，也不能让 delta writer偷偷创建 row。

## 2. 输入 package

输入是一个 UTF-8、LF 结尾、canonical compact JSON 文件，符合 `schemas/global-work-lineage-provision-package-v01.schema.json`：

```json
{
  "existingProvenanceRefs": [
    "global-audit-run-v01:already-in-database"
  ],
  "provenanceObjects": [
    {
      "document": {
        "auditRunId": "global-audit-run-v01:new-release"
      },
      "objectKind": "audit_run",
      "objectRef": "global-audit-run-v01:new-release"
    }
  ],
  "schemaVersion": "global-work-lineage-provision-package-v01",
  "works": [
    {
      "document": {
        "contractVersion": "global-work-lineage-v01",
        "workId": "90001",
        "canonical": {},
        "identities": {},
        "research": {},
        "assessment": {},
        "candidate": {},
        "published": {},
        "human": {},
        "reservations": {},
        "quarantine": {},
        "effectiveState": {},
        "integrity": {},
        "provenance": {
          "auditRunRef": "global-audit-run-v01:new-release"
        }
      },
      "workId": "90001"
    }
  ]
}
```

示例省略了区块内部正式字段；真实 document 必须是完整 fresh runtime WorkLineage：12 个 active block 全部存在，migration-only `legacy` 不存在，`document.workId` 与外层 exact `workId` 相同，canonical title 与 auditRunRef 非空。

### `existingProvenanceRefs`

- 只列 package 不新增、但 new Work 实际引用的既有 audit run；
- 必须排序、唯一；
- 每个 ref 必须被至少一个 new Work 使用；
- apply 时数据库必须存在同 ref 且 `object_kind=audit_run`；
- 不能把 ref 同时声明为 existing 和 new。

### `provenanceObjects`

允许现有五类 supporting object：

- `observation`
- `audit_run`
- `output_manifest`
- `provenance_bundle`
- `formal_package_manifest`

`objectRef` 和 canonical document SHA 都必须在 package 内唯一。数据库里任一相同 ref 或相同 document SHA 已存在时，writer 不做幂等吞并，而是失败，要求操作者重新清点 exact release。

允许 `works=[]` 的 provenance-only package，用于在 existing-row delta 前先插入新的 immutable supporting objects。package 至少要有一个 new provenance object 或 new Work，不能全空。

### `works`

- `workId` 必须由 research-data Identity authority 预先分配；writer 不生成 ID；
- workId 和 document SHA 在 package 内必须唯一；
- 每个 Work 的 auditRunRef 必须在 `provenanceObjects` 中以 `audit_run` 新增，或列在 `existingProvenanceRefs`；
- 同一事务内先插 provenance，再检查/锁 audit run dependency，再插 Work。

## 3. offline 检查

默认不连接数据库：

```bash
python3 scripts/work-lineage/provision_global_work_lineage_rows_v01.py \
  --package path/to/provision-package.json \
  --release-ref release/global-work-lineage-v01/new-works/2026-08-22.1 \
  --out-dir path/to/offline-proof
```

新目录包含：

```text
offline-proof/
├── apply.sql
└── receipt.json
```

offline receipt 给出 raw package SHA、provenance/work set SHA、精确数量、SQL SHA 和 `databaseWrite=false`。再次使用同一 output 目录会失败，不覆盖 proof。

## 4. gate

复制 `config/global-work-lineage-provision-apply-gate-v01.template.json` 到新的版本化 release/gate artifact，并填写：

| 字段 | 必须精确绑定 |
| --- | --- |
| `releaseRef` | research-data accepted Published release |
| `packageSha256` | package raw bytes |
| `provenanceSetSha256` | 按 objectRef 排序的 ref/kind/document digest set |
| `workSetSha256` | 按 opaque workId 稳定排序的 workId/document digest set |
| `provenanceObjectCount` | package new object 数 |
| `workCount` | package new Work 数 |
| `applyEnabled` | 模板是 false；独立审批后才可为 exact package 创建 true gate |

不能修改已使用的 gate。package 任意一个字节变化，都要新 gate。

## 5. production apply

apply 前：

1. 数据库备份完成且可读取；
2. offline proof 通过；
3. exact Published release、package SHA、set SHA、count 与 gate 一致；
4. 确认目标 `workId` 应当全部不存在；
5. 确认 supporting objects 不存在，existing provenance refs 已存在；
6. 网站 runner / operator 使用的数据库 URL 是明确目标，不依赖模糊默认值。

命令：

```bash
python3 scripts/work-lineage/provision_global_work_lineage_rows_v01.py \
  --package path/to/provision-package.json \
  --release-ref release/global-work-lineage-v01/new-works/2026-08-22.1 \
  --out-dir path/to/applied-proof \
  --gate path/to/enabled-exact-gate.json \
  --apply \
  --database-url 'postgresql://USER:PASSWORD@HOST:5432/DATABASE' \
  --confirm-release-ref release/global-work-lineage-v01/new-works/2026-08-22.1 \
  --confirm-package-sha256 <raw package SHA-256>
```

`--apply`、enabled gate、database URL、release 确认、package SHA 确认缺一不可。

## 6. 单事务行为

生成 SQL 只含 INSERT：

1. `BEGIN`；
2. 对每个 new provenance object 检查 ref/document SHA 都不存在；
3. INSERT provenance object；
4. 对每个 new Work 检查 workId/document SHA 都不存在；
5. 以 `FOR KEY SHARE` 检查 auditRunRef 存在且 kind 是 audit_run；
6. INSERT Work；
7. deferred FK 与所有表约束通过；
8. `COMMIT`。

任一步失败，PostgreSQL 回滚整个事务。并发操作者即使同时看到“absent”，primary/unique constraint 也会让一个事务失败，不会变 upsert。

## 7. apply 后

- receipt 必须是 `PASS_APPLIED`；
- 按 exact workId 查询 new rows；
- 查询 row count、canonical title、auditRunRef、document SHA；
- 保留 package、gate、apply.sql、receipt、backup ref 与 releaseRef；
- 不删除旧备份，不自动重跑。

若 psql 返回失败：先独立查询数据库。不要直接重跑，因为事务是否已经 COMMIT 必须由 durable state 证明。若 row 已存在，新的 provision 必须停止；后续正式变化改走 existing-row CAS delta。

## 8. 五会话中的使用位置

只有 Publication 与 Website Delta 已被后续 gate 开放后才使用：

1. research-data Publication worker 产出 accepted Published revision；
2. 独立 Website Delta worker 产出 exact provision package；
3. S1 在网站仓库离线运行本 writer；
4. 用户检查 package/gate/proof；
5. 显式授权后 S1 apply；
6. 另一个会话/测试做 readback。

当前 v08 只允许 Research/QA，因此这个 writer 即使代码存在，gate 模板仍是 false，也不能用于当前 20 项 canary。
