import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  claudeKeychainService, fetchClaudeRateLimits, OAUTH_USAGE_URL, parseClaudeCredentials, parseRateLimits,
  retryAfterTime, usageWarningLevel,
} from "../server/usage/rate-limits.ts";
import { RateLimits } from "../shared/usage/types.ts";

const TOKEN = "sk-ant-oat01-SECRETTOKEN-abc123";
const NOW = Date.parse("2026-01-01T12:00:00Z");
const account = { profileIds: ["claude"], label: "claude", configHome: "/h/.claude", credentialHome: "/h/.claude" } as never;
const creds = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 3_600_000, ...over } });

type Resp = { status: number; ok?: boolean; body?: unknown; headers?: Record<string, string>; jsonThrows?: boolean };
function setup(resp: Resp | Error, credText: string | null | Error = creds()) {
  const calls: { url: string; init: RequestInit }[] = [];
  const opts = {
    platform: "darwin" as const,
    now: () => NOW,
    readKeychain: async () => { if (credText instanceof Error) throw credText; return credText; },
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (resp instanceof Error) throw resp;
      return {
        status: resp.status, ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
        headers: { get: (k: string) => resp.headers?.[k.toLowerCase()] ?? null },
        json: async () => { if (resp.jsonThrows) throw new SyntaxError(`bad json near ${TOKEN}`); return resp.body; },
      };
    },
  };
  return { opts, calls };
}
function assertNoLeak(result: unknown) {
  assert.ok(!JSON.stringify(result).includes(TOKEN), "token leaked in result");
  assert.ok(!JSON.stringify(result).includes("SECRETTOKEN"));
}
const okBody = {
  five_hour: { utilization: 42.5, resets_at: "2026-01-01T15:00:00Z" },
  seven_day: { utilization: 10, resets_at: "2026-01-05T00:00:00Z" },
};

test("claudeKeychainService hashes the config dir", () => {
  assert.equal(claudeKeychainService(), "Claude Code-credentials");
  assert.equal(claudeKeychainService(""), "Claude Code-credentials");
  const h = createHash("sha256").update("/tmp/pb1").digest("hex").slice(0, 8);
  assert.equal(claudeKeychainService("/tmp/pb1"), `Claude Code-credentials-${h}`);
  assert.notEqual(claudeKeychainService("/tmp/pb1"), claudeKeychainService("/tmp/pb5"));
});

test("parseClaudeCredentials states", () => {
  assert.deepEqual(parseClaudeCredentials(null), { state: "unauthenticated" });
  assert.deepEqual(parseClaudeCredentials(""), { state: "unauthenticated" });
  assert.deepEqual(parseClaudeCredentials("nope"), { state: "error" });
  assert.deepEqual(parseClaudeCredentials("[]"), { state: "error" });
  assert.deepEqual(parseClaudeCredentials("{}"), { state: "unauthenticated" });
  assert.deepEqual(parseClaudeCredentials(JSON.stringify({ claudeAiOauth: {} })), { state: "unauthenticated" });
  assert.deepEqual(parseClaudeCredentials(JSON.stringify({ claudeAiOauth: { accessToken: "  " } })), { state: "unauthenticated" });
  assert.deepEqual(parseClaudeCredentials(creds({ expiresAt: NOW }), NOW), { state: "expired", expiresAt: new Date(NOW).toISOString() });
  assert.deepEqual(parseClaudeCredentials(creds({ expiresAt: NOW - 1 }), NOW), { state: "expired", expiresAt: new Date(NOW - 1).toISOString() });
  assert.deepEqual(parseClaudeCredentials(creds({ expiresAt: NOW + 1 }), NOW), { state: "ok", accessToken: TOKEN, expiresAt: NOW + 1 });
  assert.deepEqual(parseClaudeCredentials(creds({ expiresAt: undefined }), NOW), { state: "ok", accessToken: TOKEN, expiresAt: undefined });
});

