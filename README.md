# 百合排雷 · Baihepailei

当前仓库已经切到版本化公开快照运行，不需要本地 PostgreSQL，也不会在请求时读取研究仓库。

## 首发快照

- 源目录 Work 记录：35,411 条
- 安全归并后的公开可浏览作品：34,940 部
- 高把握归并：471 组 / 471 条重复记录，其中 427 组有跨来源证据
- 可搜索译名 / 别名证据：5,619 条作品记录、19,307 个标题值
- 因同来源身份歧义而禁止标题自动归并：199 个标题键
- 当前决策范围：4,118 条源记录
- S–F 评级：4,001 条源记录
- 非评级终态：117 条源记录
- 作品类型：35,411 条（全源目录）
- 可核验来源摘要：524 条
- 补回具体评级理由 / 范围：1,066 条，其中 971 条带现行细分类

公开页面优先展示作品基本资料、译名与别名、作者/主创、创作机构、简介、核心等级、
具体警示和资料来源。目录序号、外部提供方、身份状态与研究覆盖等内部治理字段不进入
普通作品页；Work ID 只在反馈流程中作为自动携带的定位信息。

公开目录不会仅因“去掉标点后标题相同”就合并作品。运行时先应用经过一对一、年份、媒体
格式与来源身份审计的显式等价组，再做只消除 Unicode、大小写与空白差异的严格标题归并。
来自 Bangumi、AniList、VNDB、Wikidata 等来源的外部译名只增强展示和搜索，绝不反过来充当
自动合并键。同一 provider 对应不同 site ID 的 exact 或 partial 身份都会阻止标题归并。
旧成员 Work ID 仍可用于搜索与 API 定位，作品页会永久重定向到归并后的主 Work ID。

本版使用完整去重审计的 4,115 个 Work ID，并叠加当前最新 owner 校准中的 3 个新评级；
Work 4975 使用同一校准中的显式 successor 结论。额外研究不再阻塞首发。

## 本地预览

需要 Node.js 24（Node.js 22 也可）和 Corepack：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm validate:release
pnpm audit:merge
pnpm dev
```

打开 <http://localhost:3000>。局域网内其他设备可用这台电脑的 IP 加端口 `3000` 访问。

完整上线检查：

```bash
pnpm check
```

生产构建完成后，可让脚本临时启动站点并检查关键页面、重定向、搜索词、公开字段边界，
以及已知的同名 / 标点标题误合并反例：

```bash
pnpm smoke:public
```

按生产构建预览（Windows PowerShell 与 macOS / Linux 均可）：

```bash
pnpm build
pnpm start
```

然后打开 <http://127.0.0.1:3000>。请统一使用 `pnpm start`；启动脚本会按平台选择合适的
Next.js production server 入口。

## Docker

```bash
docker compose up --build
```

健康检查位于 <http://localhost:3000/api/health>。除了源目录和评级数，还会报告安全归并后的
`visibleWorks`、`mergedAway`、`mergedGroups` 与 `largestMergedGroup`。生产镜像使用 Next.js
standalone 输出，数据快照随镜像一起冻结；AWS 部署时不会依赖研究仓库或外部数据库。
Compose 默认仅监听 `127.0.0.1:3000`，由服务器现有的 TLS 反向代理对外提供服务。部署交接见
[`deploy/aws/README.md`](deploy/aws/README.md)。

## 数据边界

公开快照位于 `data/public-release/v1/`，清单记录每个 shard 的 SHA-256、行数和字节数。
`pnpm validate:release` 验证源快照完整性，`pnpm audit:merge` 则独立验证公开归并边界：

- 35,411 个源 Work ID 全局唯一；
- 当前固定快照安全归并后必须为 34,940 部公开作品、471 个双成员合并组；
- 427 个显式等价组、5,619 条标题证据和 31 条排除记录必须通过独立哈希与结构校验；
- 安全归并不得产生同一 provider 下不同 exact / partial site ID 的冲突；
- 安全归并不得跨已知媒体类别，也不得把 blocking terminal 状态藏在已评级合并结果中；
- 4,001 个评级 + 117 个非评级终态 = 4,118 个当前决策范围；
- 1,083 条证据不足型 D 必须同时保留低置信与待补证标记；
- owner 校准的 Work 18556、26328、26923、4975 必须保持指定等级与类别；
- 每个公开 shard 与清单哈希一致；
- 35,411 条媒体类型均按精确 Work ID 绑定；
- 作品资料和评级细节只允许绑定公开 Work ID，评级细节还必须与当前等级一致；
- 退役类别与旧评级不得进入补充层，补充文件的行数、字节数与 SHA-256 必须一致。

每次 Release checks 都会保存一份 merge audit artifact，便于回看安全归并统计和旧宽松规则的对照。
后续资料通过新的版本化快照追加，不回写当前快照或历史冻结研究。
