# Toolbox: /mcp and /plugins for Paseo (all-in-one plugin)

Goal: inside Paseo, `/mcp` and `/plugins` work like Claude Code's and Codex's own commands, for every
agent CLI and every account (profile): see status, browse marketplaces, install and manage. They
intentionally shadow the providers' own `/mcp` and `/plugin(s)` in Paseo.

## Concepts
- **Profile** = one Paseo provider of kind claude / codex / antigravity, including custom providers
  that `extends` one (e.g. `claude-pb1` with its own `CLAUDE_CONFIG_DIR`). Discovered from Paseo config
  in `server/core/profiles.ts`. Every CLI call for a profile must use `runtime.command` and
  `runtime.env` (that is what makes multi-account work).
- **Ecosystem** = paseo | claude | codex | antigravity (whose plugins).

## Ownership (do not edit files you do not own)
| Path | Owner |
| --- | --- |
| `shared/toolbox/*`, `server/core/*`, `server/toolbox.ts`, `index.*.ts(x)`, `docs/toolbox-plan.md` | orchestrator |
| `server/adapters/claude/*`, `tests/claude-*.test.ts` | worker: claude adapter |
| `server/adapters/codex/*`, `server/adapters/paseo/*`, `tests/codex-*.test.ts`, `tests/paseo-*.test.ts` | worker: codex + paseo adapters |
| `client/toolbox/*` | worker: UI |
| `server/adapters/antigravity/*`, `docs/antigravity.md`, `tests/antigravity-*.test.ts` | worker: antigravity |
| existing sidebar files (`client/nested-sidebar.tsx`, `client/look.ts`, `client/archive.tsx`, `client/provider-icons.ts`, `shared/tree.ts`) | orchestrator; UI worker may import, not edit |

Need a contract change? Do not edit it; describe the change in your final report.

## Safety rules (hard)
- Real user config is read-only. Allowed on real config: list/status/get/help commands only.
- Any add/remove/install/enable/disable test runs against a throwaway home:
  `CLAUDE_CONFIG_DIR=$(mktemp -d)`, `CODEX_HOME=$(mktemp -d)`. Never against `~/.claude*`, `~/.codex`.
- Never run `paseo plugin install|remove|enable|disable|update|reload` and never edit `~/.paseo`.
- Never install a third-party plugin, even in a temp home. Parse install output from `--help` and
  docs; mark install paths as verified-by-typecheck only.
- Never print or store tokens, API keys, or account emails. Test fixtures must be scrubbed
  (replace emails with `user@example.com`).
- Never run commands that open a browser or wait for interactive input.

## Rules for code
- Run CLIs only through `server/core/exec.ts` (`run`, argv only, no shell strings).
- Every mutating action returns `CommandResult` with the exact argv in `command`; `previewAction` /
  `previewMcpAdd` return the same argv without running anything, plus `source` and `warnings`.
- Parse JSON output when the CLI offers it (`--json`); otherwise parse text defensively and keep
  unknown lines out rather than guessing.
- `npm run typecheck` must pass. Unit tests: `node --test tests/<file>.test.ts` with fixtures.
- Client code: React Native primitives only, colors from theme (see `client/look.ts`), no DOM.

## Decisions (orchestrator)
- File-edit actions (adapters that change a config file instead of running a CLI) report
  `command: ["write-file", <absolute path>]`. UI shows it as "edits <path>" instead of a shell line.
- Antigravity: no CLI marketplace browsing. `listCatalog` returns the official marketplace entry and
  installed plugins; UI shows that browsing happens inside `agy` (`/plugin`). Multi-account for
  Antigravity is not supported (no documented config-home variable); profiles still work per provider.
