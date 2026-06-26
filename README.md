# Baihepailei

百合排雷资料库重建项目。

本仓库用于把旧 XWiki 站点中的有效资料抢救、清洗并迁移到一个新的轻量资料站。项目当前采用 **Next.js + Payload CMS + PostgreSQL**，前台以作品、创作者、机构、排雷规则、搜索、推荐和个人列表为核心，后台用于继续整理结构化内容。

## 项目定位

Baihepailei 不是旧站的原样复刻，而是一次重新整理：

- 从旧 AWS / XWiki 备份中提取有价值内容。
- 舍弃旧站中不再适合沿用的标签、来源字段和系统页面噪声。
- 把作品、创作者、机构、规则、证据材料等内容拆成结构化 collection。
- 前台优先保持简洁，避免把所有后台字段一次性堆给普通用户。
- 后续逐步加入个人列表、评论、推荐和材料留存等功能。

## 当前功能

### 前台

- 首页轻量入口：作品、创作者、机构、排雷规则。
- 作品列表：按分级、创作者、机构、证据材料状态筛选。
- 详情页：基础信息、雷点矩阵、我的列表、作品简介、材料留存、来源链接、评论区。
- 搜索页：基于本地导出的 Lite search index。
- 推荐页：基于分级、复核状态、证据强度、雷点矩阵和个人列表的规则推荐。
- 我的列表：登录用户可记录想看、已看、避雷、需要复核。
- 排雷规则页：旧 XWiki 正文会被整理成可折叠章节，作者评级内容暂不在前台展示。
- 白天 / 夜间模式切换。

### 后台

Payload CMS 当前主要 collection：

```text
Users
Media
Works
Creators
Organizations
Evidence
Comments
UserLists
Terms
Warnings
Tags
Rules
```

其中：

- `Works`：作品条目、分级、复核状态、证据强度、雷点矩阵、创作者和机构关系。
- `Creators`：创作者资料，前台暂不做创作者评级。
- `Organizations`：出版社、制作公司、动画工房、游戏平台、品牌、制作委员会等机构资料。
- `Evidence`：截图、官方页面、访谈、社交媒体、平台页面等材料留存。
- `Comments`：登录用户评论，默认待审核。
- `UserLists`：用户个人作品状态。
- `Rules`：排雷规则与说明。

## 主要前台路由

```text
/                  首页
/browse            资料库总览
/works             作品列表
/creators          创作者列表
/organizations     机构列表
/rules             排雷规则
/search            搜索
/recommendations   推荐
/me/lists          我的列表
/updates           最近更新
/feedback          反馈
/admin             Payload 后台
```

## 原始备份与安全原则

旧站原始备份只保存在本地，不提交到 GitHub：

```text
E:\baihepaileiwikiR\backup\baihepailei_data_backup
```

安全原则：

- 不提交 SQL dump。
- 不提交 XWiki / MySQL data volume。
- 不提交 Let's Encrypt 证书和私钥。
- 不提交旧服务器 home/root/opt 目录。
- 不提交任何 `.env`、私钥、token、数据库密码。
- 不提交真实清洗 seed 数据。
- 不提交 `public/search-index.json` 或 `public/detail-index.json`，它们由本地导出命令生成，可能包含真实迁移正文。
- 分析脚本只读取本地备份，不修改原始文件。

## 目录结构

```text
docs/       项目说明、迁移记录、安全说明
tools/      备份审计、导出、转换脚本
exports/    本地导出结果，默认不提交
src/        Payload CMS 与 Next.js 新站代码
scripts/    导入、导出与开发辅助脚本
infra/      部署模板，不含真实密钥
```

## 本地开发

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

## 测试

前台聚合测试与构建：

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"

node scripts/test-frontend.mjs
pnpm build
```

也可以按功能单独运行测试，例如：

```powershell
node --test tests/frontend-simplification.test.mjs
node --test tests/rule-rendering-fix.test.mjs
node --test tests/recommendation-rules.test.mjs
node --test tests/personalized-recommendations.test.mjs
```

## 运行 XWiki 备份审计

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\tools\xwiki_audit\run_audit_windows.ps1 `
  -BackupDir "E:\baihepaileiwikiR\backup\baihepailei_data_backup" `
  -OutDir "E:\baihepaileiwikiR\backup\baihepailei_audit_out"
```

输出会写到本地 `OutDir`，不要直接提交到 GitHub。

## 当前开发重点

短期目标：

- 继续清洗旧 XWiki 正文，让少量真实资料更可读。
- 完善作品、机构、证据材料之间的关系。
- 让前台保持简洁，优先服务普通浏览者。
- 逐步把个人列表、评论和推荐做成可用的小功能。

中长期目标：

- 扩充材料留存与复核流程。
- 改善推荐规则和用户偏好设置。
- 做更完整的部署、备份和迁移文档。
- 在数据稳定后再考虑更复杂的 Full 版本。