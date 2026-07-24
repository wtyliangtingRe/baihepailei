# Radar 统一 1,804 条生产闭环与后续复用手册 v0.1

状态：**生产执行完成，最终 recovery evidence 已独立复核通过。**

日期：2026-07-25（Asia/Taipei）

## 1. 最终生产状态

本轮在既有 9,000 条 current 公共 AI 结论上新增 1,804 条：

```text
生产 baseline       9,000
本轮新增             1,804
最终 current 总数   10,804
```

最终 post-apply recovery 结果：

```text
PostApplyRows               10804
AcceptanceChecks            25 / 25
Original9000Unchanged       True
NonRadarTablesUnchanged     True
ProductionApplyCommitted    True
ProductionRollbackExecuted  False
PersistentWriteInRecovery   False
```

独立复核确认：

- recovery evidence ZIP SHA-256 匹配；
- ZIP CRC 正常；
- manifest `30 / 30`；
- backup 前、后两轮 acceptance 均为 `25 / 25`；
- 两轮 acceptance 与隔离演练预期输出逐字一致；
- baseline fingerprint 在生产 apply 前后保持一致；
- recovery backup 前后 full fingerprint、sequence 与 87 张 public 表计数完全一致；
- 11 份 stderr 全空；
- post-apply backup archive 可读取。

## 2. 数据构成

```text
既有 accepted assembly      683
Phase 2 canonical ready    1,121
实际 production create     1,804
noncanonical merge-out         1
```

唯一 noncanonical 记录：

```text
Work 25561
→ 不单独创建公共 AI 结论
→ 由 canonical Work 32094 覆盖
```

本轮增量等级分布：

```text
A  104
B  692
C  182
D  779
E   39
F    8
```

生产最终等级分布：

```text
S     8
A   371
B 1,367
C 1,050
D 7,811
E   177
F    20
```

## 3. 不可变代码提交

规则、Phase 2、统一 assembly 与 storage lab：

```text
852c1dbd5c157941d7b39412790bda58cbd1c73f
feat(radar): add dual-track coverage and unified 1804 lab
```

production read-only gate：

```text
a4681f8394ba213df8a4d1bdc2253e72c377a0d5
feat(radar): add unified 1804 production read-only gate
```

生产执行与 recovery 均绑定分支：

```text
agent/radar-public-conclusions-v01
```

## 4. 核心产物与 SHA-256

| 阶段 | SHA-256 |
|---|---|
| Phase 2 closeout | `AE6908AB6E375FBCFA7602FFA39115FBA20300D816105E76421DBD9E8D012330` |
| 统一 assembly | `53AD4CD92D5A7186B7D52A5BDC8D6E714573E7C9CC17559D8BF96CD2D194B8B9` |
| storage lab evidence | `38AF33DCE50F0536A951D6EED26E85C3E9EA45A251F53588D5AB5E2E8772351C` |
| production read-only gate evidence | `07B108DEB7F77F6A61AD89B91640E3F421757D91EF42015D7A5771FC4D5F5106` |
| production execution package | `F03B688B40A23C3C40E00A7FC737A4F3F48E5B4DF7980D7C75454526D9962151` |
| execution failure evidence | `72FE447C0B688276A9280CFE21863FCC78537B738D9E5E1216A3E5DA88709C9D` |
| rollback package | `99EC8B44EA76D48AE05BF8627B632785BEF00F02CE2CFBB94CFD1F02CFBDB4F6` |
| recovery V02 | `342C6B136D0665E65FC5191C77E9D473543E3229243FCC2B85961E4A0937EF30` |
| final recovery evidence | `FB7AB619390CDE56FC81275CE49FDBE12EE9EEF01D3E10CF394E27D9EC335B3F` |

本机完整备份：

| 备份 | SHA-256 |
|---|---|
| storage lab fresh backup | `8A8D6DD3BE51E5844DD97C31CDAC8A84EF5DE52C450368AE75001332B12410F7` |
| read-only gate fresh backup | `BEB9643C2A8FF9A2A2C8C9BE9A53D83EDD2398B5DA7C3A5408DB6DA737BC5955` |
| production apply 前即时 backup | `5C0AC79588AA73E64A1C399AEEFEE95B7486E09A4A136A7D982D9893485B6F92` |
| post-apply recovery backup | `BD46339679D4B63926B03E45BBA05AE45918BD6697EDECBD257B85002FCACF8F` |

完整 dump 只保留本机，不提交 Git、不放入小型 evidence ZIP。

## 5. 标准执行状态机

后续每轮公共 Radar 增量统一使用：

```text
研究与 canonical identity 收口
→ storage-normalized assembly
→ 隔离 restore / apply / acceptance / rollback
→ 独立 lab evidence 验收
→ immutable code commit
→ production read-only exact-before gate
→ 独立 gate evidence 验收
→ production execution package
→ 独立 apply 授权
→ exact-before + 即时 backup + 预生成 rollback package
→ serializable apply
→ post-apply acceptance
→ fresh post-apply backup
→ receipt / evidence
→ 独立最终验收
```