- `exec.run` takes `maxOutputBytes` (default 2 MiB) and reports `truncated`; `failure()` treats a
  truncated run as an error. Raise the cap for large JSON (Claude's catalog is ~2.4 MB).
- `listCatalog` RPC returns at most `CATALOG_LIMIT` (200) plugins plus `total`; the cut happens in
  `server/toolbox.ts`, adapters return all matches for the query. Adapters should cache catalogs
  (~5 min) since listing is slow.
- `runMarketplaceAction.source`: the source for "add", the marketplace name for "remove"/"update".
- `MCP_SCOPES` (shared/toolbox/types.ts) lists the scopes each CLI accepts; codex has none (null).
- Previews for removeMcp / loginMcp / marketplace actions: not in the contract yet; the UI shows a
  plain confirmation and the exact argv appears in the result.
- MCP OAuth login: v1 returns `ok: false` with the terminal command to run (Claude `/mcp`, Codex
  `codex mcp login`). In-app completion needs a long-running exec with streamed output and stdin for
  the callback URL — follow-up.

## Review round 1 decisions (orchestrator)
- ProfileRuntime has `args` (leading args of the provider command). Use `runProfile(profile, args, opts)`
  and `argvOf(profile, args)` from server/core/run-profile.ts everywhere instead of `run(profile.command, ...)`.
  Custom providers inherit command/env from the provider they extend.
- `exec.run` spawns in its own process group, kills the group on timeout and always resolves.
- Plugin RPCs carry `cwd` (agent project). Adapter plugin methods get it as a trailing optional param.
- `ECOSYSTEM_CAPS` (shared/toolbox/types.ts): UI hides unsupported actions.
- Never open a browser on the daemon host. If an add triggers OAuth, stop on a short timeout and
  return guidance to run the CLI's login in a terminal.
- Follow-ups (not in v1): preview tokens so a run executes exactly the previewed plan when several
  previews are open; in-app MCP OAuth; Codex HTTP MCP add in-app (Codex 0.167 may open a browser).

## Review round 2 decisions (orchestrator)
- `server/toolbox.ts` validates every incoming cwd with `checkedCwd` (absolute, existing directory) before
  adapters see it; adapters can trust a non-null cwd.
- `exec.run`: settles ~1.5s after `exit` even if a grandchild holds the pipes; grace timers are cleared on
  settle; stdin errors are swallowed.
- When cwd is null, CLIs must run in the user's home directory, never the daemon's cwd.
- Secret masking only masks values of 4+ characters (avoid hiding `-y`, `serve`).
- Sidebar (2026-11-19): parentage only counts inside one project. A session started from another
  project's session is a root of its own project (same as the Agent Team plugin), so each project
  shows its own work. Test: tree.test.ts "a child started from another project's session…".
- Plugins (2026-11-19): installed lists are sorted by name in server/toolbox.ts. `InstalledPlugin.updateTo`
  comes from optional `adapter.checkUpdates` (paseo: `plugin update --all --check --json`, 10-min cache;
  claude: marketplace manifest version vs installed version, only when the manifest declares one; codex,
  antigravity: none). UI shows the update button only when `updateTo` is set.
- Codex `plugin list --available` is ~6 MB: read with a 64 MiB cap, cached 5 min, cleared on changes.

## Multi-profile view and bulk apply (2026-11-19, spec by orchestrator)
MCP servers and CLI plugins live per profile (CLAUDE_CONFIG_DIR / CODEX_HOME), except Claude
project-scope MCP (`.mcp.json` in the repo, shared by all profiles) and Paseo plugins (one daemon).
Antigravity has no profiles beyond the provider entry.
- Profile switcher gets an "전체" (all) option for each kind. Default stays the opening chat's profile.
- All view: one row per server name / plugin id, with a per-profile presence+status strip (profile
  mark + short label + status dot). Project-scope servers render once, tagged "공유 (project)".
  Rows missing from some profiles get "나머지 계정에도 추가/설치".
- Bulk actions: add server, install/uninstall/enable/disable/update plugin, remove server take a
  target-profile multi-select (default: all logged-in profiles of that kind; logged-out/not-installed
  shown disabled). The confirm modal lists one exact argv per profile (previews run per profile);
  run sequentially, stop nothing on one failure, show per-profile results; reload offer covers all
  touched profiles.
- "나머지 계정에도 추가" for MCP needs the server's full definition, which list output does not give
  (secrets are never returned). v1: prefill the add form with name/transport/target and require the
  user to re-enter env/header values; say so in the form.
- No contract change: the client composes per-profile RPCs. Queries per profile run in parallel,
  each with its own loading state; the all view renders as profiles arrive.
- Codex project MCP (verified 2026-11-19 in temp homes): a trusted project's `.codex/config.toml`
  `[mcp_servers.*]` is merged into `codex mcp list` when run in that project. The adapter tags those
  names `scope: "project"` (read-only parse of that file) and the rest `user`; the CLI can only
  add/remove user-level servers, so project ones are list-only.
- Scope data (2026-11-19): Claude `mcp list` has no scope, so the adapter reads server NAMES only from
  `<config>/.claude.json` (user = top level, local = projects[cwd]) and `<cwd>/.mcp.json` (project);
  `plugin:` names → plugin, `claude.ai ` names → "claude.ai" (account connectors). `InstalledPlugin.scope`
  added (claude from `plugin list --json`: user/project/local/synced; codex: user).
- RULE (2026-11-19): plugin screens (`addScreen`) and their modals have NO plugin state host —
  `useAgent/useAgents/useWorkspace(s)/useProject(s)/useTerminal(s)` throw "Plugin state hooks must run
  inside a plugin host" and break the whole screen. In client/toolbox use `usePaseo()` SDK calls with
  react-query, or pass data via screen params. State hooks are fine in the sidebar view.
