# 百合排雷 · Baihepailei

当前仓库已经切到版本化公开快照运行，不需要本地 PostgreSQL，也不会在请求时读取研究仓库。

## 首发快照

- 公开可检索作品：35,411
- 当前决策范围：4,118
- S–F 评级：4,001
- 非评级终态：117
- 尚未进入本轮评估的目录作品：31,293
- 作品类型：35,411 条（全目录）
- 可核验来源摘要：524 条
- 补回具体评级理由 / 范围：1,066 条，其中 971 条带现行细分类

公开页面优先展示作品基本资料、各语言名称、作者/主创、创作机构、简介、核心等级、
具体警示和资料来源。目录序号、外部提供方、身份状态与研究覆盖等内部治理字段不进入
普通作品页；Work ID 只在反馈流程中作为自动携带的定位信息。

本版使用完整去重审计的 4,115 个 Work ID，并叠加当前最新 owner 校准中的 3 个新评级；
Work 4975 使用同一校准中的显式 successor 结论。额外研究不再阻塞首发。

## 本地预览

需要 Node.js 24（Node.js 22 也可）和 Corepack：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm validate:release
pnpm dev
```

打开 <http://localhost:3000>。局域网内其他设备可用这台电脑的 IP 加端口 `3000` 访问。

完整上线检查：

```bash
pnpm check
```

生产构建完成后，可让脚本临时启动站点并检查关键页面、重定向、搜索词与公开字段边界：

```bash
pnpm smoke:public
```

按生产构建预览（Windows PowerShell 与 macOS / Linux 均可）：

```bash
pnpm build
pnpm start
```

然后打开 <http://127.0.0.1:3000>。项目使用 Next.js standalone 输出，因此请用
`pnpm start`，不要再直接运行 `pnpm exec next start`。

## Docker

```bash
docker compose up --build
```

健康检查位于 <http://localhost:3000/api/health>。生产镜像使用 Next.js standalone 输出，
数据快照随镜像一起冻结；AWS 部署时不会依赖研究仓库或外部数据库。Compose 默认仅监听
`127.0.0.1:3000`，由服务器现有的 TLS 反向代理对外提供服务。部署交接见
[`deploy/aws/README.md`](deploy/aws/README.md)。

## 数据边界

公开快照位于 `data/public-release/v1/`，清单记录每个 shard 的 SHA-256、行数和字节数。
`pnpm validate:release` 会验证：

- 35,411 个 Work ID 全局唯一；
- 4,001 个评级 + 117 个非评级终态 = 4,118 个当前决策范围；
- 1,083 条证据不足型 D 必须同时保留低置信与待补证标记；
- owner 校准的 Work 18556、26328、26923、4975 必须保持指定等级与类别；
- 每个公开 shard 与清单哈希一致。
- 35,411 条媒体类型均按精确 Work ID 绑定；
- 作品资料和评级细节只允许绑定公开 Work ID，评级细节还必须与当前等级一致；
- 退役类别与旧评级不得进入补充层，补充文件的行数、字节数与 SHA-256 必须一致。

后续资料通过新的版本化快照追加，不回写当前快照或历史冻结研究。
