Atrium is for people who run many agents at once in Paseo. Sub-agents nest under the agent that started them, and their chats can sit side by side on one screen. It also shows usage for your extra Claude and Codex accounts, and its `/mcp` and `/plugins` screens manage Claude Code, Codex and Antigravity.

## Agent tree sidebar

Turn it on under Settings, Sidebar, Sidebar view, Atrium. Sub-agents show under the agent that started them, at any depth, even when they run in their own worktree workspace. Rows show the provider and whether an agent is running, waiting for permission or failed.

- Worktree badges show which `git worktree` and branch each session works in, with one color per worktree. Paseo’s default sidebar can also show the badge from its Show menu.
- Drag projects and sessions to set your own order, which every client sees. On mobile, long-press a project header instead.
- Rename a workspace; the name is saved as its Paseo title, so every client shows it.
- Hide a project from the Atrium sidebar and bring it back from Hidden projects. Its workspaces, sessions and files remain available in Paseo. Archiving a session also archives its workspace when nothing else runs there.
- Chats that belong to no project live in a General section pinned at the bottom. With multiple hosts, each host shows its latest chat and can expand independently. Filter by host to narrow the list. An empty host offers to start a chat; on a remote host its chat folder must already exist. Collapsed workspaces show how many sessions they hide. On web and desktop, folded rows and sections stay folded across reloads.

## Panes

The Panes screen puts the chats of many agents next to each other, across projects. Drag a session out of the sidebar to add it, or use the Command Center. On mobile, use the long-press menu.

- Parents and their sub-agents stay together and share a color.
- Each active pane has its own text box. Messages join an active turn, and panes keep the chat history available when a session becomes read-only. Panes show who sent instructions to a sub-agent and link to the original Paseo chat when an agent needs permission.
- Reorder and resize panes; there is no fixed limit on how many are open.

## Usage for additional accounts

Paseo's usage panel covers your default Claude and Codex accounts. Atrium adds a card for each other account configured as a Paseo provider, for example a custom provider that extends `claude` with its own `CLAUDE_CONFIG_DIR`. The Claude profiles and Codex profiles sources preserve the configured profile names. A card shows the plan, the 5-hour, weekly and model-specific limits with reset times, and local token totals. On Paseo 0.17.1, the quota window length and observation time also support Paseo’s usage forecasts. More detail is in [the usage monitor notes](https://github.com/Mr-DooSun/atrium/blob/main/docs/usage-monitor.md).

## MCP and plugin toolbox

In an agent chat, `/mcp` and `/plugins` open full screens in place of the providers' own commands. The Command Center has the same items.

- `/mcp` lists, adds and removes MCP servers for Claude Code, Codex and Antigravity. For Claude-hosted connectors it offers to continue sign-in in the browser. For other servers it shows how to sign in with the provider's CLI.
- `/plugins` manages Claude Code, Codex and Antigravity plugins by profile. Claude Code and Codex have searchable catalogs and installed lists. Claude Code also supports enabling, disabling and updating plugins, and Antigravity supports enabling and disabling them. You can install from a GitHub URL or local folder for Antigravity, or from a marketplace not added yet for Claude Code.
- The Paseo tab directs you to the selected host’s Settings → Plugins, where Paseo handles browsing, installation and updates.
- Each account is its own profile, and one change can run on several profiles. Every change asks for confirmation first. Plugin and marketplace changes and MCP additions also show the exact command for each profile, its source and any warnings; removing an MCP server shows a warning instead of a command.

## Setup

Requires Paseo 0.16.1 or later. Only the tree needs to be turned on (see above); panes, usage cards and the toolbox work right away.

- The toolbox uses the CLIs installed on the daemon host: `claude`, `codex` and `agy`. A missing CLI shows as not installed.
- Worktree badges need `git` on the daemon host and are left out without it.
- Usage cards need the extra account configured as a Paseo provider and logged in.

The sidebar, panes and toolbox are available in English, Korean, Japanese, Simplified Chinese, Spanish, French, Portuguese (Brazil), Russian and Arabic, following the app language.

## Data access and limits

Atrium runs on the daemon host with your user's permissions. It sends nothing to its author and collects no telemetry. Account emails appear on usage cards and in the toolbox. MCP environment values and headers are not sent to the app, and the toolbox masks tokens and other secrets it finds in command output.

**Network requests the plugin makes**

- Each additional Claude account's OAuth token goes to `https://api.anthropic.com/api/oauth/usage` to read its limits, at most once a minute per account. Redirects are refused, and the token is not logged, stored or returned to the app.
- Panes reads timelines and parent links through the Paseo daemon. The `chat.send` RPC passes message text and the host and agent IDs to the daemon. It checks the target host, agent, workspace and project before sending the text through Paseo’s agent API. On the server, pane sends are text only and steer active turns.
- General reads chat and workspace metadata across the app's configured Paseo hosts. Starting a chat uses that host's existing connection to open its chat project.
- For a Claude-hosted connector, the daemon passes the Claude authorization link to the Paseo client. The client opens it on `claude.ai` only when you select the browser sign-in action.

