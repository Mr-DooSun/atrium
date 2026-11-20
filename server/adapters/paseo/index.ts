import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ActionPreview, CatalogPlugin, InstalledPlugin, PluginAction, PluginSourceInput } from "../../../shared/toolbox/types.ts";
import { PASEO_PLUGIN_TRUST_WARNING } from "../../../shared/toolbox/warnings.ts";
import { commandResult, unsupported, type PluginEcosystemAdapter } from "../../core/adapter.ts";
import { failure, plain, run } from "../../core/exec.ts";
import { paseoHomeArgs, resolvePaseoCommand } from "../../core/paseo-bin.ts";
import { checkGitRef, checkGitRemote, checkLocalDir, checkNpm, checkSubPath, safeHttpsUrl } from "../../core/source.ts";

const registryUrl = new URL("https://plugins.paseo.sh");
const registryIndex = new URL("/index.json", registryUrl).href;
const registryName = "Paseo plugins";
const registryTtlMs = 10 * 60_000;
const registryId = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const runtimeId = /^[A-Za-z0-9_][\w.-]*$/;
const gitCommit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const npmVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const npmPackage = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i;

const registryEntry = z.object({
  id: z.string().regex(registryId),
  name: z.string(),
  description: z.string().nullish(),
  categories: z.array(z.string()).default([]),
  repository: z.object({ url: z.string() }).nullish(),
  artifact: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("git"), remote: z.string(), commit: z.string().optional(), pluginPath: z.string().optional() }),
    z.object({ kind: z.literal("npm"), package: z.string(), version: z.string().optional(), pluginPath: z.string().optional() }),
  ]),
  translations: z.record(z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })).optional(),
  // Store metadata; loose so a registry schema change never empties the catalog.
  author: z.object({ github: z.string().optional(), name: z.string().optional() }).passthrough().nullish().catch(null),
  icon: z.string().nullish().catch(null),
  installs: z.number().nullish().catch(null),
  license: z.string().nullish().catch(null),
  updatedAt: z.string().nullish().catch(null),
});

const installedEntry = z.object({
  id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  status: z.string(),
  enabled: z.boolean(),
  error: z.string().nullish(),
  path: z.string().nullish(),
  remote: z.string().nullish(),
  version: z.string().nullish(),
  installation: z.object({
    identity: z.object({
      kind: z.string(),
      remote: z.string().nullish(),
      pluginPath: z.string().nullish(),
      packageName: z.string().nullish(),
      registry: z.object({ url: z.string(), id: z.string() }).nullish(),
    }),
    currentRevision: z.string().nullish(),
  }).nullish(),
});

type RegistryEntry = z.infer<typeof registryEntry>;
type InstalledEntry = z.infer<typeof installedEntry>;

let registryCache: { expiresAt: number; plugins: RegistryEntry[] } | undefined;
let registryFetch: Promise<RegistryEntry[]> | undefined;
let featured = new Set<string>();

