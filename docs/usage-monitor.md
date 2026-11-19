# Multi-account Claude and Codex usage monitor

Complements Paseo's built-in usage indicator (bottom-left), which shows only the default account. This plugin detects every Claude and Codex account on the host and displays their rate limits, local token usage, and account identity.

## How accounts are detected

### Claude accounts

Accounts are discovered from Paseo's providers configured as `kind: "claude"`:
- Built-in `claude` provider
- Custom providers that extend `claude` (e.g., `claude-pb1`, `claude-pb5`)

Each provider's configuration directory (set via `CLAUDE_CONFIG_DIR` environment variable, or defaults to `~/.claude`) is canonicalized and deduplicated—multiple profiles pointing to the same directory share one account row.

Account identity (email, organization, subscription type) is read from:
- `<configHome>/.claude.json` (where `configHome` is the provider's canonical config directory)
- If no config directory is configured for the provider, also tries `~/.claude.json`

The first file that exists and parses successfully is used; identity is optional.

### Codex accounts

Accounts are discovered from Paseo's providers configured as `kind: "codex"`. Each provider's configuration directory (set via `CODEX_HOME` environment variable, or defaults to `~/.codex`) is canonicalized and deduplicated—multiple profiles pointing to the same directory share one account row.

Account identity (email and plan type only) is decoded locally from `<configHome>/auth.json`, extracting the `id_token` JWT and parsing its claims. Identity is optional and tokens are never returned or logged.

## Where data comes from

### Claude: Rate limits (Anthropic API)

The OAuth token for the account is retrieved from:
- **macOS**: Keychain service name `Claude Code-credentials` (or hashed variant per config dir)
- **Other platforms**: `.credentials.json` in the account's credential directory

The token is sent to `GET https://api.anthropic.com/api/oauth/usage` for that specific account via the `Authorization: Bearer` header. Redirects are blocked. The token is never logged, stored, cached, or returned. Expired tokens cause the account to show an `expired` state; re-login is required. Results are cached in memory for 60 seconds; `429 Retry-After` headers are honored. The request times out after 8 seconds.

Rate limit windows include:
- **5-hour window**: Anthropic's 5-hour rate-limit utilization % for this account (may be omitted if no recent use)
- **7-day window**: One for all-model usage, plus model-scoped limits for specific models
- **State codes**: 
  - `ok`: Rate limits available
  - `expired`: OAuth token expired
  - `unauthenticated`: No login found
  - `unavailable`: Credentials could not be read, Anthropic throttled the request, or OS error
  - `error`: Malformed credentials or API error

### Claude: Local token totals

Token usage over the last 7 days is aggregated from JSONL log files at `<configDir>/projects/**/*.jsonl`. Each log entry records message ID, request ID, timestamp, and token counts (input, output, cache creation, cache read). Duplicates across streaming snapshots are deduplicated by ID, keeping the earliest timestamp and cumulative token maxima. Local usage is bucketed into:
- **5-hour window**: Tokens since the start of the current 5-hour rate-limit window (derived from its reset time), or the last 5 hours if unknown
- **Today**: Midnight to now in the account's local timezone
- **7-day window**: Last 7 calendar days
- **State codes**: 
  - `ok`: Logs readable
  - `partial`: Some logs could not be read
  - `unavailable`: Projects directory not found

### Codex: Local session logs and rate limits

Rate limits and local token usage are both sourced from Codex session logs at `<configHome>/sessions/**/*.jsonl`. No network requests are made; tokens are never sent anywhere. The rate limits are a snapshot recorded in the last session's `token_count` event (timestamp shown as `observedAt`). Limits are potentially stale: once the recorded reset time has passed, utilization is reported as 0%.

Token usage over the last 7 days is aggregated from `token_count` events, which record message ID, timestamp, token counts (input, output, cache-read, reasoning), and cumulative totals. Duplicates across forked sessions are deduplicated by cumulative key. Local usage includes:
- **5-hour window**: Tokens since the start of the current 5-hour rate-limit window (or last 5 hours if unknown)
- **Today**: Midnight to now in the account's local timezone
- **7-day window**: Last 7 calendar days
- **Token fields**: input, output, reasoning, and cache-read (which is a subset of input for Codex)
- **State codes**:
  - `ok`: Logs readable
  - `partial`: Some logs could not be read
  - `unavailable`: Sessions directory not found

Rate limit windows include 5-hour (300 min) and 7-day (10,080 min) slots, plus custom windows. Utilization is measured in percentage.

## States and warning levels

Each account shows a warning level based on its rate-limit utilization:

| Level | Condition |
|-------|-----------|
| `unknown` | No rate-limit data, or the account is not in an `ok` state |
| `ok` | Highest utilization < 80% |
| `warn` | Highest utilization 80–95% |
| `critical` | Highest utilization ≥ 95% |
| `limited` | Any window at 100% utilization or status rejected |

Rate-limit state meanings and actions:

| State | Meaning | Action |
|-------|---------|--------|
| `ok` | Rate limits retrieved | Display usage percentage |
| `expired` | OAuth token expired | Re-login with this account's `claude` command |
| `unauthenticated` | No Claude OAuth login found | Log in via `claude` |
| `unavailable` | Credentials could not be read; Anthropic throttled; or OS error | Retry; check system keychain or `.credentials.json` |
| `error` | Credentials malformed or API returned an error | Show the error message; retry |

## Where it shows up

The plugin registers two usage sources ("claude-profiles" and "codex-profiles") that add account cards to Paseo's built-in usage panel. Only accounts not already shown by Paseo (i.e., not the default `~/.claude`/`~/.codex` or the daemon's `CLAUDE_CONFIG_DIR`/`CODEX_HOME`) are displayed. Each card shows the plan, 5-hour/weekly/model-scoped rate-limit windows with utilization %, reset times, email (if available), and local token totals for 5-hour, today, and 7-day windows (including reasoning tokens for Codex). For Codex accounts, the rate-limit snapshot timestamp is shown. Cards from expired or rejected accounts carry a `refreshedBy` hint so Paseo shows its own re-login prompt.

Paseo caches usage data for approximately 5 minutes.

## Privacy

**Claude accounts**: OAuth tokens are read from the OS keychain or local credentials file and transmitted only to `GET https://api.anthropic.com/api/oauth/usage` for that account; never logged, stored, cached, or returned by this plugin.

**Codex accounts**: Rate limits and tokens are read from local session logs only; no network requests are made. The `id_token` JWT is decoded locally to extract email and plan; tokens are never returned or logged.

All local token logs are read from the host filesystem only; they are aggregated in memory and never sent anywhere.

## Replacing zerosub

zerosub's exact feature set has not been verified against this plugin. This monitor detects every Claude and Codex account on the host and displays their rate limits, local usage, and account identity. To migrate:

1. Enable this monitor in Paseo plugin settings
2. Verify all accounts appear and their data looks correct
3. Disable or uninstall zerosub
