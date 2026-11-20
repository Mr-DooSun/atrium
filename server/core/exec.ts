// Runs agent CLIs without a shell. Owned by the orchestrator.
import { spawn } from "node:child_process";

export interface ExecOptions {
  /** Overrides for the daemon's environment. An undefined value removes the variable. */
  env?: NodeJS.ProcessEnv;
  cwd?: string | null;
  timeoutMs?: number;
  /** Text written to stdin, then closed. Stdin is closed immediately otherwise. */
  stdin?: string;
  /** Per-stream cap in bytes (default 2 MiB). Raise it for large JSON such as plugin catalogs. */
  maxOutputBytes?: number;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn failure such as ENOENT (binary not installed). */
  spawnError: string | null;
  /** stdout or stderr hit `maxOutputBytes`; the text is cut and must not be parsed as complete. */
  truncated: boolean;
}

const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;

/** argv only: never interpolate user input into a shell string. */
export function run(command: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    const text = () => ({
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    });
    const finish = (result: Omit<ExecResult, "stdout" | "stderr" | "truncated">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (exitTimer) clearTimeout(exitTimer);
      resolve({ ...result, ...text(), truncated });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd ?? undefined,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
        // Own process group, so a timeout can stop wrappers (npx, shims) and their children.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: String(error), truncated: false });
      return;
    }
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      // A grandchild holding the pipes can keep "close" from ever firing: give up after the grace.
      graceTimer = setTimeout(() => {
        killGroup("SIGKILL");
        finish({ code: null, timedOut: true, spawnError: null });
      }, 2000);
      graceTimer.unref();
    }, options.timeoutMs ?? 30_000);
    // Byte-accurate caps; chunks are joined before decoding so multi-byte characters stay whole.
    child.stdout?.on("data", (chunk: Buffer) => {
      if (outBytes + chunk.length > limit) {
        truncated = true;
        chunk = chunk.subarray(0, Math.max(0, limit - outBytes));
      }
      outBytes += chunk.length;
      if (chunk.length) out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (errBytes + chunk.length > limit) {
        truncated = true;
        chunk = chunk.subarray(0, Math.max(0, limit - errBytes));
      }
      errBytes += chunk.length;
      if (chunk.length) err.push(chunk);
    });
    child.on("error", (error) => finish({ code: null, timedOut, spawnError: error.message }));
    child.on("close", (code) => finish({ code, timedOut, spawnError: null }));
    // The CLI exited but a background grandchild may still hold stdout/stderr open, so "close"
    // can lag forever. Settle with the exit code after a short drain window.
    child.on("exit", (code) => {
      exitTimer = setTimeout(() => finish({ code, timedOut, spawnError: null }), 1500);
      exitTimer.unref();
    });
    // The CLI may exit before reading stdin (EPIPE); never let that crash the plugin host.
    child.stdin?.on("error", () => {});
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();
  });
}

/** Strips ANSI escapes some CLIs print even with NO_COLOR. */
export function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}

/** Error text for a failed run, or null when it succeeded. */
export function failure(result: ExecResult): string | null {
  if (result.spawnError) return result.spawnError;
  if (result.timedOut) return "timed out";
  if (result.truncated) return "output exceeded the size limit";
  if (result.code !== 0) return plain(result.stderr || result.stdout).trim() || `exit ${result.code}`;
  return null;
}
