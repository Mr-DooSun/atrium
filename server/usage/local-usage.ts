import { createReadStream, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LocalUsage, TokenTotals } from "../../shared/usage/types";
import { asRecord, nonemptyString, parseJson } from "./json";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const TOKEN_FIELDS = {
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  cacheCreationInputTokens: "cache_creation_input_tokens",
  cacheReadInputTokens: "cache_read_input_tokens",
} as const;
const tokenFields = Object.keys(TOKEN_FIELDS) as (keyof typeof TOKEN_FIELDS)[];

export interface LocalUsageEntry {
  timestamp: number;
  messageId?: string;
  requestId?: string;
  tokens: TokenTotals;
}

function zeroTokens(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

export function parseUsageLine(line: string): LocalUsageEntry | undefined {
  const entry = asRecord(parseJson(line));
  if (entry?.type !== "assistant" || typeof entry.timestamp !== "string") return;
  const timestamp = Date.parse(entry.timestamp);
  if (!Number.isFinite(timestamp)) return;
  const message = asRecord(entry.message);
  const usage = asRecord(message?.usage);
  if (!usage) return;
  const tokens = zeroTokens();
  let hasTokens = false;
  for (const field of tokenFields) {
    const value = usage[TOKEN_FIELDS[field]];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      tokens[field] = value;
      hasTokens = true;
    }
  }
  if (hasTokens) {
    return {
      timestamp,
      messageId: nonemptyString(message?.id),
      requestId: nonemptyString(entry.requestId) ?? nonemptyString(message?.requestId),
      tokens,
    };
  }
}

function addTokens(totals: TokenTotals, tokens: TokenTotals): void {
  for (const field of tokenFields) totals[field] = Math.min(Number.MAX_SAFE_INTEGER, totals[field] + tokens[field]);
  if (tokens.reasoningOutputTokens !== undefined) {
    totals.reasoningOutputTokens = Math.min(
      Number.MAX_SAFE_INTEGER, (totals.reasoningOutputTokens ?? 0) + tokens.reasoningOutputTokens,
    );
  }
}

/**
 * Streaming snapshots repeat usage across assistant blocks and transcript files.
 * Build groups by either ID, keeping the earliest timestamp and cumulative token maxima.
 */
export function aggregateLocalUsage(
  entries: Iterable<LocalUsageEntry>,
  now: number,
  fiveHourResetsAt?: string | null,
  state: LocalUsage["state"] = "ok",
): LocalUsage {
  const reset = fiveHourResetsAt ? Date.parse(fiveHourResetsAt) : NaN;
  const fiveHourStart = reset > now && reset <= now + FIVE_HOURS_MS
    ? reset - FIVE_HOURS_MS : now - FIVE_HOURS_MS;
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const sevenDayStart = now - SEVEN_DAYS_MS;
  const local: LocalUsage = {
    state,
    fiveHour: zeroTokens(),
    fiveHourStartsAt: new Date(fiveHourStart).toISOString(),
    today: zeroTokens(),
    sevenDay: zeroTokens(),
  };

  function add(entry: LocalUsageEntry) {
    if (entry.timestamp >= sevenDayStart) addTokens(local.sevenDay, entry.tokens);
    if (entry.timestamp >= todayStart) addTokens(local.today, entry.tokens);
    if (entry.timestamp >= fiveHourStart) addTokens(local.fiveHour, entry.tokens);
  }

  interface Group {
    entry: LocalUsageEntry;
    parent?: Group;
  }
  const groups: Group[] = [];
  const aliases = new Map<string, Group>();
  function root(group: Group | undefined): Group | undefined {
    while (group?.parent) {
      if (group.parent.parent) group.parent = group.parent.parent;
      group = group.parent;
    }
    return group;
  }
  function merge(target: LocalUsageEntry, source: LocalUsageEntry) {
    target.timestamp = Math.min(target.timestamp, source.timestamp);
    for (const field of tokenFields) target.tokens[field] = Math.max(target.tokens[field], source.tokens[field]);
    if (source.tokens.reasoningOutputTokens !== undefined) {
      target.tokens.reasoningOutputTokens = Math.max(
        target.tokens.reasoningOutputTokens ?? 0, source.tokens.reasoningOutputTokens,
      );
    }
  }

  for (const entry of entries) {
    if (entry.timestamp > now) continue;
    const message = entry.messageId ? "message:" + entry.messageId : undefined;
    const request = entry.requestId ? "request:" + entry.requestId : undefined;
    if (!message && !request) {
      add(entry);
      continue;
    }

    const messageGroup = message ? root(aliases.get(message)) : undefined;
    const requestGroup = request ? root(aliases.get(request)) : undefined;
    let group = messageGroup ?? requestGroup;
    if (!group) {
      group = { entry: { ...entry, tokens: { ...entry.tokens } } };
      groups.push(group);
    } else {
      merge(group.entry, entry);
      if (requestGroup && requestGroup !== group) {
        merge(group.entry, requestGroup.entry);
        requestGroup.parent = group;
      }
    }
    if (message) aliases.set(message, group);
    if (request) aliases.set(request, group);
  }
  for (const group of groups) {
    if (!group.parent) add(group.entry);
  }
  return local;
}