async function fetchRegistry(): Promise<RegistryEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(registryIndex, { signal: controller.signal });
    if (!response.ok) throw new Error(`Paseo registry returned HTTP ${response.status}.`);
    try {
      const index = z.object({
        plugins: z.array(registryEntry),
        featured: z.array(z.string()).optional().catch(undefined),
      }).parse(await response.json());
      featured = new Set(index.featured ?? []);
      return index.plugins;
    } catch {
      throw new Error("Paseo registry returned an invalid catalog.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function getRegistry() {
  if (registryCache && registryCache.expiresAt > Date.now()) return registryCache.plugins;
  registryFetch ??= fetchRegistry().then((plugins) => {
    registryCache = { plugins, expiresAt: Date.now() + registryTtlMs };
    return plugins;
  }).finally(() => { registryFetch = undefined; });
  return registryFetch;
}


function redact(text: string): string {
  return plain(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted>")
    .replace(/\b(?:npm_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+)\b/g, "<redacted>")
    .replace(/((?:https?|ssh):\/\/)[^\s/]+@/gi, "$1")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/gi, "$1?<redacted>");
}

async function installedFromCli(command: string, home: readonly string[]): Promise<InstalledEntry[]> {
  const result = await run(command, ["plugin", "ls", "--json", ...home]);
  const error = failure(result);
  if (error) throw new Error(redact(error));
  try {
    return z.array(installedEntry).parse(JSON.parse(result.stdout));
  } catch {
    throw new Error("Paseo returned an invalid installed plugin list.");
  }
}

function repositoryKey(remote: string): string {
  return remote.trim().replace(/^git@([^:]+):/, "ssh://$1/")
    .replace(/^(?:https?|ssh):\/\/(?:git@)?/i, "")
    .replace(/\/$/, "").replace(/\.git$/, "");
}

function authorOf(entry: RegistryEntry): string | null {
  const name = entry.author?.name ?? entry.author?.github;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null;
}

function installedVersionOf(entry: InstalledEntry): string | null {
  if (entry.version) return entry.version;
  const revision = entry.installation?.currentRevision;
  if (!revision) return null;
  return entry.installation?.identity.kind === "npm" ? revision : revision.slice(0, 7);
}

function installedMatch(entry: RegistryEntry, plugins: InstalledEntry[]): InstalledEntry | undefined {
  const artifact = entry.artifact;
  return plugins.find((installed) => {
    const identity = installed.installation?.identity;
    if (identity?.registry) {
      // An identically named entry from a self-hosted registry may be a different artifact.
      if (identity.registry.url.replace(/\/$/, "") === registryUrl.origin && identity.registry.id === entry.id) return true;
    }
    if (installed.id === entry.id) return true;
    const remote = identity?.remote ?? installed.remote;
    if ((identity?.pluginPath ?? ".") !== (artifact.pluginPath ?? ".")) return false;
    if (artifact.kind === "npm") return identity?.packageName === artifact.package;
    return !!remote && repositoryKey(remote) === repositoryKey(artifact.remote);
  });
}

function catalogSource(entry: RegistryEntry): string | null {
  const artifact = entry.artifact;
  if (artifact.kind === "npm") {
    return `npm:${artifact.package}${artifact.version ? `@${artifact.version}` : ""}`;
  }
  const remote = artifact.remote || entry.repository?.url;
  if (!remote) return null;
  const path = artifact.pluginPath ? ` (${artifact.pluginPath})` : "";
  const revision = artifact.commit ? ` @ ${artifact.commit}` : "";
  return redact(`${remote}${path}${revision}`);
}

function installedSource(entry: InstalledEntry): string | null {
  const identity = entry.installation?.identity;
  if (identity?.packageName) return `npm:${identity.packageName}`;
  const remote = identity?.remote ?? entry.remote;
  if (remote) {
    const source = remote.replace(/^[^@/:]+@([^:]+):/, "ssh://$1/");
    return redact(identity?.pluginPath && identity.pluginPath !== "." ? `${source} (${identity.pluginPath})` : source);
  }
  return entry.path ?? null;
}

const actionVerb = {
  install: "add", uninstall: "remove", enable: "enable", disable: "disable", update: "update",
} satisfies Record<PluginAction, string>;

const updateResult = z.array(z.object({
  id: z.string(),
  outcome: z.string(),
  error: z.string().nullish(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("git"), commit: z.string() }),
    z.object({ kind: z.literal("npm"), version: z.string() }),
  ]).nullish(),
}));

function parseUpdateResult(output: string, id: string) {
  try {
    return updateResult.parse(JSON.parse(output)).find((item) => item.id === id);
  } catch {
    throw new Error("Paseo returned an invalid update result.");
  }
}

type PinnedPlan = {
  command: string;
  args: string[];
  source: string;
  installedSnapshot?: string;
  manual?: boolean;
  expiresAt: number;
};

const pinnedPlans = new Map<string, PinnedPlan>();
const pendingPlans = new Map<string, Promise<PinnedPlan>>();
const registryUpdateWarning = "This Paseo CLI requires interactive review for registry installations. Run the displayed command in a terminal and confirm the revision shown there.";

function planKey(action: PluginAction, id: string, marketplace: string | null, home: readonly string[], cwd?: string | null) {
  return JSON.stringify([action, id, marketplace, home, cwd ?? null]);
}

function relativeHomeForDisplay(home: readonly string[]): string | undefined {
  const path = home[1];
  if (!path || !isAbsolute(path)) return undefined;
  const suffix = relative(resolve(homedir()), resolve(path));
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) return undefined;
  return suffix.split(sep).join("/");
}

