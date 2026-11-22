import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinUsageHomes, createUsageSources, toUsageReport, usageAccountLabel, usageSourceInput } from "../server/usage/source.ts";

const H = 3_600_000;
const NOW = new Date(2026, 0, 10, 15, 0, 0).getTime();
const iso = (t: number) => new Date(t).toISOString();
const sec = (t: number) => Math.floor(t / 1000);
const TOKEN = "sk-ant-oat01-SOURCESECRET";
const ID_SECRET = "ID-ACCESS-SECRET";
const home = "/home/u";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: unknown) => `${b64({ alg: "none" })}.${b64(claims)}.SIG-SECRET`;

function prof(id: string, kind: string, configHome?: string, env?: Record<string, string>, label = id) {
  return { profile: { id, label, kind }, runtime: { configHome, env } } as never;
}
const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
const creds = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 1e9, ...over } });

type Resp = { status: number; body?: unknown; headers?: Record<string, string>; jsonThrows?: boolean };
interface Opts {
  profiles?: unknown[];
  env?: NodeJS.ProcessEnv;
  files?: Record<string, unknown>;       // readFile (identity)
  tree?: Record<string, string[]>;       // fake local-usage files: path -> lines
  credential?: string | null | Error;
  resp?: Resp;
  realpath?: (d: string) => Promise<string>;
}
function build(o: Opts = {}) {
  const urls: string[] = [];
  const fileMap = o.files ?? {};
  const tree = o.tree ?? {};
  const fsApi = {
    readdir: async (dir: string) => {
      const prefix = dir + "/";
      const names = new Map<string, boolean>();
      for (const p of Object.keys(tree)) {
        if (!p.startsWith(prefix)) continue;
        const [first, ...more] = p.slice(prefix.length).split("/");
        names.set(first, more.length > 0);
      }
      if (!names.size) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...names].map(([name, d]) => ({ name, isDirectory: () => d, isFile: () => !d }));
    },
    stat: async () => ({ mtimeMs: 1, size: 1 }),
    readLines: (file: string) => (async function* () { yield* tree[file]; })(),
  };
  const sources = createUsageSources({
    now: () => NOW,
    platform: "darwin",
    readKeychain: async () => { if (o.credential instanceof Error) throw o.credential; return o.credential === undefined ? creds() : o.credential; },
    fetch: async (url: string) => {
      urls.push(url);
      const r = o.resp ?? { status: 200, body: { five_hour: { utilization: 42, resets_at: iso(NOW + 2 * H) }, seven_day: { utilization: 10 } } };
      return { status: r.status, ok: r.status < 300, headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
        json: async () => { if (r.jsonThrows) throw new Error("bad " + TOKEN); return r.body; } };
    },
    localFiles: fsApi as never,
    codexFiles: fsApi as never,
    loadProfiles: async () => (o.profiles ?? []) as never,
    detection: {
      home, cwd: "/work", env: o.env ?? {}, realpath: o.realpath ?? (async (d: string) => d),
      readFile: async (f: string) => {
        if (!(f in fileMap)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        const v = fileMap[f];
        return typeof v === "string" ? v : JSON.stringify(v);
      },
    },
  });
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  return { sources, claude: byId["claude-profiles"], codex: byId["codex-profiles"], urls };
}
const noToken = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const secret of [TOKEN, ID_SECRET, "SIG-SECRET", "SOURCESECRET"]) assert.ok(!s.includes(secret), secret);
};
const global = { kind: "global" } as const;

// ---- registration & discovery ----
test("createUsageSources registers claude-profiles and codex-profiles", () => {
  const { sources } = build();
  assert.deepEqual(sources.map((s) => [s.id, s.label]), [["claude-profiles", "Claude profiles"], ["codex-profiles", "Codex profiles"]]);
  for (const s of sources) assert.ok(s.icon && s.input);
});

test("claude global discovery returns only non-default accounts", async () => {
  const { claude } = build({
    env: { CLAUDE_CONFIG_DIR: "/tmp/daemon-env" },
    profiles: [
      prof("claude", "claude", undefined, undefined, "Claude"),               // default ~/.claude
      prof("claude-home", "claude", "~/.claude"),                              // default via ~
      prof("claude-env", "claude", undefined, { CLAUDE_CONFIG_DIR: "/tmp/daemon-env" }), // daemon env dir
      prof("claude-env2", "claude", "/tmp/daemon-env/"),                       // same, trailing slash
      prof("claude-pb1", "claude", "/tmp/pb1"),
      prof("claude-pb5", "claude", undefined, { CLAUDE_CONFIG_DIR: "/tmp/pb5" }),
      prof("codex", "codex", "/tmp/cx"),
    ],
    files: { "/tmp/pb1/.claude.json": { oauthAccount: { emailAddress: "pb1@x.com" } } },
  });
  const accounts = await claude.discover(global);
  assert.deepEqual(accounts.map((a) => a.input), [
    { provider: "claude", configHome: "/tmp/pb1" }, { provider: "claude", configHome: "/tmp/pb5" }]);
  assert.deepEqual(accounts.map((a) => a.label), ["claude-pb1", "claude-pb5"]);
  assert.ok(accounts.every((a) => a.harness === a.label), "the card heading is the profile name");
});

test("codex global discovery excludes ~/.codex and daemon CODEX_HOME", async () => {
  const { codex } = build({
    env: { CODEX_HOME: "/tmp/daemon-codex" },
    profiles: [
      prof("codex", "codex"), prof("codex-env", "codex", undefined, { CODEX_HOME: "/tmp/daemon-codex" }),
      prof("codex-dc", "codex", "/tmp/daemon-codex"), prof("codex-1", "codex", "/tmp/cx1"), prof("claude-x", "claude", "/tmp/x"),
    ],
  });
  const accounts = await codex.discover(global);
  assert.deepEqual(accounts.map((a) => a.input), [{ provider: "codex", configHome: "/tmp/cx1" }]);
});

