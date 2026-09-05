# 独立匿名文字投稿

本目录是可独立部署的 Cloudflare Worker + 静态表单 + SQLite Durable Object。主站只放链接，无主站投稿 API、AWS 回源、附件上传、自动邮件、AI 处理或数据库导入。代码已通过本地测试与 Wrangler 部署预检；未配置真实账户、域名和 Turnstile 密钥时不会接收投稿。

## 部署

1. 使用独立的 Cloudflare Workers **Free** 账户/项目。确认账户没有启用 Workers Paid；代码中的每日投稿上限不是付费账户的账单硬上限。
2. 在本目录执行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm check`，然后 `pnpm exec wrangler login` 登录自己的账户。
3. 在 Cloudflare 创建 Turnstile 小组件，只允许实际投稿域名；不要使用测试密钥上线。
4. 修改 `wrangler.jsonc` 的 `PUBLIC_ORIGIN`（完整 HTTPS origin，不带末尾斜线）和 `TURNSTILE_SITE_KEY`。可以使用独立的 `workers.dev` 地址，无需经过 AWS。
5. 分别执行以下命令，在交互输入中填写密钥；不要写入仓库或 `NEXT_PUBLIC_*`：

   ```sh
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
   pnpm exec wrangler secret put SESSION_SECRET
   pnpm exec wrangler secret put REVIEW_TOKEN
   ```

   后两项使用不同的高强度随机值，至少 32 字符。主站不需要这些密钥。
6. 保持 `ACCEPT_SUBMISSIONS=false` 部署一次，确认静态页面可打开、API 返回关闭状态。再设为 `true` 并重新部署，完成一次真实浏览器验证和待审导出测试。
7. 最后在主站 `.env.local` 或部署环境设置 `NEXT_PUBLIC_FEEDBACK_FORM_URL=https://实际投稿域名`，重新构建主站。Work ID、作品名、新作品类型会由入口自动带入。

每次部署执行 `pnpm deploy`。本地 `wrangler dev` 默认 HTTP 与生产 HTTPS 检查不同；逻辑测试使用 `pnpm test`，真实 Turnstile 应在已绑定的 HTTPS 预览地址验证。

## 接收边界

| 项目 | 限制 |
| --- | --- |
| 单次请求 | 流式读取最多 16 KiB；仅 JSON 固定字段 |
| 说明 | 10–3,000 字符，纯文字 |
| 来源 | 最多 3 条 HTTPS URL，每条最多 500 字符；不抓取、不预览 |
| 图片、附件 | 无上传接口；拒绝 multipart、额外字段、HTML |
| 边缘限流 | 每 IP 每分钟 10 次 API 请求（平台分布式近似限流） |
| 验证前尝试 | 全局每天 500 次；每小时 IP/会话各 5 次、网段 20 次 |
| 成功接收 | SQLite 原子事务保证全局每天最多 100 条；IP/会话每天各 5 条 |
| 待审区容量 | 最多 3,000 条；约 30 天保留，按日清理过期数据 |
| 重复线索 | 内容哈希去重；签名 Cookie 抑制重复提交 |
| 隐私 | 不收邮箱，不存原始 IP；以每日 HMAC 摘要限流，不记录正文日志 |

Turnstile 在服务端验证签名结果、hostname、action，并限时 5 秒。依赖错误、容量达到上限、未配置或维护开关开启时拒绝写入。

**费用边界：** 这套实现使投稿流量留在 Cloudflare。无效请求仍可能调用 Worker/DO，应用限流不能给 Workers Paid 账户设置货币硬上限。Free 的平台配额用尽会使服务不可用；不要为了维持投稿可用而自动升级套餐或回源 AWS。主站自身的浏览流量费用仍由主站部署承担。

参考：[Durable Objects 定价与 Free 限制](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)、[Turnstile 服务端验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

## 人工审核与关闭

管理接口需要 `Authorization: Bearer <REVIEW_TOKEN>`，只在维护者自己的终端中调用：

- `GET /api/admin/export`：导出最多 50 条 JSON；响应的 `next` 非空时，以 `?after=<next>` 翻页。只返回待审文字，不返回限流摘要。
- `POST /api/admin/state`，JSON `{"disabled":true}`：立即禁止投稿；`false` 恢复。也可随时把环境变量 `ACCEPT_SUBMISSIONS` 设为 `false` 并部署。

导出数据保持不可信输入；人工核对作品、版本和来源后再整理为两个正式仓库中的补丁。不要把这些 JSON 渲染为 HTML、执行链接内容或自动下载附件。服务没有自动“审核通过即写入核心库”的路径。

生产密钥不包含在任何存档里。仓库回档会恢复代码和配置模板，不会恢复 Cloudflare 待审区里的投稿；既有 `v1` SQLite 迁移应保留。
