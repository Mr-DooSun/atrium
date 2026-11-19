// Profiles = Paseo providers of a managed kind. Owned by the orchestrator.
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
type PaseoApi = PluginHandlerContext["paseo"];
import type { Profile, ProviderKind } from "../../shared/toolbox/types";
import type { ProfileRuntime, ProviderAdapter } from "./adapter";

const KINDS: readonly ProviderKind[] = ["claude", "codex", "antigravity"];

interface ProviderEntry {
  extends?: string;
  label?: string;
  command?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface ResolvedProfile {
  profile: Omit<Profile, "auth">;
  runtime: ProfileRuntime;
  adapter: ProviderAdapter;
}

function kindOf(id: string, entry: ProviderEntry | undefined): ProviderKind | null {
  if ((KINDS as readonly string[]).includes(id)) return id as ProviderKind;
  const base = entry?.extends;
  return base && (KINDS as readonly string[]).includes(base) ? (base as ProviderKind) : null;
}

const LABELS: Record<ProviderKind, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
};

/** Built-in providers plus every custom provider that extends one, as configured in Paseo. */
export async function resolveProfiles(
  paseo: PaseoApi,
  adapters: Record<ProviderKind, ProviderAdapter>,
): Promise<ResolvedProfile[]> {
  const [{ config }, availability] = await Promise.all([
    paseo.config.get(),
    paseo.providers.listAvailable().catch(() => null),
  ]);
  const available = new Map(
    (availability?.providers ?? []).map((p) => [p.provider, p.available] as const),
  );
  return resolveConfiguredProfiles(config, adapters, available);
}

export function resolveConfiguredProfiles(
  config: unknown,
  adapters: Record<ProviderKind, ProviderAdapter>,
  available: ReadonlyMap<string, boolean> = new Map(),
): ResolvedProfile[] {
  // The SDK's config view keeps providers at the top level; config.json nests them under `agents`.
  const view = config as {
    providers?: Record<string, ProviderEntry>;
    agents?: { providers?: Record<string, ProviderEntry> };
  } | null | undefined;
  const providers = view?.providers ?? view?.agents?.providers ?? {};

  const ids = new Set<string>([...KINDS, ...Object.keys(providers)]);
  const out: ResolvedProfile[] = [];
  for (const id of ids) {
    const entry = providers[id];
    const kind = kindOf(id, entry);
    if (!kind) continue;
    const adapter = adapters[kind];
    // A custom provider inherits command and env from the provider it extends, then overrides.
    const base = entry?.extends ? providers[entry.extends] : undefined;
    const env = { ...(base?.env ?? {}), ...(entry?.env ?? {}) };
    const commandLine = entry?.command?.length ? entry.command : base?.command?.length ? base.command : [adapter.defaultCommand];
    const [command, ...commandArgs] = commandLine;
    const configHome = adapter.configHomeEnv ? (env[adapter.configHomeEnv] ?? null) : null;
    out.push({
      adapter,
      runtime: { id, command, args: commandArgs, env, configHome },
      profile: {
        id,
        label: entry?.label ?? LABELS[kind],
        kind,
        available: available.get(id) ?? false,
        enabled: entry?.enabled !== false,
        command: commandLine.join(" "),
        configHome,
      },
    });
  }
  // Built-ins first, then custom profiles, each alphabetically.
  return out.sort((a, b) => {
    const ab = KINDS.includes(a.profile.id as ProviderKind) ? 0 : 1;
    const bb = KINDS.includes(b.profile.id as ProviderKind) ? 0 : 1;
    return ab - bb || a.profile.id.localeCompare(b.profile.id);
  });
}
