# Baihepailei：Codex、PowerShell 与 Git 命令速查

> 适用环境：Windows、PowerShell 7、Codex CLI、本地项目目录 `D:\0GitHubtest\Baihepailei`。
>
> 本文以“可以直接复制粘贴”为目标。涉及删除、数据库写入、迁移、导入、部署、强制推送的命令会明确标记为高风险。

---

## 0. 每天最常用的几条

### 打开 Baihepailei 并启动一个新 Codex 会话

```powershell
baihe
```

等价于：

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex
```

### 选择一个旧会话继续

```powershell
baihe-resume
```

等价于：

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex resume
```

### 直接继续当前项目最近一次会话

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex resume --last
```

### 查看 Git 状态与 Codex 登录状态

```powershell
baihe-status
```

### Codex 工作完成后检查改动

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
git status --short --branch
git diff --stat
git diff
```

---

## 1. 当前推荐的 Codex 默认配置

配置文件：

```text
D:\EnglishOnly\Codex\home\config.toml
```

打开配置：

```powershell
notepad "$env:CODEX_HOME\config.toml"
```

推荐内容：

```toml
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
model_verbosity = "low"
service_tier = "default"

[projects.'d:\0githubtest\baihepailei']
trust_level = "trusted"

[windows]
sandbox = "unelevated"
```

推荐日常组合：

- 普通开发：Terra + Medium + Default
- 小型机械修改：Luna + Low
- 复杂架构、权限、数据库设计：Sol + Medium/High
- 节约余量时保持 Fast 关闭

---

## 2. PowerShell 快捷命令配置

打开 PowerShell 配置文件：

```powershell
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Force -Path $PROFILE | Out-Null
}

notepad $PROFILE
```

可以加入：

```powershell
function baihe {
    Set-Location 'D:\0GitHubtest\Baihepailei'
    codex
}

function baihe-resume {
    Set-Location 'D:\0GitHubtest\Baihepailei'
    codex resume
}

function baihe-last {
    Set-Location 'D:\0GitHubtest\Baihepailei'
    codex resume --last
}

function baihe-status {
    Set-Location 'D:\0GitHubtest\Baihepailei'
    git status --short --branch
    codex login status
}

function baihe-review {
    Set-Location 'D:\0GitHubtest\Baihepailei'
    codex review --uncommitted
}

function baihe-doctor {
    codex doctor --summary
}
```

让当前 PowerShell 立即读取新配置：

```powershell
. $PROFILE
```

---

## 3. Codex 安装、版本、登录与诊断

### 查看版本

```powershell
codex --version
```

### 查看全部帮助

```powershell
codex --help
```

### 查看某个子命令帮助

```powershell
codex resume --help
codex review --help
codex exec --help
codex doctor --help
```

### 查看当前登录方式

```powershell
codex login status
```

正确结果应类似：

```text
Logged in using ChatGPT
```

### 设备码重新登录

本机普通网页登录回调端口受 Windows 保留范围影响时，使用：

```powershell
codex login --device-auth
```

### 退出登录

```powershell
codex logout
```

> 注意：这会删除本地保存的 ChatGPT/API 登录凭据，平时不要误运行。

### 诊断 Codex

```powershell
codex doctor
```

精简诊断：

```powershell
codex doctor --summary
```

无颜色输出：

```powershell
codex doctor --summary --no-color
```

JSON 输出：

```powershell
codex doctor --json
```

### 更新 Codex CLI

```powershell
codex update
```

---

## 4. 启动、恢复、分叉与管理会话

### 启动新会话

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex
```

### 启动时直接附带第一条任务

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex "只读检查当前仓库，不要修改文件，先总结状态。"
```

### 打开当前项目的会话选择器

```powershell
codex resume
```

### 直接恢复当前目录最近的会话

```powershell
codex resume --last
```

### 显示其他目录的会话

```powershell
codex resume --all
```

### 按会话 ID 或名称恢复

```powershell
codex resume <SESSION_ID_OR_NAME>
```

### 从旧会话分叉新会话

```powershell
codex fork
```

直接分叉最近一次：

```powershell
codex fork --last
```

### 归档会话

```powershell
codex archive <SESSION_ID_OR_NAME>
```

### 恢复归档会话

```powershell
codex unarchive <SESSION_ID_OR_NAME>
```

### 永久删除会话（高风险）

```powershell
codex delete <SESSION_ID_OR_NAME>
```

