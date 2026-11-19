import { homedir } from "node:os";
import type { ProfileRuntime } from "../../core/adapter.ts";
import { plain, type ExecOptions, type ExecResult } from "../../core/exec.ts";
import { runProfile } from "../../core/run-profile.ts";

const minimumSecretLength = 4;

export function runCodex(profile: ProfileRuntime, args: readonly string[], options: ExecOptions = {}) {
  return runProfile(profile, args, { ...options, cwd: options.cwd ?? homedir() });
}

export function maskValue(value: string): string {
  return value.length >= minimumSecretLength ? "<redacted>" : value;
}

function jsonError(output: string): string | undefined {
  for (const candidate of [output, ...output.trim().split("\n").reverse()]) {
    try {
      const data = JSON.parse(candidate);
      const error = typeof data?.error === "string" ? data.error : data?.error?.message;
      if (typeof error === "string" && error.trim()) return error.trim();
      if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
    } catch {
      // Some CLI modes emit diagnostic text rather than JSON.
    }
  }
  return undefined;
}

function scrub(text: string, secrets: string[]): string {
  for (const secret of new Set(secrets.filter((secret) => secret.length >= minimumSecretLength).sort((a, b) => b.length - a.length))) {
    text = text.replaceAll(secret, "<redacted>");
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) text = text.replaceAll(escaped, "<redacted>");
  }
  return text
    .replace(/\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]+)/gi, (_, scheme, spacing, value) => scheme + spacing + maskValue(value))
    .replace(/\b(sk-|gh[pousr]_|npm_)[A-Za-z0-9_-]+\b/g, "<redacted>")
    .replace(/(\b[\w.-]*(?:token|secret|password|api[-_]?key)\b["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;]+)/gi,
      (whole, key: string, value: string) => {
        const raw = /^["']/.test(value) ? value.slice(1, -1) : value;
        return raw.length >= minimumSecretLength ? key + maskValue(raw) : whole;
      })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted>")
    .replace(/https?:\/\/[^\s"')]+/gi, (url) => publicUrl(url) ?? "<redacted>");
}

export function codexError(
  result: ExecResult,
  operation: string,
  secrets: string[] = [],
  env: Record<string, string> = {},
): string | null {
  if (!result.spawnError && !result.timedOut && !result.truncated && result.code === 0) return null;
  const envSecrets = Object.entries({ ...process.env, ...env })
    .filter(([key]) => /token|secret|password|api.?key|authorization/i.test(key))
    .flatMap(([, value]) => value ?? []);
  const stderr = plain(result.stderr);
  const stdout = plain(result.stdout);
  const diagnostic = stderr.split("\n").map((line) => line.trim())
    .filter((line) => /^(?:error\b|caused by\b|failed\b|no MCP server\b)/i.test(line))
    .slice(0, 8).join("\n");
  const detail = result.spawnError ?? jsonError(stderr) ?? jsonError(stdout) ?? (diagnostic || stderr.split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^(?:[\[{]|warning\b|note\b)/i.test(line)));
  const fallback = result.timedOut ? `Codex timed out during ${operation}.`
    : result.truncated ? `Codex output exceeded the limit during ${operation}.`
      : `Codex failed during ${operation} (exit ${result.code ?? "unknown"}).`;
  if (!detail) return fallback;
  return scrub(result.timedOut || result.truncated ? `${fallback}\n${detail}` : detail, [...secrets, ...envSecrets]).slice(0, 1500);
}

export function publicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}
