// Guards against tests touching the developer's real Paseo home (~/.paseo/atrium and friends).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { isolatedHome, wasRealHome } from "./helpers/isolated-home.ts";

const dir = import.meta.dirname;
const files = readdirSync(dir).filter((name) => name.endsWith(".test.ts") && name !== "home-guard.test.ts");
// Modules that load server/project-order.ts, which freezes PASEO_HOME at import.
const storeImport = /(?:from\s+|import\s*\(\s*|import\s+)[`"']\.\.\/(?:server\/project(?:-order)?|index\.server)(?:\.ts|\.tsx)?[?`"']/;

describe("tests never use the real Paseo home", () => {
  test("the helper always leaves PASEO_HOME on a temp dir, never ~/.paseo", () => {
    assert.equal(process.env.PASEO_HOME, isolatedHome);
    assert.notEqual(isolatedHome, join(homedir(), ".paseo"));
    if (wasRealHome) assert.ok(isolatedHome.includes("atrium-test-home-"));
  });

  test("every test that loads the Atrium store imports the isolation helper before anything else", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      if (!storeImport.test(source)) continue;
      checked++;
      const firstImport = source.match(/^\s*import\s[^\n]*$/m)?.[0] ?? "";
      if (!/^\s*import\s+["']\.\/helpers\/isolated-home(?:\.ts)?["'];?\s*$/.test(firstImport)) offenders.push(name);
    }
    assert.ok(checked >= 5, `expected to find the store-touching tests, found ${checked}`);
    assert.deepEqual(offenders, [], "import './helpers/isolated-home.ts' as the first import");
  });

  test("no test hard-codes the real home as a write target", () => {
    const offenders = files.filter((name) => /homedir\(\)\s*,\s*["']\.paseo["']/.test(readFileSync(join(dir, name), "utf8")));
    assert.deepEqual(offenders, []);
  });
});
