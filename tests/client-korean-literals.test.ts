import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const root = new URL("../client/", import.meta.url).pathname;
const resources = new Set(["sidebar-strings.ts", "chat-strings.ts"]);
const aliases = new Set(["서버", "플러그인", "마켓플레이스"]);

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

test("client Korean literals are confined to translations, diagnostic matching and command aliases", async () => {
  const violations: string[] = [];
  for (const file of await files(root)) {
    const path = relative(root, file);
    if (!/\.tsx?$/.test(path) || path.startsWith("toolbox/locales/") || resources.has(path)) continue;
    // Korean wire diagnostics are intentionally recognized and translated here.
    if (path === "toolbox/diagnostics.ts") continue;
    const tree = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node: ts.Node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isRegularExpressionLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[가-힣]/.test(node.text)) {
        if (!(path === "toolbox/index.tsx" && ts.isStringLiteral(node) && aliases.has(node.text))) {
          violations.push(`${path}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${node.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.deepEqual(violations, []);
});
