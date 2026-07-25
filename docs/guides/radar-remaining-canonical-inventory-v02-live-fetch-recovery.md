# 剩余 canonical Works inventory V02：live fetch 恢复

## 背景

首次真实 V01 执行完成了依赖安装、Payload 登录、单条 Works 就绪探针和 5 项专项测试，但在同时读取 draft Works、published Works 与公共 Radar 结论时出现 Node `TypeError: fetch failed`。

V01 使用三个完整分页扫描并发执行。当前规模约为：

- draft Works：35,615；
- published Works：35,615；
- current public Radar conclusions：10,804。

开发服务器已经通过就绪探针，因此该失败不表示凭据错误，也不表示 PostgreSQL 或 Payload 内容写入。失败发生在长时间全集读取期间。

## V02 修复

V02 保留 V01 inventory 分类、候选排序、2,500 / 10×250 打包和 manifest 逻辑，只替换 live fetch 层：

1. 三个 collection 严格串行读取；
2. 每个分页请求最长 60 秒；
3. 临时网络错误、408、429 与 5xx 最多重试 5 次；
4. 每完成一个 collection 立即写入 snapshot；
5. 进度按首尾页及每 25 页输出；
6. 最终失败包含准确 URL 和底层 cause；
7. runner 显示保留 worktree、Next stdout/stderr 和部分输出目录。

## 不变的安全边界

- Payload 内容写入：false；
- PostgreSQL 直接写入：false；
- migration / schema push：false；
- production apply package：false；
- 唯一 POST：管理员登录；
- 失败时不删除诊断 worktree；
- 成功后才删除本轮 worktree。

## 运行入口

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-radar-remaining-canonical-inventory-v02.ps1 `
  -ExpectedBranchHead <固定 PR HEAD>
```

V02 runner 以精确文本补丁复用 V01 的 worktree、服务器停止、摘要、manifest 和 ZIP 验收，只将 active builder 切换到 V02。