test("exclusion canonicalizes via realpath (symlinked default dir)", async () => {
  const sources = createUsageSources({
    loadProfiles: async () => [prof("alias", "claude", "/tmp/link"), prof("other", "claude", "/tmp/other")] as never,
    detection: { home, cwd: "/", env: {}, readFile: async () => { throw new Error("x"); },
      realpath: async (d) => (d === "/tmp/link" ? "/home/u/.claude" : d) },
  });
  const accounts = await sources[0].discover(global);
  assert.deepEqual(accounts.map((a) => a.input), [{ provider: "claude", configHome: "/tmp/other" }]);
});

test("session scope returns no accounts", async () => {
  const { claude, codex } = build({ profiles: [prof("claude-pb1", "claude", "/tmp/pb1"), prof("codex-1", "codex", "/tmp/cx1")] });
  const scope = { kind: "session", provider: "claude", env: { CLAUDE_CONFIG_DIR: "/tmp/pb1" } } as const;
  assert.deepEqual(await claude.discover(scope), []);
  assert.deepEqual(await codex.discover({ ...scope, provider: "codex" }), []);
});

test("account keys are stable, unique, valid, and contain no email or credential", async () => {
  const opts = { profiles: [prof("a", "claude", "/tmp/pb1"), prof("b", "claude", "/tmp/pb5"), prof("c", "claude", "/tmp/pb1/")],
    files: { "/tmp/pb1/.claude.json": { oauthAccount: { emailAddress: "pb1@x.com" } } } };
  const first = await build(opts).claude.discover(global);
  const second = await build(opts).claude.discover(global);
  assert.equal(first.length, 2, "profiles sharing a dir collapse to one account");
  assert.deepEqual(first.map((a) => a.key), second.map((a) => a.key));
  assert.notEqual(first[0].key, first[1].key);
  for (const a of first) {
    assert.match(a.key, KEY_RE);
    assert.ok(!a.key.includes("pb1@x.com"));
  }
  const s = JSON.stringify(first);
  for (const secret of ["pb1@x.com", TOKEN, "accessToken", "refreshToken"]) assert.ok(!s.includes(secret), secret);
});

test("claude and codex keys differ even for the same directory", async () => {
  const c = await build({ profiles: [prof("a", "claude", "/tmp/same")] }).claude.discover(global);
  const x = await build({ profiles: [prof("a", "codex", "/tmp/same")] }).codex.discover(global);
  assert.notEqual(c[0].key, x[0].key);
});

test("discover inputs validate against the source's own zod input schema and carry no credentials", async () => {
  const { sources } = build({ profiles: [prof("a", "claude", "/tmp/pb1"), prof("b", "codex", "/tmp/cx1")],
    files: { "/tmp/cx1/auth.json": { tokens: { id_token: jwt({ email: "c@x.com" }), access_token: ID_SECRET } } } });
  for (const s of sources) {
    for (const a of await s.discover(global)) {
      assert.equal(s.input.safeParse(a.input).success, true);
      assert.deepEqual(Object.keys(a.input as object).sort(), ["configHome", "provider"]);
      noToken(a);
      assert.ok(!JSON.stringify(a).includes("c@x.com"));
    }
  }
});

test("discover keeps profile labels as the user wrote them and falls back to the profile id only when blank", async () => {
  const { claude, codex } = build({ profiles: [
    prof("claude-pb9", "claude", "/tmp/pb9", undefined, "Claude"),
    prof("claude-pb1", "claude", "/tmp/pb1", undefined, "Claude (부계정 pb1)"),
    prof("codex-work", "codex", "/tmp/codex-work", undefined, "Codex: Work"),
  ] });
  assert.deepEqual((await claude.discover(global)).map((account) => account.label), ["Claude", "Claude (부계정 pb1)"]);
  assert.equal((await codex.discover(global))[0].label, "Codex: Work");
});

test("usageSourceInput schema rejects relative paths, NULs, unknown keys and providers", () => {
  assert.equal(usageSourceInput.safeParse({ provider: "claude", configHome: "/ok" }).success, true);
  for (const bad of [{ provider: "claude", configHome: "rel" }, { provider: "claude", configHome: "/a\0b" },
    { provider: "claude", configHome: "/ok", token: "x" }, { provider: "gemini", configHome: "/ok" },
    { provider: "claude" }, null, "x"]) assert.equal(usageSourceInput.safeParse(bad).success, false);
});

// ---- fetch: claude ----
const claudeIn = { provider: "claude", configHome: "/tmp/pb1" };
const claudeProfiles = [prof("claude-pb1", "claude", "/tmp/pb1")];
const tl = (ts: number, input: number, output: number, id: string) => JSON.stringify({
  type: "assistant", timestamp: iso(ts), message: { id, usage: { input_tokens: input, output_tokens: output } } });

test("fetch ok -> available with windows, summary flags, tone, plan label and details", async () => {
  const { claude, urls } = build({
    profiles: claudeProfiles,
    files: { "/tmp/pb1/.claude.json": { oauthAccount: { emailAddress: "pb1@x.com", subscriptionType: "max" } } },
    tree: { "/tmp/pb1/projects/p/s.jsonl": [tl(NOW - H, 1000, 500, "m1")] },
    resp: { status: 200, body: {
      five_hour: { utilization: 42.5, resets_at: iso(NOW + 2 * H) },
      seven_day: { utilization: 85, resets_at: iso(NOW + 48 * H) },
      seven_day_opus: { utilization: 97 },
    } },
  });
  const report = await claude.fetch(claudeIn) as any;
  assert.equal(report.status, "available");
  assert.equal(report.planLabel, "max");
  const [five, week, opus] = report.windows;
  assert.deepEqual([five.id, five.shortLabel, five.summary, five.usedPct, five.tone, five.resetsAt], ["five_hour", "5h", true, 42.5, "ok", iso(NOW + 2 * H)]);
  assert.deepEqual([week.id, week.shortLabel, week.summary, week.usedPct, week.tone], ["weekly", "wk", true, 85, "warning"]);
  assert.equal(opus.summary, undefined);
  assert.equal(opus.tone, "danger");
  assert.equal(opus.shortLabel, "Opus");
  const detail = Object.fromEntries(report.details.map((d: any) => [d.id, d.value]));
  assert.equal(detail.email, "pb1@x.com");
  assert.equal(detail["tokens-5h"], "1.5K");
  assert.equal(detail["tokens-today"], "1.5K");
  assert.equal(detail["tokens-7d"], "1.5K");
  assert.deepEqual(urls, ["https://api.anthropic.com/api/oauth/usage"]);
  noToken(report);
});