test("success path: token only goes to the Anthropic usage URL", async () => {
  const { opts, calls } = setup({ status: 200, body: okBody });
  const result = await fetchClaudeRateLimits(account, opts);
  assert.equal(result.state, "ok");
  assert.deepEqual(result.windows.map((w) => [w.kind, w.utilization, w.limited]), [["five_hour", 42.5, false], ["seven_day", 10, false]]);
  assert.equal(result.windows[0].resetsAt, "2026-01-01T15:00:00.000Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OAUTH_USAGE_URL);
  assert.equal(new URL(calls[0].url).origin, "https://api.anthropic.com");
  assert.ok(!calls[0].url.includes(TOKEN));
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].init.redirect, "error");
  assertNoLeak(result);
  RateLimits.parse(result);
});

test("linux reads .credentials.json from credentialHome", async () => {
  const { opts, calls } = setup({ status: 200, body: okBody });
  const read: string[] = [];
  const result = await fetchClaudeRateLimits({ ...(account as object), credentialHome: "/c/home" } as never,
    { ...opts, platform: "linux", readFile: async (f) => { read.push(f); return creds(); } });
  assert.deepEqual(read, ["/c/home/.credentials.json"]);
  assert.equal(result.state, "ok");
  assert.equal(calls.length, 1);
});

test("linux: ENOENT -> unauthenticated, other errors -> error, no fetch", async () => {
  const { opts, calls } = setup({ status: 200, body: okBody });
  const r1 = await fetchClaudeRateLimits(account, { ...opts, platform: "linux", readFile: async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); } });
  assert.equal(r1.state, "unauthenticated");
  const r2 = await fetchClaudeRateLimits(account, { ...opts, platform: "linux", readFile: async () => { throw Object.assign(new Error(TOKEN), { code: "EACCES" }); } });
  assert.equal(r2.state, "error");
  assertNoLeak(r2);
  assert.equal(calls.length, 0);
});

test("keychain: uses hashed service and USER account", async () => {
  const seen: string[][] = [];
  const { opts } = setup({ status: 200, body: okBody });
  await fetchClaudeRateLimits({ ...(account as object), keychainConfigDir: "/tmp/pb1", keychainUser: "alice" } as never,
    { ...opts, readKeychain: async (s, u) => { seen.push([s, u]); return creds(); } });
  assert.deepEqual(seen, [[claudeKeychainService("/tmp/pb1"), "alice"]]);
  seen.length = 0;
  await fetchClaudeRateLimits({ ...(account as object), keychainUser: "bad user!" } as never,
    { ...opts, readKeychain: async (s, u) => { seen.push([s, u]); return creds(); } });
  assert.deepEqual(seen, [["Claude Code-credentials", "claude-code-user"]]);
});

test("missing / expired / unreadable / malformed credentials never fetch", async () => {
  const cases: [string | null | Error, string][] = [
    [null, "unauthenticated"], ["{}", "unauthenticated"], [creds({ expiresAt: NOW - 1 }), "expired"],
    [new Error("keychain locked " + TOKEN), "error"], ["garbage", "error"],
  ];
  for (const [cred, state] of cases) {
    const { opts, calls } = setup({ status: 200, body: okBody }, cred);
    const result = await fetchClaudeRateLimits(account, opts);
    assert.equal(result.state, state);
    assert.deepEqual(result.windows, []);
    assert.equal(result.expiresAt, state === "expired" ? new Date(NOW - 1).toISOString() : undefined);
    assert.equal(calls.length, 0);
    assertNoLeak(result);
  }
});

test("nonLocalOAuth account is unavailable and never touches credentials", async () => {
  let touched = false;
  const { opts, calls } = setup({ status: 200, body: okBody });
  const result = await fetchClaudeRateLimits({ ...(account as object), nonLocalOAuth: true } as never,
    { ...opts, readKeychain: async () => { touched = true; return creds(); } });
  assert.equal(result.state, "unavailable");
  assert.equal(touched, false);
  assert.equal(calls.length, 0);
});

