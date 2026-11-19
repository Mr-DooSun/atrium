import { test } from "node:test";
import assert from "node:assert/strict";
import { createUsageService } from "../server/usage/service.ts";
import { OAUTH_USAGE_URL } from "../server/usage/rate-limits.ts";
import { AccountUsage } from "../shared/usage/types.ts";

const TOKEN = "sk-ant-oat01-SVCSECRET";
const T0 = Date.parse("2026-01-10T12:00:00Z");
const acct = (home: string, extra: object = {}) => ({
  provider: "claude", profileIds: [home], label: home, configHome: home, credentialHome: home, keychainConfigDir: home, ...extra,
}) as never;
const emptyFiles = {
  readdir: async () => { throw new Error("ENOENT"); },
  stat: async () => ({ mtimeMs: 0, size: 0 }),
  readLines: async function* () {},
};

function harness(responder?: (n: number) => { status: number; body?: unknown; headers?: Record<string, string> }, ttl = 60_000) {
  let clock = T0;
  const calls: { url: string; auth: string }[] = [];
  const gate: { release?: () => void; wait?: Promise<void> } = {};
  const svc = createUsageService({
    now: () => clock,
    platform: "darwin",
    rateLimitTtlMs: ttl,
    localFiles: emptyFiles as never,
    readKeychain: async () => JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: T0 + 1e9 } }),
    fetch: async (url, init) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization) });
      if (gate.wait) await gate.wait;
      const r = responder?.(calls.length) ?? { status: 200, body: { five_hour: { utilization: 10 } } };
      return { status: r.status, ok: r.status < 300, headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null }, json: async () => r.body };
    },
  });
  return {
    svc, calls,
    advance: (ms: number) => { clock += ms; },
    hold: () => { gate.wait = new Promise<void>((res) => { gate.release = res; }); },
    release: () => { gate.release?.(); gate.wait = undefined; },
  };
}

test("read returns a schema-valid AccountUsage; token never leaks; only the usage URL is called", async () => {
  const h = harness();
  const a = await h.svc.read(acct("/a", { identity: { email: "a@x.com" } }));
  AccountUsage.parse(a);
  assert.equal(a.provider, "claude");
  assert.equal(a.warningLevel, "ok");
  assert.equal(a.local.state, "unavailable");
  assert.equal(a.identity?.email, "a@x.com");
  assert.ok(!JSON.stringify(a).includes(TOKEN));
  assert.ok(h.calls.every((c) => c.url === OAUTH_USAGE_URL && c.auth === `Bearer ${TOKEN}`));
});

test("60s TTL: cached within ttl, refetched after", async () => {
  const h = harness();
  await h.svc.read(acct("/a"));
  h.advance(59_999);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 1);
  h.advance(1);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 2);
});

test("custom rateLimitTtlMs is honoured", async () => {
  const h = harness(undefined, 1_000);
  await h.svc.read(acct("/a"));
  h.advance(1_001);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 2);
});

test("accounts are cached independently", async () => {
  const h = harness();
  await h.svc.read(acct("/a"));
  await h.svc.read(acct("/b"));
  assert.equal(h.calls.length, 2);
  await h.svc.read(acct("/a"));
  await h.svc.read(acct("/b"));
  assert.equal(h.calls.length, 2);
});

test("retainAccounts evicts claude accounts that are no longer present", async () => {
  const h = harness();
  await h.svc.read(acct("/a"));
  await h.svc.read(acct("/b"));
  h.svc.retainAccounts("claude", [acct("/a")]);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 2, "/a stays cached");
  await h.svc.read(acct("/b"));
  assert.equal(h.calls.length, 3, "/b was evicted and refetched");
});

test("concurrent reads for the same account are coalesced; different accounts are not", async () => {
  const h = harness();
  h.hold();
  const same = [h.svc.read(acct("/a")), h.svc.read(acct("/a")), h.svc.read(acct("/a"))];
  const other = h.svc.read(acct("/b"));
  await new Promise((r) => setImmediate(r));
  h.release();
  const [a, b, c] = await Promise.all(same);
  await other;
  assert.equal(h.calls.length, 2);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("a failed read does not wedge the account", async () => {
  const bad = createUsageService({ now: () => T0, platform: "darwin", localFiles: { ...emptyFiles, readdir: async () => { throw new Error("x"); } } as never,
    readKeychain: async () => null });
  const first = await bad.read(acct("/a"));
  const second = await bad.read(acct("/a"));
  assert.equal(first.rateLimits.state, "unauthenticated");
  assert.equal(second.rateLimits.state, "unauthenticated");
});

test("429 with Retry-After is honoured until it expires", async () => {
  const h = harness((n) => n === 1 ? { status: 429, headers: { "retry-after": "120" } } : { status: 200, body: { five_hour: { utilization: 10 } } });
  const first = await h.svc.read(acct("/a"));
  assert.equal(first.rateLimits.state, "error");
  h.advance(61_000); // past ttl, still inside Retry-After
  const during = await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 1, "must not hit the API during Retry-After");
  assert.equal(during.rateLimits.state, "error");
  h.advance(58_999);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 1);
  h.advance(1);
  const after = await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 2);
  assert.equal(after.rateLimits.state, "ok");
});

test("429 without Retry-After backs off for the ttl", async () => {
  const h = harness((n) => n === 1 ? { status: 429 } : { status: 200, body: { five_hour: { utilization: 10 } } });
  await h.svc.read(acct("/a"));
  h.advance(59_999);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 1);
  h.advance(1);
  await h.svc.read(acct("/a"));
  assert.equal(h.calls.length, 2);
});

test("429 on one account does not block another", async () => {
  const h = harness((n) => n === 1 ? { status: 429, headers: { "retry-after": "300" } } : { status: 200, body: { five_hour: { utilization: 10 } } });
  const a = await h.svc.read(acct("/a"));
  const b = await h.svc.read(acct("/b"));
  assert.equal(a.rateLimits.state, "error");
  assert.equal(b.rateLimits.state, "ok");
});

test("warningLevel flows through; 5h reset anchors local window", async () => {
  const h = harness(() => ({ status: 200, body: {
    five_hour: { utilization: 96, resets_at: new Date(T0 + 3_600_000).toISOString() },
    seven_day: { utilization: 5 },
  } }));
  const a = await h.svc.read(acct("/a"));
  assert.equal(a.warningLevel, "critical");
  assert.equal(a.local.fiveHourStartsAt, new Date(T0 + 3_600_000 - 5 * 3_600_000).toISOString());
});

test("http errors yield schema-valid accounts with unknown warning level", async () => {
  for (const status of [401, 403, 500]) {
    const h = harness(() => ({ status }));
    const a = await h.svc.read(acct("/a"));
    AccountUsage.parse(a);
    assert.equal(a.warningLevel, "unknown");
  }
});
