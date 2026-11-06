# 远端编译台设计（不依赖大模型）

这个面板首先是一个独立的远端构建工具：浏览器 UI、Host 进程和 SSH 组成完整链路，大模型完全不参与也能完成上传、构建、安装、测试、监控和终端操作。模型只是可选的第二类调用方。

## 1. 组件

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Client | `client.js`，`sidebar.panellist` + `main` | 卡片、配置表单、流水线日志、终端窗口；用 `fetch('/build-servers/...')` 与 Host 通信 |
| Host | `index.js`，`webServer` 前缀路由 `/build-servers` | 配置持久化、SSH 探测、路径检测、流水线调度、终端会话、Agent 工具 |
| SSH | 本机 OpenSSH | 免密登录和远端执行；不保存密码，沿用 `~/.ssh/config` 与 ssh-agent |
| Store | `~/.dsh/build-servers.json`，`build-server-bindings.json`，`build-server-settings.json` | 服务器网络条目、会话绑定/工作区默认、会话构建设置；运行记录和终端会话只在内存中 |

同源请求带 `x-build-servers: 1` 标记，跨源请求被拒绝；GET 只返回配置和状态，所有变更走 POST/PUT。

## 2. 网络条目与会话设置

面板（左侧「编译服务器」）只配置网络条目：

```text
name / target / port            显示名、ssh 别名或 user@host、可选端口
enabled                         是否参与探测
```

构建路径和命令属于**会话**，在对话底部的「编译设置」里配置：

```text
localPath                       本机待上传目录（可空，空则跳过上传）
repoPath                        远端构建路径（可空，空则探测时给出建议）
syncExclude                     上传排除模式，默认 .git build node_modules .venv .dsh-plugins
stages.build / install / test   按顺序执行的命令，可空
```

绑定是**按会话**的（`sessions`）；某个工作区会记住最近一次采用的服务器（`workspaces`），新建会话默认采用它，但不会覆盖显式解绑（`sessions[session] = null`）。`POST /probe` 读取发行版、内核、架构、用户、工具链版本、负载、内存、磁盘、Git 状态。

## 3. 流水线：sync → build → install → test

- `sync`：本机 `tar -cf -` 通过管道送入 `ssh target 'mkdir -p <repo> && tar -xf - -C <repo>'`；两个子进程直接 pipe，不经过本地 shell，不需要 Windows 上有 rsync。阶段实时累计字节数，UI 显示已上传大小。
- `build/install/test`：每阶段一次 `ssh target "bash -lc 'cd <repo> && <command>'"`，用登录 shell 拿到构建机的工具链环境。
- 失败即停：当前阶段 `failed`，后续阶段 `skipped`；用户停止时杀掉当前 SSH（同步阶段连同 tar 一起杀），状态为 `stopped`。
- 每阶段输出上限 128 KiB，接口快照保留尾部 64 KiB；状态、退出码、耗时每秒轮询。
- 配置了 `localPath` 但没有 `repoPath` 会在保存时被拒绝，避免把源码解到 `$HOME`。

## 4. 终端

`POST /terminal/open` 启动一个常驻 `ssh -tt target 'bash -l'`，之后：

- `POST /terminal/input` 写入按键（行输入、`Ctrl-C`）；
- `GET /terminal?session=` 读完整输出；
- `POST /terminal/close` 结束会话。

工作目录和环境变量在会话内保持；输出去掉 ANSI 转义并按行显示，适合构建、`git`、`ctest` 这类命令，不承诺 vim/top 这类全屏程序。同一服务器已有存活会话时，面板和工具都会复用它，而不是再开一条 SSH。

## 5. 把模型的工具调用接到这条终端

Host 注册了一个全局工具 `remote_terminal`（`ctx.tools.register`），它是终端会话的第二个调用方，和面板共用同一个 `terminals` 表：

| action | 作用 |
| --- | --- |
| `list` | 列出已配置服务器和存活会话（含 cursor） |
| `open` | 按 id 或名称打开；已有存活会话则复用 |
| `send` | 写入一条命令，`waitMs` 等待输出，返回新增文本和 cursor |
| `read` | 从 cursor 继续读取后续输出 |
| `close` | 关闭会话 |

模型的一次任务只需要 `open` 一次，然后连续 `send`。cwd、环境变量、后台任务都在同一条 shell 里，不必每条命令重新 `ssh host '...'`。示例：

```text
open(build-host)          -> term_x, cursor=29
send("cd ~/src/myproject") -> 提示符变成 myproject
send("ls -d build")       -> build
send("cmake --build build -j8", waitMs=8000) -> 构建输出
read(cursor=...)          -> 后续输出
close()
```

**权限边界**：工具只接受已配置的服务器，执行身份就是本机 SSH 的免密身份；没有额外的审批弹窗。因此服务器列表应只保留可信机器；需要审批时可用 `ctx.tools.guard()` 或在 `tools/pre-execute` 里拦截。

没有采用“劫持内置 bash/pwsh 工具”的方案：那会把本地命令和远端命令混在一个工具名下，需要按会话维护“当前服务器”，还会影响模型的本地编辑/检索工具。独立工具更可控，也保留了面板直接操作的能力。

## 6. 失败与生命周期

- SSH 退出码、stderr 尾部、`ssh` 缺失、超时都会变成阶段错误文本；不会把旧结果当成功。
- Host 重启后配置仍在，运行中的流水线和终端会话会丢失，UI 会显示会话失效。
- 删除服务器不会改动远端内容；正在运行的流水线禁止删除配置。

## 7. 对话内嵌（当前形态）

- `conversation.composer.dock` 里注册 `build-servers-mini`：输入框**最下排**只有一个状态点和服务器名，没有 `⋯` 按钮。
- 状态点：绿色=在线空闲，绿色闪烁=流水线运行中，黄色=延迟高于 1200ms，红色=探测无响应，灰色=未绑定/尚未探测。
- 点击状态点打开详情对话框：OS/IP、负载/内存/磁盘/运行时长、上传/构建/安装/测试各阶段状态与耗时，以及构建/停止、终端、编译设置、解绑、配置、切换服务器。
- 绑定属于**会话**，默认没有绑定；工作区记住最近一次采用的服务器，新会话默认采用，但不覆盖显式解绑（`sessions[session] = null`）。
- 构建路径、上传目录和 build/install/test 命令放在 `build-server-settings.json`，按会话保存；详情对话框里的「编译设置」编辑它们。
- 「新建终端」在详情对话框里就地展开，和面板、Agent 工具共用同一个 per-server 会话。
- 左侧「编译服务器」面板只配置网络条目（名称、target、端口、启用）；`配置` 调 `ctx.layout.selectPanel('build-servers')` 打开它。
- Agent 端 `build_server` 工具（`status / run / pipeline / stop`）用 `exec.agent.id` 找到会话，再按会话绑定（或工作区默认）找服务器和会话设置；没有绑定时明确报错，不会猜测服务器。
- 会话行右边的 `⋯` 菜单（pin/rename/fork/archive）有扩展 slot，已加入 `编译服务器…`：打开后选服务器绑定/解绑，并能进入该会话的「编译设置」。
- 工作区行右边的 `⋯` 菜单（重命名/删除工作区）是内置 UI，没有插件 slot；工作区级别没有绑定入口。
