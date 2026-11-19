import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCodexAccounts, detectClaudeAccounts, parseCodexIdentity } from "../server/usage/accounts.ts";
import {
  codexRateLimits, createCodexUsageReader, parseCodexRateWindows, parseCodexTokenCountLine, readCodexRollout,
} from "../server/usage/codex-usage.ts";
import { createUsageService } from "../server/usage/service.ts";
import { AccountUsage, LocalUsage, RateLimits } from "../shared/usage/types.ts";

const H = 3_600_000;
const NOW = new Date(2026, 0, 10, 15, 0, 0).getTime();
const TODAY = new Date(NOW).setHours(0, 0, 0, 0);
const iso = (t: number) => new Date(t).toISOString();
const sec = (t: number) => Math.floor(t / 1000);

// ---------- identity / detection ----------
const ACCESS = "ACCESS-TOKEN-SECRET", REFRESH = "REFRESH-TOKEN-SECRET", API_KEY = "sk-OPENAI-SECRET";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: unknown) => `${b64({ alg: "none" })}.${b64(claims)}.SIGNATURE-SECRET`;
const authJson = (claims: unknown = { email: "c@x.com", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }) => ({
  OPENAI_API_KEY: API_KEY,
  tokens: { id_token: jwt(claims), access_token: ACCESS, refresh_token: REFRESH, account_id: "acct-1" },
});
function noSecrets(v: unknown) {
  const s = JSON.stringify(v) ?? "";
  for (const secret of [ACCESS, REFRESH, API_KEY, "SIGNATURE-SECRET", "acct-1"]) assert.ok(!s.includes(secret), secret);
}
function prof(id: string, kind: string, configHome?: string, env?: Record<string, string>) {
  return { profile: { id, label: id, kind }, runtime: { configHome, env } } as never;
}
const base = { home: "/home/u", cwd: "/work", env: {} as NodeJS.ProcessEnv, realpath: async (d: string) => d };
const fileMap = (m: Record<string, unknown>) => async (f: string) => {
  if (!(f in m)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return typeof m[f] === "string" ? (m[f] as string) : JSON.stringify(m[f]);
};

test("parseCodexIdentity extracts email and plan and never tokens", () => {
  const id = parseCodexIdentity(authJson());
  assert.deepEqual(id, { email: "c@x.com", subscriptionType: "plus" });
  noSecrets(id);
  assert.deepEqual(parseCodexIdentity(authJson({ email: "only@x.com" })), { email: "only@x.com", subscriptionType: undefined });
  assert.deepEqual(parseCodexIdentity(authJson({ "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })),
    { email: undefined, subscriptionType: "pro" });
});

test("parseCodexIdentity rejects malformed input", () => {
  for (const v of [null, {}, [], "x", { tokens: null }, { tokens: { id_token: 5 } }, { tokens: { id_token: "a.b" } },
    { tokens: { id_token: "a.b.c.d" } }, { tokens: { id_token: "a.!!!.c" } }, { tokens: { id_token: `a.${b64("str")}.c` } },
    { tokens: { id_token: `a.${Buffer.from("{bad").toString("base64url")}.c` } },
    { tokens: { id_token: jwt({}) } }, { tokens: { id_token: jwt({ email: "  " }) } }]) {
    assert.equal(parseCodexIdentity(v), undefined, JSON.stringify(v));
  }
});

test("detectCodexAccounts: default ~/.codex, CODEX_HOME env, runtime configHome, profile env", async () => {
  const readFile = fileMap({
    "/home/u/.codex/auth.json": authJson(),
    "/tmp/cx1/auth.json": authJson({ email: "one@x.com" }),
  });
  const accounts = await detectCodexAccounts([
    prof("codex", "codex"),
    prof("codex-1", "codex", "/tmp/cx1"),
    prof("codex-2", "codex", undefined, { CODEX_HOME: "/tmp/cx2" }),
    prof("claude", "claude"), prof("agy", "antigravity"),
  ], { ...base, readFile });
  assert.deepEqual(accounts.map((a) => [a.provider, a.configHome, a.profileIds]), [
    ["codex", "/home/u/.codex", ["codex"]], ["codex", "/tmp/cx1", ["codex-1"]], ["codex", "/tmp/cx2", ["codex-2"]],
  ]);
  assert.equal(accounts[0].identity?.email, "c@x.com");
  assert.equal(accounts[1].identity?.email, "one@x.com");
  assert.equal(accounts[2].identity, undefined);
  noSecrets(accounts);
});

test("detectCodexAccounts: process CODEX_HOME applies to default profile", async () => {
  const [a] = await detectCodexAccounts([prof("codex", "codex")], { ...base, env: { CODEX_HOME: "/env/codex" } });
  assert.equal(a.configHome, "/env/codex");
});

test("detectCodexAccounts: dedupe via slash, ~, relative, symlink", async () => {
  const real: Record<string, string> = { "/tmp/link": "/tmp/real" };
  const accounts = await detectCodexAccounts([
    prof("a", "codex", "/tmp/real"), prof("b", "codex", "/tmp/real/"), prof("c", "codex", "/tmp/link"),
    prof("d", "codex", "~/.codex"), prof("e", "codex"), prof("f", "codex", "rel"), prof("g", "codex", "/work/rel"),
  ], { ...base, realpath: async (d) => real[d] ?? d });
  assert.deepEqual(accounts.map((a) => a.profileIds), [["a", "b", "c"], ["d", "e"], ["f", "g"]]);
});

test("detectCodexAccounts: missing or malformed auth.json -> no identity, no throw", async () => {
  const readFile = fileMap({ "/t/bad/auth.json": "{nope", "/t/arr/auth.json": "[]", "/t/noid/auth.json": { tokens: {} },
    "/t/apikey/auth.json": { OPENAI_API_KEY: API_KEY } });
  const accounts = await detectCodexAccounts(["missing", "bad", "arr", "noid", "apikey"].map((n) => prof(n, "codex", `/t/${n}`)), { ...base, readFile });
  assert.equal(accounts.length, 5);
  for (const a of accounts) assert.equal(a.identity, undefined);
  noSecrets(accounts);
});

test("detectClaudeAccounts tags provider claude", async () => {
  const [a] = await detectClaudeAccounts([prof("claude", "claude")], { ...base, readFile: fileMap({}) });
  assert.equal(a.provider, "claude");
});

// ---------- parsers ----------
const rates = (primary: unknown, secondary: unknown = null) => ({ primary, secondary });
const tc = (ts: number | string, last: unknown, total: unknown, rate_limits: unknown = null) => JSON.stringify({
  timestamp: typeof ts === "number" ? iso(ts) : ts, type: "event_msg",
  payload: { type: "token_count", info: last === null ? null : { last_token_usage: last, total_token_usage: total }, rate_limits },
});
const L = (input: number, out = 0, cached = 0, reasoning?: number) =>
  ({ input_tokens: input, output_tokens: out, cached_input_tokens: cached, ...(reasoning === undefined ? {} : { reasoning_output_tokens: reasoning }) });
const T = (n: number) => ({ total_tokens: n, input_tokens: n, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0 });

test("parseCodexRateWindows maps by window_minutes", () => {
  const w = parseCodexRateWindows(rates(
    { used_percent: 12.5, window_minutes: 300, resets_at: sec(NOW + H) },
    { used_percent: 40, window_minutes: 10_080, resets_at: sec(NOW + 24 * H) }));
  assert.deepEqual(w.map((x) => [x.id, x.kind, x.windowMinutes, x.utilization, x.limited]), [
    ["codex:primary:300", "five_hour", 300, 12.5, false], ["codex:secondary:10080", "seven_day", 10_080, 40, false]]);
  assert.equal(w[0].resetsAt, iso(sec(NOW + H) * 1000));
});

test("parseCodexRateWindows: custom windows, swapped slots, null secondary, limited", () => {
  const custom = parseCodexRateWindows(rates({ used_percent: 100, window_minutes: 60, resets_at: sec(NOW) }));
  assert.deepEqual(custom.map((x) => [x.kind, x.windowMinutes, x.limited]), [["custom", 60, true]]);
  const swapped = parseCodexRateWindows(rates({ used_percent: 1, window_minutes: 10_080 }, { used_percent: 2, window_minutes: 300 }));
  assert.deepEqual(swapped.map((x) => x.kind), ["seven_day", "five_hour"]);
  assert.deepEqual(parseCodexRateWindows(rates({ used_percent: 99.99, window_minutes: 300 }, null)).map((x) => x.limited), [false]);
  assert.equal(parseCodexRateWindows(rates({ used_percent: 150, window_minutes: 300 }))[0].limited, true);
});

test("parseCodexRateWindows: malformed windows are dropped; missing resets_at -> null", () => {
  for (const v of [null, "x", {}, rates(null), rates({ used_percent: 5 }), rates({ window_minutes: 300 }),
    rates({ used_percent: "5", window_minutes: 300 }), rates({ used_percent: -1, window_minutes: 300 }),
    rates({ used_percent: 5, window_minutes: 0 }), rates({ used_percent: 5, window_minutes: 1.5 })]) {
    assert.deepEqual(parseCodexRateWindows(v), [], JSON.stringify(v));
  }
  assert.equal(parseCodexRateWindows(rates({ used_percent: 5, window_minutes: 300 }))[0].resetsAt, null);
  assert.equal(parseCodexRateWindows(rates({ used_percent: 5, window_minutes: 300, resets_at: "soon" }))[0].resetsAt, null);
});

test("parseCodexTokenCountLine: valid, with reasoning and timestamp", () => {
  const e = parseCodexTokenCountLine(tc(NOW, L(10, 5, 3, 2), T(18), rates({ used_percent: 1, window_minutes: 300 })));
  assert.equal(e?.timestamp, NOW);
  assert.deepEqual(e?.tokens, { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 3, reasoningOutputTokens: 2 });
  assert.equal(e?.windows.length, 1);
  assert.equal(e?.cumulativeKey, "18:18:0:0:0:");
});

test("parseCodexTokenCountLine: info null still returns windows; reasoning omitted when absent", () => {
  const e = parseCodexTokenCountLine(tc(NOW, null, null, rates({ used_percent: 1, window_minutes: 300 })));
  assert.equal(e?.tokens, undefined);
  assert.equal(e?.windows.length, 1);
  const f = parseCodexTokenCountLine(tc(NOW, L(1), T(1)));
  assert.ok(!("reasoningOutputTokens" in f!.tokens!));
});

test("parseCodexTokenCountLine rejects malformed and unrelated lines", () => {
  const ok = JSON.parse(tc(NOW, L(1), T(1)));
  for (const l of ["", "{bad", "[]", "null",
    JSON.stringify({ ...ok, type: "response_item" }),
    JSON.stringify({ ...ok, payload: { ...ok.payload, type: "agent_message" } }),
    JSON.stringify({ ...ok, timestamp: "nope" }), JSON.stringify({ ...ok, timestamp: undefined }),
    JSON.stringify({ ...ok, payload: null })]) {
    assert.equal(parseCodexTokenCountLine(l), undefined, l);
  }
});

// ---------- codexRateLimits ----------
test("codexRateLimits: undefined snapshot -> unavailable", () => {
  const r = codexRateLimits(undefined, NOW);
  assert.equal(r.state, "unavailable");
  assert.deepEqual(r.windows, []);
  assert.ok(r.message);
});

test("codexRateLimits: observedAt, past reset -> 0 & not limited keeping resetsAt, future kept", () => {
  const windows = parseCodexRateWindows(rates(
    { used_percent: 100, window_minutes: 300, resets_at: sec(NOW - H) },
    { used_percent: 100, window_minutes: 10_080, resets_at: sec(NOW + H) }));
  const r = codexRateLimits({ timestamp: NOW - 2 * H, windows }, NOW);
  assert.equal(r.state, "ok");
  assert.equal(r.observedAt, iso(NOW - 2 * H));
  assert.deepEqual([r.windows[0].utilization, r.windows[0].limited, r.windows[0].resetsAt], [0, false, iso(sec(NOW - H) * 1000)]);
  assert.deepEqual([r.windows[1].utilization, r.windows[1].limited], [100, true]);
  RateLimits.parse(r);
});

test("codexRateLimits: reset exactly now counts as passed; null resetsAt untouched; input not mutated", () => {
  const windows = parseCodexRateWindows(rates({ used_percent: 50, window_minutes: 300, resets_at: sec(NOW) }, { used_percent: 60, window_minutes: 10_080 }));
  const r = codexRateLimits({ timestamp: NOW - H, windows }, NOW);
  assert.equal(r.windows[0].utilization, 0);
  assert.equal(r.windows[1].utilization, 60);
  assert.equal(windows[0].utilization, 50);
});

// ---------- readCodexRollout ----------
async function* gen(lines: string[]) { yield* lines; }
const total = (rows: { tokens: { inputTokens: number; outputTokens: number } }[]) => rows.reduce((s, r) => s + r.tokens.inputTokens + r.tokens.outputTokens, 0);

test("readCodexRollout sums per-turn last_token_usage", async () => {
  const r = await readCodexRollout(gen([tc(NOW - 3 * H, L(10, 1), T(11)), tc(NOW - 2 * H, L(20, 2), T(33)), tc(NOW - H, L(30, 3, 0, 4), T(66))]), NOW);
  assert.equal(r.entries.length, 3);
  assert.equal(total(r.entries), 11 + 22 + 33);
  assert.equal(r.entries[2].tokens.reasoningOutputTokens, 4);
});

test("readCodexRollout: repeated token_count events are not double counted", async () => {
  const r = await readCodexRollout(gen([
    tc(NOW - 3 * H, L(10), T(10)), tc(NOW - 3 * H + 1000, L(10), T(10)), tc(NOW - 2 * H, L(10), T(10)),
    tc(NOW - H, L(5), T(15)),
  ]), NOW);
  assert.equal(total(r.entries), 15);
});

test("readCodexRollout: events with no tokens, zero tokens or malformed lines are skipped; windows still tracked", async () => {
  const r = await readCodexRollout(gen([
    "{bad", tc(NOW - 3 * H, null, null, rates({ used_percent: 7, window_minutes: 300 })),
    tc(NOW - 2 * H, L(0), T(0)),
    tc(NOW - 2 * H + 1, L(4), T(4), rates({ used_percent: 9, window_minutes: 300 })),
  ]), NOW);
  assert.equal(r.entries.length, 1);
  assert.equal(r.latest?.timestamp, NOW - 2 * H + 1);
  assert.equal(r.latest?.windows[0].utilization, 9);
});

test("readCodexRollout: latest snapshot is by event timestamp, not file order", async () => {
  const r = await readCodexRollout(gen([
    tc(NOW - H, L(1), T(1), rates({ used_percent: 30, window_minutes: 300 })),
    tc(NOW - 2 * H, L(1), T(2), rates({ used_percent: 10, window_minutes: 300 })),
  ]), NOW);
  assert.equal(r.latest?.timestamp, NOW - H);
  assert.equal(r.latest?.windows[0].utilization, 30);
});

test("readCodexRollout: future events ignored and flagged; cutoff drops old entries but keeps rate snapshot", async () => {
  const r = await readCodexRollout(gen([
    tc(NOW - 8 * 24 * H, L(100), T(100), rates({ used_percent: 3, window_minutes: 300 })),
    tc(NOW + 1000, L(1000), T(1100)),
    tc(NOW, L(1), T(101)),
  ]), NOW, NOW - 7 * 24 * H);
  assert.equal(r.hasFutureEvents, true);
  assert.equal(total(r.entries), 1);
  assert.equal(r.latest?.windows[0].utilization, 3);
});

test("readCodexRollout feeds boundaries correctly through aggregation", async () => {
  const { aggregateLocalUsage } = await import("../server/usage/local-usage.ts");
  const r = await readCodexRollout(gen([
    tc(NOW - 7 * 24 * H - 1, L(1000), T(1000)),   // outside 7d (cutoff default)
    tc(NOW - 7 * 24 * H, L(100), T(1100)),         // exactly 7d
    tc(TODAY - 1, L(10), T(1110)),                 // before midnight
    tc(TODAY + 1, L(2), T(1112)),                  // today
    tc(NOW - 5 * H, L(3), T(1115)),                // exactly 5h
    tc(NOW - 5 * H - 1, L(4), T(1119)),            // just outside 5h (but today)
  ]), NOW);
  const a = aggregateLocalUsage(r.entries, NOW);
  assert.equal(a.sevenDay.inputTokens, 100 + 10 + 2 + 3 + 4);
  assert.equal(a.today.inputTokens, 2 + 3 + 4);
  assert.equal(a.fiveHour.inputTokens, 3);
});

// ---------- reader ----------
type F = { lines: string[]; mtimeMs?: number; size?: number };
function fakeFs(initial: Record<string, F>) {
  const fsMap = { ...initial };
  const reads: string[] = [];
  const dirents = (dir: string) => {
    const prefix = dir + "/";
    const names = new Map<string, boolean>();
    for (const p of Object.keys(fsMap)) {
      if (!p.startsWith(prefix)) continue;
      const [first, ...more] = p.slice(prefix.length).split("/");
      names.set(first, more.length > 0);
    }
    return names;
  };
  const files = {
    readdir: async (dir: string) => {
      const n = dirents(dir);
      if (!n.size) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...n].map(([name, d]) => ({ name, isDirectory: () => d, isFile: () => !d }));
    },
    stat: async (file: string) => {
      const f = fsMap[file];
      if (!f) throw new Error("ENOENT");
      return { mtimeMs: f.mtimeMs ?? 1, size: f.size ?? f.lines.length };
    },
    readLines: (file: string) => {
      reads.push(file);
      return (async function* () { yield* fsMap[file].lines; })();
    },
  };
  return { fsMap, files, reads };
}
const CFG = "/cx";
const day = (y: number, m: number, d: number, name = "rollout-a.jsonl") =>
  `${CFG}/sessions/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${name}`;
const R = (pct: number, resets = NOW + 2 * H) => rates({ used_percent: pct, window_minutes: 300, resets_at: sec(resets) });

test("codex reader: no sessions dir -> unavailable rate limits and local", async () => {
  const { files } = fakeFs({});
  const { local, rateLimits } = await createCodexUsageReader(files).read(CFG, NOW);
  assert.equal(rateLimits.state, "unavailable");
  assert.equal(local.state, "unavailable");
  LocalUsage_ok(local);
});
function LocalUsage_ok(l: unknown) { LocalUsage.parse(l); }

test("codex reader: logs without any rate_limits -> unavailable rate limits but local usage counted", async () => {
  const { files } = fakeFs({ [day(2026, 1, 10)]: { lines: [tc(NOW - H, L(7), T(7))] } });
  const { local, rateLimits } = await createCodexUsageReader(files).read(CFG, NOW);
  assert.equal(rateLimits.state, "unavailable");
  assert.equal(local.state, "ok");
  assert.equal(local.fiveHour.inputTokens, 7);
});

test("codex reader: newest file wins for rate limits; scans newest-first and stops at old files", async () => {
  const { files, reads } = fakeFs({
    [day(2026, 1, 10, "new.jsonl")]: { lines: [tc(NOW - H, L(5), T(5), R(42))], mtimeMs: NOW - H },
    [day(2026, 1, 9, "mid.jsonl")]: { lines: [tc(NOW - 20 * H, L(3), T(3), R(11))], mtimeMs: NOW - 20 * H },
    [day(2025, 12, 1, "old.jsonl")]: { lines: [tc(NOW - 40 * 24 * H, L(1000), T(1000), R(99))], mtimeMs: Date.UTC(2025, 11, 1) },
    [`${CFG}/sessions/notes/readme.jsonl`]: { lines: [tc(NOW - H, L(9999), T(9999), R(1))] },
    [day(2026, 1, 10, "ignore.txt")]: { lines: [tc(NOW - H, L(9999), T(9999))] },
  });
  const { local, rateLimits } = await createCodexUsageReader(files).read(CFG, NOW);
  assert.equal(rateLimits.state, "ok");
  assert.equal(rateLimits.windows[0].utilization, 42);
  assert.equal(rateLimits.observedAt, iso(NOW - H));
  assert.ok(!reads.includes(day(2025, 12, 1, "old.jsonl")), "stale rollout must not be read");
  assert.ok(!reads.some((r) => r.includes("notes") || r.endsWith(".txt")));
  assert.equal(local.sevenDay.inputTokens, 8);
  assert.equal(local.state, "ok");
});

test("codex reader: falls back to older file when newest has no rate limits", async () => {
  const { files } = fakeFs({
    [day(2026, 1, 10)]: { lines: [tc(NOW - H, L(5), T(5))], mtimeMs: NOW - H },
    [day(2026, 1, 9)]: { lines: [tc(NOW - 20 * H, L(3), T(3), R(11, NOW + H))], mtimeMs: NOW - 20 * H },
  });
  const { rateLimits } = await createCodexUsageReader(files).read(CFG, NOW);
  assert.equal(rateLimits.windows[0].utilization, 11);
  assert.equal(rateLimits.observedAt, iso(NOW - 20 * H));
});

test("codex reader: past reset reports 0; 5h local window anchors to future reset", async () => {
  const past = fakeFs({ [day(2026, 1, 10)]: { lines: [tc(NOW - 6 * H, L(1), T(1), R(100, NOW - H))] } });
  const p = await createCodexUsageReader(past.files).read(CFG, NOW);
  assert.deepEqual([p.rateLimits.windows[0].utilization, p.rateLimits.windows[0].limited], [0, false]);
  const fut = fakeFs({ [day(2026, 1, 10)]: { lines: [tc(NOW - 4 * H, L(1), T(1)), tc(NOW - H, L(2), T(3), R(30, NOW + 3 * H))] } });
  const f = await createCodexUsageReader(fut.files).read(CFG, NOW); // window started NOW-2h
  assert.equal(f.local.fiveHourStartsAt, iso(NOW - 2 * H));
  assert.equal(f.local.fiveHour.inputTokens, 2);
  assert.equal(f.local.sevenDay.inputTokens, 3);
});

test("codex reader: duplicate events copied across forked rollouts counted once", async () => {
  const ev = tc(NOW - H, L(10), T(10));
  const { files } = fakeFs({
    [day(2026, 1, 10, "a.jsonl")]: { lines: [ev, tc(NOW - 30 * 60_000, L(5), T(15))], mtimeMs: NOW - 1 },
    [day(2026, 1, 10, "b.jsonl")]: { lines: [ev], mtimeMs: NOW - 2 },
  });
  const { local } = await createCodexUsageReader(files).read(CFG, NOW);
  assert.equal(local.sevenDay.inputTokens, 15);
});

test("codex reader: caches by mtime/size, reparses on change, drops deleted, retainAccounts evicts", async () => {
  const p = day(2026, 1, 10);
  const { fsMap, files, reads } = fakeFs({ [p]: { lines: [tc(NOW - H, L(2), T(2), R(5))], mtimeMs: 1, size: 10 } });
  const reader = createCodexUsageReader(files);
  await reader.read(CFG, NOW);
  await reader.read(CFG, NOW + 1000);
  assert.equal(reads.length, 1);
  fsMap[p] = { lines: [tc(NOW - H, L(2), T(2), R(5)), tc(NOW - H + 1, L(3), T(5))], mtimeMs: 2, size: 10 };
  assert.equal((await reader.read(CFG, NOW + 2000)).local.sevenDay.inputTokens, 5);
  assert.equal(reads.length, 2);
  fsMap[p] = { ...fsMap[p], size: 11 };
  await reader.read(CFG, NOW + 3000);
  assert.equal(reads.length, 3);
  reader.retainAccounts([]);
  await reader.read(CFG, NOW + 4000);
  assert.equal(reads.length, 4);
  delete fsMap[p];
  assert.equal((await reader.read(CFG, NOW + 5000)).local.state, "unavailable");
});

test("codex reader: file with future events is reparsed on next read", async () => {
  const { files, reads } = fakeFs({ [day(2026, 1, 10)]: { lines: [tc(NOW - H, L(1), T(1)), tc(NOW + H, L(50), T(51))] } });
  const reader = createCodexUsageReader(files);
  assert.equal((await reader.read(CFG, NOW)).local.sevenDay.inputTokens, 1);
  assert.equal((await reader.read(CFG, NOW + 2 * H)).local.sevenDay.inputTokens, 51);
  assert.equal(reads.length, 2);
});

test("codex reader: unreadable file -> partial; non-ENOENT readdir error -> partial", async () => {
  const fx = fakeFs({ [day(2026, 1, 10, "ok.jsonl")]: { lines: [tc(NOW - H, L(2), T(2))] }, [day(2026, 1, 10, "bad.jsonl")]: { lines: [] } });
  const orig = fx.files.readLines;
  fx.files.readLines = (f: string) => f.endsWith("bad.jsonl") ? (async function* () { throw new Error("EIO"); })() : orig(f);
  const r = await createCodexUsageReader(fx.files).read(CFG, NOW);
  assert.equal(r.local.state, "partial");
  assert.equal(r.local.sevenDay.inputTokens, 2);

  const fy = fakeFs({ [day(2026, 1, 10)]: { lines: [tc(NOW - H, L(2), T(2))] } });
  const rd = fy.files.readdir;
  fy.files.readdir = async (d: string) => { if (d.endsWith("/2026")) throw Object.assign(new Error("x"), { code: "EACCES" }); return rd(d); };
  assert.equal((await createCodexUsageReader(fy.files).read(CFG, NOW)).local.state, "unavailable");
});

// ---------- service ----------
const codexAcct = (home: string, extra: object = {}) => ({ provider: "codex", profileIds: [home], label: home, configHome: home, ...extra }) as never;
const claudeAcct = (home: string) => ({ provider: "claude", profileIds: [home], label: home, configHome: home, credentialHome: home, keychainConfigDir: home }) as never;
const empty = { readdir: async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); }, stat: async () => ({ mtimeMs: 0, size: 0 }), readLines: async function* () {} };

function service(codexFiles: unknown) {
  let fetches = 0;
  const svc = createUsageService({
    now: () => NOW, platform: "darwin", localFiles: empty as never, codexFiles: codexFiles as never,
    readKeychain: async () => JSON.stringify({ claudeAiOauth: { accessToken: "TOK", expiresAt: NOW + 1e9 } }),
    fetch: async () => { fetches++; return { status: 200, ok: true, json: async () => ({ five_hour: { utilization: 10 } }) }; },
  });
  return { svc, fetches: () => fetches };
}

test("service.read: claude and codex accounts validate against AccountUsage with provider", async () => {
  const { files } = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5, 1, 2, 3), T(6), R(85))] } });
  const { svc } = service(files);
  const claude = await svc.read(claudeAcct("/c"));
  const codex = await svc.read(codexAcct(CFG, { identity: { email: "c@x.com" } }));
  AccountUsage.parse(claude);
  AccountUsage.parse(codex);
  assert.deepEqual([claude.provider, codex.provider], ["claude", "codex"]);
  assert.equal(codex.warningLevel, "warn");
  assert.equal(codex.rateLimits.windows[0].kind, "five_hour");
  assert.equal(codex.local.fiveHour.reasoningOutputTokens, 3);
  assert.equal(codex.identity?.email, "c@x.com");
  noSecrets([claude, codex]);
  assert.ok(!JSON.stringify([claude, codex]).includes("TOK\""));
});