**Commands it runs on the daemon host** (separate processes, no shell, each name, source and option value passed as its own argument)

- Each profile's own CLI with that profile's environment: `claude` (`auth status`, `mcp`, `plugin`, `plugin marketplace`), `codex` (`login status`, `mcp`, `plugin`, `plugin marketplace`) and `agy` (`--version`, `plugin`). Listing runs when a screen opens; changes run only after you confirm. These CLIs may contact their own services, for example to check MCP servers or download plugins.
- For a Claude-hosted connector, `claude mcp login --no-browser -- <name>` requests an authorization link using the selected profile after you confirm.
- Plugin changes: `claude plugin install`, `uninstall`, `enable`, `disable` and `update` (with `-s` for the scope, and `--marketplace` when the marketplace is not added yet) and `claude plugin marketplace add`, `remove` and `update`; `codex plugin add` and `remove` and `codex plugin marketplace add`, `remove` and `upgrade`; `agy plugin install`, `uninstall`, `enable` and `disable`.
- Read-only `git` (`rev-parse`, `worktree list`, `symbolic-ref`, `for-each-ref`) in each session's folder for worktree badges and the default branch. It runs against the session's folder, not any `GIT_DIR` or similar variables set for the daemon, and each folder's answer is reused for a few seconds.
- On macOS, `/usr/bin/security find-generic-password` to read an additional Claude account's login from the Keychain.

**Files it reads**

- `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) to find the configured providers. Atrium checks `$PASEO_HOME/server-id` when the daemon API cannot provide its host ID for worktree badges, project visibility changes or pane messages.
- Claude account state comes from `.claude.json` in the config directory, with `~/.claude.json` as a fallback when no config directory is set. Atrium reads `oauthAccount` for email, organization and plan metadata and hashes `accountUuid` with `organizationUuid` to identify duplicate accounts. For additional accounts it reads token counts from session logs under `projects/` and, outside macOS, the OAuth login from `.credentials.json` in the credential directory.
- Codex account state comes from `auth.json` in each config directory. Atrium decodes local token claims for email and plan. For duplicate detection it hashes `tokens.account_id` (or `chatgpt_account_id` from the ID token) together with the ID token’s `chatgpt_user_id` (or `sub`). The two `chatgpt_*` fields come from the ID token’s `https://api.openai.com/auth` claim. For additional accounts it reads token counts and limit snapshots from logs under `sessions/`.
- Toolbox, Claude Code: `.claude.json` in the profile's config directory (or `~/.claude.json`) and the chat folder's `.mcp.json` (MCP names only); `plugins/known_marketplaces.json` in the config directory and each added marketplace's `.claude-plugin/marketplace.json` (plugin names, versions, authors, homepages, categories, licenses).
- Toolbox, Codex: the chat folder's `.codex/config.toml` (names only).
- Toolbox, Antigravity: `~/.gemini/antigravity-cli/settings.json` and the two `mcp_config.json` files listed below.

**Files it writes**

- `~/.paseo/atrium/project-order.json` (or under `$PASEO_HOME`) stores project and session order and `hiddenProjects`, a list of host and project IDs. If the file does not exist yet, an earlier version’s `nested-agents/project-order.json` in the same daemon home is copied once.
- Web and Electron use local storage for folded sidebar rows, open panes and pane widths.
- The `~/.paseo-chat` folder for General chats.
- Antigravity's `~/.gemini/config/mcp_config.json` or `<project>/.agents/mcp_config.json`, only when you add or remove an Antigravity MCP server.

**Files the CLIs write when you confirm a plugin change** (Atrium does not edit them)

- Claude Code: user scope changes `settings.json` in the profile's config directory, project scope the chat folder's `.claude/settings.json`, local scope its `.claude/settings.local.json`. Installing from a marketplace not added yet also adds it to the profile's user settings. Plugin files go to `plugins` in the profile's config directory.
- Codex and Antigravity store plugins in their own locations.

**Safeguards and limits**

- The Toolbox validates sources for the provider that accepts them. It checks source formats such as marketplace names, GitHub URLs and existing local directories, and masks credentials in displayed URLs and command output.
- Usage discovery compares extra profiles with the default and daemon-configured Claude and Codex homes. It groups matching homes and matching hashed account identities. If the identity fields are missing, the config directory is the fallback. The raw account IDs and Codex tokens stay on the daemon host.
- Claude limits come from Anthropic's usage endpoint; accounts that use an API key, a custom base URL, Bedrock, Vertex or Foundry show no limits, and an expired login shows Paseo's re-login prompt.
- Codex limits come from the newest snapshot in local session logs, shown with the time it was recorded; they can be out of date, and a window past its reset time shows 0%.
- Panes show agents of the host the plugin runs on. Agents from other hosts open in Paseo instead.
- Codex MCP servers are user scope only. The toolbox shows sign-in steps for MCP servers that require authentication in the CLI. Antigravity plugins are browsed in Antigravity itself.