async function* readLines(file: string): AsyncGenerator<string> {
  let pending: string[] = [];
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    const lines = (chunk as string).split("\n");
    pending.push(lines[0]);
    if (lines.length === 1) continue;
    yield pending.join("");
    for (let index = 1; index < lines.length - 1; index++) yield lines[index];
    pending = [lines[lines.length - 1]];
  }
  if (pending.length) yield pending.join("");
}

export interface LocalUsageFiles {
  readdir: (directory: string) => Promise<readonly Pick<Dirent, "name" | "isDirectory" | "isFile">[]>;
  stat: (file: string) => Promise<{ mtimeMs: number; size: number; ino?: number; ctimeMs?: number }>;
  readLines: (file: string) => AsyncIterable<string>;
}

function listDirectory(directory: string) {
  return readdir(directory, { withFileTypes: true });
}

export const nodeUsageFiles: LocalUsageFiles = { readdir: listDirectory, stat, readLines };

interface CachedFile {
  fingerprint: string;
  cutoff: number;
  entries: LocalUsageEntry[];
}

function* joinEntries(files: LocalUsageEntry[][]): Generator<LocalUsageEntry> {
  for (const entries of files) yield* entries;
}

export function createLocalUsageReader(files: LocalUsageFiles = nodeUsageFiles) {
  const accountCaches = new Map<string, Map<string, CachedFile>>();

  async function read(configHome: string, now: number, fiveHourResetsAt?: string | null): Promise<LocalUsage> {
    const root = join(configHome, "projects");
    const cache = accountCaches.get(configHome) ?? new Map<string, CachedFile>();
    accountCaches.set(configHome, cache);

    const seen = new Set<string>();
    const parsedFiles: LocalUsageEntry[][] = [];
    const dirs = [root];
    const cutoff = now - SEVEN_DAYS_MS;
    let state: LocalUsage["state"] = "ok";
    for (const dir of dirs) {
      let entries: Awaited<ReturnType<LocalUsageFiles["readdir"]>>;
      try {
        entries = await files.readdir(dir);
      } catch {
        state = dir === root ? "unavailable" : "partial";
        continue;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          dirs.push(path);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        seen.add(path);
        try {
          const info = await files.stat(path);
          const fingerprint = [info.mtimeMs, info.size, info.ino, info.ctimeMs].join(":");
          const cached = cache.get(path);
          if (cached?.fingerprint === fingerprint && cached.cutoff <= cutoff) {
            if (cached.cutoff < cutoff) {
              cached.entries = cached.entries.filter((row) => row.timestamp >= cutoff);
              cached.cutoff = cutoff;
            }
            parsedFiles.push(cached.entries);
            continue;
          }
          const rows: LocalUsageEntry[] = [];
          for await (const line of files.readLines(path)) {
            const row = parseUsageLine(line);
            if (row && row.timestamp >= cutoff) rows.push(row);
          }
          cache.set(path, { fingerprint, cutoff, entries: rows });
          parsedFiles.push(rows);
        } catch {
          cache.delete(path);
          state = "partial";
        }
      }
    }
    for (const path of cache.keys()) {
      if (!seen.has(path)) cache.delete(path);
    }
    return aggregateLocalUsage(joinEntries(parsedFiles), now, fiveHourResetsAt, state);
  }

  function retainAccounts(configHomes: readonly string[]) {
    const active = new Set(configHomes);
    for (const configHome of accountCaches.keys()) {
      if (!active.has(configHome)) accountCaches.delete(configHome);
    }
  }

  return { read, retainAccounts };
}
