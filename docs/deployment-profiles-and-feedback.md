# 部署版本、图片与反馈渠道

本文定义 Baihepailei 的公开展示模式、反馈入口与安全边界。

## 推荐结论

项目默认使用 `enhanced` 完整版：作品、创作者和机构不再受旧可见性字段为空的影响，并显示索引中已有的作品封面。需要节省流量时可显式使用 `text`，并在导出时传入 `--profile lite`。

现行版本继续使用经过 GitHub 登录的结构化 Issue Form；由于目标仓库仍是私有仓库，目前只对协作者可用。2026-09-05 已确定后续公开投稿采用并行双入口：普通访客使用匿名、纯文字、无附件的 Cloudflare 表单；熟悉 GitHub 的贡献者使用独立公开投稿仓库的 Issue Form。两条渠道都不要求注册或绑定本站账号，也不会向公开网站暴露核心数据库写入接口。

这两条入口接收的都只是待核实线索。审核确认前不得写入正式作品资料、Research、Assessment、发布状态或评级。完整决策与实施边界见 [`public-feedback-intake-decision-20260905.md`](public-feedback-intake-decision-20260905.md)。

## 已采纳的公开双入口

| 受众 | 入口 | 身份要求 | 附件 | 数据落点 |
| --- | --- | --- | --- | --- |
| 普通访客 | 独立 Cloudflare 表单 | 匿名；不绑定本站账号 | 禁止 | 与 AWS 主站和核心数据隔离的待审队列 |
| 熟悉 GitHub 的贡献者 | 独立公开投稿仓库 Issue Form | GitHub 账号 | 不由本站接收或托管 | GitHub Issue 待审线索 |

这是已采纳的后续方向，不是当前已经上线的服务状态。匿名 Cloudflare 服务和独立公开投稿仓库在完成各自安全边界前，不得用同源 AWS 写入端点或公开现有源码、研究数据仓库来代替。

## 三种可组合方案

| 方案 | 浏览图片 | 反馈入口 | 图片反馈 | 适用场景 |
| --- | --- | --- | --- | --- |
| 低流量正式站 | 不显示 | 公开双入口上线前仍为私有 GitHub 问题单 | 不由本站接收 | 长期在线、控制带宽 |
| 增强静态包 | 显示随包图片 | 使用相同的外部双入口 | 不由静态包接收 | 网盘、静态分发 |
| 增强可部署包 | 显示 | Cloudflare 匿名表单 + 公开 GitHub 问题单 | 匿名入口禁止附件 | 自建完整服务 |

### 为什么静态包不能自己接收投稿

静态站只有 HTML、CSS、JavaScript 和数据文件，没有数据库、鉴权会话或写入 API。它可以显示打包好的图片，但反馈必须送往独立 Cloudflare 表单或 GitHub Issues；不能为了省事在 AWS 主站增加同源写入端点。

## 默认 GitHub 提交入口

`/feedback` 默认链接到：

```text
https://github.com/wtyliangtingRe/baihepailei/issues/new
```

仓库内提供两份结构化表单：

- `work-correction.yml`：作品资料补充与纠错；
- `new-work.yml`：推荐收录新作品。

从作品详情页进入时，页面会把 Work ID、作品标题和提交标题预填进 GitHub 表单。GitHub 官方支持通过 URL 查询参数选择模板并预填 Issue Form 的自定义文本字段。

两个源码/数据仓库在 2026-09-05 均为私有仓库，因此默认入口目前只对已有读取权限的协作者可用。正式面向公众收集前，应创建不含源码和研究数据的专用公开 issues-only 仓库，再通过环境变量把入口指向它；不要为了开放反馈而把源码或研究数据仓库改为公开。

## 环境变量