> 删除是永久操作。一般优先使用 `archive`，不要轻易使用 `delete`。

---

## 5. 不进入持续聊天界面的单次任务

### 一次性执行任务

```powershell
codex exec "只读检查当前仓库并给出摘要，不要修改文件。"
```

简写：

```powershell
codex e "只读检查当前仓库并给出摘要，不要修改文件。"
```

### 明确指定项目目录

```powershell
codex exec `
    -C 'D:\0GitHubtest\Baihepailei' `
    "只读检查 Git 状态和最近提交，不要修改文件。"
```

### 临时指定模型

```powershell
codex exec `
    -C 'D:\0GitHubtest\Baihepailei' `
    --model gpt-5.6-luna `
    "查找所有引用某个函数的位置，不要修改文件。"
```

### 把最终回答保存到文件

```powershell
codex exec `
    -C 'D:\0GitHubtest\Baihepailei' `
    --output-last-message '.\codex-result.txt' `
    "只读总结当前仓库状态。"
```

---

## 6. 非交互代码审查

### 审查所有未提交改动

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
codex review --uncommitted
```

这会包含：

- 已暂存修改
- 未暂存修改
- 未跟踪文件

### 与 main 分支比较

```powershell
codex review --base main
```

### 审查某次提交

```powershell
codex review --commit <COMMIT_SHA>
```

示例：

```powershell
codex review --commit 2bbe0c1
```

### 加入自定义审查要求

```powershell
codex review --uncommitted "重点检查数据安全、权限边界、数据库写入风险和缺失测试。"
```

---

## 7. Codex 交互界面中的核心 `/` 命令

在输入框键入：

```text
/
```

即可查看当前版本实际支持的全部命令。

### 模型与速度

```text
/model
```

切换当前会话模型和推理强度。

```text
/fast
```

切换 Fast 服务档。节约余量时保持关闭。

```text
/status
```

查看当前模型、推理强度、权限、目录、Token、上下文和会话状态。

```text
/personality
```

切换 Codex 的表达风格。

### 工作方式

```text
/plan
```

进入规划模式，适合大型重构、迁移、权限系统和多文件任务。

```text
/permissions
```

调整 Codex 可以自动执行的操作范围。

```text
/approve
```

自动审核拒绝某个动作后，允许它重试一次。

```text
/review
```

让 Codex 审查当前工作树。

```text
/diff
```

在 Codex 内查看 Git diff、未暂存改动与未跟踪文件。

```text
/init
```

在当前项目生成 `AGENTS.md` 初始模板。

### 会话管理

```text
/rename <名称>
```

给当前会话命名。

```text
/resume
```

打开已保存会话选择器。

```text
/fork
```

复制当前会话并创建新的分支会话。

```text
/side
```

开启临时旁支会话，不打断主任务。

```text
/compact
```

压缩长会话上下文，保留关键信息并释放上下文空间。

```text
/archive
```

归档当前会话并退出。

```text
/delete
```

永久删除当前会话并退出。高风险，不建议随便使用。

### 输出与界面

```text
/copy
```

复制 Codex 最近一次完整回答。

```text
/raw
```

切换更适合复制的原始输出模式。

```text
/statusline
```

自定义底部状态栏。建议显示：模型+推理、Git 分支、上下文、速率限制、Token、目录。

```text
/title
```

自定义终端窗口标题内容。

```text
/theme
```

切换终端语法主题。

```text
/keymap
```

查看或修改 Codex TUI 快捷键。

```text
/vim
```

切换输入框 Vim 模式。

### 后台任务

```text
/ps
```

查看当前会话的后台终端任务。

```text
/stop
```

停止当前会话的后台终端任务。

```text
/clean
```

`/stop` 的别名。

### 退出

```text
/exit
```

或：

```text
/quit
```

安全退出 Codex。

---

## 8. Codex 交互快捷键

| 操作 | 作用 |
|---|---|
| `@` | 搜索并引用工作区文件 |
| `Up` / `Down` | 恢复输入历史 |
| `Ctrl + R` | 搜索历史提示词 |
| `Ctrl + O` | 复制最近一次完整回答 |
| Codex 工作时按 `Tab` | 把补充指令排到下一轮 |
| Codex 工作时按 `Enter` | 立即把新指令注入当前轮 |
| 空输入框连续按两次 `Esc` | 编辑上一条用户消息并从那里分叉 |
| `Ctrl + C` | 中断当前任务或退出会话 |

---

## 9. Git 日常检查命令

### 确认当前目录

```powershell
Get-Location
```

### 查看当前分支和改动

```powershell
git status --short --branch
```

### 查看改动规模

```powershell
git diff --stat
```

### 查看未暂存 diff

```powershell
git diff
```

### 查看已暂存 diff

```powershell
git diff --cached
```

### 查看某个文件改动

```powershell
git diff -- next-env.d.ts
```

### 查看最近提交

```powershell
git log -10 --oneline
```

### 查看远端信息

```powershell
git remote -v
```

### 拉取远端更新，不自动生成合并提交

```powershell
git pull --ff-only
```

### 新建任务分支

```powershell
git switch -c codex/<任务名称>
```

示例：

```powershell
git switch -c codex/generated-files-cleanup
```

### 切回 main

```powershell
git switch main
```

### 暂存指定文件

```powershell
git add <文件路径>
```

### 提交

```powershell
git commit -m "docs: describe the change"
```

### 推送当前分支并设置上游

```powershell
git push -u origin HEAD
```

### 高风险 Git 命令：默认不要运行

```powershell
git reset --hard
git clean -fd
git push --force
```

> 这些命令可能永久丢失本地工作或改写远端历史。除非已经确认影响范围，否则不要执行，也不要让 Codex自行执行。

---

## 10. Baihepailei 常用项目命令

先进入项目：

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'
```