test("fetch tone thresholds: 79.9 ok, 80 warning, 95 danger, 100 danger", async () => {
  for (const [pct, tone] of [[79.9, "ok"], [80, "warning"], [95, "danger"], [100, "danger"]] as const) {
    const { claude } = build({ profiles: claudeProfiles, resp: { status: 200, body: { five_hour: { utilization: pct } } } });
    const r = await claude.fetch(claudeIn) as any;
    assert.equal(r.windows[0].tone, tone, String(pct));
  }
});

test("fetch without logs omits token details; partial logs are labelled", async () => {
  const { claude } = build({ profiles: claudeProfiles });
  const r = await claude.fetch(claudeIn) as any;
  assert.deepEqual(r.details.map((d: any) => [d.id, d.label, d.value]), [["profile", "Profile", "claude-pb1"]]);
  assert.equal(r.planLabel, undefined);
});

test("fetch expired -> unavailable/expired with expiresAt", async () => {
  const { claude, urls } = build({ profiles: claudeProfiles, credential: creds({ expiresAt: NOW - H }) });
  const r = await claude.fetch(claudeIn) as any;
  assert.deepEqual(r, { status: "unavailable", problem: { kind: "expired", expiresAt: iso(NOW - H), refreshedBy: "claude" } });
  assert.equal(urls.length, 0);
  noToken(r);
});

test("fetch 401/403 -> unavailable/rejected with status", async () => {
  for (const status of [401, 403]) {
    const { claude } = build({ profiles: claudeProfiles, resp: { status, body: { error: TOKEN } } });
    const r = await claude.fetch(claudeIn) as any;
    assert.deepEqual(r, { status: "unavailable", problem: { kind: "rejected", status, refreshedBy: "claude" } });
    noToken(r);
  }
});

test("fetch with no credentials / non-local auth -> no_quota", async () => {
  for (const o of [{ credential: null }, { credential: "{}" }]) {
    const { claude, urls } = build({ profiles: claudeProfiles, ...o });
    const r = await claude.fetch(claudeIn) as any;
    assert.equal(r.status, "unavailable");
    assert.equal(r.problem.kind, "no_quota");
    assert.ok(r.problem.detail);
    assert.equal(urls.length, 0);
  }
  const ext = build({ profiles: [prof("x", "claude", "/tmp/pb1", { ANTHROPIC_API_KEY: "k" })] });
  const r = await ext.claude.fetch(claudeIn) as any;
  assert.equal(r.problem?.kind, "no_quota");
});

test("fetch other failures -> error without leaking the token", async () => {
  const cases: Opts[] = [
    { resp: { status: 500, body: {} } }, { resp: { status: 429, headers: { "retry-after": "60" } } },
    { resp: { status: 200, jsonThrows: true } }, { resp: { status: 200, body: "str" } },
    { credential: "garbage" }, { credential: new Error("keychain " + TOKEN) },
    { resp: { status: 200, body: { five_hour: null, seven_day: null } } },
  ];
  for (const c of cases) {
    const { claude } = build({ profiles: claudeProfiles, ...c });
    const r = await claude.fetch(claudeIn) as any;
    const expected = c.resp?.status === 200 && (c.resp.body as any)?.five_hour === null ? "no_quota" : "error";
    if (expected === "error") assert.equal(r.status, "error", JSON.stringify(c.resp ?? c.credential));
    else assert.equal(r.problem.kind, "no_quota");
    assert.ok(r.status !== "available");
    noToken(r);
  }
});

test("fetch validates the locator and never reads unconfigured or default homes", async () => {
  const { claude, codex, urls } = build({ profiles: [...claudeProfiles, prof("claude", "claude")] });
  const bad = [null, {}, { provider: "claude", configHome: "relative" }, { provider: "claude", configHome: "/tmp/pb1", token: TOKEN },
    { provider: "codex", configHome: "/tmp/pb1" }];
  for (const b of bad) {
    const r = await claude.fetch(b) as any;
    assert.equal(r.status, "error");
    noToken(r);
  }
  assert.equal((await codex.fetch(claudeIn) as any).status, "error", "claude locator rejected by codex source");
  const unknown = await claude.fetch({ provider: "claude", configHome: "/etc/elsewhere" }) as any;
  assert.equal(unknown.status, "error");
  const def = await claude.fetch({ provider: "claude", configHome: "/home/u/.claude" }) as any;
  assert.equal(def.status, "error", "default home is not served by the profile source");
  assert.equal(urls.length, 0);
});

test("fetch swallows profile-loading failures into an error report", async () => {
  const sources = createUsageSources({ loadProfiles: async () => { throw new Error("config " + TOKEN); },
    detection: { home, cwd: "/", env: {}, realpath: async (d) => d } });
  const r = await sources[0].fetch(claudeIn) as any;
  assert.equal(r.status, "error");
  noToken(r);
});

// ---- fetch: codex ----
const rl = (pct: number, resets: number) => ({ primary: { used_percent: pct, window_minutes: 300, resets_at: sec(resets) },
  secondary: { used_percent: pct / 2, window_minutes: 10_080, resets_at: sec(resets + 24 * H) } });
const tc = (ts: number, input: number, rate: unknown, total = input) => JSON.stringify({ timestamp: iso(ts), type: "event_msg",
  payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, output_tokens: 0 }, total_token_usage: { total_tokens: total, input_tokens: total } }, rate_limits: rate } });
const codexIn = { provider: "codex", configHome: "/tmp/cx1" };
const codexProfiles = [prof("codex-1", "codex", "/tmp/cx1")];
const sessionFile = "/tmp/cx1/sessions/2026/01/10/rollout.jsonl";

