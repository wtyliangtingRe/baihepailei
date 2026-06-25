# baihepailei

白河排列旧 XWiki 站点恢复、清洗、导出与新网站重建项目。

## 当前目标

1. 离线分析旧 AWS XWiki 备份。
2. 区分个人内容、系统页面、垃圾账号/垃圾页面。
3. 导出有价值资料。
4. 将清洗后的内容迁移到新的静态/动态网站。
5. 最终在本仓库维护新网站代码。

## 原始备份位置

原始备份只保存在本地，不提交到 GitHub：

```text
E:\baihepaileiwikiR\backup\baihepailei_data_backup
```

## 安全原则

- 不提交 SQL dump。
- 不提交 XWiki / MySQL data volume。
- 不提交 Let's Encrypt 证书和私钥。
- 不提交旧服务器 home/root/opt 目录。
- 不提交任何 `.env`、私钥、token、数据库密码。
- 不提交 `public/search-index.json` 或 `public/detail-index.json`，它们由本地导出命令生成，可能包含真实迁移正文。
- 分析脚本只读取本地备份，不修改原始文件。

## 目录规划

```text
docs/       项目说明、迁移记录、安全说明
tools/      备份审计、导出、转换脚本
exports/    本地导出结果，默认不提交
src/        Payload CMS 与 Next.js 新站代码
scripts/    导入、导出与开发辅助脚本
infra/      部署模板，不含真实密钥
```

## 新站本地开发

启动 PostgreSQL 与 Next.js / Payload 开发服务：

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

docker compose up -d postgres
pnpm dev
```

打开：

```text
http://localhost:3000
http://localhost:3000/admin
```

如果 Payload 后台提示 import map 相关错误，重新生成 import map 并清理 Next 缓存：

```powershell
pnpm generate:importmap
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
pnpm dev
```

## 导入清洗后的内容

清洗后的真实数据 seed 只保存在本地，不提交到 GitHub。导入示例：

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

pnpm import:clean-seed -- --file "D:\0GitHubtest\Baihepailei\_clean_real_data\payload_seed_direct_v2_clean.json" --url "http://localhost:3000" --update-existing
```

## 生成前台索引

前台搜索和详情页需要本地生成索引文件：

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

$env:PAYLOAD_EXPORT_EMAIL="你的Payload后台邮箱"
$env:PAYLOAD_EXPORT_PASSWORD="你的Payload后台密码"

pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts
pnpm export:lite-details -- --url "http://localhost:3000" --include-drafts
```

生成文件：

```text
public/search-index.json
public/detail-index.json
```

这些文件默认被 `.gitignore` 忽略，不提交。

## 前台测试

完整前台测试可以用独立 runner 一次跑完：

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

node scripts/test-frontend.mjs
pnpm build
```

runner 当前包含：

```text
tests/frontend-polish.test.mjs
tests/frontend-expanded-polish.test.mjs
tests/works-rank-page.test.mjs
tests/search-utils.test.mjs
```

`pnpm test:frontend` 仍可运行已有前台测试；如果新增了前台测试文件，优先以 `node scripts/test-frontend.mjs` 为准。

## 运行 XWiki 备份审计

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\tools\xwiki_audit\run_audit_windows.ps1 `
  -BackupDir "E:\baihepaileiwikiR\backup\baihepailei_data_backup" `
  -OutDir "E:\baihepaileiwikiR\backup\baihepailei_audit_out"
```

输出会写到本地 `OutDir`，不要直接提交到 GitHub。
