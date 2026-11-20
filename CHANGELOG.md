# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, bug fixes go in a patch release (0.1.x), and new
features or behavior changes go in a minor release (0.2.0).

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

[0.1.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.1.0
