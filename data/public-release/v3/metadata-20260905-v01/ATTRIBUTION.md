# 描述资料来源与复用说明

此目录是仅用于名称、书目、主创与简短介绍的追加快照。它不修改身份归并、正式研究、评级或警示。旧源文件仍在原路径保持冻结。

- **既有资料**：两个私有仓库已经保存的作品资产、译名证据，以及 34,731 个 Work 的历史研究响应。只按相同 Work ID + 原始来源编号取回；没有正文的 `descriptionAvailable` 标志不会被当作简介。
- **Bangumi**：[公开 API](https://api.bgm.tv/) 的精确 subject 编号、名称、infobox 主创和日期。
- **VNDB**：[Kana API](https://api.vndb.org/kana) 的精确 VN 编号、语言标题、开发方与原版主创。翻译版/其他 edition 的人员不混入原版主创。
- **Steam**：精确 app ID 的公开商店名称、开发方、发行方与日期。
- **百合图鉴**：[作品详情页](https://www.yurizukan.com/) 中带编号的作品对象与“同作者作品”明示关联；后者仅补该页面明确关联的作者，不声称得到完整主创名单。不同卷与同系列不会据此合并。
- **anime-offline-database**：[2026-27 发布快照](https://github.com/manami-project/anime-offline-database/releases/tag/2026-27)，按唯一 AniList 动画编号连接，补标题、动画制作、出品与作品形态。其数据库使用 [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/)；本站保留来源署名，派生的本目录描述数据库按 ODbL-1.0 提供。单条文本及第三方名称等可能有独立权利，不因此改变原来源条款。

每个公开字段所依据的来源链接保留在记录中；详细抓取时间、原始研究 blob SHA、缺项与覆盖统计保存在研究仓库的同名数据集。没有运行时联网抓取，没有把第三方图片搬到 AWS。

`source_summary` 是从已有来源材料筛选、去除宣传头部并缩短的介绍；`identity_summary` 是根据确认的形态、日期、长度、主创等生成的书目识别信息。后者不是剧情简介，统计与页面均区分两者。

分片为确定性 gzip 压缩 JSONL，`manifest.json` 同时记录压缩前后的字节数、SHA-256 与行数。`pnpm validate:metadata` 验证完整性，并逐个核对全部旧 Work ID 的主条目及评级没有变化。缺失字段保留未知，不猜测或填入“暂无资料”来凑覆盖率。
