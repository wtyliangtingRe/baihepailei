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

## 执行器

当前实验执行器：

```text
scripts/radar/lab-ai-radar-v06-version-roundtrip-v02.mjs
```

精确确认字符串：

```text
EXECUTE-V06-VERSION-ROUNDTRIP-LAB-V02-ONLY
```

一次成功实验最多发出 3 个 Payload 写请求：

1. 恢复干净 published-content draft；
2. 发布 Radar 白名单 patch；
3. 恢复原始 latest draft。

每一步后都重新读取 published 与 `draft=true` 视图并验证：

- unrelated published state；
- human track；
- Radar patch；
- clean draft 内容；
- 原始 latest draft；
- 恢复原 draft 后 published main 不变。

## 本地检查

```powershell
node --check scripts/radar/lab-ai-radar-v06-version-roundtrip-v02.mjs
node --test `
  tests/ai-radar-v06-version-roundtrip-lab.test.mjs `
  tests/ai-radar-v06-version-roundtrip-lab-v02.test.mjs
```

## 只读发现

```powershell
node --env-file=.env `
  scripts/radar/lab-ai-radar-v06-version-roundtrip-v02.mjs `
  --candidate-manifest "$CandidateManifest" `
  --url "http://127.0.0.1:3100"
```

预期选择版本 `8744` 与 `79558`，且写请求数为 0。

## 临时数据库执行

执行前必须重新生成 30 分钟有效的数据库证明。

```powershell
$env:RADAR_VERSION_ROUNDTRIP_LAB = "YES"

node --env-file=.env `
  scripts/radar/lab-ai-radar-v06-version-roundtrip-v02.mjs `
  --candidate-manifest "$CandidateManifest" `
  --url "http://127.0.0.1:3100" `
  --lab-database "$LabDb" `
  --database-proof "$ProofFile" `
  --confirmation "EXECUTE-V06-VERSION-ROUNDTRIP-LAB-V02-ONLY" `
  --execute-lab
```

成功必须同时满足：

```text
status: version_roundtrip_lab_verified
payloadWriteRequests: 3
final.patchMatchedPublished: true
final published state == after-Radar published state
final unrelated published state == baseline published state
final human state == baseline published state
final draft state == original latest draft state
```

PR 保持 Draft，直到本地测试与临时数据库实验全部通过。