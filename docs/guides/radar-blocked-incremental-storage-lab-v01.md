# Radar blocked 683 条增量 Storage 隔离录入演练 v0.1

## 状态与目的

本流程绑定已经验收的 683 条 assembly dry-run 结果，在生产 PostgreSQL 保持只读的前提下完成：

```text
当前 9,000 条公共结论基线
→ fresh pg_dump
→ --network none 隔离恢复
→ 683 条增量 create
→ 主表、子表与原 9,000 条 acceptance
→ 删除 683 条
→ sequence 精确恢复
→ 完整 baseline 指纹恢复
```

该阶段只证明增量数据能够在真实数据库结构中往返。它不创建 production gate，也不授权生产写入。

## 固定输入

```text
RADAR-BLOCKED-ASSEMBLY-DRYRUN-20260724-202932.zip
SHA-256 D41FB41951E35E8DC0C2CDDE1FB904968AF3DF5D3564BDDB8A13A3FB002C14C2

public-ai-storage-ready.jsonl
SHA-256 4DDAADC268B9F84F7B8A0D2C9BA8A2E73C37F129967CCF0D59C7E970B3066862
```

固定基数：

```text
baseline public rows  9000
incremental creates     683
post-apply rows         9683
```

## 增量等级分布

```text
A  51
B 423
C 146
D  40
E  15
F   8
```

演练后的总分布预期：

```text
S    8
A  318
B 1098
C 1014
D 7072
E  153
F   20
```

## 生产库安全边界

生产容器只执行：

- `SELECT` 型 preflight；
- 主表、子表、sequence 和全部 public 表指纹读取；
- `pg_dump --serializable-deferrable`；
- 临时文件复制与清理。

所有生产 `psql` 调用都额外设置：

```text
default_transaction_read_only=on
```

禁止：

- `INSERT` / `UPDATE` / `DELETE`；
- migration 或 schema push；
- Payload 读写；
- Works 修改；
- 生成生产 apply runner；
- 自动创建 production gate。

## 隔离库 apply 门槛

写入前必须确认：

- `radar_public` 当前恰好 9,000 行；
- 9,000 行全部为 current；
- publication key 与 conclusion hash 各自唯一；
- 683 个 publication key 与基线零重叠；
- 683 个 Work ID 全部存在；
- 输入 manifest、行数、身份与 conclusion hash 全部匹配。

隔离 apply 只能执行 `INSERT`，禁止 upsert、update 或 merge。

## Acceptance

应用 683 条后必须验证：

- 主表恰好 9,683 行；
- 原 9,000 条完整 JSONB 指纹不变；
- 683 条主表字段与 storage-ready 输入逐字段一致；
- 683 条 review reason、matched rule、contradiction 子表完全一致；
- 新增 publication key、Work ID 和 conclusion hash 集合一致；
- 所有非 Radar 表行数不变；
- 无孤儿子行；
- 等级分布符合固定预期。

## Exact rollback

回滚只删除本次 683 个 publication key，依靠 FK cascade 删除其子行。随后：

1. 恢复 `radar_public_id_seq`；
2. 恢复 `radar_public_review_reasons_id_seq`；
3. 比较全部 public 表行数；
4. 比较 Radar 主表与三类子表完整指纹；
5. 比较 sequence 状态；
6. 再次确认 683 个 key 全部不存在。

只有所有结果与 apply 前完全一致，才记录 `baselineRestored = true`。

## 输出

完整 fresh dump 只留在本地：

```text
exports/radar-blocked-incremental-storage-lab-<timestamp>/database-backup.dump
```

可上传的 evidence ZIP 明确排除完整 dump：

```text
RADAR-BLOCKED-INCREMENTAL-STORAGE-LAB-EVIDENCE-<timestamp>.zip
```

Evidence 包包括 SQL、preflight、表计数、完整指纹、sequence 状态、acceptance、rollback 日志、summary 与 manifest。

## 后续

隔离演练证据包经独立验收后，才能另行生成新的 production gate。production gate 与 production apply 必须是后续独立阶段，不能由本演练隐式授权。
