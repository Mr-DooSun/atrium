// Import this FIRST (before any server module) in every test that loads a module touching the Atrium
// store. server/project-order.ts reads PASEO_HOME when it is first imported, so a test that sets it
// afterwards would read and write the developer's real ~/.paseo/atrium.
//
// When PASEO_HOME is unset (the mode RELEASING.md also requires) or points at the real ~/.paseo, it is
// replaced by a fresh temp dir. Default-home resolution is still covered through the injected `home`
// and `env` of the usage detection tests; nothing here ever writes to the real home.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
const realHome = real(join(homedir(), ".paseo"));
const current = process.env.PASEO_HOME;

/** True when the process would have used the developer's real daemon home. */
export const wasRealHome = !current || real(current) === realHome;

export const isolatedHome: string = wasRealHome
  ? realpathSync(mkdtempSync(join(tmpdir(), "atrium-test-home-")))
  : (current as string);

if (wasRealHome) {
  process.env.PASEO_HOME = isolatedHome;
  process.once("exit", () => rmSync(isolatedHome, { recursive: true, force: true }));
}

if (real(process.env.PASEO_HOME!) === realHome) throw new Error("tests must not use the real Paseo home");