test("codex fetch: available with 5h/wk windows, details with email, tokens and observed-at", async () => {
  const observed = NOW - H;
  const { codex, urls } = build({
    profiles: codexProfiles,
    files: { "/tmp/cx1/auth.json": { tokens: { id_token: jwt({ email: "cx@x.com", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } }), access_token: ID_SECRET } } },
    tree: { [sessionFile]: [tc(observed, 2000, rl(30, NOW + 2 * H))] },
  });
  const r = await codex.fetch(codexIn) as any;
  assert.equal(r.status, "available");
  assert.equal(r.planLabel, "pro");
  assert.deepEqual(r.windows.map((w: any) => [w.id, w.shortLabel, w.summary, w.usedPct, w.tone]),
    [["five_hour", "5h", true, 30, "ok"], ["weekly", "wk", true, 15, "ok"]]);
  const detail = Object.fromEntries(r.details.map((d: any) => [d.id, d]));
  assert.equal(detail.email.value, "cx@x.com");
  assert.equal(detail["tokens-5h"].value, "2K");
  assert.ok(detail["observed-at"], "observedAt detail present");
  assert.match(detail["observed-at"].value, /2026/);
  assert.match(detail["observed-at"].label, /UTC/);
  assert.equal(urls.length, 0);
  noToken(r);
});

test("codex fetch: past reset reports zero usage; high usage tone", async () => {
  const past = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - 6 * H, 5, rl(100, NOW - H))] } });
  const r = await past.codex.fetch(codexIn) as any;
  assert.equal(r.windows[0].usedPct, 0);
  assert.equal(r.windows[0].tone, "ok");
  const hot = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - H, 5, rl(96, NOW + H))] } });
  assert.equal(((await hot.codex.fetch(codexIn)) as any).windows[0].tone, "danger");
});

test("codex fetch: custom window durations map to non-5h/wk windows", async () => {
  const rate = { primary: { used_percent: 10, window_minutes: 60, resets_at: sec(NOW + H) } };
  const { codex } = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - H, 5, rate)] } });
  const r = await codex.fetch(codexIn) as any;
  assert.equal(r.status, "available");
  assert.equal(r.windows.length, 1);
  assert.ok(r.windows[0].id !== "five_hour" && r.windows[0].id !== "weekly");
  assert.ok(!r.windows[0].summary);
});

test("codex fetch: no logs or no rate limits in logs -> no_quota", async () => {
  const none = build({ profiles: codexProfiles });
  assert.equal(((await none.codex.fetch(codexIn)) as any).problem.kind, "no_quota");
  const noRate = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - H, 5, null)] } });
  const r = await noRate.codex.fetch(codexIn) as any;
  assert.equal(r.status, "unavailable");
  assert.equal(r.problem.kind, "no_quota");
});

test("codex fetch: unreadable logs -> error or no_quota but never available, no secrets", async () => {
  const { codex } = build({ profiles: codexProfiles, tree: { [sessionFile]: [] } });
  const r = await codex.fetch(codexIn) as any;
  assert.notEqual(r.status, "available");
  noToken(r);
});

// ---- toUsageReport ----
const emptyLocal = { state: "unavailable" as const, fiveHourStartsAt: iso(NOW), fiveHour: {} as never, today: {} as never, sevenDay: {} as never };
const base = { provider: "claude" as const, profileIds: ["a"], label: "a", configHome: "/a", local: emptyLocal, warningLevel: "unknown" as const };

test("toUsageReport maps every rate-limit state", () => {
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "error", windows: [], message: "boom" } }) as any).error, "boom");
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "error", windows: [] } }) as any).status, "error");
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "unauthenticated", windows: [] } }) as any).problem.kind, "no_quota");
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "unavailable", windows: [], message: "m" } }) as any).problem.detail, "m");
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "expired", windows: [], expiresAt: iso(NOW) } }) as any).problem.kind, "expired");
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "expired", windows: [] } }) as any).status, "error"); // no expiresAt to report
  assert.equal((toUsageReport({ ...base, rateLimits: { state: "unauthenticated", windows: [], rejectedStatus: 403 } }) as any).problem.status, 403);
});

test("toUsageReport dedupes windows with the same id", () => {
  const w = { id: "five_hour", kind: "five_hour" as const, utilization: 1, resetsAt: null, limited: false };
  const r = toUsageReport({ ...base, rateLimits: { state: "ok", windows: [w, { ...w, utilization: 2 }] } }) as any;
  assert.equal(r.windows.length, 1);
});


const det = (extra: object = {}) => ({ home, cwd: "/work", env: {} as NodeJS.ProcessEnv, realpath: async (d: string) => d, ...extra });

// ---------- label rule ----------
test("usageAccountLabel keeps the user's profile name whole, including a provider prefix", () => {
  const L = (provider: "claude" | "codex", label: string, id = "p1") => usageAccountLabel(provider, { label, profileIds: [id] }, [{ label, profileIds: [id] }]);
  for (const label of ["Claude (부계정 pb1)", "Claude", "claude", "Claude · work", "Claude: work", "Claude - work", "Claude work", "Claude ()", "Claudette", "claude-pb1", "Claude (a) (b)"]) {
    assert.equal(L("claude", label), label);
  }
  assert.equal(L("codex", "Codex (pb)"), "Codex (pb)");
  assert.equal(L("codex", "Claude (pb)"), "Claude (pb)");
  assert.equal(L("claude", "  부계정  "), "부계정", "surrounding space is trimmed");
  assert.equal(L("claude", "", "pid"), "pid", "a blank label falls back to the profile id");
  assert.equal(L("claude", "   ", "pid"), "pid");
});

test("usageAccountLabel disambiguates identical labels with the profile id, and only those", () => {
  const accounts = [{ label: "Same", profileIds: ["a"] }, { label: "Same", profileIds: ["b"] }, { label: "Claude (Same)", profileIds: ["c"] }, { label: "Other", profileIds: ["d"] }];
  assert.deepEqual(accounts.map((x) => usageAccountLabel("claude", x, accounts)), ["Same · a", "Same · b", "Claude (Same)", "Other"]);
});

test("builtinUsageHomes: default dir and env override, canonicalized", async () => {
  const s = await builtinUsageHomes("claude", det({ env: { CLAUDE_CONFIG_DIR: "/tmp/env/" }, realpath: async (d: string) => (d === "/tmp/env" ? "/real/env" : d) }));
  assert.deepEqual([...s].sort(), ["/home/u/.claude", "/real/env"]);
  assert.deepEqual([...(await builtinUsageHomes("codex", det()))], ["/home/u/.codex"]);
});

