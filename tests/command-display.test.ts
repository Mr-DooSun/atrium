import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(join(process.cwd(), "client/toolbox/action-flow.tsx"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moduleExports: typeof import("../client/toolbox/action-flow.tsx") = {} as never;
runInNewContext(js, { exports: moduleExports, require: () => ({}) });
const { formatArgv } = moduleExports;

test("command display abbreviates only the final home argument and preserves argv", () => {
  const argv = ["paseo", "plugin", "add", "--home", "/Users/me/my home"];
  assert.equal(formatArgv(argv, "my home"), "paseo plugin add --home ~/'my home'");
  assert.equal(formatArgv(argv, ""), "paseo plugin add --home ~");
  assert.equal(formatArgv(argv), "paseo plugin add --home '/Users/me/my home'");
  assert.equal(formatArgv(["paseo", "--home", "/x", "--json"], "x"), "paseo --home /x --json");
  assert.deepEqual(argv, ["paseo", "plugin", "add", "--home", "/Users/me/my home"]);
  assert.equal(formatArgv(["paseo", "--home", "C:\\Users\\me\\.paseo"], ".paseo"), "paseo --home ~/.paseo");
  assert.equal(formatArgv(["paseo", "--home", "D:\\outside\\home"]), "paseo --home 'D:\\outside\\home'");
  assert.equal(formatArgv(["paseo", "--home", "/Users/me/a'b"], "a'b"), "paseo --home ~/'a'\\''b'");
});
