# Baihepailei

Baihepailei 是百合作品资料库的网站运行时。当前主线是 **plain Next.js + fresh Global Work Lineage v01 PostgreSQL**；旧 Payload/Radar、账户、评论、个人列表和旧兼容读取已经从可执行运行时切断，不再是当前架构。

## 两份总入口

- 五会话、workers、两个 runner、各阶段提示词与生产边界：[`baihepailei-research-data/OPERATIONS.md`](https://github.com/wtyliangtingRe/baihepailei-research-data/blob/main/OPERATIONS.md)
- 13 区块、两仓数据结构、25-Work Chunk、备份与最小重跑：[`baihepailei-research-data/DATA-STRUCTURE-AND-BACKUP.md`](https://github.com/wtyliangtingRe/baihepailei-research-data/blob/main/DATA-STRUCTURE-AND-BACKUP.md)

本站不复制第二套 Research/Assessment/Publication 流程。批准网站导出之前的数据 authority 全部在 research-data 仓库。

## 当前运行时

- Next.js 16、React 19；
- PostgreSQL 17；
- `WORK_LINEAGE_DATABASE_URL` 是正式数据库连接键；
- 首页、browse、Work 列表、Work 详情和搜索从 fresh WorkLineage repository 读取；
- `/api/work-lineage/works` 提供 exact workId lookup 和 title/Work-ID presentation search；
- creator/organization 等未来实体层在没有正式数据前保持空；
- 历史 Radar download 返回 retired/`410 Gone`，不会 fallback 到旧索引；
- feedback 只是独立 discovery hint 渠道，不能直接写 Formal WorkLineage。

`next.config.mjs` 不包装 Payload，`package.json` 没有 Payload/GraphQL/editor 依赖。历史文件可能仍存在于 Git history 中作为审计材料，但没有当前 route、workflow、credential 或 runtime import。

## 数据库

当前 schema 只有两张表：

| 表 | 用途 |
| --- | --- |
| `global_work_lineage_v01.work_lineages` | 每个 existing `work_id` 一行完整 current WorkLineage JSONB + document SHA |
| `global_work_lineage_v01.provenance_objects` | Frozen Section 13 已定义的 Audit/Manifest/Provenance supporting objects |

这不是第 14 个逻辑区块。网站 current document 保留 Frozen 13-block 合同的 12 个 active blocks；migration-only `legacy` 已 sunset 并省略。

完整 fresh import/隔离证明：[`docs/GLOBAL-WORK-LINEAGE-FRESH-DATABASE-v01.md`](docs/GLOBAL-WORK-LINEAGE-FRESH-DATABASE-v01.md)。

## 本地启动

先复制 `.env.example` 为 `.env.local` 并更改开发密码，不要提交它：

```powershell
docker compose up -d postgres
pnpm install
pnpm dev
```

默认本地数据库：

```text
host: localhost
port: 15432
database: baihepailei_v01
volume: postgres-v01-data
```

这是与旧 `postgres-data` 分离的 fresh volume。首次装载正式包时按 fresh database 文档执行；不要把旧 Payload 数据库接入、迁移或建立兼容 view。

## Existing-row CAS delta

正式增量写入器只允许替换已经存在的 exact `workId`：

- 默认完全离线，只生成 `apply.sql` 与 receipt；
- 每行先 `FOR UPDATE`；
- current `document_sha256` 必须等于 delta 的 base SHA；
- 禁止 create、delete、insert、merge、upsert、whole-database lock 和 automatic retry；
- `--apply`、enabled versioned gate、exact releaseRef/delta/base-set SHA/row count 和 confirm-release-ref 必须同时匹配；
- production apply 前必须备份；开始后禁止自动 retry/rollback。

完整格式与命令：[`docs/GLOBAL-WORK-LINEAGE-DELTA-WRITER-v01.md`](docs/GLOBAL-WORK-LINEAGE-DELTA-WRITER-v01.md)。

## New-work / provenance insert-only provision

新 `workId` 与新的 immutable provenance supporting object 使用另一条窄写入路径：

- 输入必须绑定 research-data 已验收的 exact Published release；
- `workId` 必须已经由 Identity authority 分配，网站 writer 不分配 ID；
- 只允许 `INSERT`，禁止 update、delete、merge、upsert、`ON CONFLICT` 和自动重试；
- package 中任一 object ref、document SHA 或 workId 已存在，整个事务失败；
- 默认只生成离线 SQL 与 receipt；production apply 需要 disabled-by-default 的独立 exact gate、releaseRef 与 package SHA 双确认；
- 可单独插入 provenance，也可在同一事务先插 provenance、再插依赖它的新 Work。

完整 package、gate、离线与 apply 操作单：[`docs/GLOBAL-WORK-LINEAGE-PROVISION-WRITER-v01.md`](docs/GLOBAL-WORK-LINEAGE-PROVISION-WRITER-v01.md)。当前 v08 仍未开放 Publication/Website，因此代码存在不等于允许写库。

## 测试

运行时与边界：

```powershell
pnpm test:work-lineage-runtime
pnpm test:fresh-runtime-boundary
pnpm build
```

delta writer：

```powershell
python -m unittest discover -s tests -p "test_apply_global_work_lineage_delta_v01.py" -v
```

insert-only provision writer：

```powershell
python -m unittest discover -s tests -p "test_provision_global_work_lineage_rows_v01.py" -v
```

真实 PostgreSQL fixture integration 由 self-hosted `radar-private` runner 执行。它会在独立 disposable 数据库中证明新 provenance/new Work 可以插入、重复 package 必须失败、既有 Work 字节不变。Ubuntu 中 `docker version` 必须同时显示 Client 和 Server。

## 两个 runner

同一台电脑可以同时运行：

- research-data 仓库 runner；
- 本网站仓库 runner。

它们必须在两个独立安装目录，各只启动一个进程。research control-plane job 不占宿主 5432，网站 fresh-database fixture 使用 5432，因此当前一边一个 runner 可以并行。

不要启动同一 runner 目录两次。也不建议在同一主机同时开两个网站 repo runner：两个 fresh-database job 可能争用 5432，并让 PostgreSQL service-container 检测看到多个容器。

## 安全边界

- 不提交数据库 dump、`.env`、token、密码、Cookie、私钥或生产证书；
- 不恢复旧 Payload/Radar runtime、表、route、workflow 或 fallback；
- 不从 Candidate、TEMP、旧索引或聊天生成网站 truth；
- production write 必须来自 exact accepted Published lineage 和显式网站 gate；
- merge 普通 PR 不会自动 production apply。