```env
# 完整增强版（默认）
NEXT_PUBLIC_MEDIA_MODE=enhanced

# 低流量文字镜像
# NEXT_PUBLIC_MEDIA_MODE=text

# 可选反馈渠道；空邮箱/表单不会显示，仅接受 HTTPS 外部 URL
NEXT_PUBLIC_FEEDBACK_EMAIL=feedback@example.com
NEXT_PUBLIC_FEEDBACK_FORM_URL=https://example.com/your-form

# 默认值如下；公共站点应改为专用公开问题单仓库
NEXT_PUBLIC_FEEDBACK_ISSUE_URL=https://github.com/wtyliangtingRe/baihepailei/issues/new
```

`NEXT_PUBLIC_MEDIA_MODE=text` 只影响公开渲染，不删除数据库或索引里的封面 URL 元数据。因此同一份数据可以用于低流量正式站，也可以在增强分发版重新构建后显示图片。

完整索引可一次生成：

```powershell
node scripts/export/build-full-public-index.mjs --url "http://localhost:3000"
```

该命令默认包含全部作品、创作者、机构和草稿，并输出增强媒体索引。证据材料仍只导出“已确认且允许公开”的版本，避免内部截图或草稿泄漏。只有明确传入 `--profile lite --media-mode text` 时才应用 Lite 可见性并生成低流量镜像。

## 匿名表单的安全底线

不登录、可直接向本站写入的表单确实更容易被自动化滥用：垃圾提交会消耗数据库与审核时间，超长正文和高频请求会造成资源耗尽，恶意链接或附件还会扩大 XSS、钓鱼、恶意文件与存储滥用风险。验证码只能是其中一层，不能替代服务端控制。

后续匿名 Cloudflare 表单必须同时满足：

- 投稿请求在 Cloudflare 边缘终止，不得转发到 AWS 主站处理；
- 在边缘层和应用层分别限流，并设置并发、请求体和每日写入硬上限；达到全局上限时必须 fail closed；
- 服务端采用字段白名单、类型校验、硬性长度上限和安全输出编码；
- 使用 Turnstile 等人机校验，并在服务端调用验证接口；只放前端组件不算防护；
- 只接受纯文字和数量受限的来源 URL，不提供任何附件、文件或预签名上传入口；
- 不在提交路径抓取、预览或扫描用户 URL，避免 SSRF、出站流量和慢请求放大；
- 提交只进入使用独立凭据的隔离审核队列；投稿服务不得持有核心数据库凭据，也不得直接写正式 Works、Research、Assessment 或 Rating；
- 保留重复提交抑制、有限审计日志、自动过期和可立即关闭入口的开关；
- 不因一次投稿自动发送邮件或调用昂贵的外部处理、AI、图片或文档服务。

参考：[GitHub Issue URL 与权限](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)、[GitHub Issue Forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)、[OWASP DoS 与限流](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)、[Cloudflare Turnstile 服务端验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

## 渠道取舍

邮件最容易启用，适合少量文字、来源链接和继续沟通；缺点是整理、去重和状态跟踪较弱，也容易收到垃圾邮件。

已采纳的匿名 Cloudflare 表单只用于结构化纯文字资料和少量来源链接，第一阶段明确不接收附件。将来若确实需要文件上传，必须另立安全决策、隔离存储和成本上限；不能把附件能力顺手加回匿名入口。

GitHub 问题单适合可公开讨论的资料补充、失效链接与页面错误，能够保留提交者身份、讨论和处理状态。公开投稿仓库只存模板、公开说明和 Issues，不得包含本站源码、研究数据、密钥或内部证据。涉及个人信息、无权公开材料或不宜暴露的关键剧透时，不应使用公开问题单。

## 数据边界

- 用户提交不会自动更改 Works 的分级或发布状态。
- 25,048 条 `radar-research-records` 仍是研究档案，不等于正式评级。完整索引只把与作品关联的研究状态、等级范围、风险信号和来源摘要作为“AI 研究档案”预览展示，不会写回 `Works.rank` 或伪装成人工复核。
- 审核工作台只允许逐条确认或标记争议，并记录审核人、时间与说明。
- “增强媒体”只改变公开展示，不改变证据状态、人工确认状态或页面提示。