function pinnedInstall(entry: RegistryEntry) {
  const artifact = entry.artifact;
  if (artifact.kind === "npm") {
    if (!artifact.version || !npmVersion.test(artifact.version) || !npmPackage.test(artifact.package)) return null;
    const args = ["plugin", "add", `npm:${artifact.package}@${artifact.version}`, "--json"];
    if (artifact.pluginPath) args.push("--path", artifact.pluginPath);
    return args;
  }
  // A registry slug is resolved again at install time. Address the reviewed artifact directly.
  if (!artifact.commit || !gitCommit.test(artifact.commit)) return null;
  try {
    const remote = new URL(artifact.remote);
    if (remote.protocol !== "https:" || remote.username || remote.password || remote.search || remote.hash) return null;
  } catch {
    return null;
  }
  // The install resolver probes named refs before rev-parse. The peel expression
  // is only valid as a revision, even when a branch is named after the hash.
  const args = ["plugin", "add", `git:${artifact.remote}`, "--ref", `${artifact.commit}^{commit}`, "--json"];
  if (artifact.pluginPath) args.push("--path", artifact.pluginPath);
  return args;
}

function installedSnapshot(entry: InstalledEntry) {
  return JSON.stringify([entry.installation, entry.remote, entry.path, entry.version]);
}

async function resolvePinnedPlan(action: "install" | "update", id: string, marketplace: string | null, home: readonly string[]): Promise<PinnedPlan> {
  const command = await resolvePaseoCommand();
  if (action === "install") {
    if (!registryId.test(id) || (marketplace !== null && marketplace !== registryName)) {
      throw new Error("Choose a plugin from the official Paseo registry.");
    }
    const registry = await getRegistry();
    const entry = registry.find((plugin) => plugin.id === id);
    const args = entry && pinnedInstall(entry);
    const source = entry && catalogSource(entry);
    if (!args || !source) throw new Error("Paseo registry entry has no supported immutable install target.");
    return { command, args: [...args, ...home], source, expiresAt: registryCache?.expiresAt ?? Date.now() };
  }

  if (!runtimeId.test(id)) throw new Error("Choose an installed Paseo plugin.");
  const installed = (await installedFromCli(command, home)).find((plugin) => plugin.id === id);
  if (!installed) throw new Error("Paseo plugin is no longer installed.");
  const check = await run(command, ["plugin", "update", id, "--check", "--json", ...home]);
  const error = failure(check);
  if (error) throw new Error(redact(error));
  const row = parseUpdateResult(check.stdout, id);
  if (row?.error) throw new Error(redact(row.error));
  if (row?.outcome !== "update" || !row.target) throw new Error("Paseo reports no update available.");
  const target = row.target;
  const revision = target.kind === "git" ? target.commit : target.version;
  if (!(target.kind === "git" ? gitCommit : npmVersion).test(revision)) {
    throw new Error("Paseo returned an update target that cannot be pinned.");
  }
  const source = `${installedSource(installed) ?? id} @ ${revision}`;
  const expiresAt = Date.now() + registryTtlMs;
  if (installed.installation?.identity.registry) {
    // Paseo rejects explicit selectors for registry-owned installations.
    return { command, args: ["plugin", "update", id, ...home], source, expiresAt, manual: true };
  }
  // The update resolver recognizes a full SHA directly before looking up remote refs.
  const args = ["plugin", "update", id, target.kind === "git" ? "--ref" : "--version", revision, "--json", ...home];
  return { command, args, source, installedSnapshot: installedSnapshot(installed), expiresAt };
}

function activePinnedPlan(key: string) {
  const now = Date.now();
  for (const [id, plan] of pinnedPlans) {
    if (plan.expiresAt <= now) pinnedPlans.delete(id);
  }
  return pinnedPlans.get(key);
}

async function previewPinnedPlan(action: "install" | "update", id: string, marketplace: string | null, home: readonly string[], cwd?: string | null) {
  const key = planKey(action, id, marketplace, home, cwd);
  const active = activePinnedPlan(key);
  if (active) return active;
  let pending = pendingPlans.get(key);
  if (!pending) {
    pending = resolvePinnedPlan(action, id, marketplace, home).then((plan) => {
      pinnedPlans.set(key, plan);
      return plan;
    }).finally(() => { pendingPlans.delete(key); });
    pendingPlans.set(key, pending);
  }
  return pending;
}

// ---- Direct installs (git, npm, local directory) ----------------------------------------------
// The preview resolves a moving ref or dist-tag to one commit or version and the run installs
// exactly that, so what the user confirmed is what lands.

const UNPINNED_LOCAL = "Installs the directory as it is now; later edits there run as-is on the next reload.";

