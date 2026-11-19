# Antigravity CLI (`agy`) notes

Legend: **[docs]** = stated in official docs (fetched as markdown, 2026-11-19). **[3p]** = third-party blogs only.
**[assumed]** = my inference. The CLI is not installed here, so nothing below was run.

## Findings
| Topic | Finding | Source |
| --- | --- | --- |
| Binary | `agy`. Installer: `curl -fsSL https://antigravity.google/cli/install.sh \| bash`; default `~/.local/bin/agy` (Windows `%LOCALAPPDATA%\agy\bin`). `agy --version` exists. [docs] | https://antigravity.google/docs/getting-started.md |
| Paseo launch | Paseo runs your installed `agy`, overridable via `agents.providers.antigravity.command` / `env` in `~/.paseo/config.json`; starts it with `--dangerously-skip-permissions`. Paseo source not read (GitHub API needs auth). [docs] | https://paseo.sh/docs/supported-providers/antigravity.md |
| Login status | **No non-interactive status command documented.** Sign-in is the OS keyring (silent) or a browser flow; `/logout` is a TUI command. Only checkable signals: `modelProvider: "gemini"` in `~/.gemini/antigravity-cli/settings.json` + `GEMINI_API_KEY` env (API-key mode), `AGY_ADC_AUTH=true` (ADC). [docs] | https://antigravity.google/docs/install.md |
| Multi-account | **No documented config-home env var.** All config lives under `~/.gemini/...`. Overriding `HOME` per profile would probably isolate accounts (keyring behaviour on macOS unknown). [assumed] | settings.md, install.md |
| Config paths | Settings `~/.gemini/antigravity-cli/settings.json`; MCP global `~/.gemini/config/mcp_config.json`, workspace `<ws>/.agents/mcp_config.json`; plugins `~/.gemini/config/plugins/<name>/` or `<ws>/.agents/plugins/`. Older 3p guides cite `~/.gemini/antigravity-cli/mcp_config.json` (outdated). [docs] | https://antigravity.google/docs/settings.md |
| MCP management | Docs describe only the `/mcp` TUI overlay (status, reload, logs) and editing `mcp_config.json`. `agy mcp add/remove/list/enable/disable` appears **only in 3p cheat sheets**, not official docs → not used. | https://antigravity.google/docs/mcp.md ; 3p: https://computingforgeeks.com/antigravity-cli-cheat-sheet/ |
| MCP file format | `{"mcpServers": {name: {command,args,env,cwd} \| {serverUrl\|url, headers}, + disabled, enabledTools, disabledTools, tools, timeoutSeconds, authProviderType, oauth}}`. Remote = Streamable HTTP only (no SSE, no `httpUrl`). OAuth runs in browser on connect. [docs] | mcp.md |
| Plugins | Shell: `agy plugin install <name>[@antigravity-plugins-official] \| <github-url> \| <local-dir>`, `uninstall <name>`, `enable <name>`, `disable <name>`, `list [--json]`, `import [gemini\|claude]`, `validate`. Only marketplace: `antigravity-plugins-official` (needs sign-in). No documented update or marketplace add/remove/browse-from-shell (browse = `/plugin` Discover tab or App). `list --json` = array of `{name,enabled,version,source,path,skills[],agents[],rules[],mcpServers[],hooks[]}`. Plugins with required variables install disabled. [docs] | https://antigravity.google/docs/plugins.md , marketplace.md |
| Headless | `agy -p "prompt" [--output-format json]`, `agy models`, `agy agents`. [docs] | cli/headless.md |

## What the adapter does (`server/adapters/antigravity/`)
- `defaultCommand` `agy`; `configHomeEnv` `null` (nothing documented). Config paths use `profile.env.HOME` if set, else the daemon's home [assumed isolation].
- `auth`: runs `agy --version`; spawn error → `not_installed`. Else `logged_in` (api_key / adc) from the documented signals, otherwise `unknown`. Never reports tokens or accounts.
- `listMcp`: reads global + workspace `mcp_config.json` (read-only, tolerant of missing/invalid files); status `disabled` or `unknown` (no live status outside the TUI); env/headers never returned, URL query/userinfo stripped. Adds plugin-bundled server names from `agy plugin list --json`.
- `previewMcpAdd` / `addMcp` / `removeMcp`: edit the documented file (atomic write, preserves other keys, refuses duplicates and unparsable files, SSE refused). `command` in results is `["write-file", <path>]` since there is no CLI argv. Scope: null/user/global → global, project/workspace/local → `<cwd>/.agents`.
- `loginMcp`: returns an explanatory error (no CLI command; OAuth is automatic on connect).
- `listInstalled`: `agy plugin list --json`, falling back to the documented text form; `[]` when missing.
- `listCatalog`: no documented listing command → only installed plugins plus the official marketplace entry.
- `previewAction` / `runAction`: install/uninstall/enable/disable map to `agy plugin ...`; `update` unsupported; ids starting with `-` or containing whitespace refused. `runMarketplaceAction`: unsupported.

## Unverified
Everything at runtime (output formats of `--version` and `plugin list`, exit codes, whether `agy plugin list --json` includes `mcpServers`, keyring/HOME isolation). Parsers are tested only against doc examples.