test("service.read: codex accounts never hit the network", async () => {
  const { files } = fakeFs({});
  const { svc, fetches } = service(files);
  const acct = await svc.read(codexAcct(CFG));
  assert.equal(fetches(), 0);
  assert.equal(acct.rateLimits.state, "unavailable");
  assert.equal(acct.warningLevel, "unknown");
  assert.equal(acct.local.state, "unavailable");
});

test("service.read: codex log changes show up on the next read (no TTL on local logs)", async () => {
  const f = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5), T(5), R(10))], mtimeMs: 1 } });
  const { svc } = service(f.files);
  assert.equal((await svc.read(codexAcct(CFG))).rateLimits.windows[0].utilization, 10);
  f.fsMap[`${CFG}/sessions/2026/01/10/r.jsonl`] = { lines: [tc(NOW - H, L(5), T(5), R(96))], mtimeMs: 2 };
  const acct = await svc.read(codexAcct(CFG));
  assert.equal(acct.rateLimits.windows[0].utilization, 96);
  assert.equal(acct.warningLevel, "critical");
});

test("service.read: concurrent codex reads for one account are coalesced", async () => {
  const f = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5), T(5), R(10))] } });
  const { svc } = service(f.files);
  const [a, b] = await Promise.all([svc.read(codexAcct(CFG)), svc.read(codexAcct(CFG))]);
  assert.equal(a, b);
  assert.equal(f.reads.length, 1);
});

