Atrium changes how you work across many agents in Paseo. It adds three things: a sidebar that shows workspaces and agents as a tree, usage cards for additional Claude and Codex accounts, and `/mcp` and `/plugins` screens for managing MCP servers and plugins in every configured agent CLI.

## Agent tree sidebar

Choose it under Settings, Sidebar, Sidebar view, "Atrium". It replaces the sidebar list with a tree built from Paseo's parent agent records. A sub-agent that runs in its own worktree workspace is shown under the agent that started it, at any depth, instead of as a separate top-level row. Agents in the same workspace are nested under their parent agent. A workspace with a single root agent shows that agent's children directly under the workspace row.

Each workspace row keeps its status, branch and diff counts, and shows how many agents below it are running. A running workspace or agent has a spinning ring; agents waiting for permission are amber and failed ones red. Each row starts with its provider's mark (Claude Code, Codex, Antigravity; a custom provider that extends one uses its mark) and ends with its status. Rows fold and unfold, and a folded row shows how many entries it hides. Hovering a workspace row shows a pencil to give it a display name; the name is saved as the workspace's Paseo title, so other clients show it too, and an empty name goes back to the folder name.

Worktrees:

- Session rows, and workspace rows that hold a single agent, show which git worktree and branch the session works in, so when you split work across several `git worktree` checkouts you can tell at a glance which session runs where. Where a badge shows, it takes the place of Paseo's gray branch line.
- A session in a linked worktree shows a folder icon, its branch and the worktree's folder name, with a thin bar in the worktree's color on the row's left edge. Every row in the same worktree gets the same color and look, whatever kind of row it is and wherever it sits in the tree; the order does not change. A long branch name is cut short, while the folder name keeps its width up to a limit.
- A session in the project's main checkout shows no badge while it is on the default branch (the remote's `origin/HEAD`, otherwise a local `main`, then `master`), or when no default branch can be found. On any other branch it shows only the branch, in muted gray. A detached HEAD shows the short commit hash followed by "detached", in a linked worktree or the main checkout; the hash always stays visible, and in a narrow sidebar the word "detached" is cut short first.
- The full worktree path is in the accessibility label read by screen readers; there is no hover tooltip. Branches are checked again every 20 seconds, so a session that switches branch updates on its own. A folder outside git, a missing folder, or a host without `git` shows no badge.

Projects:

- A project stays in the tree after its last session is archived, with a row to start a new chat in it.
- Hovering a project header shows a button to remove it from Paseo (a long press on mobile). After a confirmation that counts its sessions and any still running, its sessions are archived and its files stay on disk. Adding the folder in Paseo again brings it back.
- Archiving a session also archives its workspace when nothing else runs there.

Ordering:

- Projects are listed most recent work first until you set your own order.
- On desktop, drag a project header and drop it where a line shows; a click still folds it. Sessions drag the same way among the sessions beside them, at any depth, and carry the sessions under them. Holding the pointer near the top or bottom edge scrolls the list.
- On mobile, a long press on a project header opens a menu with reordering and removing. Reordering gives every header up and down buttons, and Done ends it.
- The order is kept on the daemon by folder, so every client shows it and a project added again keeps its place. A project not placed yet shows at the top, and Reset goes back to most recent first. New top sessions show first and new sub-sessions last.

A General section stays pinned at the bottom of the sidebar for conversations that belong to no project. Paseo agents always run in a folder, so these run in `~/.paseo-chat` on the daemon, which the plugin creates on first use; that folder's workspaces are left out of the tree. The new chat button opens Paseo's own new workspace screen for that folder, so the provider picker works as usual.

Background helpers and closed agents are hidden. Fold state is not saved across reloads. Sidebar labels are available in English, Korean, Japanese, Simplified Chinese, Spanish, French, Portuguese (Brazil), Russian and Arabic, following the app language, and fall back to English.

## Usage for additional accounts

Paseo's built-in usage panel shows the default Claude and Codex accounts. Atrium adds a card for each other Claude or Codex account that is configured as a Paseo provider, such as a custom provider that extends `claude` with its own `CLAUDE_CONFIG_DIR`. Providers that share a config directory share one card. Accounts that Paseo already shows (`~/.claude`, `~/.codex`, or the daemon's own `CLAUDE_CONFIG_DIR` or `CODEX_HOME`) are not repeated.

Each card shows the plan, the 5-hour, weekly and model-specific limit windows with reset times, the account email when it is known, and local token totals for the current 5-hour window, today and the last 7 days.

- Claude limits come from Anthropic's usage endpoint for that account and are refreshed at most once a minute per account. A profile that authenticates through an API key, a custom base URL, Bedrock, Vertex or Foundry shows no limits.
- Codex limits come from the newest snapshot in the account's local session logs, with the time it was recorded. They can be out of date, and a window whose reset time has passed shows 0%.
- An expired or rejected Claude login shows Paseo's own re-login prompt on its card.