async function resolveGitCommit(remote: string, ref: string | null): Promise<string> {
  if (ref && gitCommit.test(ref)) return ref.toLowerCase();
  const patterns = ref ? [ref, `refs/tags/${ref}^{}`] : ["HEAD"];
  const result = await run("git", ["ls-remote", "--", remote, ...patterns], {
    timeoutMs: 20_000,
    env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
  });
  const error = failure(result);
  if (error) throw new Error(`Could not read the Git repository: ${redact(error).slice(0, 300)}`);
  const rows = result.stdout.trim().split("\n").map((line) => line.split("\t")).filter((row) => row.length === 2);
  // An annotated tag lists the tag object and, with ^{}, the commit it points at.
  const peeled = rows.find(([, name]) => name.endsWith("^{}"));
  const exact = rows.find(([, name]) => !ref || name === ref || name === `refs/heads/${ref}` || name === `refs/tags/${ref}`);
  const sha = (peeled ?? exact ?? rows[0])?.[0];
  if (!sha || !gitCommit.test(sha)) throw new Error(ref ? `Git ref "${ref}" was not found.` : "The Git repository has no default branch.");
  return sha.toLowerCase();
}

async function resolveNpmVersion(name: string, tag: string | null): Promise<string> {
  if (tag && npmVersion.test(tag)) return tag;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/${encodeURIComponent(tag ?? "latest")}`;
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(response.status === 404 ? `npm package ${name}@${tag ?? "latest"} was not found.` : `npm registry returned HTTP ${response.status}.`);
    const version = z.object({ version: z.string() }).parse(await response.json()).version;
    if (!npmVersion.test(version)) throw new Error("npm registry returned an invalid version.");
    return version;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveSourcePlan(source: PluginSourceInput, home: readonly string[]): Promise<PinnedPlan> {
  const command = await resolvePaseoCommand();
  const expiresAt = Date.now() + registryTtlMs;
  const path = checkSubPath(source.path);
  if (!path.ok) throw new Error(path.error);
  const pathArgs = path.value ? ["--path", path.value] : [];
  const pathNote = path.value ? ` (${path.value})` : "";
  if (source.kind === "git") {
    const git = checkGitRemote(source.value);
    if (!git.ok) throw new Error(git.error);
    if (git.value.remote.startsWith("git@")) throw new Error("Use an https Git URL or owner/repo for Paseo plugins.");
    const ref = checkGitRef(source.ref);
    if (!ref.ok) throw new Error(ref.error);
    const remote = git.value.remote.includes("://") ? git.value.remote : `https://github.com/${git.value.remote}`;
    const commit = await resolveGitCommit(remote, ref.value);
    // Same pinning as registry installs: the peel expression is only valid as a revision.
    const args = ["plugin", "add", `git:${remote}`, "--ref", `${commit}^{commit}`, ...pathArgs, "--json", ...home];
    const via = ref.value && ref.value.toLowerCase() !== commit ? ` (${ref.value})` : "";
    return { command, args, source: redact(`${git.value.display}${pathNote} @ ${commit}${via}`), expiresAt };
  }
  if (source.kind === "npm") {
    const npm = checkNpm(source.value, source.version);
    if (!npm.ok) throw new Error(npm.error);
    const version = await resolveNpmVersion(npm.value.name, npm.value.version);
    const args = ["plugin", "add", `npm:${npm.value.name}@${version}`, ...pathArgs, "--json", ...home];
    return { command, args, source: `npm:${npm.value.name}@${version}${pathNote}`, expiresAt };
  }
  if (source.kind === "local") {
    const dir = await checkLocalDir(source.value);
    if (!dir.ok) throw new Error(dir.error);
    if (path.value) throw new Error("Pick the plugin directory itself instead of a sub-path.");
    return { command, args: ["plugin", "add", dir.value, "--json", ...home], source: dir.value, expiresAt };
  }
  throw new Error(`Paseo plugins cannot be installed from a ${source.kind} source.`);
}

function sourceKey(source: PluginSourceInput, home: readonly string[]) {
  const { kind, value, ref, version, path, plugin, scope } = source;
  return JSON.stringify(["source", kind, value.trim(), ref ?? null, version ?? null, path ?? null, plugin ?? null, scope ?? null, home]);
}

