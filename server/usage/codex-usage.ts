import { join } from "node:path";
import type { LocalUsage, RateLimits, RateLimitWindow, TokenTotals } from "../../shared/usage/types";
import { asRecord, parseJson } from "./json";
import {
  aggregateLocalUsage, nodeUsageFiles, SEVEN_DAYS_MS,
  type LocalUsageEntry, type LocalUsageFiles,
} from "./local-usage";

const DAY_MS = SEVEN_DAYS_MS / 7;

interface CodexRateSnapshot {
  timestamp: number;
  windows: RateLimitWindow[];
}

export interface CodexTokenCount {
  timestamp: number;
  tokens?: TokenTotals;
  cumulativeKey?: string;
  windows: RateLimitWindow[];
}

function count(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
}

function parseTokens(value: unknown): TokenTotals | undefined {
  const tokens = asRecord(value);
  if (!tokens) return;
  const inputTokens = count(tokens.input_tokens);
  const outputTokens = count(tokens.output_tokens);
  const cacheReadInputTokens = count(tokens.cached_input_tokens);
  const reasoningOutputTokens = count(tokens.reasoning_output_tokens);
  if ([inputTokens, outputTokens, cacheReadInputTokens, reasoningOutputTokens].every((n) => n === undefined)) return;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cacheReadInputTokens ?? 0,
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
  };
}

function parseCumulativeKey(value: unknown): string | undefined {
  const totals = asRecord(value);
  if (!totals) return;
  const fields = [
    totals.total_tokens, totals.input_tokens, totals.output_tokens,
    totals.cached_input_tokens, totals.reasoning_output_tokens, totals.cache_write_input_tokens,
  ].map(count);
  if (fields.some((field) => field !== undefined)) return fields.join(":");
}

export function parseCodexRateWindows(value: unknown): RateLimitWindow[] {
  const rates = asRecord(value);
  const windows: RateLimitWindow[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const window = asRecord(rates?.[slot]);
    const windowMinutes = count(window?.window_minutes);
    const utilization = window?.used_percent;
    if (!windowMinutes || typeof utilization !== "number" || !Number.isFinite(utilization) || utilization < 0) continue;
    const kind = windowMinutes === 300 ? "five_hour" : windowMinutes === 10_080 ? "seven_day" : "custom";
    const epochSeconds = count(window?.resets_at);
    const reset = new Date((epochSeconds ?? NaN) * 1_000);
    windows.push({
      id: `codex:${slot}:${windowMinutes}`,
      kind,
      windowMinutes,
      utilization,
      resetsAt: Number.isFinite(reset.getTime()) ? reset.toISOString() : null,
      limited: utilization >= 100,
    });
  }
  return windows;
}

export function parseCodexTokenCountLine(line: string): CodexTokenCount | undefined {
  const record = asRecord(parseJson(line));
  const payload = asRecord(record?.payload);
  if (record?.type !== "event_msg" || payload?.type !== "token_count" || typeof record.timestamp !== "string") return;
  const timestamp = Date.parse(record.timestamp);
  if (!Number.isFinite(timestamp)) return;
  const info = asRecord(payload.info);
  return {
    timestamp,
    tokens: parseTokens(info?.last_token_usage),
    cumulativeKey: parseCumulativeKey(info?.total_token_usage),
    windows: parseCodexRateWindows(payload.rate_limits),
  };
}

export function codexRateLimits(snapshot: CodexRateSnapshot | undefined, now: number): RateLimits {
  if (!snapshot) {
    return { state: "unavailable", windows: [], message: "No Codex rate limits recorded in local session logs." };
  }
  return {
    state: "ok",
    observedAt: new Date(snapshot.timestamp).toISOString(),
    // Keep the last observed reset time. Once it passes, report zero with that historical timestamp.
    windows: snapshot.windows.map((window) =>
      window.resetsAt && Date.parse(window.resetsAt) <= now
        ? { ...window, utilization: 0, limited: false } : window,
    ),
  };
}

interface ParsedRollout {
  entries: LocalUsageEntry[];
  latest?: CodexRateSnapshot;
  hasFutureEvents: boolean;
}

export async function readCodexRollout(
  lines: AsyncIterable<string>,
  now: number,
  cutoff = now - SEVEN_DAYS_MS,
): Promise<ParsedRollout> {
  const entries: LocalUsageEntry[] = [];
  let latest: CodexRateSnapshot | undefined;
  let lastCumulative: string | undefined;
  let hasFutureEvents = false;
  for await (const line of lines) {
    const event = parseCodexTokenCountLine(line);
    if (!event) continue;
    const { timestamp, tokens, cumulativeKey, windows } = event;
    if (timestamp > now) {
      hasFutureEvents = true;
      continue;
    }
    if (windows.length && (!latest || timestamp >= latest.timestamp)) latest = { timestamp, windows };
    if (!tokens || !Object.values(tokens).some((value) => value > 0)) continue;
    if (cumulativeKey !== undefined && cumulativeKey === lastCumulative) continue;
    if (cumulativeKey !== undefined) lastCumulative = cumulativeKey;
    if (timestamp < cutoff) continue;
    // Forked rollouts can copy the original event. Its timestamp and counters survive verbatim.
    const messageId = cumulativeKey === undefined ? undefined : `${timestamp}:${cumulativeKey}`;
    entries.push({ timestamp, tokens, messageId });
  }
  return { entries, latest, hasFutureEvents };
}

