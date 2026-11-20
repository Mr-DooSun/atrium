Atrium 面向在 Paseo 中同时运行多个代理的用户。子代理嵌套显示在启动它们的代理之下，它们的聊天可以并排放在同一个屏幕上。Atrium 还会显示你的其他 Claude 和 Codex 账号的用量，它的 `/mcp` 和 `/plugins` 屏幕适用于所有代理 CLI。

## 代理树侧边栏

在“设置 → 侧边栏 → 侧边栏视图”中选择 Atrium 即可启用。子代理按任意层级显示在启动它们的代理之下，即使它们运行在各自的 worktree 工作区中也一样。每一行会显示提供方，以及代理是在运行、等待权限确认还是已失败。

- worktree 徽标显示每个会话所在的 `git worktree` 和分支，每个 worktree 对应一种颜色。
- 拖动项目和会话即可设置自己的顺序，所有客户端都会按这个顺序显示。在手机上，请改为长按项目标题。
- 可以重命名工作区；名称会保存为它的 Paseo 标题，因此所有客户端都会显示新名称。
- 可以从 Paseo 中移除项目：项目的会话会被归档，文件仍保留在磁盘上。归档会话时，如果其工作区中没有其他会话在运行，该工作区也会一并归档。
- 不属于任何项目的聊天放在固定于底部的“通用”分组中。

## 分屏

“分屏”屏幕把多个代理的聊天并排放在一起，可以跨项目。从侧边栏拖出一个会话即可添加，也可以使用命令中心。在手机上，请使用长按菜单。

- 父代理和它的子代理会保持在一起，并使用同一种颜色。
- 每个分屏都有自己的消息输入框。代理工作期间发送的消息会加入它当前的轮次，不会打断它。
- 可以调整分屏的顺序和宽度；同时打开的分屏数量没有固定上限。

## 其他账号的用量

