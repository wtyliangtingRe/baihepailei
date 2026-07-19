# 本地 AI Radar 更新管道 v0.1

`pnpm radar:local-update` 是本地的“准备、校验、计划、dry-run”总入口。它消除了每次批量评估前人工清理 JSONL、拼接模型输出和手动比对身份的工作；它**不会**自动改 Payload、不会改 PostgreSQL、不会发布作品。

## 轨道边界

- AI 仅生成或更新 `Works.radarAssessment`。
- 已有 `humanAssessment`、人工等级、人工状态、人工备注和目录中的人工优先展示不被 AI 覆盖。
- 有人工轨道的作品仍然可以刷新 AI 轨道；生成的计划会断言非 AI 字段完全不变。
- 明确锁定的作品仍会被阻止自动写入。
- 用户新作品申请经“采纳并生成预填草稿”后成为站内草稿；下一次使用 `--scope unassessed` 时会被自动纳入 AI 输入。

## 一次准备 / dry-run

先启动本地站点，并在同一终端提供 Payload 账户环境变量：

    $env:PAYLOAD_EXPORT_EMAIL = "你的后台邮箱"
    $SecurePassword = Read-Host "请输入后台密码" -AsSecureString
    $env:PAYLOAD_EXPORT_PASSWORD = [System.Net.NetworkCredential]::new("", $SecurePassword).Password

然后选一种 AI 接入方式。

### 已配置本地 AI 执行器

执行器必须读取环境变量：

- `BAIHEPAILEI_AI_INPUT`：清理且经过重复防护的 JSONL；
- `BAIHEPAILEI_AI_OUTPUT`：必须写入的 JSONL；
- `BAIHEPAILEI_AI_CONTRACT`：输入/输出契约与准确行数；
- `BAIHEPAILEI_AI_RUN_DIR`：本次只读/输出目录。

它输出一行对应一行，最少保留 `workId`、`siteId`，并包含 `evidenceCoverage`、`evidenceStatus`、`sourceSummary` 与 `ruleAssessments`。模型无权提供或改写现有状态、人工轨道、来源包或身份字段。

将执行器命令保存在当前 PowerShell 会话后，只需一条总命令：

    $env:BAIHEPAILEI_AI_ASSESSOR_COMMAND = "你的受控 AI 执行器命令"
    pnpm radar:local-update -- --url "http://127.0.0.1:3001" --scope unassessed

评估全部未锁定作品（包括已有 AI 结论的重新判定）：

    pnpm radar:local-update -- --url "http://127.0.0.1:3001" --scope all

只评估由站内用户新作品申请生成的草稿：

    pnpm radar:local-update -- --url "http://127.0.0.1:3001" --scope feedback-drafts

### 已有模型输出文件

若执行器在别处运行，可将它的 JSONL 交给同一总入口；脚本会做一对一身份检查、合并可信输入字段、解析规则、来源审计、Payload 补丁计划和 dry-run：

    pnpm radar:local-update -- --url "http://127.0.0.1:3001" --scope unassessed --model-output "D:\\Baihepailei-analysis\\model-output.jsonl"

没有配置执行器或输出文件时，命令不会失败性写入；它会创建本次 run 的 `assessor-contract.json` 和输入快照，状态为 `awaiting_assessor`。

## 每次 run 的证据

所有文件都在 `data_local/staging/ai-radar/local-update-v01/<run-id>/`（Git 忽略）：

- `input/`：全部输入、清理输入、选中范围及 SHA-256；
- `assessment/assessor-contract.json`：模型输入输出契约；
- `assessment/trusted-merged-model-output.jsonl`：只合并白名单模型字段后的可信结果；
- `assessment/`：解析、完整命中规则、冲突和来源审计；
- `payload-plan/`：将会修改什么的计划；
- `payload-dryrun/`：再次读取 Payload 后得到的 would-update / blocked / already-current；
- `summary.json`：本次 run 的总清单与下一步。

模型输出少行、重复行、未知行、身份不一致、来源格式不合格或规则无效时都会停止；不会跳过后续行继续写。

## 写回与发布

总入口刻意不接受 `--apply`、`--execute`、`--confirm`。正式写回只能走已有的 armed release 流程，并且每次都必须：

1. 新建并验证数据库 checkpoint；
2. 检查本次 `payload-dryrun`、来源审计和 blocked 行；
3. 生成候选、获得本地 arm、输入明确确认短语；
4. apply 后通过 API 回读；
5. 重建前台索引并比较作品、创作者、机构总数；
6. 再建一个导入后 checkpoint。

这避免了“一个命令”在模型或来源发生异常时静默写入数万条数据。真正自动化的是清理、格式化、身份绑定、规则解析、计划和 dry-run；影响公开资料库的写入仍保留可追溯的人类确认。

## 新作品发现

持续联网发现不能是无来源、不可复现的黑箱。受控发现器应先输出带来源快照的候选 JSONL，再经过：

    来源快照 → 标准化 → 本站 ID/外部 ID/标题+类型+日期去重
    → create / duplicate / blocker 计划 → 编辑确认 → 草稿 → AI 轨道

当前版本已将“用户申请新作品 → 审核通过 → 可追踪预填草稿”接入站内；外部发现器的候选自动入库将作为下一步单独的、带来源适配器的导入器实现，不能把不受控网页搜索直接变成公开数据写入。
