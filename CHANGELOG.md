# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, bug fixes go in a patch release (0.1.x), and new
features or behavior changes go in a minor release (0.2.0).

## [Unreleased]

## [0.2.0] - 2026-11-20

### Added

- Panes screen: open many agent chats side by side. Only the panes near the viewport are mounted and subscribed, so there is no fixed limit on how many can be open.
- Drag a session out of the sidebar to open it as a pane. If the panes screen is closed, it opens with the session added. Sessions can also be opened from a hover button, the long-press menu on mobile, and the Command Center.
- Parent and child sessions are grouped: they sit next to each other, parents first, share a color and a connecting line, and move together. Dropping a parent offers to add its sub-agents that are not open yet.
- A composer in each pane. A message sent while the agent is working is added to the current turn instead of interrupting it, and Enter during IME composition (Korean, Japanese, Chinese) does not send.
- Reorder panes by dragging the grip in the pane header, resize panes from their right edge (double-click resets), and keep both across restarts.
- Plugin RPCs `chat.timelines` (live timelines for many agents), `chat.timeline.older` (older history) and `chat.links` (parent and child links).
- Worktree badges on sidebar sessions: a session in a linked `git worktree` shows its branch, the worktree folder and a color bar shared by every session in that worktree. A session in the main checkout shows its branch only when it is off the default branch or on a detached HEAD. Needs `git` on the daemon host; folders outside git show no badge.

### Fixed

- Light themes whose surface color is not a six-digit hex value (for example `#fff` or `rgb(...)`) were treated as dark.

## [0.1.0] - 2026-11-20

First public release.

### Added

- Agent tree sidebar ("Nested agents"): workspaces and agents shown as a tree, with sub-agents nested under the agent that started them, fold and unfold, provider marks, and status and running counts.
- Project and session ordering by drag and drop on desktop and a long-press menu on mobile. The order is kept on the daemon.
- Removing a project from the sidebar, a pinned General section for conversations outside any project, and archiving a session's workspace when nothing else runs there.
- Usage cards for additional Claude and Codex accounts: plan, limit windows with reset times, and local token totals.
- MCP and plugin toolbox: `/mcp` and `/plugins` screens for Claude Code, Codex, Antigravity and Paseo, with a confirmation that shows the exact command before any change.
- Sidebar and toolbox text in nine languages (English, Korean, Japanese, Simplified Chinese, Spanish, French, Brazilian Portuguese, Russian, Arabic), falling back to English.
- Screenshots, `LICENSE` (MIT) and `README.md`.

### Changed

- Renamed from `paseo-nested-agents` to Atrium (plugin ID `atrium`). The sidebar view is now named Atrium.
- Project and session order is stored in `$PASEO_HOME/atrium/project-order.json`. If that file does not exist, the order from the old `nested-agents/project-order.json` is copied once and the old file is kept.
- Rewrote `OVERVIEW.md` for the plugin listing, including the data access it needs.

### Fixed

- Agents waiting for permission, including sub-agents, are shown in amber and are no longer counted as running.
- The toolbox confirmation shows the full command and no longer repeats warnings.
- Calls to the Paseo CLI pass `--home` explicitly, and displayed paths are shortened to `~` only inside the home folder.

[Unreleased]: https://github.com/Mr-DooSun/atrium/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.2.0
[0.1.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.1.0