// ---------- refreshedBy ----------
const baseAcct = (provider: "claude" | "codex") => ({ provider, profileIds: ["a"], label: "a", configHome: "/a", warningLevel: "unknown" as const,
  local: { state: "unavailable" as const, fiveHourStartsAt: new Date(NOW).toISOString(), fiveHour: {} as never, today: {} as never, sevenDay: {} as never } });

test("refreshedBy is the provider on expired and rejected problems", () => {
  for (const provider of ["claude", "codex"] as const) {
    const expired = toUsageReport({ ...baseAcct(provider), rateLimits: { state: "expired", windows: [], expiresAt: new Date(NOW).toISOString() } }) as any;
    assert.deepEqual(expired.problem, { kind: "expired", expiresAt: new Date(NOW).toISOString(), refreshedBy: provider });
    const rejected = toUsageReport({ ...baseAcct(provider), rateLimits: { state: "unauthenticated", windows: [], rejectedStatus: 401 } }) as any;
    assert.deepEqual(rejected.problem, { kind: "rejected", status: 401, refreshedBy: provider });
    const noQuota = toUsageReport({ ...baseAcct(provider), rateLimits: { state: "unauthenticated", windows: [] } }) as any;
    assert.equal(noQuota.problem.refreshedBy, undefined);
  }
});

// ---- A-6: window length, observation time, account de-duplication ----
test("durationSeconds: Claude 5h=18000, weekly and model weekly=604800, kept next to the SDK helper fields", async () => {
  const { claude } = build({
    profiles: claudeProfiles,
    resp: { status: 200, body: {
      five_hour: { utilization: 10, resets_at: iso(NOW + H) },
      seven_day: { utilization: 20, resets_at: iso(NOW + 48 * H) },
      seven_day_opus: { utilization: 30, resets_at: iso(NOW + 48 * H) },
    } },
  });
  const report = await claude.fetch(claudeIn) as any;
  const [five, week, opus] = report.windows;
  assert.deepEqual([five.id, five.shortLabel, five.durationSeconds], ["five_hour", "5h", 18_000]);
  assert.deepEqual([week.id, week.shortLabel, week.durationSeconds], ["weekly", "wk", 604_800]);
  assert.equal(opus.shortLabel, "Opus");
  assert.equal(opus.durationSeconds, 604_800);
});

test("durationSeconds: Codex windowMinutes*60, including a custom window", async () => {
  const rate = {
    primary: { used_percent: 10, window_minutes: 300, resets_at: sec(NOW + H) },
    secondary: { used_percent: 5, window_minutes: 10_080, resets_at: sec(NOW + 24 * H) },
  };
  const std = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - H, 5, rate)] } });
  const r = await std.codex.fetch(codexIn) as any;
  assert.deepEqual(r.windows.map((w: any) => [w.id, w.durationSeconds]), [["five_hour", 18_000], ["weekly", 604_800]]);
  const custom = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - H, 5, {
    primary: { used_percent: 10, window_minutes: 60, resets_at: sec(NOW + H) } })] } });
  const c = await custom.codex.fetch(codexIn) as any;
  assert.equal(c.windows[0].durationSeconds, 3_600);
});

test("observedAt: Codex report carries the log time, not the read time; Claude carries the API completion time", async () => {
  const observed = NOW - 3 * H;
  const cx = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(observed, 5, rl(30, NOW + 2 * H))] } });
  assert.equal(((await cx.codex.fetch(codexIn)) as any).observedAt, iso(observed));
  const cl = build({ profiles: claudeProfiles });
  assert.equal(((await cl.claude.fetch(claudeIn)) as any).observedAt, iso(NOW));
});

test("toUsageReport: observedAt only appears when the rate limits have one", () => {
  const base = { provider: "claude", profileIds: [], label: "x", configHome: "/x", warningLevel: "ok", local: { state: "unavailable" } } as any;
  const windows = [{ id: "five_hour", kind: "five_hour", utilization: 1 }];
  const withObs = toUsageReport({ ...base, rateLimits: { state: "ok", windows, observedAt: iso(NOW - H) } }) as any;
  const without = toUsageReport({ ...base, rateLimits: { state: "ok", windows } }) as any;
  assert.equal(withObs.observedAt, iso(NOW - H));
  assert.ok(!("observedAt" in without));
});

test("codex fetch: a window past its reset shows 0%, not limited, with the past resetsAt and the original log time", async () => {
  const observed = NOW - 6 * H;
  const past = NOW - H;
  const { codex } = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(observed, 5, rl(100, past))] } });
  const r = await codex.fetch(codexIn) as any;
  assert.equal(r.windows[0].usedPct, 0);
  assert.equal(r.windows[0].tone, "ok");
  assert.equal(r.windows[0].resetsAt, iso(sec(past) * 1000));
  assert.equal(r.observedAt, iso(observed), "the observation time is not regenerated as 'now'");
  assert.equal(r.windows[0].durationSeconds, 18_000);
});

const claudeState = (email: string, accountUuid?: string, organizationUuid?: string) =>
  ({ oauthAccount: { emailAddress: email, accountUuid, organizationUuid } });
const codexAuth = (o: { email?: string; accountId?: string; userId?: string; sub?: string }) => ({
  tokens: {
    id_token: jwt({ email: o.email, sub: o.sub, "https://api.openai.com/auth": { chatgpt_user_id: o.userId, chatgpt_plan_type: "team" } }),
    account_id: o.accountId,
  },
});
const homesOf = (accounts: { input: unknown }[]) => accounts.map((a) => (a.input as { configHome: string }).configHome);

test("claude dedupe: same accountUuid+organizationUuid in two homes is one card", async () => {
  const { claude } = build({
    profiles: [prof("a", "claude", "/tmp/a"), prof("b", "claude", "/tmp/b")],
    files: { "/tmp/a/.claude.json": claudeState("a@x.com", "u1", "o1"), "/tmp/b/.claude.json": claudeState("b@x.com", "u1", "o1") },
  });
  const accounts = await claude.discover(global);
  assert.equal(accounts.length, 1);
});

