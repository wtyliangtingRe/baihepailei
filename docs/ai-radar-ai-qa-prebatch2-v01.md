# AI Radar 第一批 AI QA 收尾与第二批前检查点 v0.1

## 目的

在不触碰人工审核线、Payload 或 PostgreSQL 的前提下，对第一批 68 条 AI 评级完成内部质检、确定性修正和本地封存。

```text
校准 AI 评级结果
→ AI 线路质检决定
→ 仅替换 3 条有确定证据的响应
→ 重新组装与解析
→ 66 条 AI QA 通过
→ 2 条暂缓并进入定向补研究
→ 第一批第二批前检查点 ZIP
```

人工审核线保持独立，整个流程创建或修改的人工审核记录数量固定为 0。

## AI QA 包

```text
RADAR-ASSESS-RESEARCH-0001-ai-qa-results-v01.zip
```

- 原样通过：63 条；
- 应用确定性修正：3 条；
- 暂缓补充研究：2 条；
- 修正后 AI QA 通过总数：66 条。

## 一键运行

将 ZIP 放入当前用户的 Downloads 目录，在仓库根目录运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\scripts\radar\run-ai-radar-prebatch2-v01.ps1"
```

脚本从 `$PSScriptRoot` 推导仓库根目录，不依赖磁盘盘符或固定绝对路径。也可以通过 `-PackagePath` 显式指定 ZIP。

脚本会：

1. 校验 ZIP SHA-256；
2. 解压到 `data_local/incoming/ai-radar/packages`；
3. 校验包内文件哈希、68 条身份和 AI／人工线路隔离；
4. 备份并替换 3 条本地 response；
5. 重新组装与解析 68 条；
6. 生成 66 条 AI QA 通过结果和 2 条定向研究记录；
7. 运行研究、校准和 AI QA 测试；
8. 生成唯一需要上传的检查点 ZIP。

输出：

```text
data_local/outputs/ai-radar/checkpoints/
RADAR-ASSESS-RESEARCH-0001-prebatch2-checkpoint-v01.zip
```

## 路径边界

研究与校准 assembler 会再次验证 manifest 提供的：

- `copiedSourceFile`；
- 每个 `inputFile`；
- 每个 `responseFile`；
- 输出目录。

这些路径必须位于 `data_local`，块输入和响应还必须位于对应 handoff 目录中。

## 安全边界

- 不读取或写入正式数据库；
- 不调用 Payload API；
- 不修改 Works；
- 不发布评级；
- 不创建或修改人工审核记录；
- 所有新产物位于被 Git 忽略的 `data_local`。