### 安装依赖

```powershell
pnpm install
```

> 会修改或生成 `pnpm-lock.yaml`。执行前后都应查看 Git 状态。

### 启动开发环境

```powershell
pnpm dev
```

使用 Webpack：

```powershell
pnpm dev:webpack
```

项目初始化脚本：

```powershell
pnpm dev:setup
```

### 生产构建

```powershell
pnpm build
```

### 启动生产构建结果

```powershell
pnpm start
```

### 生成 Payload 类型

```powershell
pnpm generate:types
```

### 生成 Payload import map

```powershell
pnpm generate:importmap
```

### 创建本地检查点

```powershell
pnpm backup:checkpoint
```

### 创建数据库检查点

```powershell
pnpm backup:checkpoint:database
```

### 验证数据库检查点

```powershell
pnpm backup:verify-database-checkpoint
```

### 导出轻量搜索索引

```powershell
pnpm export:lite-search
```

### 导出轻量详情索引

```powershell
pnpm export:lite-details
```

### 详情页烟雾测试

```powershell
pnpm smoke:lite-details
```

### 查看全部项目脚本

```powershell
node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).sort().join('\n'))"
```

### 查看脚本与实际命令对应关系

```powershell
node -e "const p=require('./package.json'); for (const [k,v] of Object.entries(p.scripts).sort()) console.log(k+' = '+v)"
```

---

## 11. 数据库、导入、迁移、Apply 与部署安全边界

以下类型的命令默认视为高风险：

- 名称中包含 `apply`
- 名称中包含 `import`
- 数据库 migration
- 直接写 PostgreSQL
- production deploy
- rollback
- 删除或覆盖数据

执行前最低要求：

1. 先创建本地检查点。
2. 默认先 dry-run、plan、audit 或 preview。
3. 阅读完整输出和目标行数。
4. 明确数据库、环境变量和目标环境。
5. 小批量验证后再扩大范围。
6. 不自动覆盖人工审核结果。
7. 不自动发布草稿或 AI 建议评分。

建议给 Codex 的固定约束：

```text
可以读取仓库、修改源码并运行测试和 build。
在我明确批准前：
- 不直接写 PostgreSQL；
- 不执行 migration；
- 不执行 apply、import、deploy 或 rollback；
- 不删除文件；
- 不运行 git reset --hard、git clean 或 force push；
- 不读取、显示或提交密码、Token、Cookie 与生产密钥；
- 数据操作默认先 dry-run、audit、plan 或 preview。
```

---

## 12. 当前生成文件检查

查看当前四个常见生成文件：

```powershell
Set-Location 'D:\0GitHubtest\Baihepailei'

Get-Item `
    next-env.d.ts,
    payload-types.ts,
    pnpm-lock.yaml,
    tsconfig.tsbuildinfo |
    Select-Object Name, Length, LastWriteTime
```

查看哪些已经由 Git 跟踪：

```powershell
git ls-files -- `
    next-env.d.ts `
    payload-types.ts `
    pnpm-lock.yaml `
    tsconfig.tsbuildinfo
