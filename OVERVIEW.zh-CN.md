Atrium 适合在 Paseo 中同时运行多个代理的人。子代理显示在发起它的代理下方，多场对话可以并排显示。Atrium 也能显示额外 Claude 和 Codex 账户的用量，并通过 `/mcp` 和 `/plugins` 管理 Claude Code、Codex 和 Antigravity。

## 代理树侧边栏

在「设置 → 侧边栏 → 侧边栏视图」中选择 Atrium。子代理显示在发起它的代理下方，支持多层嵌套以及各自的工作树工作区。每一行显示提供商和运行、等待授权或失败等状态。

- 工作树徽标显示会话所在的 `git worktree` 和分支，每个工作树有自己的颜色。也可以在 Paseo 默认侧边栏的显示菜单中启用徽标。
- 拖动项目和会话调整顺序，结果会同步到各客户端。在移动端可以长按项目标题。
- 重命名工作区会更新其 Paseo 标题，各客户端都会显示新名称。
- 可以在 Atrium 侧边栏隐藏项目，并在「隐藏的项目」中恢复显示。项目、工作区、会话和文件仍可在 Paseo 中访问。归档某个会话时，如果其工作区没有其他会话，也会一并归档该工作区。
- 不属于项目的聊天集中在底部的「通用」区。连接多个主机时，每个主机默认显示最近一场对话，可独立展开，也可以按主机筛选。没有聊天的主机提供「开始新对话」入口，远程主机需要已有聊天目录。折叠的工作区显示隐藏的会话数。网页端和桌面端会在刷新后保留折叠状态。

## 分屏

分屏界面可以并排查看来自多个项目的代理对话。从侧边栏拖入会话，或使用命令中心打开。在移动端可以使用长按菜单。

- 父代理和子代理排在一起，并使用相同的颜色。
- 每个活跃的分屏都有输入框。消息可以加入正在运行的轮次。会话变为只读后，仍可查看对话记录。分屏会显示向子代理发送指令的人，并在代理需要授权时提供原始 Paseo 对话入口。
- 可调整分屏顺序和宽度，打开数量没有固定上限。

## 额外账户的用量