interface CachedRollout extends ParsedRollout {
  fingerprint: string;
  cutoff: number;
  readAt: number;
}

interface RolloutFile {
  file: string;
  mtimeMs: number;
  latestPossibleAt: number;
  fingerprint: string;
}

async function listRollouts(root: string, files: LocalUsageFiles) {
  const rollouts: RolloutFile[] = [];
  let partial = false;
  async function visit(directory: string, parts: string[]) {
    let children: Awaited<ReturnType<LocalUsageFiles["readdir"]>>;
    try {
      children = await files.readdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") partial = true;
      return;
    }
    for (const child of children) {
      const path = join(directory, child.name);
      if (parts.length < 3) {
        const component = parts.length === 0 ? /^\d{4}$/ : /^\d{2}$/;
        if (child.isDirectory() && component.test(child.name)) await visit(path, [...parts, child.name]);
        continue;
      }
      if (!child.isFile() || !child.name.endsWith(".jsonl")) continue;
      try {
        const info = await files.stat(path);
        const date = Date.parse(parts.join("-") + "T00:00:00Z");
        // A rollout can be opened again on a later date. Use its modification time too.
        // The day bound allows for rollout dates written in any time zone.
        const latestPossibleAt = Math.max(info.mtimeMs, Number.isFinite(date) ? date + 2 * DAY_MS : 0);
        const fingerprint = [info.mtimeMs, info.size, info.ino, info.ctimeMs].join(":");
        rollouts.push({ file: path, mtimeMs: info.mtimeMs, latestPossibleAt, fingerprint });
      } catch {
        partial = true;
      }
    }
  }
  await visit(root, []);
  rollouts.sort((a, b) =>
    b.latestPossibleAt - a.latestPossibleAt || b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file),
  );
  return { rollouts, partial };
}

export function createCodexUsageReader(files: LocalUsageFiles = nodeUsageFiles) {
  const accountCaches = new Map<string, Map<string, CachedRollout>>();

  async function read(configHome: string, now: number): Promise<{ rateLimits: RateLimits; local: LocalUsage }> {
    const { rollouts, partial } = await listRollouts(join(configHome, "sessions"), files);
    const cache = accountCaches.get(configHome) ?? new Map<string, CachedRollout>();
    accountCaches.set(configHome, cache);
    const seen = new Set<string>();
    const rows: LocalUsageEntry[][] = [];
    const cutoff = now - SEVEN_DAYS_MS;
    let state: LocalUsage["state"] = partial ? "partial" : "ok";
    let latest: CodexRateSnapshot | undefined;
    let readAny = false;
    for (const { file, latestPossibleAt, fingerprint } of rollouts) {
      if (latest && latestPossibleAt < cutoff && latestPossibleAt < latest.timestamp) break;
      seen.add(file);
      try {
        let parsed = cache.get(file);
        if (parsed?.fingerprint !== fingerprint || parsed.cutoff > cutoff || parsed.readAt > now || parsed.hasFutureEvents) {
          const rollout = await readCodexRollout(files.readLines(file), now, cutoff);
          parsed = { ...rollout, fingerprint, cutoff, readAt: now };
          cache.set(file, parsed);
        }
        if (parsed.cutoff < cutoff) {
          parsed.entries = parsed.entries.filter((entry) => entry.timestamp >= cutoff);
          parsed.cutoff = cutoff;
        }
        readAny = true;
        if (parsed.latest && (!latest || parsed.latest.timestamp > latest.timestamp)) latest = parsed.latest;
        rows.push(parsed.entries);
      } catch {
        cache.delete(file);
        state = "partial";
      }
    }
    for (const file of cache.keys()) {
      if (!seen.has(file)) cache.delete(file);
    }
    const rateLimits = codexRateLimits(latest, now);
    const reset = rateLimits.windows.find((window) => window.kind === "five_hour")?.resetsAt;
    function* entries() {
      for (const group of rows) yield* group;
    }
    const local = aggregateLocalUsage(entries(), now, reset, readAny ? state : "unavailable");
    return { local, rateLimits };
  }

  function retainAccounts(configHomes: readonly string[]) {
    const active = new Set(configHomes);
    for (const configHome of accountCaches.keys()) {
      if (!active.has(configHome)) accountCaches.delete(configHome);
    }
  }

  return { read, retainAccounts };
}
