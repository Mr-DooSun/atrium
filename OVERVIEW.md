Atrium is for people who run many agents at once in Paseo. Sub-agents nest under the agent that started them, and their chats can sit side by side on one screen. It also shows usage for your extra Claude and Codex accounts, and its `/mcp` and `/plugins` screens work across every agent CLI.

## Agent tree sidebar

Turn it on under Settings, Sidebar, Sidebar view, Atrium. Sub-agents show under the agent that started them, at any depth, even when they run in their own worktree workspace. Rows show the provider and whether an agent is running, waiting for permission or failed.

- Worktree badges show which `git worktree` and branch each session works in, with one color per worktree.
- Drag projects and sessions to set your own order, which every client sees. On mobile, long-press a project header instead.
- Rename a workspace; the name is saved as its Paseo title, so every client shows it.
- Remove a project from Paseo: its sessions are archived and its files stay on disk. Archiving a session also archives its workspace when nothing else runs there.
- Chats that belong to no project live in a General section pinned at the bottom.

## Panes

The Panes screen puts the chats of many agents next to each other, across projects. Drag a session out of the sidebar to add it, or use the Command Center. On mobile, use the long-press menu.

- Parents and their sub-agents stay together and share a color.
- Each pane has its own message box. A message sent while the agent works joins its current turn instead of interrupting it.
- Reorder and resize panes; there is no fixed limit on how many are open.

## Usage for additional accounts

Paseo's usage panel covers your default Claude and Codex accounts. Atrium adds a card for each other account configured as a Paseo provider, for example a custom provider that extends `claude` with its own `CLAUDE_CONFIG_DIR`. A card shows the plan, the 5-hour, weekly and model-specific limits with reset times, and local token totals. More detail is in [the usage monitor notes](https://github.com/Mr-DooSun/atrium/blob/main/docs/usage-monitor.md).

## MCP and plugin toolbox

In an agent chat, `/mcp` and `/plugins` open full screens in place of the providers' own commands. The Command Center has the same items.

- `/mcp` lists, adds and removes MCP servers for Claude Code, Codex and Antigravity. For a server that needs a login, it shows how to sign in with that CLI.
- `/plugins` has a tab per ecosystem. The Paseo, Claude Code and Codex catalogs can be searched, filtered by category and sorted, and each plugin opens a detail page. The Installed tab shows what has an update or an error.
- Every tab installs and removes plugins. Claude Code and Paseo also enable, disable and update them (for Paseo plugins installed from the registry, the update is shown as a terminal command), and Antigravity enables and disables them. You can also install from a source you enter: a git repository, npm package or local folder for Paseo, a GitHub URL or local folder for Antigravity, or a marketplace not added yet for Claude Code.
- Each account is its own profile, and one change can run on several profiles. Every change asks for confirmation first. Plugin and marketplace changes and MCP additions also show the exact command for each profile, its source and any warnings; removing an MCP server shows a warning instead of a command.

## Setup

Requires Paseo 0.16.1 or later. Only the tree needs to be turned on (see above); panes, usage cards and the toolbox work right away.

- The toolbox uses the CLIs installed on the daemon host: `claude`, `codex`, `agy` and `paseo`. A missing CLI shows as not installed.
- Worktree badges need `git` on the daemon host and are left out without it.
- Usage cards need the extra account configured as a Paseo provider and logged in.

The sidebar, panes and toolbox are available in English, Korean, Japanese, Simplified Chinese, Spanish, French, Portuguese (Brazil), Russian and Arabic, following the app language.

## Data access and limits

Atrium runs on the daemon host with your user's permissions. It sends nothing to its author and collects no telemetry. Account emails appear on usage cards and in the toolbox. MCP environment values and headers are not sent to the app, and the toolbox masks tokens and other secrets it finds in command output.

**Network requests the plugin makes**

- Each additional Claude account's OAuth token goes to `https://api.anthropic.com/api/oauth/usage` to read its limits, at most once a minute per account. Redirects are refused, and the token is not logged, stored or returned to the app.
- The Paseo plugins tab downloads the public catalog from `https://plugins.paseo.sh/index.json`. The app loads plugin icons from the https addresses listed there.
- When a Paseo plugin is installed from npm without an exact version, the preview asks `https://registry.npmjs.org` which version the dist-tag (or `latest`) points to.
- The Panes screen makes none. It reads timelines and parent links, and sends your messages, through the Paseo daemon's own API on the host.

**Commands it runs on the daemon host** (separate processes, no shell, each name, source and option value passed as its own argument)