test("HTTP errors map to states without leaking the token", async () => {
  const cases: [number, string][] = [[401, "unauthenticated"], [403, "unauthenticated"], [429, "error"], [500, "error"], [503, "error"], [404, "error"]];
  for (const [status, state] of cases) {
    const { opts } = setup({ status, body: { error: TOKEN } });
    const result = await fetchClaudeRateLimits(account, opts);
    assert.equal(result.state, state, `status ${status}`);
    assert.deepEqual(result.windows, []);
    assert.ok(result.message);
    assert.equal(result.rejectedStatus, status === 401 || status === 403 ? status : undefined);
    assertNoLeak(result);
    RateLimits.parse(result);
  }
});

test("429 reports Retry-After through onThrottle", async () => {
  const seen: (number | undefined)[] = [];
  const { opts } = setup({ status: 429, headers: { "retry-after": "120" } });
  await fetchClaudeRateLimits(account, opts, (t) => seen.push(t));
  assert.deepEqual(seen, [NOW + 120_000]);
  const { opts: o2 } = setup({ status: 429 });
  await fetchClaudeRateLimits(account, o2, (t) => seen.push(t));
  assert.equal(seen[1], undefined);
});

test("retryAfterTime", () => {
  assert.equal(retryAfterTime("30", 1000), 31_000);
  assert.equal(retryAfterTime(undefined, 1000), undefined);
  assert.equal(retryAfterTime("  ", 1000), undefined);
  assert.equal(retryAfterTime("0", 1000), undefined);
  assert.equal(retryAfterTime("-5", 1000), undefined);
  assert.equal(retryAfterTime("garbage", 1000), undefined);
  assert.equal(retryAfterTime(new Date(NOW + 5000).toUTCString(), NOW), Date.parse(new Date(NOW + 5000).toUTCString()));
  assert.equal(retryAfterTime(new Date(NOW - 5000).toUTCString(), NOW), undefined);
});

test("malformed JSON body and thrown fetch errors become error state, no leak", async () => {
  const r1 = await fetchClaudeRateLimits(account, setup({ status: 200, jsonThrows: true }).opts);
  assert.equal(r1.state, "error");
  assertNoLeak(r1);
  const r2 = await fetchClaudeRateLimits(account, setup(new Error(`connect failed Bearer ${TOKEN}`)).opts);
  assert.equal(r2.state, "error");
  assertNoLeak(r2);
  const r3 = await fetchClaudeRateLimits(account, setup({ status: 200, body: "str" }).opts);
  assert.equal(r3.state, "error");
  const r4 = await fetchClaudeRateLimits(account, setup({ status: 200, body: [1] }).opts);
  assert.equal(r4.state, "error");
});

test("parseRateLimits: missing fields and null windows", () => {
  assert.equal(parseRateLimits(null).state, "error");
  assert.equal(parseRateLimits({}).state, "unavailable");
  assert.equal(parseRateLimits({ five_hour: null, seven_day: null }).state, "unavailable");
  assert.equal(parseRateLimits({ five_hour: { resets_at: "2026-01-01T00:00:00Z" } }).state, "unavailable");
  assert.equal(parseRateLimits({ five_hour: { utilization: "abc" } }).state, "unavailable");
  assert.equal(parseRateLimits({ five_hour: { utilization: -1 } }).state, "unavailable");
});

test("parseRateLimits: missing five_hour window still yields seven_day", () => {
  const r = parseRateLimits({ seven_day: { utilization: 30, resets_at: "2026-01-05T00:00:00Z" } });
  assert.equal(r.state, "ok");
  assert.deepEqual(r.windows.map((w) => w.kind), ["seven_day"]);
  assert.equal(usageWarningLevel(r), "ok");
});

