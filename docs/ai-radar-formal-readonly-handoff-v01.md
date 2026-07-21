# AI Radar 正式数据库只读审核交接 v0.1

## 目标

从正式 Payload 数据库读取当前 Works 目录，生成可供 AI 逐批审核的结构化交接包。

这条流程只做：

1. 读取正式 Works；
2. 生成证据包；
3. 清洗和审计输入；
4. 把条目分到 AI 评估、外部研究、身份复核、人工保护等队列；
5. 为第一批可直接 AI 评估的作品生成上传分块。

它不会发布评级，也不会 PATCH Works、恢复版本或直接写 PostgreSQL。

## 一键入口

```text
scripts/radar/run-ai-radar-formal-readonly-handoff-v01.ps1
```

入口固定使用：

```text
Payload:    http://127.0.0.1:3000
Database:   baihepailei
Tables:     83
Output:     data_local/staging/ai-radar/formal-readonly-handoff-v01
```

正式导出只允许在已经合并的 `main` 分支运行。审查分支只允许运行 Inspect。

## 默认 Inspect

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-formal-readonly-handoff-v01.ps1
```

Inspect 会：

- 检查 Git 分支和工作区；
- 运行相关语法检查与专项测试；
- 检查 3000 端口和 83 张表；完成第一条只读 Payload 请求后，再确认正式数据库应用连接已经建立；
- 安全读取管理员密码；
- 只读取 1 个 Work；
- 验证输出摘要明确记录零 Payload 写入、零 PostgreSQL 写入。

## 正式只读导出

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-ai-radar-formal-readonly-handoff-v01.ps1 `
  -Mode Export `
  -Confirmation "EXPORT-FORMAL-AI-RADAR-READONLY-HANDOFF-V01"
```

默认设置：

```text
AI assessment batch size: 250
external research batch:  100
identity review batch:    100
upload chunk size:         25
prepared assessment batch: 1
```

默认只为第一批 `ready_for_ai_assessment` 生成上传文件，先验证 AI 审核与回收流程。要一次生成全部可评估批次，可以设置：

```powershell
-AssessmentHandoffBatchLimit 0
```

在第一批输出和组装流程稳定前，不建议这样做。

## 输出结构

每次运行都使用新的时间戳目录，不复用旧目录：

```text
data_local/staging/ai-radar/formal-readonly-handoff-v01/
  inspect/<run-id>/
  export/<run-id>/
```

正式导出目录主要包含：

```text
raw/                                      原始 Works 证据包
audit/                                    清洗和输入审计
queue/                                    全目录队列、批次和统计
handoffs/radar-assess-0001/               第一批 AI 交接包
UPLOAD_PLAN.md                             上传顺序
formal-readonly-handoff-summary-v01.json  顶层安全与统计摘要
```

交接包每 25 条作品生成一个 `chunks/*.input.jsonl`。按照 `UPLOAD_PLAN.md` 和各自的 `handoff-manifest.json` 顺序上传。

## AI 审核语义

输入包会明确要求：

- 不把现有 `rank` 当作真值；
- 人工审核轨道与 AI Radar 分开保存；
- 保留全部实际命中规则；
- 资料不足时使用 `insufficient_evidence` 或 `unknown`；
- 输出始终是“AI 综合，待复核”，不是最终评级；
- 不伪造来源、剧情、结局或角色关系。

Works 类型本身也将 `humanAssessment` 与 `radarAssessment` 分开定义；目录展示可优先采用人工等级，但两条证据轨道仍分别保留。

## 安全门禁

Export 必须同时满足：

- 当前分支为 `main`；
- 除 `next-env.d.ts` 和 `payload-types.ts` 外没有本地修改；
- `.env` 存在但不会打印；
- Next/Payload 刚启动时允许暂时没有应用连接；第一条只读请求成功后必须确认正式数据库连接已经建立；
- 正式数据库恰好有 83 张 public 表；
- 3000 端口正在监听；
- 完整导出读取至少 35,000 个 Works；
- 所有清洗行都被队列清单完整计入；
- 所有摘要都声明 `payloadWrite=false` 和 `directPostgresqlWrite=false`；
- 导出前后数据库连接和表数仍满足正式拓扑；
- 所有产物只写入被 Git 忽略的 `data_local`。

## 下一步

拿到第一批 `*.input.jsonl` 后，将文件上传给 ChatGPT 做规则评估，并把返回的纯 JSONL 保存到交接包指定的 `responses` 文件名中。

随后使用现有组装器验证一一对应、SHA-256、workId、siteId、证据状态和规则格式。组装结果仍然只是候选评估数据，不能直接发布到正式数据库。
