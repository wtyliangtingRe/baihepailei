# 作品资料与投稿入口存档：2026-09-05 v02

本存档处理网站公开目录的全部 35,411 个源 Work，并在既有 471 个审核合并组之后形成 34,940 个可见作品。描述资料只用于搜索和辨认，不参与身份归并或评级计算。

## 网站运行态覆盖

| 项目 | 覆盖 |
| --- | ---: |
| 可见作品 | 34,940 |
| 有译名或别名 | 21,324 |
| 已知媒介 | 33,701 |
| 有人物署名 | 6,015 |
| 有机构署名 | 13,869 |
| 有任一署名 | 15,117 |
| 有发行日期 | 23,084 |
| 有内容概述 | 1,116 |
| 有身份辨认说明 | 22,982 |
| 尚无可靠介绍 | 10,842 |
| 尚无可靠署名 | 19,823 |

每个源 Work 都有一条元数据输出。缺项保留未知；没有用“暂无资料”或猜测内容制造表面覆盖率。此次没有发现满足严格证据门槛的新合并组，新增合并为 0。规范 Work ID、旧条目跳转、媒介归类与评级均由冻结基线逐项校验，没有变化。

## 描述资料

- 从旧公开资产、502 个既有研究响应、既有译名证据中按 Work ID 和原始站点编号恢复资料。
- 以精确编号补取 Bangumi、VNDB、Steam、百合图鉴公开记录；成功记录固定在研究数据集中。
- anime-offline-database 2026-27 只按唯一 AniList 动画编号连接，并保留 ODbL-1.0 归因。
- `source_summary` 是短内容概述；`identity_summary` 是依据媒介、日期、集数、题材或署名形成的书目辨认说明，页面明确区分两者。
- 元数据在既有去重之后加载，因此新增译名不会成为自动合并键。

## 投稿入口

- 普通访客入口为独立 Cloudflare Worker 的匿名纯文字表单：固定字段、16 KiB 请求上限、最多三条 HTTPS 来源、无附件、Turnstile、分层限流、每日总量与容量上限、约 30 天清理和紧急关闭开关。
- GitHub 贡献者入口为独立公开投稿仓库的 Issue Forms；可选上传 PNG、JPG、JPEG、WebP 图片。网站不下载或镜像图片。
- 两条渠道均只进入待核实区，不自动写入网站数据库、研究数据、评级或 AWS。
- 未配置真实 Cloudflare 域名时，网站如实显示匿名入口尚未开放。独立 GitHub 投稿仓库创建前，默认入口仍只对现有源码仓库协作者可用。

## 验证

```sh
pnpm check
pnpm smoke:public
node --test tests/feedback-entry.test.mjs
cd deploy/cloudflare-feedback
node --test worker.test.mjs
pnpm exec wrangler deploy --dry-run
```

研究数据集另运行 `python3 scripts/validate-public-metadata-20260905.py` 和对应的五项单元测试。网站锚点名称为 `archive/public-site-20260905-v02`；研究数据锚点名称为 `archive/public-metadata-20260905-v01`，均在各自 PR 合并完成后指向合并提交。