test("claude dedupe: same email only, a different accountUuid/organizationUuid, or no uuids does not merge", async () => {
  const sameEmail = build({
    profiles: [prof("a", "claude", "/tmp/a"), prof("b", "claude", "/tmp/b"), prof("c", "claude", "/tmp/c")],
    files: {
      "/tmp/a/.claude.json": claudeState("same@x.com", "u1", "o1"),
      "/tmp/b/.claude.json": claudeState("same@x.com", "u2", "o1"),
      "/tmp/c/.claude.json": claudeState("same@x.com", "u1", "o2"),
    },
  });
  assert.equal((await sameEmail.claude.discover(global)).length, 3);
  const noUuid = build({
    profiles: [prof("a", "claude", "/tmp/a"), prof("b", "claude", "/tmp/b")],
    files: { "/tmp/a/.claude.json": claudeState("same@x.com"), "/tmp/b/.claude.json": claudeState("same@x.com") },
  });
  assert.deepEqual(homesOf(await noUuid.claude.discover(global)), ["/tmp/a", "/tmp/b"]);
  const half = build({
    profiles: [prof("a", "claude", "/tmp/a"), prof("b", "claude", "/tmp/b")],
    files: { "/tmp/a/.claude.json": claudeState("same@x.com", "u1"), "/tmp/b/.claude.json": claudeState("same@x.com", "u1") },
  });
  assert.equal((await half.claude.discover(global)).length, 2, "a missing organizationUuid proves nothing");
});

test("claude dedupe: unknown identity never merges across homes, but one home listed twice stays one", async () => {
  const { claude } = build({
    profiles: [prof("a", "claude", "/tmp/a"), prof("a2", "claude", "/tmp/a/"), prof("b", "claude", "/tmp/b")],
  });
  assert.deepEqual(homesOf(await claude.discover(global)), ["/tmp/a", "/tmp/b"]);
});

test("claude dedupe: an identity already served by the default home or the daemon-env home gets no extra card", async () => {
  const { claude } = build({
    env: { CLAUDE_CONFIG_DIR: "/tmp/daemon-env" },
    profiles: [prof("copy-default", "claude", "/tmp/copy1"), prof("copy-env", "claude", "/tmp/copy2"), prof("other", "claude", "/tmp/other")],
    files: {
      "/home/u/.claude.json": claudeState("d@x.com", "ud", "od"),
      "/tmp/daemon-env/.claude.json": claudeState("e@x.com", "ue", "oe"),
      "/tmp/copy1/.claude.json": claudeState("d@x.com", "ud", "od"),
      "/tmp/copy2/.claude.json": claudeState("e@x.com", "ue", "oe"),
      "/tmp/other/.claude.json": claudeState("o@x.com", "uo", "oo"),
    },
  });
  assert.deepEqual(homesOf(await claude.discover(global)), ["/tmp/other"]);
});

test("claude account keys follow the quota identity, not the directory", async () => {
  const files = { "/tmp/a/.claude.json": claudeState("a@x.com", "u1", "o1"), "/tmp/b/.claude.json": claudeState("a@x.com", "u1", "o1") };
  const one = await build({ profiles: [prof("a", "claude", "/tmp/a")], files }).claude.discover(global);
  const two = await build({ profiles: [prof("b", "claude", "/tmp/b")], files }).claude.discover(global);
  assert.equal(one[0].key, two[0].key);
  assert.ok(KEY_RE.test(one[0].key));
});

test("codex dedupe: same account_id + same user in two homes is one card; a different user in the same team stays separate", async () => {
  const same = build({
    profiles: [prof("a", "codex", "/tmp/a"), prof("b", "codex", "/tmp/b")],
    files: {
      "/tmp/a/auth.json": codexAuth({ email: "a@x.com", accountId: "team-1", userId: "user-1" }),
      "/tmp/b/auth.json": codexAuth({ email: "b@x.com", accountId: "team-1", userId: "user-1" }),
    },
  });
  assert.equal((await same.codex.discover(global)).length, 1);
  const team = build({
    profiles: [prof("a", "codex", "/tmp/a"), prof("b", "codex", "/tmp/b")],
    files: {
      "/tmp/a/auth.json": codexAuth({ email: "a@x.com", accountId: "team-1", userId: "user-1" }),
      "/tmp/b/auth.json": codexAuth({ email: "b@x.com", accountId: "team-1", userId: "user-2" }),
    },
  });
  assert.equal((await team.codex.discover(global)).length, 2);
});

test("codex dedupe: the sub claim stands in for chatgpt_user_id", async () => {
  const bySub = build({
    profiles: [prof("a", "codex", "/tmp/a"), prof("b", "codex", "/tmp/b"), prof("c", "codex", "/tmp/c")],
    files: {
      "/tmp/a/auth.json": codexAuth({ accountId: "team-1", sub: "auth0|1" }),
      "/tmp/b/auth.json": codexAuth({ accountId: "team-1", sub: "auth0|1" }),
      "/tmp/c/auth.json": codexAuth({ accountId: "team-1", sub: "auth0|2" }),
    },
  });
  assert.deepEqual(homesOf(await bySub.codex.discover(global)), ["/tmp/a", "/tmp/c"]);
});

test("codex dedupe: same email only, a different account_id, or no auth.json does not merge", async () => {
  const { codex } = build({
    profiles: [prof("a", "codex", "/tmp/a"), prof("b", "codex", "/tmp/b"), prof("c", "codex", "/tmp/c"), prof("d", "codex", "/tmp/d")],
    files: {
      "/tmp/a/auth.json": codexAuth({ email: "same@x.com", accountId: "acct-1", userId: "u" }),
      "/tmp/b/auth.json": codexAuth({ email: "same@x.com", accountId: "acct-2", userId: "u" }),
      "/tmp/c/auth.json": codexAuth({ email: "same@x.com" }),
    },
  });
  assert.deepEqual(homesOf(await codex.discover(global)), ["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/d"]);
});

// A shared workspace id without any per-user claim proves nothing about who is logged in.
test("codex dedupe: a team account_id without a user claim does not merge two homes", async () => {
  const { codex } = build({
    profiles: [prof("a", "codex", "/tmp/a"), prof("b", "codex", "/tmp/b")],
    files: {
      "/tmp/a/auth.json": codexAuth({ email: "a@x.com", accountId: "team-1" }),
      "/tmp/b/auth.json": codexAuth({ email: "b@x.com", accountId: "team-1" }),
    },
  });
  assert.equal((await codex.discover(global)).length, 2);
});

