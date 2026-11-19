// Validates the agent cwd that arrives from the app. Owned by the orchestrator.
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

/** An absolute path to an existing directory, or null. Anything else is rejected with a clear error. */
export function checkedCwd(cwd: string | null): string | null {
  if (cwd === null || cwd === "") return null;
  if (!isAbsolute(cwd)) throw new Error(`Project path must be absolute: ${cwd}`);
  let isDir = false;
  try {
    isDir = statSync(cwd).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new Error(`Project directory does not exist: ${cwd}`);
  return cwd;
}
