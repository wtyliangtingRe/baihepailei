# Baihepailei

Baihepailei 是一个以作品、排雷分级、可追溯来源和人工复核为核心的百合资料库。项目采用 Next.js、Payload CMS 与 PostgreSQL；当前代码和数据模型均以本站自身规则为准。

## 当前功能

前台提供作品、创作者、机构、排雷规则、搜索、推荐、最近更新、注册账户、评论、我的列表和反馈入口。作品详情会分开显示人工审核参考与 AI Radar 参考；目录等级按“人工参考优先、否则 AI、再否则兼容旧字段”计算。两条轨道都保留来源、证据状态和审计边界，不互相覆盖。

后台主要集合包括：

```text
Users
Media
Works
Creators
Organizations
Evidence
RadarResearchRecords
AuditEvents
Comments
UserLists
FeedbackSubmissions
Terms
Warnings
Tags
Rules
```

`Works.humanAssessment` 与 `Works.radarAssessment` 是两条独立评级轨道。目录展示优先采用人工轨道等级，没有人工等级时采用 AI 建议；`Works.rank` 只作为兼容旧记录的后备值。`RadarResearchRecords` 是独立内部研究档案，不能直接覆盖任一轨道。用户评论即时公开，但有重复发送限制、时间频率限制、用户举报与达到阈值后的自动保护隐藏；作者和工作人员仍可删除。用户反馈进入独立审核队列，不会自动修改条目。

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
/me/review/content         作品、创作者、机构审核与编辑
/me/studio                  站内内容工作台
/me/personnel               人事任用、角色与封停
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

node scripts/export/build-full-public-index.mjs --url "http://localhost:3000"
```

请在另一个终端保持 `pnpm dev` 或生产服务器运行后再执行导出；默认每页读取 100 条，避免三万多条作品组成的超大请求超时。可用 `PUBLIC_INDEX_PAGE_LIMIT=200`（最大 250）调高批量大小。三万余条作品的完整导出会持续数分钟；保持开发服务器运行并等待它完成，不要同时重复启动第二次导出。

该命令默认生成包含全部当前作品、创作者、机构、草稿和审核中记录的完整增强版，并保留封面；只有明确归档的记录会被排除。旧导入记录即使 status 或可见性字段为空也会进入完整版；只有低流量镜像才显式传入 `--profile lite --media-mode text` 并应用 Lite 可见性开关。生成的 `public/search-index.json` 和 `public/detail-index.json` 默认不提交。详见 `docs/deployment-profiles-and-feedback.md`。

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

`SITE_OWNER_EMAIL` 只供服务端认证使用，不会回退成公开反馈地址。若要展示联系邮箱，请另设 `NEXT_PUBLIC_FEEDBACK_EMAIL`，并建议使用专门的站务邮箱。

本地测试可设置 `ACCOUNT_EMAIL_VERIFICATION_ENABLED=false`，并把 `SMTP_HOST` 留空；完整变量见 `.env.example`。

## Radar 数据边界

两条数据线必须长期区分：

- v0.6 评估包共有 10,805 条计划记录，其中 9,364 条具备受控写入资格，1,441 条因来源可追溯性不足保持阻断。
- 研究归档共有 25,048 条，存放在 `radar-research-records`；完整前台索引会以“AI 研究档案 · 非正式评级”展示关联预览，但它们仍是研究建议，不是正式 Works 评级，也不会覆盖 `Works.rank`。

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

如果数据库已经存在 stewardship notices 表，保持 `STEWARDSHIP_NOTICES_SCHEMA_READY=true`，不要在开发启动时接受删除表的 schema 警告。新增集合字段后先运行 `pnpm generate:types`，再执行 TypeScript 与构建检查。

### 旧 XWiki 列清理

代码已不再读取或写入 XWiki 兼容字段。已有数据库第一次启动时如只提示删除 `legacy_x_wiki_page` / `version_legacy_x_wiki_page` 及其关系列，先建立数据库 checkpoint，再确认该提示以完成历史列清理；如果提示还包含当前集合或 stewardship notices 的表/列，不要确认，先核对环境变量和迁移状态。
