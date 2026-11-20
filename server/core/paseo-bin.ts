// Path of the paseo CLI on the daemon machine.
import { failure, run } from "./exec.ts";

export async function resolvePaseoCommand(): Promise<string> {
  if (process.env.PASEO_BIN) return process.env.PASEO_BIN;
  const result = await run("which", ["paseo"], { timeoutMs: 3_000 });
  return (!failure(result) && result.stdout.trim()) || "/Applications/Paseo.app/Contents/Resources/bin/paseo";
}

/** Select the daemon that launched this plugin when Paseo supplies its home. */
export function paseoHomeArgs(): string[] {
  const home = process.env.PASEO_HOME;
  return home ? ["--home", home] : [];
}