```

查看是否被 `.gitignore` 忽略：

```powershell
git check-ignore -v `
    payload-types.ts `
    pnpm-lock.yaml `
    tsconfig.tsbuildinfo
```

查看文件开头：

```powershell
Get-Content payload-types.ts -TotalCount 30
Get-Content pnpm-lock.yaml -TotalCount 30
```

通常判断：

- `next-env.d.ts`：由 Next.js 自动维护，需要判断是否应提交版本变化。
- `payload-types.ts`：Payload 自动生成，禁止手工编辑；是否提交取决于项目规范。
- `pnpm-lock.yaml`：依赖锁文件，通常应审查后纳入版本控制。
- `tsconfig.tsbuildinfo`：TypeScript 增量缓存，通常加入 `.gitignore`。

---

## 13. VPN / Xray 检查命令

### 查看 Codex 是否连接本地代理端口

在 Codex 正在工作时，另开 PowerShell：

```powershell
$CodexProcess = Get-Process codex -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending |
    Select-Object -First 1

if (-not $CodexProcess) {
    throw '当前没有找到正在运行的 Codex 进程。'
}

Get-NetTCPConnection `
    -OwningProcess $CodexProcess.Id `
    -State Established `
    -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort
```

目前预期看到 Codex 连接：

```text
127.0.0.1:10808
```

### 确认 10808 的监听程序

```powershell
$Listener = Get-NetTCPConnection `
    -State Listen `
    -LocalPort 10808 `
    -ErrorAction Stop |
    Select-Object -First 1

$Listener

Get-Process -Id $Listener.OwningProcess |
    Select-Object Id, ProcessName, Path
```

当前预期程序：

```text
xray.exe
```

### 查看公网出口信息

```powershell
curl.exe -s https://api.ipify.org
"`n"
```

更完整信息：

```powershell
curl.exe -s https://ipinfo.io/json
```

> 公网 IP 属于隐私信息，不要随意贴到公开聊天或仓库。

### 查看代理核心的外部连接

```powershell
$ProxyPid = $Listener.OwningProcess

Get-NetTCPConnection `
    -OwningProcess $ProxyPid `
    -State Established `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.RemoteAddress -notin @('127.0.0.1', '::1')
    } |
    Select-Object RemoteAddress, RemotePort, LocalAddress, LocalPort
```

注意：Xray 最终通过物理网卡连接远端代理节点是正常现象；关键是 Codex 请求先进入本地 Xray，而不是 Codex 自己直接连公网。

---

## 14. 推荐的第一次正式任务模板

```text
这是 Baihepailei 项目的本地主仓库。

先检查 git status、当前分支、README.md、AGENTS.md、package.json、
docs 目录和最近提交。

可以读取仓库、修改源码并运行目标测试、TypeScript 检查和 build。
但在我明确批准以前：
- 不直接写 PostgreSQL；
- 不执行 migration；
- 不执行 apply、import、deploy 或 rollback；
- 不删除文件；
- 不运行 git reset --hard、git clean 或 force push；
- 不读取或输出密码、Token、Cookie 和生产环境密钥；
- 数据操作默认先 dry-run、audit、plan 或 preview。

第一轮先只读分析，输出当前进度、风险、阻塞项和下一步建议，不要修改文件。
```

---

## 15. 推荐工作流程

### 开始任务前

```powershell
baihe-status
git diff --stat
git diff
```

### 创建任务分支

```powershell
git switch -c codex/<任务名称>
```

### 启动 Codex

```powershell
baihe
```

### Codex 完成后

```powershell
git status --short --branch
git diff --stat
git diff
```

### 让 Codex 再审查一次

```powershell
codex review --uncommitted
```

### 人工确认后再提交

```powershell
git add <确认过的文件>
git commit -m "<提交说明>"
git push -u origin HEAD
```

---

## 16. 官方参考

- Codex 开发者命令：`https://developers.openai.com/codex/cli/reference`
- Codex CLI：`https://developers.openai.com/codex/cli/features`
- Codex 认证：`https://developers.openai.com/codex/auth`
- Codex 配置：`https://developers.openai.com/codex/config-reference`

> Codex CLI 更新较快。某条命令与本文不一致时，以本机 `codex --help`、`codex <子命令> --help` 和在 Codex 输入 `/` 后显示的当前命令为准。