Paseo 的用量面板涵盖默认 Claude 和 Codex 账户。对于配置为 Paseo 提供商的其他账户，例如使用独立 `CLAUDE_CONFIG_DIR` 的 Claude 配置，Atrium 会分别显示用量卡片。卡片保留配置名称，并显示套餐、五小时、每周和模型专属限额、重置时间及本地令牌总数。Paseo 0.17.1 还可用用量窗口长度和观测时间进行预测。详情见[用量监控文档](https://github.com/Mr-DooSun/atrium/blob/main/docs/usage-monitor.md)。

## MCP 和插件工具箱

在代理对话中，`/mcp` 和 `/plugins` 会打开 Atrium 的完整界面。命令中心也提供相同入口。

- `/mcp` 可以查看、添加和移除 Claude Code、Codex 和 Antigravity 的 MCP 服务器。Claude 托管的连接器可以在浏览器中继续授权，其他需要登录的服务器会显示相应 CLI 的登录步骤。
- `/plugins` 按配置管理 Claude Code、Codex 和 Antigravity 插件。Claude Code 和 Codex 提供可搜索的目录和已安装列表。Claude Code 还支持启用、停用和更新插件，Antigravity 支持启用和停用。Antigravity 可以从 GitHub URL 或本地目录安装，Claude Code 可以从尚未添加的市场安装。
- Paseo 标签页会指引你前往所选主机的「设置 → 插件」。Paseo 在那里处理插件的浏览、安装和更新。
- 每个账户使用独立配置，一项操作可以应用于多个配置。每次变更都需要确认。变更插件或市场、添加 MCP 服务器时会显示各配置的执行命令、来源和警告。移除 MCP 服务器时会显示确认警告。

## 环境要求

需要 Paseo 0.16.1 或更高版本。代理树需要在设置中启用。分屏、用量卡片和工具箱可直接使用。

- 工具箱使用守护进程主机上安装的 `claude`、`codex` 和 `agy` 命令。缺失的 CLI 会显示为未安装。
- 工作树徽标需要守护进程主机上的 `git`。
- 额外账户需要配置为 Paseo 提供商并登录，才能显示用量。

侧边栏、分屏和工具箱跟随应用语言，支持英语、韩语、日语、简体中文、西班牙语、法语、巴西葡萄牙语、俄语和阿拉伯语。

## 数据访问和限制

Atrium 在守护进程所在主机上以当前用户的权限运行。它不会向作者发送数据，也不收集遥测信息。用量卡片和工具箱会显示账户邮箱。MCP 环境变量的值和请求头不会发送到应用，工具箱会遮盖命令输出中的令牌和其他敏感信息。

**网络请求**

- 每个额外 Claude 账户的 OAuth 令牌会发送到 `https://api.anthropic.com/api/oauth/usage`，用于查询限额，每个账户最多每分钟一次。请求拒绝重定向，Atrium 不记录、保存或向应用返回该令牌。
- 分屏通过 Paseo 守护进程读取时间线和代理的父子关系。`chat.send` RPC 将消息文本、主机 ID 和代理 ID 传给守护进程。它在调用 Paseo 代理 API 前验证目标主机、代理、工作区和项目。分屏发送限于文本，运行中的轮次会接收追加消息。
- 「通用」区读取应用已配置主机的对话和工作区信息。开始聊天时，使用目标主机的现有连接打开对应聊天项目。
- 对于 Claude 托管的连接器，守护进程把 Claude 授权链接交给 Paseo 客户端。只有你选择浏览器授权时，客户端才会打开 `claude.ai` 上的链接。

**在守护进程主机上运行的命令**

- 使用每个配置对应的环境运行 CLI。Claude Code 使用 `claude auth status`、`claude mcp`、`claude plugin` 和 `claude plugin marketplace`。Codex 使用 `codex login status`、`codex mcp`、`codex plugin` 和 `codex plugin marketplace`。Antigravity 使用 `agy --version` 和 `agy plugin`。这些命令在独立进程中运行，参数逐个传递，无需 shell。打开界面时读取列表，确认后才执行变更。CLI 可能连接其各自的服务以检查 MCP 服务器或下载插件。
- 用户确认后，Claude 托管的连接器使用所选配置运行 `claude mcp login --no-browser -- <name>`，以获取浏览器授权链接。
- 插件变更包括 `claude plugin install`、`uninstall`、`enable`、`disable`、`update` 和市场的 `add`、`remove`、`update`。Codex 支持插件的 `add`、`remove` 和市场的 `add`、`remove`、`upgrade`。Antigravity 支持插件的 `install`、`uninstall`、`enable`、`disable`。Claude Code 用 `-s` 指明范围，未添加的市场可用 `--marketplace` 指定。
- 在会话目录运行只读 Git 命令 `rev-parse`、`worktree list`、`symbolic-ref`、`for-each-ref` 以读取工作树和默认分支。忽略守护进程的 `GIT_DIR` 等变量，结果短时缓存。
- macOS 使用 `/usr/bin/security find-generic-password` 从钥匙串读取额外 Claude 账户的登录凭证。

**读取的文件**

- 从 `~/.paseo/config.json` 或 `$PASEO_HOME/config.json` 读取提供商配置。守护进程 API 未提供主机 ID 时，从 `$PASEO_HOME/server-id` 读取，以处理工作树徽标、项目可见性和分屏消息。
- 从配置目录的 `.claude.json` 读取 Claude 账户状态，未指定目录时用 `~/.claude.json`。从 `oauthAccount` 读取邮箱、组织和套餐，并用 `accountUuid` 与 `organizationUuid` 的哈希识别重复账户。额外账户的令牌用量来自 `projects/` 会话日志。在 macOS 以外的平台，从凭证目录的 `.credentials.json` 读取额外账户的 OAuth 凭证。
- 从 Codex 配置目录的 `auth.json` 读取邮箱和套餐对应的令牌声明。将 `tokens.account_id` 或 ID 令牌的 `chatgpt_account_id` 与 `chatgpt_user_id` 或 `sub` 一起哈希，用于识别重复账户。两个 `chatgpt_*` 字段来自 ID 令牌中的 `https://api.openai.com/auth` 声明。额外账户的用量和限额快照来自 `sessions/` 日志。
- Claude Code 工具箱读取配置目录中的 `.claude.json` 或 `~/.claude.json`，以及会话目录下的 `.mcp.json` 中的 MCP 名称。还读取配置目录的 `plugins/known_marketplaces.json` 和各市场的 `.claude-plugin/marketplace.json`，获取插件名称、版本、作者、主页、类别和许可证。
- Codex 工具箱读取会话目录下 `.codex/config.toml` 的名称。Antigravity 工具箱读取 `~/.gemini/antigravity-cli/settings.json` 和下述两个 `mcp_config.json` 文件。

**写入的文件**

- `~/.paseo/atrium/project-order.json` 或 `$PASEO_HOME` 下对应的文件保存项目和会话顺序，以及由主机与项目 ID 组成的 `hiddenProjects` 列表。如果文件尚不存在，会从同一守护进程目录的旧版 `nested-agents/project-order.json` 迁移一次。
- 网页端和 Electron 使用本地存储保存侧边栏折叠状态、分屏列表及宽度。
- `~/.paseo-chat` 目录用于「通用」聊天。
- 添加或移除 Antigravity MCP 服务器时，才会写入 `~/.gemini/config/mcp_config.json` 或 `<project>/.agents/mcp_config.json`。

**确认插件变更后，由 CLI 写入的文件**

- Claude Code 用户范围对应配置目录的 `settings.json`，项目范围对应会话目录的 `.claude/settings.json`，本地范围对应 `.claude/settings.local.json`。从新市场安装也会把该市场加入用户设置。插件文件保存到配置目录的 `plugins` 中。
- Codex 和 Antigravity 将插件保存到各自的位置。

**保护措施和限制**

- 工具箱校验各提供商接受的来源格式，例如市场名称、GitHub URL 和已有本地目录。它会遮盖显示的 URL 和命令输出中的凭证。
- 用量卡片将额外配置与默认账户和守护进程配置的目录进行对比，根据相同目录或相同账户哈希分组。无法识别账户时按配置目录分组。原始账户 ID 和 Codex 令牌保留在守护进程主机。
- Claude 限额来自 Anthropic 的用量端点。使用 API 密钥、自定义服务地址、Bedrock、Vertex 或 Foundry 的账户不会显示该限额。凭证过期时，Paseo 会提示重新登录。
- Codex 限额来自本地会话日志中的最新快照，会显示采样时间。快照可能过期，越过重置时间后显示为 0%。
- 分屏显示 Atrium 所在主机的代理，其他主机的代理在 Paseo 中打开。
- Codex 的 MCP 服务器仅支持用户范围。需要在 CLI 中认证的 MCP 服务器会显示对应登录步骤。Antigravity 的插件目录在 Antigravity 中浏览。