test("service: codexFiles falls back to localFiles when omitted", async () => {
  const f = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5), T(5))] } });
  const svc = createUsageService({ now: () => NOW, localFiles: f.files as never, platform: "linux" });
  assert.equal((await svc.read(codexAcct(CFG))).local.sevenDay.inputTokens, 5);
});

test("service.read: limited codex window -> limited warning", async () => {
  const f = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5), T(5), R(100))] } });
  const { svc } = service(f.files);
  assert.equal((await svc.read(codexAcct(CFG))).warningLevel, "limited");
});

test("service.retainAccounts evicts codex reader cache", async () => {
  const f = fakeFs({ [`${CFG}/sessions/2026/01/10/r.jsonl`]: { lines: [tc(NOW - H, L(5), T(5), R(10))] } });
  const { svc } = service(f.files);
  await svc.read(codexAcct(CFG));
  await svc.read(codexAcct(CFG));
  assert.equal(f.reads.length, 1);
  svc.retainAccounts("codex", []);
  await svc.read(codexAcct(CFG));
  assert.equal(f.reads.length, 2);
});

test("detectCodexAccounts honours excludeConfigHomes", async () => {
  const accounts = await detectCodexAccounts([prof("a", "codex"), prof("b", "codex", "/tmp/b")],
    { ...base, excludeConfigHomes: new Set(["/home/u/.codex"]) } as never);
  assert.deepEqual(accounts.map((a) => a.configHome), ["/tmp/b"]);
});

// ---------- contract ----------
test("contract: provider is required and constrained; new window fields validate", () => {
  const acct = { provider: "codex", profileIds: ["a"], label: "a", configHome: "/a",
    rateLimits: { state: "ok", observedAt: iso(NOW), windows: [{ id: "x", kind: "custom", windowMinutes: 60, utilization: 0, resetsAt: null, limited: false }] },
    local: { state: "ok", fiveHourStartsAt: iso(NOW), fiveHour: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 1 },
      today: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      sevenDay: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } },
    warningLevel: "ok" };
  assert.equal(AccountUsage.safeParse(acct).success, true);
  const { provider: _p, ...noProvider } = acct;
  assert.equal(AccountUsage.safeParse(noProvider).success, false);
  assert.equal(AccountUsage.safeParse({ ...acct, provider: "gemini" }).success, false);
  const bad = structuredClone(acct); (bad.rateLimits.windows[0] as { windowMinutes: number }).windowMinutes = 0;
  assert.equal(AccountUsage.safeParse(bad).success, false);
});