async function previewSourcePlan(source: PluginSourceInput, home: readonly string[]) {
  const key = sourceKey(source, home);
  const active = activePinnedPlan(key);
  if (active) return active;
  let pending = pendingPlans.get(key);
  if (!pending) {
    pending = resolveSourcePlan(source, home).then((plan) => {
      pinnedPlans.set(key, plan);
      return plan;
    }).finally(() => { pendingPlans.delete(key); });
    pendingPlans.set(key, pending);
  }
  return pending;
}

function unavailablePreview(error: string): ActionPreview {
  return { command: [], source: null, warnings: [error], supported: false };
}

function localizedText(entry: RegistryEntry) {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const translation = entry.translations?.[locale] ?? entry.translations?.[locale.split("-")[0]];
  return {
    name: translation?.name ?? entry.name,
    description: translation?.description ?? entry.description ?? null,
  };
}

let updateCache: { home: string | undefined; at: number; map: Map<string, string> } | null = null;
const UPDATE_TTL_MS = 10 * 60_000;

export const paseoPluginsAdapter: PluginEcosystemAdapter = {
  async checkUpdates() {
    const home = paseoHomeArgs();
    if (updateCache && updateCache.home === home[1] && Date.now() - updateCache.at < UPDATE_TTL_MS) return updateCache.map;
    const command = await resolvePaseoCommand();
    const result = await run(command, ["plugin", "update", "--all", "--check", "--json", ...home], { timeoutMs: 90_000 });
    if (failure(result)) return new Map();
    let rows: z.infer<typeof updateResult> = [];
    try {
      rows = updateResult.parse(JSON.parse(result.stdout));
    } catch {
      return new Map();
    }
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.outcome !== "update" || !row.target) continue;
      map.set(row.id, row.target.kind === "git" ? row.target.commit.slice(0, 7) : row.target.version);
    }
    updateCache = { home: home[1], at: Date.now(), map };
    return map;
  },

  async listInstalled(): Promise<InstalledPlugin[]> {
    const [entries, registry] = await Promise.all([
      installedFromCli(await resolvePaseoCommand(), paseoHomeArgs()),
      // Store metadata only: an unreachable registry must not hide installed plugins.
      getRegistry().catch(() => [] as RegistryEntry[]),
    ]);
    const metaFor = (entry: InstalledEntry) => {
      const reg = registry.find((r) => installedMatch(r, [entry]));
      return reg ? {
        iconUrl: safeHttpsUrl(reg.icon), author: authorOf(reg), homepage: safeHttpsUrl(reg.repository?.url), categories: reg.categories,
      } : {};
    };
    return entries.map((entry) => ({
      ...metaFor(entry),
      id: entry.id,
      name: entry.name ?? entry.id,
      version: entry.version ?? (entry.installation?.identity.kind === "npm" ? entry.installation.currentRevision ?? null : null),
      enabled: entry.enabled,
      marketplace: entry.installation?.identity.registry?.url.replace(/\/$/, "") === registryUrl.origin ? registryName : null,
      source: installedSource(entry),
      description: entry.description ?? null,
      status: entry.status,
      error: entry.error ? redact(entry.error) : null,
    }));
  },

  async listCatalog(_profile, query) {
    const [registry, installed] = await Promise.all([
      getRegistry(),
      resolvePaseoCommand().then((command) => installedFromCli(command, paseoHomeArgs())),
    ]);
    const search = query.trim().toLowerCase();
    const plugins = registry.flatMap((entry) => {
      const { name, description } = localizedText(entry);
      const searchable = [entry.id, entry.name, entry.description, name, description, ...entry.categories];
      if (!searchable.some((value) => value?.toLowerCase().includes(search))) return [];
      const match = installedMatch(entry, installed);
      const plugin: CatalogPlugin = {
        id: entry.id,
        name,
        description,
        marketplace: registryName,
        source: catalogSource(entry),
        categories: entry.categories,
        installed: !!match,
        author: authorOf(entry),
        version: entry.artifact.kind === "npm" ? entry.artifact.version ?? null : entry.artifact.commit?.slice(0, 7) ?? null,
        installedVersion: match ? installedVersionOf(match) : null,
        homepage: safeHttpsUrl(entry.repository?.url),
        iconUrl: safeHttpsUrl(entry.icon),
        license: entry.license ?? null,
        installs: entry.installs ?? null,
        featured: featured.has(entry.id),
        updatedAt: entry.updatedAt ?? null,
      };
      return [plugin];
    });
    return { plugins, marketplaces: [{ name: registryName, source: registryIndex, pluginCount: registry.length, official: true }] };
  },

  async previewAction(_profile, action, pluginId, marketplace, cwd) {
    const home = paseoHomeArgs();
    const relativeHome = relativeHomeForDisplay(home);
    if (action === "install" || action === "update") {
      try {
        const plan = await previewPinnedPlan(action, pluginId, marketplace, home, cwd);
        return {
          command: [plan.command, ...plan.args],
          relativeHome,
          source: plan.source,
          warnings: plan.manual ? [registryUpdateWarning, PASEO_PLUGIN_TRUST_WARNING] : [PASEO_PLUGIN_TRUST_WARNING],
          supported: !plan.manual,
        };
      } catch (error) {
        return unavailablePreview(redact(error instanceof Error ? error.message : String(error)));
      }
    }
    if (!runtimeId.test(pluginId)) return unavailablePreview("Choose an installed Paseo plugin.");
    const command = await resolvePaseoCommand();
    const installed = (await installedFromCli(command, home)).find(({ id }) => id === pluginId);
    return {
      command: [command, "plugin", actionVerb[action], pluginId, "--json", ...home],
      relativeHome,
      source: installed ? installedSource(installed) : null,
      warnings: [PASEO_PLUGIN_TRUST_WARNING],
      supported: true,
    };
  },

  async runAction(_profile, action, pluginId, marketplace, cwd) {
    updateCache = null;
    if (action !== "install" && !runtimeId.test(pluginId)) return unsupported([], "This Paseo plugin target");
    const home = paseoHomeArgs();
    const key = planKey(action, pluginId, marketplace, home, cwd);
    const requiresPreview = action === "install" || action === "update";
    const plan = requiresPreview ? activePinnedPlan(key) : undefined;
    if (requiresPreview && !plan) return commandResult([], "", "Open a new preview and confirm its pinned revision before proceeding.", false);
    const command = plan?.command ?? await resolvePaseoCommand();
    const args = plan?.args ?? ["plugin", actionVerb[action], pluginId, "--json", ...home];
    if (plan?.manual) return commandResult([command, ...args], "", registryUpdateWarning, false);
    if (action === "update") {
      const current = (await installedFromCli(command, home)).find(({ id }) => id === pluginId);
      if (!current || installedSnapshot(current) !== plan?.installedSnapshot) {
        pinnedPlans.delete(key);
        return commandResult([], "", "The installed plugin changed. Open a new update preview.", false);
      }
    }
    const result = await run(command, args, { timeoutMs: 120_000 });
    let error = failure(result);
    if (!error && action === "update") {
      try {
        const row = parseUpdateResult(result.stdout, pluginId);
        if (!row || row.outcome !== "updated") {
          error = row?.error ?? `Paseo did not apply the update (${row?.outcome ?? "missing result"}).`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    return commandResult(
      [command, ...args],
      error ? "" : `Paseo completed plugin ${action}.`,
      error ? redact(error) : null,
      false,
    );
  },

  async previewSource(_profile, source) {
    const home = paseoHomeArgs();
    try {
      const plan = await previewSourcePlan(source, home);
      const warnings = source.kind === "local" ? [UNPINNED_LOCAL, PASEO_PLUGIN_TRUST_WARNING]
        : ["Not reviewed by the Paseo registry: only install code you trust.", PASEO_PLUGIN_TRUST_WARNING];
      return { command: [plan.command, ...plan.args], relativeHome: relativeHomeForDisplay(home), source: plan.source, warnings, supported: true };
    } catch (error) {
      return unavailablePreview(redact(error instanceof Error ? error.message : String(error)));
    }
  },

  async installSource(_profile, source) {
    updateCache = null;
    const home = paseoHomeArgs();
    const key = sourceKey(source, home);
    const plan = activePinnedPlan(key);
    if (!plan) return commandResult([], "", "Open a new preview and confirm its pinned revision before proceeding.", false);
    // One confirmation, one install.
    pinnedPlans.delete(key);
    const result = await run(plan.command, plan.args, { timeoutMs: 180_000 });
    const error = failure(result);
    return commandResult([plan.command, ...plan.args], error ? "" : `Paseo installed ${plan.source}.`, error ? redact(error) : null, false);
  },

  async runMarketplaceAction() {
    return unsupported([], "Changing the Paseo marketplace");
  },
};
