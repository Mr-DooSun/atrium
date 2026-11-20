// Validation for user-typed plugin sources (git URL, npm package, local directory, marketplace).
// Every value ends up as one argv element, never in a shell string; these checks keep a value
// from being read as an option, smuggling credentials, or escaping its directory.
import { stat, realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (error: string): Checked<never> => ({ ok: false, error });

const MAX = 2048;
const control = /[\u0000-\u001f\u007f]/;
const ownerRepo = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
// The host goes to ssh as an argument: it must never be readable as an option ("-oProxyCommand").
const hostName = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*";
const scpGit = new RegExp(`^git@(${hostName}):([A-Za-z0-9._/-]+?)(?:\\.git)?$`);
const validHost = new RegExp(`^${hostName}$`);
export const gitCommit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
export const npmPackage = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const npmExactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const npmTag = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

function basic(value: string | null | undefined, what: string): Checked<string> {
  const text = (value ?? "").trim();
  if (!text) return bad(`${what} is empty.`);
  if (text.length > MAX) return bad(`${what} is too long.`);
  if (control.test(text)) return bad(`${what} contains control characters.`);
  if (text.startsWith("-")) return bad(`${what} must not start with "-".`);
  return ok(text);
}

export interface GitSource {
  /** What the CLI receives: https URL, ssh scp form, or owner/repo shorthand. */
  remote: string;
  /** https URL without credentials, for display. */
  display: string;
}

/** https URL (no credentials, query or fragment), git@host:owner/repo, or GitHub owner/repo. */
export function checkGitRemote(value: string | null | undefined): Checked<GitSource> {
  const text = basic(value, "Git source");
  if (!text.ok) return text;
  const v = text.value;
  if (ownerRepo.test(v)) return ok({ remote: v, display: `https://github.com/${v}` });
  const scp = scpGit.exec(v);
  if (scp) {
    if (scp[2].split("/").some((part) => part === ".." || part === "" || part.startsWith("-"))) return bad("Git source path is invalid.");
    return ok({ remote: v, display: `ssh://${scp[1]}/${scp[2]}` });
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return bad("Git source must be an https URL, git@host:owner/repo, or owner/repo.");
  }
  if (url.protocol !== "https:") return bad("Git URLs must use https.");
  if (url.username || url.password) return bad("Remove credentials from the Git URL.");
  if (url.search || url.hash) return bad("Git URLs must not have a query or fragment.");
  if (!url.hostname.includes(".") || !validHost.test(url.hostname) || url.pathname.length < 2) {
    return bad("Git URL needs a valid host and repository path.");
  }
  return ok({ remote: url.href.replace(/\/$/, ""), display: url.href.replace(/\/$/, "") });
}

/** Branch, tag or commit: no option prefix, no "..", no ref-spec punctuation. */
export function checkGitRef(value: string | null | undefined): Checked<string | null> {
  if (value == null || !value.trim()) return ok(null);
  const v = value.trim();
  if (v.length > 255 || v.startsWith("-") || v.includes("..") || v.endsWith(".lock") || v.endsWith("/") ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v)) {
    return bad("Git ref is invalid.");
  }
  return ok(v);
}

/** Relative path inside a repository or package. */
export function checkSubPath(value: string | null | undefined): Checked<string | null> {
  if (value == null || !value.trim() || value.trim() === ".") return ok(null);
  const v = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (v.length > 512 || isAbsolute(v) || v.startsWith("-") || control.test(v) ||
      v.split("/").some((part) => part === ".." || part === "" || part.startsWith("-")) ||
      !/^[A-Za-z0-9._@/ -]+$/.test(v)) {
    return bad("Plugin path must be a relative path inside the source.");
  }
  return ok(v);
}

export interface NpmSource { name: string; version: string | null; pinned: boolean }

/** npm package name; `version` may be exact (pinned) or a dist-tag. "pkg@1.2.3" is also accepted. */
export function checkNpm(value: string | null | undefined, version?: string | null): Checked<NpmSource> {
  const text = basic(value, "npm package");
  if (!text.ok) return text;
  let name = text.value.replace(/^npm:/, "");
  let ver = version?.trim() || null;
  const at = name.lastIndexOf("@");
  if (at > 0) {
    if (ver) return bad("Give the version once.");
    ver = name.slice(at + 1) || null;
    name = name.slice(0, at);
  }
  if (name.length > 214 || !npmPackage.test(name)) return bad("npm package name is invalid.");
  if (ver && !npmExactVersion.test(ver) && !npmTag.test(ver)) return bad("npm version must be an exact version or a dist-tag.");
  return ok({ name, version: ver, pinned: !!ver && npmExactVersion.test(ver) });
}

/** Absolute path to an existing directory, resolved through symlinks. */
export async function checkLocalDir(value: string | null | undefined): Promise<Checked<string>> {
  const text = basic(value, "Directory");
  if (!text.ok) return text;
  if (!isAbsolute(text.value)) return bad("Directory must be an absolute path.");
  try {
    const real = await realpath(normalize(text.value));
    if (!(await stat(real)).isDirectory()) return bad("Path is not a directory.");
    return ok(real);
  } catch {
    return bad("Directory does not exist.");
  }
}

/** Claude marketplace source: owner/repo, https or git@ URL, or an existing absolute path. */
export async function checkMarketplaceSource(value: string | null | undefined): Promise<Checked<string>> {
  const text = basic(value, "Marketplace source");
  if (!text.ok) return text;
  if (isAbsolute(text.value)) {
    const dir = await checkLocalDir(text.value);
    if (dir.ok) return dir;
    // A path to a marketplace.json file is valid too.
    try {
      const real = await realpath(text.value);
      if ((await stat(real)).isFile() && real.endsWith(".json")) return ok(real);
    } catch { /* fall through */ }
    return dir;
  }
  if (/^https?:\/\//i.test(text.value)) {
    try {
      const url = new URL(text.value);
      if (url.protocol !== "https:") return bad("Marketplace URLs must use https.");
      if (url.username || url.password) return bad("Remove credentials from the marketplace URL.");
      if (url.hash) return bad("Marketplace URL must not have a fragment.");
      if (!validHost.test(url.hostname)) return bad("Marketplace URL host is invalid.");
      return ok(url.href);
    } catch {
      return bad("Marketplace URL is invalid.");
    }
  }
  const git = checkGitRemote(text.value);
  return git.ok ? ok(git.value.remote) : bad("Marketplace source must be owner/repo, an https URL, or an absolute path.");
}

/** Plugin or marketplace name as CLIs accept it. */
export function checkName(value: string | null | undefined, what = "Plugin name"): Checked<string> {
  const text = basic(value, what);
  if (!text.ok) return text;
  if (text.value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text.value)) return bad(`${what} is invalid.`);
  return ok(text.value);
}

/** https URL safe to show or load in the app (icons, homepages); anything else becomes null. */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