test("codex dedupe: an identity already served by ~/.codex or the daemon CODEX_HOME gets no extra card", async () => {
  const { codex } = build({
    env: { CODEX_HOME: "/tmp/daemon-codex" },
    profiles: [prof("copy-default", "codex", "/tmp/c1"), prof("copy-env", "codex", "/tmp/c2"), prof("other", "codex", "/tmp/c3")],
    files: {
      "/home/u/.codex/auth.json": codexAuth({ accountId: "acct-d", userId: "ud" }),
      "/tmp/daemon-codex/auth.json": codexAuth({ accountId: "acct-e", userId: "ue" }),
      "/tmp/c1/auth.json": codexAuth({ accountId: "acct-d", userId: "ud" }),
      "/tmp/c2/auth.json": codexAuth({ accountId: "acct-e", userId: "ue" }),
      "/tmp/c3/auth.json": codexAuth({ accountId: "acct-o", userId: "uo" }),
    },
  });
  assert.deepEqual(homesOf(await codex.discover(global)), ["/tmp/c3"]);
});

test("codex dedupe: keys and inputs never contain the account or user ids", async () => {
  const { codex } = build({
    profiles: [prof("a", "codex", "/tmp/a")],
    files: { "/tmp/a/auth.json": codexAuth({ email: "leak@x.com", accountId: "ACCT-LEAK", userId: "USER-LEAK" }) },
  });
  const accounts = await codex.discover(global);
  const s = JSON.stringify(accounts);
  for (const secret of ["ACCT-LEAK", "USER-LEAK", "leak@x.com"]) assert.ok(!s.includes(secret), secret);
  assert.ok(KEY_RE.test(accounts[0].key));
});

test("account keys and cards stay stable when the order of path aliases changes", async () => {
  const realpath = async (d: string) => d.replace(/^\/tmp\/alias/, "/tmp/real");
  const state = { "/tmp/real/.claude.json": claudeState("a@x.com", "u1", "o1"), "/tmp/alias/.claude.json": claudeState("a@x.com", "u1", "o1") };
  const noIdentity = {};
  for (const files of [state, noIdentity]) {
    const forward = await build({ realpath, files, profiles: [prof("r", "claude", "/tmp/real"), prof("a", "claude", "/tmp/alias")] }).claude.discover(global);
    const reverse = await build({ realpath, files, profiles: [prof("a", "claude", "/tmp/alias"), prof("r", "claude", "/tmp/real")] }).claude.discover(global);
    assert.equal(forward.length, 1);
    assert.equal(reverse.length, 1);
    assert.equal(forward[0].key, reverse[0].key);
  }
});

test("codex account keys stay stable when the order of path aliases changes", async () => {
  const realpath = async (d: string) => d.replace(/^\/tmp\/alias/, "/tmp/real");
  const auth = codexAuth({ accountId: "acct-1", userId: "u1" });
  const files = { "/tmp/real/auth.json": auth, "/tmp/alias/auth.json": auth };
  const forward = await build({ realpath, files, profiles: [prof("r", "codex", "/tmp/real"), prof("a", "codex", "/tmp/alias")] }).codex.discover(global);
  const reverse = await build({ realpath, files, profiles: [prof("a", "codex", "/tmp/alias"), prof("r", "codex", "/tmp/real")] }).codex.discover(global);
  assert.equal(forward.length, 1);
  assert.equal(reverse.length, 1);
  assert.equal(forward[0].key, reverse[0].key);
});

// ---- actionable messages, source order, and the Profile detail ----
const detailOf = (report: any, id: string) => report.details.find((d: any) => d.id === id)?.value;

test("every usage card has a Profile detail with the profile's full name, Claude and Codex", async () => {
  const cl = build({ profiles: [prof("claude-pb1", "claude", "/tmp/pb1", undefined, "Claude (부계정 pb1)")] });
  assert.equal(detailOf(await cl.claude.fetch(claudeIn), "profile"), "Claude (부계정 pb1)");
  const cx = build({ profiles: [prof("codex-1", "codex", "/tmp/cx1", undefined, "Codex: Work")], tree: { [sessionFile]: [tc(NOW - H, 5, rl(30, NOW + 2 * H))] } });
  const r = await cx.codex.fetch(codexIn) as any;
  assert.equal(detailOf(r, "profile"), "Codex: Work");
  assert.equal(r.details[0].id, "profile", "first, before email and tokens");
  const blank = build({ profiles: [prof("claude-pb1", "claude", "/tmp/pb1", undefined, "  ")] });
  assert.equal(detailOf(await blank.claude.fetch(claudeIn), "profile"), "claude-pb1");
});

test("the Profile detail does not change quota identity keys or account de-duplication", async () => {
  const files = { "/tmp/a/.claude.json": claudeState("a@x.com", "u1", "o1"), "/tmp/b/.claude.json": claudeState("b@x.com", "u1", "o1") };
  const one = await build({ profiles: [prof("a", "claude", "/tmp/a", undefined, "Name One")], files }).claude.discover(global);
  const renamed = await build({ profiles: [prof("a", "claude", "/tmp/a", undefined, "Another Name")], files }).claude.discover(global);
  assert.equal(one[0].key, renamed[0].key, "renaming a profile keeps its key");
  const both = await build({ profiles: [prof("a", "claude", "/tmp/a", undefined, "Name One"), prof("b", "claude", "/tmp/b", undefined, "Name Two")], files }).claude.discover(global);
  assert.equal(both.length, 1, "the same quota identity is still one card");
  assert.equal(both[0].key, one[0].key);
});

test("actionable messages: login required names the command to run", async () => {
  for (const credential of [null, "{}"]) {
    const { claude } = build({ profiles: claudeProfiles, credential });
    const r = await claude.fetch(claudeIn) as any;
    assert.equal(r.problem.kind, "no_quota");
    assert.match(r.problem.detail, /claude auth login/);
    assert.match(r.problem.detail, /refresh/i);
  }
});