test("parseRateLimits: null/invalid resetsAt, numeric epoch seconds, string utilization", () => {
  const r = parseRateLimits({
    five_hour: { utilization: 5, resets_at: null },
    seven_day: { utilization: "7.5", resets_at: "not a date" },
    seven_day_opus: { utilization: 1, resets_at: 1767225600 },
  });
  assert.equal(r.windows[0].resetsAt, null);
  assert.equal(r.windows[1].resetsAt, null);
  assert.equal(r.windows[1].utilization, 7.5);
  assert.equal(r.windows[2].resetsAt, "2026-01-01T00:00:00.000Z");
  RateLimits.parse(r);
});

test("parseRateLimits: model weekly windows, oauth_apps ignored, ordering", () => {
  const r = parseRateLimits({
    seven_day_opus: { utilization: 20 },
    seven_day_oauth_apps: { utilization: 99 },
    seven_day_sonnet: { utilization: 3 },
    seven_day: { utilization: 1 },
    five_hour: { utilization: 2 },
  });
  assert.deepEqual(r.windows.map((w) => w.id), ["five_hour", "seven_day", "model:opus", "model:sonnet"]);
  assert.equal(r.windows[2].model, "opus");
  assert.equal(r.windows[2].kind, "model_weekly");
});

test("parseRateLimits: limited flag via >=100, rejected status, locked_reason", () => {
  const r = parseRateLimits({
    five_hour: { utilization: 100 },
    seven_day: { utilization: 10, status: "rejected" },
    seven_day_opus: { utilization: 10, locked_reason: "quota" },
    seven_day_sonnet: { utilization: 99.9 },
  });
  assert.deepEqual(r.windows.map((w) => w.limited), [true, true, true, false]);
});

test("parseRateLimits: scoped limits array fills gaps without overriding top-level", () => {
  const r = parseRateLimits({
    five_hour: { utilization: 1 },
    limits: [
      { kind: "session", utilization: 90 },
      { kind: "weekly_all", utilization: 50, resets_at: "2026-01-05T00:00:00Z" },
      { kind: "weekly_scoped", utilization: 60, scope: { model: { id: "claude-opus-5", display_name: "Opus 5" } } },
      { kind: "weekly_scoped", utilization: 60, scope: {} },
    ],
  });
  assert.equal(r.windows.find((w) => w.id === "five_hour")?.utilization, 1);
  assert.equal(r.windows.find((w) => w.id === "seven_day")?.utilization, 50);
  const m = r.windows.find((w) => w.kind === "model_weekly");
  assert.equal(m?.model, "Opus 5");
  assert.equal(m?.id, "model:claude-opus-5");
  assert.equal(r.windows.filter((w) => w.kind === "model_weekly").length, 1);
});

test("usageWarningLevel thresholds", () => {
  const w = (utilization: number, limited = false) => ({ id: "x", kind: "five_hour" as const, utilization, resetsAt: null, limited });
  const rl = (windows: ReturnType<typeof w>[], state: RateLimits["state"] = "ok") => ({ state, windows });
  assert.equal(usageWarningLevel(rl([w(0)])), "ok");
  assert.equal(usageWarningLevel(rl([w(79.99)])), "ok");
  assert.equal(usageWarningLevel(rl([w(80)])), "warn");
  assert.equal(usageWarningLevel(rl([w(94.9)])), "warn");
  assert.equal(usageWarningLevel(rl([w(95)])), "critical");
  assert.equal(usageWarningLevel(rl([w(99.9)])), "critical");
  assert.equal(usageWarningLevel(rl([w(100, true)])), "limited");
  assert.equal(usageWarningLevel(rl([w(10, true)])), "limited");
  assert.equal(usageWarningLevel(rl([w(10), w(85)])), "warn");
  assert.equal(usageWarningLevel(rl([])), "unknown");
  assert.equal(usageWarningLevel(rl([w(99)], "expired")), "unknown");
  assert.equal(usageWarningLevel(rl([w(99)], "error")), "unknown");
});