不得跳过阶段，也不得把某阶段成功自动解释成下一阶段授权。

## 6. 本轮故障与永久防回归规则

### 6.1 Builder / runner summary 文件名不一致

故障：builder 输出 `radar-unified-incremental-storage-lab-plan-summary.json`，runner 一度读取另一个名称。

永久规则：

- builder 输出文件名只能在一个机器可读 binding 文件中定义；
- runner 与测试读取同一个 binding；
- 测试必须逐字验证 builder 输出名等于 runner 输入名。

### 6.2 Git staged diff 的 EOF 多余空行

故障：测试通过，但 `git diff --cached --check` 拦截 `new blank line at EOF`。

永久规则：

- commit 前强制 `git diff --cached --check`；
- 失败时只撤销本轮 staged 文件，不 reset 用户其他 dirty 文件；
- LF/CRLF warning 不是失败条件，`diff --check` 才是门槛；
- 文本文件保留恰好一个结尾换行符。

### 6.3 Acceptance 错误使用全局只读 session

故障：post-apply acceptance 需要 `CREATE TEMP TABLE`，却被放入 `default_transaction_read_only=on` session，因此在 apply 已提交后失败。

永久规则：把验证 SQL 分成两类：

```text
Pure read-only verification
→ SELECT / fingerprint / count
→ 可以使用 default_transaction_read_only=on

Temporary-session acceptance
→ CREATE TEMP TABLE / COPY temp / SELECT
→ 不得使用全局 read-only session
→ 严禁 persistent INSERT / UPDATE / DELETE / DDL
```

静态测试必须确认 temporary acceptance 仅触碰会话临时对象。

### 6.4 Recovery V01 手抄 SHA 多一位

故障：执行前 backup 的 64 位 SHA 被手抄成 65 位，导致 metadata 正确却被 fail-closed 拒绝。

永久规则：

- 所有 SHA 必须匹配 `^[0-9A-Fa-f]{64}$`；
- 不得从聊天或日志向多个脚本手工重复抄写；
- 使用 `execution-bindings.json` 统一生成 runner、test 与 summary；
- 测试同时验证长度、字符集、metadata 逐字一致和已知错误值不存在。

## 7. Commit 后失败的恢复规则

外层进程失败不等于 apply 未提交。第一步必须读取：

```text
productionApplyCommitted
productionDatabaseWrite
rowsCreated
automaticRollbackExecuted
rollbackPackageReady
```

若 `productionApplyCommitted = true`：

- **禁止重跑 apply**；
- **禁止自动 rollback**；
- 保留 failure evidence、执行前 backup 与 rollback package；
- 只允许生成 post-apply recovery；
- recovery 只能补 acceptance、fingerprint、sequence、table counts、backup 与 receipt。

Rollback 必须使用独立 package、独立 SHA、独立授权短语，并在执行前确认当前状态精确等于目标 post-apply 状态。

## 8. 每轮强制检查表

### Assembly

- cohort 数量算术正确；
- overlap 为 0；
- publicationKey、Work ID、conclusion hash 唯一；
- conclusion hash 全部可重算；
- storage normalization 不改变业务等级与规则；
- noncanonical merge-out 有 canonical target。

### Lab

- fresh production dump；
- `--network none`；
- apply / acceptance / exact rollback；
- baseline 与 sequence 恢复；
- 非 Radar 表往返一致；
- 生产库全程只读。

### Gate

- 当前生产与 accepted baseline 的 preflight、fingerprint、sequence、全表计数逐字一致；
- fresh backup archive 可读取；
- backup 前后零漂移；
- gate 不包含 apply 能力。

### Production apply

- exact immutable HEAD；
- exact package SHA；
- 独立授权短语；
- apply 前即时 backup；
- rollback package 在 apply 前完成封装；
- apply 事务内部再次检查 baseline、overlap、最终数量和内容 mismatch；
- post-apply acceptance 与 receipt 完成。

### Closeout

- final current 总数正确；
- acceptance 全部通过；
- baseline-only fingerprint 不变；
- 非 Radar 表不变；
- sequence 正确；
- post-apply backup 可读取；
- evidence ZIP 独立复核；
- PR 描述更新为真实状态。

## 9. 下一阶段

本轮 10,804 条 current 公共 AI 结论闭环后，下一阶段转入剩余作品条目：

- 以 10,804 条为新的 immutable already-current baseline；
- 采用 2,500 条用户输入包、内部 `10 × 250` 可恢复子波次；
- 已完成作品默认不重做，只有证据、规则、identity 或结论 hash 发生实质变化时才 supersede；
- 每波先研究与组装，累计到统一生产批次后再走完整 lab → gate → apply 流程；
- 不把单来源或低置信度当作“无 AI 结论”，而是明确记录不确定性和待复核状态。