test("actionable messages: expired and rejected logins are problems the host explains (no free text), and unreadable credentials say what to open", async () => {
  const expired = await build({ profiles: claudeProfiles, credential: creds({ expiresAt: NOW - 1 }) }).claude.fetch(claudeIn) as any;
  assert.equal(expired.problem.kind, "expired");
  const rejected = await build({ profiles: claudeProfiles, resp: { status: 401 } }).claude.fetch(claudeIn) as any;
  assert.deepEqual([rejected.problem.kind, rejected.problem.status], ["rejected", 401]);
  const unreadable = await build({ profiles: claudeProfiles, credential: new Error("keychain locked") }).claude.fetch(claudeIn) as any;
  assert.equal(unreadable.status, "error");
  assert.match(unreadable.error, /Claude CLI/);
  assert.match(unreadable.error, /refresh/i);
  const malformed = await build({ profiles: claudeProfiles, credential: "garbage" }).claude.fetch(claudeIn) as any;
  assert.match(malformed.error, /claude auth login/);
});

test("actionable messages: 429 says to wait; server and connection failures say to check the connection and retry", async () => {
  const throttled = await build({ profiles: claudeProfiles, resp: { status: 429, headers: { "retry-after": "60" } } }).claude.fetch(claudeIn) as any;
  assert.equal(throttled.status, "error");
  assert.match(throttled.error, /rate-limited/);
  assert.match(throttled.error, /Wait/);
  const down = await build({ profiles: claudeProfiles, resp: { status: 503, body: {} } }).claude.fetch(claudeIn) as any;
  assert.match(down.error, /connection and retry/);
  const unreadable = await build({ profiles: claudeProfiles, resp: { status: 200, jsonThrows: true } }).claude.fetch(claudeIn) as any;
  assert.match(unreadable.error, /connection and retry/);
  const garbage = await build({ profiles: claudeProfiles, resp: { status: 200, body: "str" } }).claude.fetch(claudeIn) as any;
  assert.match(garbage.error, /unreadable\. Refresh/);
  for (const r of [throttled, down, unreadable, garbage]) {
    noToken(r);
    assert.doesNotMatch(r.error, /Anthropic/, "no provider jargon or raw errors");
  }
});

test("actionable messages: a plan with no usage meters and an API/gateway login say what to check", async () => {
  const none = await build({ profiles: claudeProfiles, resp: { status: 200, body: { five_hour: null, seven_day: null } } }).claude.fetch(claudeIn) as any;
  assert.equal(none.problem.kind, "no_quota");
  assert.match(none.problem.detail, /plan in Claude/);
  const gateway = await build({ profiles: [prof("x", "claude", "/tmp/pb1", { ANTHROPIC_API_KEY: "k" })] }).claude.fetch(claudeIn) as any;
  assert.match(gateway.problem.detail, /billing/);
});

test("actionable messages: Codex without a session log says how to create one", async () => {
  for (const tree of [{}, { [sessionFile]: [tc(NOW - H, 5, null)] }] as Record<string, string[]>[]) {
    const { codex } = build({ profiles: codexProfiles, tree });
    const r = await codex.fetch(codexIn) as any;
    assert.equal(r.problem.kind, "no_quota", JSON.stringify(Object.keys(tree)));
    assert.match(r.problem.detail, /Send a prompt in this profile's Codex CLI/);
    assert.match(r.problem.detail, /codex login/);
  }
});

test("actionable messages: locator and configuration failures say what to do", async () => {
  const { claude } = build({ profiles: claudeProfiles });
  const stale = await claude.fetch({ provider: "claude", configHome: "/tmp/removed" }) as any;
  assert.match(stale.error, /removed\. Refresh the usage panel/);
  const invalid = await claude.fetch({ provider: "claude", configHome: "relative" }) as any;
  assert.match(invalid.error, /choose this profile again/);
  const broken = createUsageSources({ loadProfiles: async () => { throw new Error("x"); }, detection: { home, cwd: "/", env: {}, realpath: async (d) => d } });
  assert.match(((await broken[0].fetch(claudeIn)) as any).error, /configuration and CLI login/);
});

test("source order: the profiles sources sort after each provider's default source by name, and a saved order still wins", () => {
  const { sources } = build();
  const labels = sources.map((s) => s.label);
  assert.deepEqual(labels, ["Claude profiles", "Codex profiles"]);
  // Paseo orders sources by label when the user saved nothing: the default cards are "Claude" / "Codex".
  const byLabel = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(byLabel(["Claude profiles", "Claude", "Codex", "Codex profiles"]), ["Claude", "Claude profiles", "Codex", "Codex profiles"]);
  for (const [defaultLabel, extra] of [["Claude", "Claude profiles"], ["Codex", "Codex profiles"]]) {
    assert.ok(extra.startsWith(defaultLabel) && extra.length > defaultLabel.length, `${extra} extends ${defaultLabel}`);
  }
  // A saved cardOrder is applied by the host over the default sort; the ids, not labels, are what it stores.
  const saved = ["codex-profiles", "claude-profiles"];
  const ordered = [...sources].sort((a, b) => saved.indexOf(a.id) - saved.indexOf(b.id));
  assert.deepEqual(ordered.map((s) => s.id), saved);
  assert.deepEqual(sources.map((s) => s.id), ["claude-profiles", "codex-profiles"], "source ids are unchanged, so saved orders stay valid");
});

test("A-6 is unchanged by the label work: window lengths, observation time and keys", async () => {
  const cx = build({ profiles: codexProfiles, tree: { [sessionFile]: [tc(NOW - 3 * H, 5, rl(30, NOW + 2 * H))] } });
  const r = await cx.codex.fetch(codexIn) as any;
  assert.deepEqual(r.windows.map((w: any) => w.durationSeconds), [18_000, 604_800]);
  assert.equal(r.observedAt, iso(NOW - 3 * H));
  const cl = await build({ profiles: claudeProfiles }).claude.fetch(claudeIn) as any;
  assert.deepEqual(cl.windows.map((w: any) => w.durationSeconds), [18_000, 604_800]);
  assert.equal(cl.observedAt, iso(NOW));
  const keyA = (await build({ profiles: [prof("a", "claude", "/tmp/a", undefined, "One")] }).claude.discover(global))[0].key;
  const keyB = (await build({ profiles: [prof("a", "claude", "/tmp/a", undefined, "Two")] }).claude.discover(global))[0].key;
  assert.equal(keyA, keyB);
});
