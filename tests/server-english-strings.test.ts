// Server and shared code send plain English on the wire; the client localizes known messages in
// client/toolbox/diagnostics.ts. A Korean (or other Hangul) string literal under server/ or shared/
// would reach every user untranslated, so none are allowed.
//
// Checked: string literals, template literal text, regular expression literals and JSX text.
// Not checked: comments. They never reach the app, and the team writes some of them in Korean.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = join(import.meta.dirname, "..");

// Hangul syllables, Jamo, compatibility Jamo, Jamo extended A/B, halfwidth Hangul.
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7A3\uD7B0-\uD7FF\uFFA0-\uFFDC]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Text a user could see: every literal and template piece in the file, with its line. */
function literalsOf(path: string): { line: number; text: string }[] {
  const code = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node)
    ) {
      found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.getText(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("the scan sees string, template and regex literals but not comments", () => {
  const dir = join(root, "tests");
  const sample = join(dir, "server-english-strings.test.ts");
  const texts = literalsOf(sample).map((l) => l.text);
  assert.ok(texts.some((t) => t.startsWith("/[\\u1100")), "regex literals are scanned");
  assert.ok(texts.some((t) => t === '"node_modules"'), "string literals are scanned");
  assert.equal(texts.some((t) => t.startsWith("//") || t.startsWith("/*")), false, "comments are not scanned");
});

test("no Hangul in string literals under server/ and shared/", () => {
  const files = [...sourceFiles(join(root, "server")), ...sourceFiles(join(root, "shared"))];
  assert.ok(files.length > 10, "found the server and shared sources");
  const problems = files.flatMap((path) =>
    literalsOf(path)
      .filter(({ text }) => HANGUL.test(text))
      .map(({ line, text }) => `${relative(root, path)}:${line}: ${text.slice(0, 80)}`));
  assert.deepEqual(problems, [], "send English from the server and add a key to client/toolbox/diagnostics.ts");
});
