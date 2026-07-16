# Baihepailei

Baihepailei 是一个以作品、排雷分级、可追溯来源和人工复核为核心的百合资料库。项目采用 Next.js、Payload CMS 与 PostgreSQL；当前代码和数据模型均以本站自身规则为准。

## 当前功能

前台提供作品、创作者、机构、排雷规则、搜索、推荐、最近更新、注册账户、评论、我的列表和反馈入口。作品详情会区分正式分级、来源、证据状态、页面提示与人工复核状态。

后台主要集合包括：

```text
Users
Media
Works
Creators
Organizations
Evidence
RadarResearchRecords
Comments
UserLists
FeedbackSubmissions
Terms
Warnings
Tags
Rules
```

`Works.rank` 是正式作品分级；`RadarResearchRecords` 是独立内部研究档案，不能覆盖正式分级。用户评论与反馈默认进入审核流程，不会自动修改条目。

## 主要路由

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
/me/review/public-catalog  内部条目审核工作台
/updates           最近更新
/feedback          反馈
/account           账户
/admin             Payload 后台
```

## 本地开发

```powershell
docker compose up -d postgres
pnpm install
pnpm dev
```

打开 `http://localhost:3000` 和 `http://localhost:3000/admin`。

如需重新生成 Payload 类型或 Admin import map：

```powershell
pnpm generate:types
pnpm generate:importmap
```

## 生成前台索引

搜索和详情页读取本地导出的索引：

```powershell
$env:PAYLOAD_EXPORT_EMAIL="你的后台邮箱"
$env:PAYLOAD_EXPORT_PASSWORD="你的后台密码"

pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts
pnpm export:lite-details -- --url "http://localhost:3000" --include-drafts
```

生成的 `public/search-index.json` 和 `public/detail-index.json` 默认不提交。正式低流量站设置 `NEXT_PUBLIC_MEDIA_MODE=text`；增强分发版设置为 `enhanced`。详见 `docs/deployment-profiles-and-feedback.md`。

## 账户与邮件

每个部署必须通过 `SITE_OWNER_EMAIL` 明确配置自己的最高权限账户。生产环境的注册验证和找回密码依赖真实 SMTP：

```env
SITE_OWNER_EMAIL=owner@example.com
ACCOUNT_EMAIL_VERIFICATION_ENABLED=true
SMTP_HOST=你的真实 SMTP 主机
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=你的 SMTP 用户名
SMTP_PASS=你的 SMTP 密码
SMTP_FROM_ADDRESS=你的发件地址
```

本地测试可设置 `ACCOUNT_EMAIL_VERIFICATION_ENABLED=false`，并把 `SMTP_HOST` 留空；完整变量见 `.env.example`。

## Radar 数据边界

两条数据线必须长期区分：

- v0.6 评估包共有 10,805 条计划记录，其中 9,364 条具备受控写入资格，1,441 条因来源可追溯性不足保持阻断。
- 研究归档共有 25,048 条，存放在 `radar-research-records`；它们是研究建议，不是正式 Works 评级。

后续网页功能不得把研究档案的建议等级批量写入 `Works.rank`。人工审核工作台只允许逐条、留痕操作。

## 安全与仓库边界

- 不提交数据库 dump、真实 `.env`、私钥、token、密码或生产证书。
- 不提交真实索引与受限研究输出。
- 用户提交不会直接改变正式评级或发布状态。
- 自建部署必须配置自己的 owner、邮件、数据库与密钥，不能继承其他部署的身份设置。

## 测试

```powershell
node scripts/test-frontend.mjs
pnpm test:community
pnpm test:radar-presentation
pnpm build
```

新增集合字段后先运行 `pnpm generate:types`，再执行 TypeScript 与构建检查。
