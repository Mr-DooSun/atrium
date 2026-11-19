import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateLocalUsage, createLocalUsageReader, parseUsageLine, type LocalUsageEntry } from "../server/usage/local-usage.ts";
import { LocalUsage } from "../shared/usage/types.ts";

const H = 3_600_000;
const NOW = new Date(2026, 0, 10, 15, 0, 0).getTime(); // local 15:00
const TODAY = new Date(NOW).setHours(0, 0, 0, 0);
const tk = (n: number) => ({ inputTokens: n, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
const entry = (timestamp: number, n: number, ids: { messageId?: string; requestId?: string } = {}): LocalUsageEntry =>
  ({ timestamp, tokens: tk(n), ...ids });
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const assistant = (ts: string | number, usage: unknown, extra: Record<string, unknown> = {}, msg: Record<string, unknown> = {}) =>
  line({ type: "assistant", timestamp: typeof ts === "number" ? new Date(ts).toISOString() : ts, message: { usage, ...msg }, ...extra });

test("parseUsageLine: valid assistant line", () => {
  const e = parseUsageLine(assistant("2026-01-01T00:00:00Z",
    { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 },
    { requestId: "req_1" }, { id: "msg_1" }));
  assert.deepEqual(e, {
    timestamp: Date.parse("2026-01-01T00:00:00Z"), messageId: "msg_1", requestId: "req_1",
    tokens: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 },
  });
});

test("parseUsageLine: rejects malformed and non-assistant lines", () => {
  const u = { input_tokens: 1 };
  for (const l of [
    "", "{bad", "[]", "null", "42",
    line({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { usage: u } }),
    line({ type: "assistant", message: { usage: u } }),
    line({ type: "assistant", timestamp: "nonsense", message: { usage: u } }),
    line({ type: "assistant", timestamp: 12345, message: { usage: u } }),
    line({ type: "assistant", timestamp: "2026-01-01T00:00:00Z" }),
    line({ type: "assistant", timestamp: "2026-01-01T00:00:00Z", message: { usage: "x" } }),
    assistant("2026-01-01T00:00:00Z", {}),
    assistant("2026-01-01T00:00:00Z", { input_tokens: -1, output_tokens: 1.5, cache_read_input_tokens: "3" }),
  ]) assert.equal(parseUsageLine(l), undefined, l);
});

test("parseUsageLine: partial token fields default to zero; requestId fallback from message", () => {
  const e = parseUsageLine(assistant("2026-01-01T00:00:00Z", { output_tokens: 7, input_tokens: "x" }, {}, { requestId: "r2" }));
  assert.deepEqual(e?.tokens, { inputTokens: 0, outputTokens: 7, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  assert.equal(e?.requestId, "r2");
  assert.equal(e?.messageId, undefined);
});

test("aggregate: window boundaries default (no reset)", () => {
  const r = aggregateLocalUsage([
    entry(NOW - 5 * H, 1),             // exactly 5h: included
    entry(NOW - 5 * H - 1, 10),        // just outside 5h
    entry(TODAY, 100),                 // midnight: in today
    entry(TODAY - 1, 1000),            // before midnight
    entry(NOW - 7 * 24 * H, 10_000),   // exactly 7d: included
    entry(NOW - 7 * 24 * H - 1, 100_000),
    entry(NOW + 1, 1_000_000),         // future ignored
  ], NOW);
  assert.equal(r.fiveHourStartsAt, new Date(NOW - 5 * H).toISOString());
  assert.equal(r.fiveHour.inputTokens, 1); // midnight entry is 15h old
  assert.equal(r.today.inputTokens, 1 + 10 + 100); // 10:00-15:00 entries plus midnight; TODAY-1 excluded
  assert.equal(r.sevenDay.inputTokens, 1 + 10 + 100 + 1000 + 10_000);
  assert.equal(r.state, "ok");
});

test("aggregate: 5h window anchored to resetsAt", () => {
  const reset = NOW + 2 * H; // window started NOW-3h
  const r = aggregateLocalUsage([entry(NOW - 3 * H, 1), entry(NOW - 3 * H - 1, 10), entry(NOW - 1, 100)], NOW, new Date(reset).toISOString());
  assert.equal(r.fiveHourStartsAt, new Date(NOW - 3 * H).toISOString());
  assert.equal(r.fiveHour.inputTokens, 101);
});

test("aggregate: bad / past / too-far resetsAt falls back to rolling 5h", () => {
  const fallback = new Date(NOW - 5 * H).toISOString();
  for (const reset of [null, undefined, "garbage", new Date(NOW - H).toISOString(), new Date(NOW).toISOString(), new Date(NOW + 6 * H).toISOString()]) {
    assert.equal(aggregateLocalUsage([], NOW, reset).fiveHourStartsAt, fallback, String(reset));
  }
  assert.equal(aggregateLocalUsage([], NOW, new Date(NOW + 5 * H).toISOString()).fiveHourStartsAt, new Date(NOW).toISOString());
});

test("aggregate: empty yields zero totals and schema-valid shape", () => {
  const r = aggregateLocalUsage([], NOW, null, "unavailable");
  assert.equal(r.state, "unavailable");
  assert.deepEqual(r.today, tk(0));
  LocalUsage.parse(r);
});

test("aggregate: dedupes by message id, requestId, and transitive links; keeps max tokens and earliest ts", () => {
  const r = aggregateLocalUsage([
    entry(NOW - H, 5, { messageId: "m1" }),
    entry(NOW - H, 9, { messageId: "m1" }),          // streaming snapshot, larger
    entry(NOW - H, 3, { messageId: "m1" }),
    entry(NOW - 2 * H, 4, { requestId: "r1" }),
    entry(NOW - H, 6, { requestId: "r1" }),
    entry(NOW - H, 1, { messageId: "m2", requestId: "r2" }),
    entry(NOW - H, 2, { messageId: "m3", requestId: "r2" }),   // m2,m3 linked via r2
    entry(NOW - H, 20, { messageId: "m3" }),
    entry(NOW - H, 50),                                // no ids: counted each time
    entry(NOW - H, 50),
  ], NOW);
  assert.equal(r.fiveHour.inputTokens, 9 + 6 + 20 + 100);
});

test("aggregate: merged group uses earliest timestamp for window membership", () => {
  const r = aggregateLocalUsage([
    entry(NOW - 6 * H, 5, { messageId: "m" }),   // outside 5h
    entry(NOW - H, 8, { messageId: "m" }),
  ], NOW);
  assert.equal(r.fiveHour.inputTokens, 0);
  assert.equal(r.sevenDay.inputTokens, 8);
});

test("aggregate: duplicates across later-linked groups are not double counted", () => {
  const r = aggregateLocalUsage([
    entry(NOW - H, 4, { messageId: "a" }),
    entry(NOW - H, 7, { requestId: "x" }),
    entry(NOW - H, 1, { messageId: "a", requestId: "x" }), // joins both
  ], NOW);
  assert.equal(r.sevenDay.inputTokens, 7);
});

// ---- reader ----
function fakeFs(initial: Record<string, { lines: string[]; mtimeMs?: number; size?: number }>) {
  const fsMap = { ...initial };
  const stats = { readdir: 0, stat: 0, readLines: [] as string[] };
  const dirs = (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const names = new Map<string, boolean>();
    for (const p of Object.keys(fsMap)) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const [first, ...more] = rest.split("/");
      names.set(first, more.length > 0);
    }
    return names;
  };
  const files = {
    readdir: async (dir: string) => {
      stats.readdir++;
      const names = dirs(dir);
      if (names.size === 0) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...names].map(([name, isDir]) => ({ name, isDirectory: () => isDir, isFile: () => !isDir }));
    },
    stat: async (file: string) => {
      stats.stat++;
      const f = fsMap[file];
      if (!f) throw new Error("ENOENT");
      return { mtimeMs: f.mtimeMs ?? 1, size: f.size ?? f.lines.length };
    },
    readLines: (file: string) => {
      stats.readLines.push(file);
      const f = fsMap[file];
      return (async function* () { if (!f) throw new Error("gone"); yield* f.lines; })();
    },
  };
  return { fsMap, files, stats };
}

const CFG = "/cfg";
const A = (ts: number, n: number, id?: string) => assistant(ts, { input_tokens: n }, {}, id ? { id } : {});

test("reader: recurses projects dir, ignores non-jsonl, skips bad lines, dedupes across files", async () => {
  const { files } = fakeFs({
    "/cfg/projects/p1/s1.jsonl": { lines: [A(NOW - H, 5, "m1"), "{bad", "", line({ type: "user" })] },
    "/cfg/projects/p1/sub/s2.jsonl": { lines: [A(NOW - H, 9, "m1"), A(NOW - H, 1, "m2")] },
    "/cfg/projects/p1/notes.txt": { lines: [A(NOW - H, 1000)] },
  });
  const reader = createLocalUsageReader(files);
  const r = await reader.read(CFG, NOW);
  assert.equal(r.state, "ok");
  assert.equal(r.fiveHour.inputTokens, 10);
});

test("reader: missing projects dir -> unavailable; unreadable subdir -> partial; unreadable file -> partial", async () => {
  const empty = fakeFs({});
  assert.equal((await createLocalUsageReader(empty.files).read(CFG, NOW)).state, "unavailable");

  const fx = fakeFs({ "/cfg/projects/a/s.jsonl": { lines: [A(NOW - H, 2)] } });
  const realReaddir = fx.files.readdir;
  fx.files.readdir = async (d: string) => {
    if (d === "/cfg/projects") return [{ name: "bad", isDirectory: () => true, isFile: () => false }, ...(await realReaddir(d))];
    return realReaddir(d);
  };
  const r = await createLocalUsageReader(fx.files).read(CFG, NOW);
  assert.equal(r.state, "partial");
  assert.equal(r.fiveHour.inputTokens, 2);

  const fy = fakeFs({ "/cfg/projects/a/s.jsonl": { lines: [A(NOW - H, 2)] } });
  fy.files.stat = async () => { throw new Error("EACCES"); };
  const r2 = await createLocalUsageReader(fy.files).read(CFG, NOW);
  assert.equal(r2.state, "partial");
  assert.equal(r2.sevenDay.inputTokens, 0);
});

test("reader: caches by mtime/size; reparses when either changes; drops deleted files", async () => {
  const { fsMap, files, stats } = fakeFs({ "/cfg/projects/a/s.jsonl": { lines: [A(NOW - H, 2)], mtimeMs: 1, size: 10 } });
  const reader = createLocalUsageReader(files);
  await reader.read(CFG, NOW);
  await reader.read(CFG, NOW + 1000);
  assert.equal(stats.readLines.length, 1, "unchanged file must not be reparsed");

  fsMap["/cfg/projects/a/s.jsonl"] = { lines: [A(NOW - H, 2), A(NOW - H, 3, "z")], mtimeMs: 2, size: 10 };
  const r = await reader.read(CFG, NOW + 2000);
  assert.equal(stats.readLines.length, 2, "mtime change reparses");
  assert.equal(r.fiveHour.inputTokens, 5);

  fsMap["/cfg/projects/a/s.jsonl"] = { lines: [A(NOW - H, 2)], mtimeMs: 2, size: 11 };
  const r2 = await reader.read(CFG, NOW + 3000);
  assert.equal(stats.readLines.length, 3, "size change reparses");
  assert.equal(r2.fiveHour.inputTokens, 2);

  delete fsMap["/cfg/projects/a/s.jsonl"];
  fsMap["/cfg/projects/a/t.jsonl"] = { lines: [A(NOW - H, 7)] };
  const r3 = await reader.read(CFG, NOW + 4000);
  assert.equal(r3.fiveHour.inputTokens, 7);
});

test("reader: cached entries age out of the 7-day cutoff as time advances", async () => {
  const { files, stats } = fakeFs({ "/cfg/projects/a/s.jsonl": { lines: [A(NOW - 6 * 24 * H, 4), A(NOW - H, 1)] } });
  const reader = createLocalUsageReader(files);
  assert.equal((await reader.read(CFG, NOW)).sevenDay.inputTokens, 5);
  assert.equal((await reader.read(CFG, NOW + 2 * 24 * H)).sevenDay.inputTokens, 1);
  assert.equal(stats.readLines.length, 1);
});

test("reader: entries older than 7d are not retained; accounts are isolated; retainAccounts evicts", async () => {
  const { files, stats } = fakeFs({
    "/cfg/projects/a/s.jsonl": { lines: [A(NOW - 8 * 24 * H, 99), A(NOW - H, 1)] },
    "/other/projects/a/s.jsonl": { lines: [A(NOW - H, 20)] },
  });
  const reader = createLocalUsageReader(files);
  assert.equal((await reader.read("/cfg", NOW)).sevenDay.inputTokens, 1);
  assert.equal((await reader.read("/other", NOW)).sevenDay.inputTokens, 20);
  reader.retainAccounts(["/cfg"]);
  await reader.read("/cfg", NOW);
  assert.equal(stats.readLines.length, 2, "retained account stays cached");
  await reader.read("/other", NOW);
  assert.equal(stats.readLines.length, 3, "evicted account reparses");
});

test("reader: honours fiveHourResetsAt", async () => {
  const { files } = fakeFs({ "/cfg/projects/a/s.jsonl": { lines: [A(NOW - 4 * H, 1), A(NOW - H, 2)] } });
  const reader = createLocalUsageReader(files);
  const r = await reader.read(CFG, NOW, new Date(NOW + 3 * H).toISOString()); // started NOW-2h
  assert.equal(r.fiveHour.inputTokens, 2);
  assert.equal(r.sevenDay.inputTokens, 3);
});