Paseo 的用量面板涵盖你的默认 Claude 和 Codex 账号。对于每个配置为 Paseo 提供方的其他账号，Atrium 会增加一张卡片，例如一个扩展 `claude` 并使用自己的 `CLAUDE_CONFIG_DIR` 的自定义提供方。卡片显示套餐、5 小时额度、每周额度和按模型划分的额度及其重置时间，以及本地统计的 token 总量。更多细节见[用量监控说明](https://github.com/Mr-DooSun/atrium/blob/main/docs/usage-monitor.md)。

## MCP 与插件工具箱

在代理聊天中，`/mcp` 和 `/plugins` 会打开全屏界面，取代各提供方自带的同名命令。命令中心中有相同的入口。

- `/mcp` 可以列出、添加和移除 Claude Code、Codex 和 Antigravity 的 MCP 服务器。对于需要登录的服务器，它会显示如何通过对应的 CLI 登录。
- `/plugins` 为每个生态提供一个标签页。Paseo、Claude Code 和 Codex 的目录支持搜索、按类别筛选和排序，每个插件都有详情页。“已安装”标签页会显示哪些插件有更新或出错。
- 每个标签页都可以安装和移除插件。Claude Code 和 Paseo 还支持启用、禁用和更新插件（对于从注册表安装的 Paseo 插件，更新会以终端命令的形式显示），Antigravity 支持启用和禁用。你也可以从自己输入的来源安装：Paseo 支持 git 仓库、npm 包或本地文件夹，Antigravity 支持 GitHub URL 或本地文件夹，Claude Code 支持尚未添加的市场。
- 每个账号是一个独立的配置（profile），一次更改可以在多个配置上运行。每一项更改都会先请你确认。插件和市场的更改以及添加 MCP 服务器时，还会显示每个配置要执行的完整命令、来源和所有警告；移除 MCP 服务器时只显示警告，不显示命令。

## 设置

需要 Paseo 0.16.1 或更高版本。只有代理树需要手动启用（见上文）；分屏、用量卡片和工具箱无需额外设置即可使用。

- 工具箱使用守护进程所在主机上已安装的 CLI：`claude`、`codex`、`agy` 和 `paseo`。缺少的 CLI 会显示为未安装。
- worktree 徽标需要守护进程所在主机上有 `git`，没有时不显示徽标。
- 用量卡片要求其他账号已配置为 Paseo 提供方并已登录。

侧边栏、分屏和工具箱提供英语、韩语、日语、简体中文、西班牙语、法语、葡萄牙语（巴西）、俄语和阿拉伯语，随应用语言显示。

## 数据访问与限制

Atrium 运行在守护进程所在的主机上，使用你的用户权限。它不会向作者发送任何数据，也不收集遥测数据。账号邮箱会显示在用量卡片和工具箱中。MCP 的环境变量值和请求头不会发送给应用，工具箱还会对命令输出中出现的令牌和其他机密信息做遮盖处理。

**插件发出的网络请求**

- 每个其他 Claude 账号的 OAuth 令牌会发送到 `https://api.anthropic.com/api/oauth/usage` 以读取其额度，每个账号每分钟最多一次。重定向会被拒绝，令牌不会被记录日志、存储或返回给应用。
- Paseo 插件标签页会从 `https://plugins.paseo.sh/index.json` 下载公开目录。应用会从该目录列出的 https 地址加载插件图标。
- 从 npm 安装 Paseo 插件且未指定确切版本时，预览会向 `https://registry.npmjs.org` 查询 dist-tag（或 `latest`）指向哪个版本。
- 分屏屏幕不发出任何请求。它通过主机上 Paseo 守护进程自己的 API 读取时间线和父子关系，并发送你的消息。

**在守护进程所在主机上运行的命令**（独立进程，不经过 shell，每个名称、来源和选项值都作为单独的参数传递）

- 各配置自己的 CLI，使用该配置的环境：`claude`（`auth status`、`mcp`、`plugin`、`plugin marketplace`）、`codex`（`login status`、`mcp`、`plugin`、`plugin marketplace`）和 `agy`（`--version`、`plugin`）。列表查询在打开屏幕时运行；更改仅在你确认后运行。这些 CLI 可能会访问它们自己的服务，例如检查 MCP 服务器或下载插件。
- 插件更改：`claude plugin install`、`uninstall`、`enable`、`disable` 和 `update`（用 `-s` 指定范围；市场尚未添加时用 `--marketplace`），以及 `claude plugin marketplace add`、`remove` 和 `update`；`codex plugin add` 和 `remove`，以及 `codex plugin marketplace add`、`remove` 和 `upgrade`；`agy plugin install`、`uninstall`、`enable` 和 `disable`。
- Paseo CLI 的 `project ls` 和 `project delete`，以及它的 `plugin ls`、`plugin add`、`plugin update`（也可带 `--check`）、`plugin enable`、`plugin disable` 和 `plugin remove` 子命令。当守护进程设置了 `PASEO_HOME` 时，会用它传入 `--home`，使命令作用于这个守护进程；否则使用 CLI 的默认 home。git 和 npm 来源由 Paseo CLI 获取。
- 当从 git 安装 Paseo 插件且指定了分支、标签或未指定 ref 时，会对输入的仓库运行 `git ls-remote`（关闭终端提示），将其解析为单个提交，供预览使用。
- 在每个会话的文件夹中运行只读的 `git`（`rev-parse`、`worktree list`、`symbolic-ref`、`for-each-ref`），用于 worktree 徽标和默认分支。它针对会话所在的文件夹运行，不受为守护进程设置的 `GIT_DIR` 等类似变量影响，每个文件夹的结果会复用几秒钟。
- 在 macOS 上，使用 `/usr/bin/security find-generic-password` 从钥匙串读取其他 Claude 账号的登录信息。

**读取的文件**

- `~/.paseo/config.json`（或 `$PASEO_HOME/config.json`），用于查找已配置的提供方。
- 其他 Claude 账号：配置目录中的 `.claude.json`（邮箱、组织、套餐）、`projects/` 下的会话日志（仅读取 token 数量），以及在非 macOS 系统上用于登录的 `.credentials.json`。
- 其他 Codex 账号：`auth.json`（邮箱和套餐，在主机上解码）以及 `sessions/` 下的会话日志（token 数量和额度快照）。
- 工具箱，Claude Code：该配置的配置目录中的 `.claude.json`（或 `~/.claude.json`）和聊天文件夹中的 `.mcp.json`（仅读取 MCP 名称）；配置目录中的 `plugins/known_marketplaces.json`，以及每个已添加市场的 `.claude-plugin/marketplace.json`（插件名称、版本、作者、主页、类别、许可证）。
- 工具箱，Codex：聊天文件夹中的 `.codex/config.toml`（仅读取名称）。
- 工具箱，Antigravity：`~/.gemini/antigravity-cli/settings.json` 以及下文列出的两个 `mcp_config.json` 文件。

**写入的文件**

- `~/.paseo/atrium/project-order.json`（或 `$PASEO_HOME` 下的对应位置），用于保存项目和会话的顺序。如果它尚不存在，会把早期版本保存在同一文件夹 `nested-agents/project-order.json` 中的顺序复制过来一次；旧文件只读取，不会删除。
- `~/.paseo-chat` 文件夹，用于“通用”聊天。
- Antigravity 的 `~/.gemini/config/mcp_config.json` 或 `<project>/.agents/mcp_config.json`，仅在你添加或移除 Antigravity MCP 服务器时写入。

**确认插件更改时由各 CLI 写入的文件**（Atrium 不会编辑这些文件）

- Claude Code：user 范围会修改该配置的配置目录中的 `settings.json`，project 范围会修改聊天文件夹中的 `.claude/settings.json`，local 范围会修改其 `.claude/settings.local.json`。从尚未添加的市场安装时，还会把该市场添加到该配置的用户设置中。插件文件存放在该配置的配置目录下的 `plugins` 中。
- Paseo：git 和 npm 插件存放在守护进程 home 下的插件存储中；本地文件夹则直接使用其所在位置。
- Codex 和 Antigravity 将插件存放在各自的位置。

**安全措施与限制**

- 安装 Paseo 插件之前，无论来自目录还是来源，预览都会先解析分支、标签或 dist-tag，再把它固定到某一个 git 提交或某一个确切的 npm 版本。安装时严格使用这个固定的版本。
- 更新同样会固定到更新检查所报告的版本。对于从注册表安装的插件，工具箱会显示需要在终端中运行的更新命令。
- 一次预览在 10 分钟内只能使用一次。超过时间，或来源或已安装的插件发生变化后，需要重新预览。
- 输入的来源会先经过检查：不允许以 `-` 开头的值，仅允许 https，URL 中不允许包含用户名或密码，git URL 中不允许包含查询参数或片段，本地路径必须是已存在的绝对路径，仓库子文件夹中不允许出现 `..`。显示的 URL 不含凭据、查询参数和片段。
- 用量卡片会跳过 Paseo 已经显示的账号（`~/.claude`、`~/.codex`，或守护进程自己的 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME`），共用同一个配置目录的提供方共用一张卡片。
- Claude 的额度来自 Anthropic 的用量接口；使用 API 密钥、自定义 base URL、Bedrock、Vertex 或 Foundry 的账号不显示额度，登录过期时会显示 Paseo 的重新登录提示。
- Codex 的额度来自本地会话日志中最新的快照，并显示其记录时间；数据可能已过时，超过重置时间的窗口显示为 0%。
- 分屏显示插件所在主机上的代理。其他主机上的代理会改为在 Paseo 中打开。
- Codex 的 MCP 服务器只有 user 范围。登录 MCP 服务器需要在 CLI 中完成；工具箱会显示相应的命令或步骤。Antigravity 的插件需要在 Antigravity 中浏览。