More detail is in [the usage monitor notes](https://github.com/Mr-DooSun/atrium/blob/main/docs/usage-monitor.md).

## MCP and plugin toolbox

In an agent chat, `/mcp` and `/plugins` (or `/plugin`) open full screens, and the Command Center has matching items. These commands take the place of the providers' own `/mcp` and `/plugin` commands inside Paseo.

- `/mcp` lists the MCP servers of a profile with their scope and status, and adds, removes or signs in to servers. `/mcp <profile>` opens another profile than the chat's own.
- `/plugins` has tabs for Paseo, Claude, Codex and Antigravity. It lists installed plugins and marketplace catalogs, and installs, removes, enables, disables and updates plugins. `/plugins claude` opens a tab directly.
- Every profile works separately. A custom provider such as `claude-work` with its own config directory is its own profile, so each account has its own servers and plugins. When a tab has several profiles, you can run one change on several of them at once.
- Every change shows a confirmation first, listing the exact command for each profile, its source, and any warnings. Nothing changes until you confirm.

Support differs by CLI:

| | MCP servers | Plugins |
| --- | --- | --- |
| Claude Code | List, add, remove | Catalog, install, remove, enable, disable, update; add, remove and update marketplaces |
| Codex | List, add, remove (user scope); shows the sign-in command to run in a terminal | Catalog, install, remove; add, remove and update marketplaces |
| Antigravity | List, add, remove by editing its documented `mcp_config.json` | Installed plugins, install, remove, enable, disable; browsing happens in Antigravity itself |
| Paseo | — | Registry catalog, installed plugins, install, remove, enable, disable, update |

The toolbox screens use the same nine languages as the sidebar, following the app language.

## Setup

Requires Paseo 0.16.1 or later. Dragging to reorder is desktop only; mobile uses the long-press menu. The toolbox uses the agent CLIs installed on the daemon host (`claude`, `codex`, `agy`) and the `paseo` CLI; a CLI that is not installed shows as not installed. Worktree badges use `git` on the daemon host and are left out when it is missing. Usage cards need nothing beyond an account that is configured as a Paseo provider and logged in.

## Data access

Atrium runs on the daemon host with your user's permissions. It sends nothing to its author and collects no telemetry.

Network requests made by the plugin itself:

- For each additional Claude account, the account's OAuth access token is sent to `https://api.anthropic.com/api/oauth/usage` to read its limits. Redirects are refused, and the token is not logged, stored or returned to the app.
- The Paseo plugins tab downloads the public catalog from `https://plugins.paseo.sh/index.json`.

Commands it runs on the daemon host (as separate processes, without a shell):

- Each profile's own CLI with that profile's environment: `claude` (`auth status`, `mcp`, `plugin` and `plugin marketplace` commands), `codex` (`login status`, `mcp`, `plugin` and `plugin marketplace` commands) and `agy` (`--version`, `plugin` commands). Listing commands run when a screen opens; changes run only after you confirm. These CLIs may contact their own services, for example to check MCP servers or download plugins.
- The `paseo` CLI to list projects, remove a project, and list, install, update, enable, disable and remove Paseo plugins.
- `git` (`rev-parse`, `worktree list`, `symbolic-ref` and `for-each-ref`) in each session's folder to show its worktree and branch in the sidebar and to find the default branch. These are read-only, run against the session's folder rather than any `GIT_DIR` or similar git variables set for the daemon, and each folder's answer is reused for a few seconds.
- On macOS, `/usr/bin/security find-generic-password` to read an additional Claude account's login from the Keychain.

Files it reads:

- `~/.paseo/config.json` (or `$PASEO_HOME/config.json`) to find the configured providers.
- For each additional Claude account: `.claude.json` in its config directory (email, organization, plan), session logs under `projects/` (token counts only), and, outside macOS, `.credentials.json` for the login.
- For each additional Codex account: `auth.json` (email and plan, decoded on the host) and session logs under `sessions/` (token counts and limit snapshots).
- For the toolbox: Claude's `.claude.json`, `.mcp.json` in the chat's folder and the plugin marketplace files in the Claude config directory (names only); `.codex/config.toml` in the chat's folder (names only); Antigravity's `settings.json` and `mcp_config.json` files.

Files it writes:

- `~/.paseo/atrium/project-order.json` (or under `$PASEO_HOME`) for the project and session order. If that file does not exist yet, an order saved by an earlier version in `nested-agents/project-order.json` in the same folder is copied there once; the old file is read but left in place.
- The `~/.paseo-chat` folder for General chats.
- Antigravity's `~/.gemini/config/mcp_config.json` or `<project>/.agents/mcp_config.json`, only when you add or remove an Antigravity MCP server.

Account emails appear on usage cards and in the toolbox's profile status. MCP environment values and headers are not sent to the app, and the toolbox masks tokens and other secrets it finds in command output.
