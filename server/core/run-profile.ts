// Profile-aware CLI helpers. Owned by the orchestrator.
import type { ProfileRuntime } from "./adapter";
import { run, type ExecOptions, type ExecResult } from "./exec";

/** Full argv for a profile: command, its configured leading args, then `args`. */
export function argvOf(profile: ProfileRuntime, args: readonly string[]): string[] {
  return [profile.command, ...profile.args, ...args];
}

/** Runs the profile's CLI with its env; `options.env` is layered on top of the profile env. */
export function runProfile(
  profile: ProfileRuntime,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return run(profile.command, [...profile.args, ...args], {
    ...options,
    env: { ...profile.env, ...(options.env ?? {}) },
  });
}
