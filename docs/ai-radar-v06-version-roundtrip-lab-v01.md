# AI Radar v0.6 版本回环实验室

## 背景

单条真实 canary 已证明：在已有 newer draft 的 Work 上执行部分 PATCH，并设置 `_status: "published"`，Payload 会把 latest draft 中未出现在 PATCH 请求体里的字段一并带入 published/main。

因此旧的：

```text
partial PATCH + _status=published
```

路线已经永久禁用，不能再次对正式数据库执行。

## 实验目标

仅在由已验证 checkpoint 恢复出的临时 PostgreSQL 数据库上，验证下面的三步版本回环：

1. 恢复一个与当前 published 内容一致的干净 draft 版本；
2. 在这个干净 draft 上发布 Radar 白名单字段；
3. 恢复原始 latest draft，同时确认 published Radar 不变。

## v0.2 基线匹配规则

现场只读诊断发现 Work 3839 的版本 `8744` 与当前 published 的全部内容完全一致，唯一差异是根级 `_status`：

```text
published main: _status=published
version 8744:   _status=draft
```

因此 v0.2 采用严格的状态感知规则：

- published 基线候选只忽略根级 `_status`；
- 任何其他字段缺失、默认值差异、嵌套状态差异或内容差异都会被拒绝；
- original latest draft 仍要求完整精确匹配，包括根级 `_status`；
- Payload 自动生成的嵌套 row ID 与等价时间格式仍按既有规范化规则处理。

对 Work 3839，预期选择：

```text
clean published-content draft version: 8744
original latest draft version:          79558
```

## 隔离要求

实验器只接受：

- loopback 地址；
- 端口 `3100`；
- 名称以 `baihepailei_radar_lab_` 开头的数据库；
- 30 分钟内生成的数据库证明文件；
- 正式数据库连接数为 0；
- 实验数据库应用连接数至少为 1；
- 与 candidate 绑定的 checkpoint dump SHA-256；
- 精确确认字符串和专用环境开关。

正式数据库不得用于本实验。

## 已验证的当前执行器

早期的 v0.1–v0.4 文件保留为实验和诊断历史；当前通过临时数据库闭环验证的引擎是：

```text
scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs
```

面向日常使用的会话无关入口是：

```text
scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1
```

外层执行确认字符串：

```text
EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V06-ONLY
```

v0.6 runner 内部只委托已验证的 v0.5 三阶段引擎：

1. REST `?draft=true` 恢复干净 published-content 版本；
2. 发布 Radar 白名单 patch；
3. REST `?draft=true` 恢复原始 latest draft。

一次成功实验必须正好包含两次 restore-as-draft 和一次部分发布 PATCH。

## 本地检查

```powershell
node --check scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs

node --test `
  tests/ai-radar-v06-version-roundtrip-lab.test.mjs `
  tests/ai-radar-v06-version-roundtrip-lab-v02.test.mjs `
  tests/ai-radar-v06-synthesized-draft-roundtrip-lab-v03.test.mjs `
  tests/ai-radar-v06-clean-draft-write-diagnostic-v04.test.mjs `
  tests/ai-radar-v06-draft-restore-roundtrip-lab-v05.test.mjs `
  tests/ai-radar-v06-draft-restore-roundtrip-runner-v06.test.mjs
```

## 默认只读入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1
```

默认模式为 `Inspect`，Payload 写请求必须为 0。

## 临时数据库执行

执行模式只允许新近从已验证 checkpoint 恢复、仍处于已审核七版本基线的临时实验库：

```text
versions read:          7
clean version:          8744
original draft version: 79558
```

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1 `
  -Mode Execute `
  -Confirmation "EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V06-ONLY"
```

已经执行过的实验库会出现新增版本，必须被 freshness gate 拒绝再次执行。

## 已验证结果

Work `3839` 的隔离实验已经证明：

```text
status: draft_restore_roundtrip_lab_verified
payloadWriteRequests: 3
restoreAsDraftRequests: 2
partialPublishedPatchRequests: 1
original draft restored: true
published Radar preserved: true
human state preserved: true
unrelated published state preserved: true
formal database targeted: false
direct PostgreSQL write: false
```

该结果只验证实验室路径，不授权正式数据库 canary 或批量发布。

PR 保持 Draft，直到最终代码、测试和实验凭证审查完成。
