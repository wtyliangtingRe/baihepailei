# 站内内容 ID、审核工作台与 AI 状态

## 三种标识必须分开

- `recordId`：Payload 数据库主键。作品反馈关系、公开规范网址和后台快捷入口都使用它。
- `id`：Lite 索引中的界面键，例如 `works:old-slug`。它只用于列表去重和前端渲染，不能写入 Payload relationship。
- `slug` / `siteId`：历史导入、旧链接兼容和跨来源匹配字段。它们不再作为公开规范网址，也不代表第三方网站仍然可用。

公开规范网址：

- 作品：`/works/w-<recordId>`
- 创作者：`/creators/c-<recordId>`
- 机构：`/organizations/o-<recordId>`

旧 Slug 网址继续可用，并在索引重新生成后自动跳转到规范网址。

## 反馈关系

作品详情页只把 `recordId` 传给反馈表单。表单把数字主键写入 `feedback-submissions.linkedWork`，不再把 `works:slug`、第三方 ID 或页面 URL 当作 relationship 值。

## 内容审核入口

- `/me/review/content`：作品、创作者、机构的统一轻量工作台，可搜索、筛选、修改常用字段并逐条保存。
- `/me/review/public-catalog`：作品证据、来源冲突和 Radar 队列的深度审核页。
- `/admin`：Payload 完整后台，用于复杂关系、来源数组、富文本和全部高级字段。

AI 状态与人工状态始终分开显示：

- `AI 已评估 · 待人工复核`：已有机器整理结果，但尚未人工通过。
- `AI 辅助 · 人工已复核`：机器整理结果后来完成了人工复核。
- `人工已复核`：已有人工复核记录。

## 本地更新后

首次启动会为创作者和机构增加复核字段。这是新增字段，不会删除原有数据；仍建议在接受任何数据库 schema 变更前保留 checkpoint。

启动成功后重新生成两个 Lite 索引，让公开网址和反馈关系获得 `recordId`：

```powershell
pnpm export:lite-search -- --url "http://localhost:3000" --include-drafts
pnpm export:lite-details -- --url "http://localhost:3000" --include-drafts
```

完成后，旧地址会跳转到新地址，详情页提交反馈时会自动带入真实 Works 主键。
