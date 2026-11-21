# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, bug fixes go in a patch release (0.1.x), and new
features or behavior changes go in a minor release (0.2.0).

## [Unreleased]

### Added

- A listing image of the usage cards for additional accounts (`assets/listing-05-usage.jpg`), made from sample data.

### Changed

- A worktree's color bar runs unbroken through consecutive rows in the same checkout, so a run reads as one line instead of dashes. Runs follow the rows as drawn: a row after a parent's last child continues that child, and a collapsed row's hidden children do not count. The full badge shows on the first row of each run; a row in another checkout between two rows breaks the run, and the next one shows the badge again.

### Fixed

- Claude Code messages in the toolbox (missing profile, timeouts, scope and marketplace warnings, sign-in status and MCP sign-in steps) were always shown in Korean. The Claude adapter now sends English like the other adapters, and the app shows them in its own language.
- The Simplified Chinese toolbox used two words for "agent". It now uses one.

## [0.5.0] - 2026-11-22

### Changed

- A worktree badge shows in full once per run of sessions in the same checkout. A row whose parent or the sibling just above it works in the same worktree and branch shows only the badge's icon, in the worktree's color, on its title line. Before, five sub-agents started in one worktree repeated the same badge five times. A row with no badge or icon still means the main checkout on its default branch.

## [0.4.0] - 2026-11-21

### Changed

- With more than one host connected, the Atrium sidebar is split into a section per host, each headed by the host's name, so every project and session sits under the host it runs on. Projects move and drag within their host's section. The host name beside each project header, added in 0.3.2, is replaced by the section headers. With a single host nothing changes.

## [0.3.2] - 2026-11-21

### Fixed

- With more than one host connected, a folder open on two hosts showed as two project blocks with the same name. Each project header now shows its host's name next to the project name, and the menu and remove dialog name the host too. With a single host nothing changes.
- Two hosts' projects in the same folder shared one place in the hand-set order and moved together. The order now keeps each host's project separately. An order saved before this update still applies to every host's project in that folder until you reorder.

## [0.3.1] - 2026-11-21

Listing and documentation update. The plugin's behavior is unchanged.

### Added

- Simplified Chinese listing: `OVERVIEW.zh-CN.md` and a `zh-CN` name and description in the manifest.

### Changed

- Rewrote the marketplace listing (`OVERVIEW.md`) to be shorter, with the data access section grouped by network requests, commands, files and safeguards. It also corrects two errors carried over from earlier listings: the Paseo CLI subcommands Atrium runs (`plugin add`, `project ls`, `project delete`, not `plugin install`), and `/mcp` sign-in, which happens in each CLI with the toolbox showing the steps.
- The one-line description in the manifest and `package.json` now says what the plugin is for instead of listing its features.
- Replaced the listing images with four screenshots of the real interface, taken with sample data (1600x900 JPG): the agent tree with worktree badges, panes, the plugins screen and the command check before a change. The earlier banner and screenshots are removed, and the README uses the new images.

## [0.3.0] - 2026-11-21

### Added

- Plugin icon (`assets/icon.png`) and a store banner (`assets/hero-dark-1600.jpg`). The manifest now sets `icon` and puts the banner first in `media`.
- Plugin store redesign in `/plugins`: cards with icons (initials when a plugin has none), search, category chips, sort options per ecosystem, a Featured badge, and a detail sheet with version, installs, license, scope, source and homepage.
- Clear install states on cards and in the detail sheet: installing, updating, removing, enabling and disabling with a spinner; installed; update available; and failures with Retry and Dismiss. A running action can continue in the background.
- Installed tab filters (All, Updates, Errors, Enabled, Disabled with counts) and a "Needs attention" sort.
- Install from source: Paseo plugins from a git repository (`owner/repo` or https URL, with an optional branch, tag, commit and subfolder), an npm package or a local folder. Antigravity plugins from a GitHub https URL or a local folder. Claude Code plugins from a marketplace that has not been added yet.
- Install scopes (user, project, local) for Claude Code plugins.
- Previews before adding, removing or updating a marketplace.
- Catalog metadata: author, version, installs, license, featured, updated date, categories and update availability.

### Changed

- A pane whose live updates stopped (daemon restart, lost connection) now reconnects by itself shortly after its host is back online, instead of waiting for the retry button. If that retry fails too, the button stays until the next reconnect.
- A source install is pinned at preview time (git refs to a commit, npm tags to an exact version) and runs only with that single-use preview, within 10 minutes, so it installs exactly what was shown.
- Claude Code marketplace sources must be `owner/repo`, an https or `git@` URL, or an absolute path. Relative paths such as `./foo` are now rejected.
- Commands and errors shown in the app no longer include credentials, query strings or fragments from URLs.
- More natural wording in every toolbox language, including French typography (no-break spaces before `:`, `;`, `?` and `!`) and consistent terms in Russian and Japanese.
- Reworded the General and panes screen text in every non-English language to read like native app text: Korean, Japanese and Simplified Chinese now use one word for "pane" as the sidebar does, French uses its spacing rules and apostrophes, and dashes in sentences are replaced by normal punctuation.

### Fixed

- Panes screen text was only translated into English, Korean and part of Japanese. It is now available in all nine languages the sidebar supports.
- Pane rows no longer show English text made on the server: tool calls show the tool name once with a translated status, and context compaction, plugin and unknown rows are translated in the app. Raw error messages are logged instead of shown.
- Separate assistant replies loaded from history were joined into one paragraph. Only live streaming pieces of the same reply are joined now.
- After a reconnect, retrying a pane keeps the history already loaded, clears the old error, and ignores late events from the previous subscription. While the server is reconnecting by itself, a pane that already shows messages says so instead of offering a retry button.
- Reordering or resizing a pane in the web app was silently cancelled when text was selected on the page.
- A closed pane's width came back when the same session was reopened before a restart. Sessions whose parent links form a loop could disappear from the panes screen.
- Worktree badges disappeared with git older than 2.36.
- With more than one host connected, a remote session could show the worktree badge of a local folder with the same path. Badges are now looked up per host, and are not shown when the plugin cannot tell which host it runs on.
- The Claude Code installed list showed project and local installs from every project on the machine, often many times over. It now shows user-wide installs, plus the project and local installs of the open project, and the catalog marks a plugin installed only on that basis.

## [0.2.1] - 2026-11-21

### Fixed

- Managed installs and updates now build without local development dependencies.

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

[Unreleased]: https://github.com/Mr-DooSun/atrium/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.5.0
[0.4.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.4.0
[0.3.2]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.3.2
[0.3.1]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.3.1
[0.3.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.3.0
[0.2.1]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.2.1
[0.2.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.2.0
[0.1.0]: https://github.com/Mr-DooSun/atrium/releases/tag/v0.1.0
