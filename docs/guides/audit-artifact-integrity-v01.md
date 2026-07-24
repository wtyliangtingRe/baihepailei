# 审计产物完整性与字符编码指南 v0.1

状态：生效。

## 目的

数据库审计产物可能包含中文、日文、换行、引号和历史说明。只要字符在 PostgreSQL、Docker、psql、Windows PowerShell 之间发生错误转码，报告就可能出现乱码，甚至产生无法解析的 JSONL。

因此，候选审计不能只依赖“文件已经生成”或“行数看起来正确”。必须同时证明：

- PostgreSQL 以 UTF-8 构造原始 JSON；
- 跨原生进程边界时只传输 ASCII Base64；
- PowerShell 使用 UTF-8 解码；
- 每一条解码结果都通过 `ConvertFrom-Json`；
- 输出文件有 SHA-256 清单；
- 打包器在生成 ZIP 前检查完整性证明。

## 已发现的问题

第一版规范化候选包的数量和文件哈希正常，但部分中文经过 Docker/psql 与 Windows PowerShell 后发生乱码。部分替换字符破坏了 JSON 字符串边界，使若干 JSONL 行无法解析。

该候选包只能用于证明数量，不能作为数据迁移输入，也不能用于决定人工说明的真实内容。

## 当前安全传输

`scripts/radar/audit-work-normalization-candidates-v02.ps1` 使用：

```text
PostgreSQL JSON text
→ convert_to(..., 'UTF8')
→ Base64
→ ASCII native-process output
→ PowerShell Base64 decode
→ UTF-8 string
→ ConvertFrom-Json validation
→ UTF-8 no-BOM JSONL
```

Base64 仅作为跨进程传输封装，不改变数据库内容。

## 必需输出

规范化候选包必须包含：

- `counts.json`
- `human-normalization-candidates.jsonl`
- `schema-retirement-exceptions.jsonl`
- `rank-retirement-candidates.jsonl`
- `validation.json`
- `manifest.json`
- `summary.txt`

`validation.json` 必须满足：

```json
{
  "transport": "postgres_utf8_base64_to_powershell_utf8",
  "jsonValidated": true
}
```

## 使用限制

- 未通过 JSON 校验的报告不能进入 dry-run 迁移设计。
- 不能人工修补乱码后把报告当作数据库原值。
- 不能根据乱码标题猜测作品身份。
- 旧报告可保留用于事故复盘，但应标记为不可用于迁移。
- 所有含真实 Work ID、标题或审核说明的产物留在 `exports/`，不提交到 Git。

## 推荐入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\radar\run-and-package-work-normalization-audit-v01.ps1
```

包装脚本会调用 v02 审计器、检查完整文件集、验证 `validation.json`，再生成 ZIP 与 SHA-256。
