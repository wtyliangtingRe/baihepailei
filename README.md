# 百合排雷 · Baihepailei

当前仓库已经切到版本化公开快照运行，不需要本地 PostgreSQL，也不会在请求时读取研究仓库。

## 首发快照

- 公开可检索作品：35,411
- 当前决策范围：4,118
- S–F 评级：4,001
- 非评级终态：117
- 尚未进入本轮评估的目录作品：31,293

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

## Docker

```bash
docker compose up --build
```

健康检查位于 <http://localhost:3000/api/health>。生产镜像使用 Next.js standalone 输出，
数据快照随镜像一起冻结；AWS 部署时不会依赖研究仓库或外部数据库。

## 数据边界

公开快照位于 `data/public-release/v1/`，清单记录每个 shard 的 SHA-256、行数和字节数。
`pnpm validate:release` 会验证：

- 35,411 个 Work ID 全局唯一；
- 4,001 个评级 + 117 个非评级终态 = 4,118 个当前决策范围；
- 1,083 条证据不足型 D 必须同时保留低置信与待补证标记；
- owner 校准的 Work 18556、26328、26923、4975 必须保持指定等级与类别；
- 每个公开 shard 与清单哈希一致。

后续资料通过新的版本化快照追加，不回写当前快照或历史冻结研究。