- Each profile's own CLI with that profile's environment: `claude` (`auth status`, `mcp`, `plugin`, `plugin marketplace`), `codex` (`login status`, `mcp`, `plugin`, `plugin marketplace`) and `agy` (`--version`, `plugin`). Listing runs when a screen opens; changes run only after you confirm. These CLIs may contact their own services, for example to check MCP servers or download plugins.
- Plugin changes: `claude plugin install`, `uninstall`, `enable`, `disable` and `update` (with `-s` for the scope, and `--marketplace` when the marketplace is not added yet) and `claude plugin marketplace add`, `remove` and `update`; `codex plugin add` and `remove` and `codex plugin marketplace add`, `remove` and `upgrade`; `agy plugin install`, `uninstall`, `enable` and `disable`.
- The Paseo CLI for `project ls` and `project delete`, and for its `plugin ls`, `plugin add`, `plugin update` (also with `--check`), `plugin enable`, `plugin disable` and `plugin remove` subcommands. When the daemon sets `PASEO_HOME`, it passes `--home` with it so the commands act on this daemon; otherwise the CLI's default home is used. Git and npm sources are fetched by the Paseo CLI.
- `git ls-remote` against the entered repository, with terminal prompts off, when a Paseo plugin is installed from git with a branch, tag or no ref, to resolve it to one commit for the preview.
- Read-only `git` (`rev-parse`, `worktree list`, `symbolic-ref`, `for-each-ref`) in each session's folder for worktree badges and the default branch. It runs against the session's folder, not any `GIT_DIR` or similar variables set for the daemon, and each folder's answer is reused for a few seconds.
- On macOS, `/usr/bin/security find-generic-password` to read an additional Claude account's login from the Keychain.

**Files it reads**

- `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) to find the configured providers.
- Additional Claude accounts: `.claude.json` in the config directory (email, organization, plan), session logs under `projects/` (token counts only) and, outside macOS, `.credentials.json` for the login.
- Additional Codex accounts: `auth.json` (email and plan, decoded on the host) and session logs under `sessions/` (token counts and limit snapshots).
- Toolbox, Claude Code: `.claude.json` in the profile's config directory (or `~/.claude.json`) and the chat folder's `.mcp.json` (MCP names only); `plugins/known_marketplaces.json` in the config directory and each added marketplace's `.claude-plugin/marketplace.json` (plugin names, versions, authors, homepages, categories, licenses).
- Toolbox, Codex: the chat folder's `.codex/config.toml` (names only).
- Toolbox, Antigravity: `~/.gemini/antigravity-cli/settings.json` and the two `mcp_config.json` files listed below.

**Files it writes**

- `~/.paseo/atrium/project-order.json` (or under `$PASEO_HOME`) for the project and session order. If it does not exist yet, an order saved by an earlier version in `nested-agents/project-order.json` in the same folder is copied there once; the old file is read but left in place.
- The `~/.paseo-chat` folder for General chats.
- Antigravity's `~/.gemini/config/mcp_config.json` or `<project>/.agents/mcp_config.json`, only when you add or remove an Antigravity MCP server.

**Files the CLIs write when you confirm a plugin change** (Atrium does not edit them)

- Claude Code: user scope changes `settings.json` in the profile's config directory, project scope the chat folder's `.claude/settings.json`, local scope its `.claude/settings.local.json`. Installing from a marketplace not added yet also adds it to the profile's user settings. Plugin files go to `plugins` in the profile's config directory.
- Paseo: git and npm plugins are stored in the plugin storage under the daemon's home; a local folder is used where it is.
- Codex and Antigravity store plugins in their own locations.

**Safeguards and limits**

- Before a Paseo plugin is installed, from the catalog or a source, the preview pins it to one git commit or one exact npm version, resolving a branch, tag or dist-tag first. The install uses exactly that.
- An update is pinned the same way to the revision the update check reports. For a plugin installed from the registry, the toolbox shows the update command to run in a terminal instead.
- A preview can be used once within 10 minutes. After that, or if the source or the installed plugin changed, a new preview is needed.
- Entered sources are checked first: no values starting with `-`, https only, no user name or password in URLs, no query or fragment in git URLs, absolute existing local paths, and no `..` in a repository subfolder. Shown URLs omit credentials, query and fragment.
- Usage cards skip accounts Paseo already shows (`~/.claude`, `~/.codex`, or the daemon's own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`), and providers that share a config directory share one card.
- Claude limits come from Anthropic's usage endpoint; accounts that use an API key, a custom base URL, Bedrock, Vertex or Foundry show no limits, and an expired login shows Paseo's re-login prompt.
- Codex limits come from the newest snapshot in local session logs, shown with the time it was recorded; they can be out of date, and a window past its reset time shows 0%.
- Panes show agents of the host the plugin runs on. Agents from other hosts open in Paseo instead.
- Codex MCP servers are user scope only. Signing in to an MCP server happens in the CLI itself; the toolbox shows the command or steps. Antigravity plugins are browsed in Antigravity itself.
