// Every fixed message the Claude adapter sends to the app is localized by
// client/toolbox/diagnostics.ts. The messages are read from server/adapters/claude/index.ts itself
// (Error arguments, warnings, error/detail fields, errorOf's returns, and string constants), so a new
// or reworded message fails here until diagnostics.ts maps it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { localizeDiagnostic } from "../client/toolbox/diagnostics.ts";

const path = join(import.meta.dirname, "..", "server/adapters/claude/index.ts");
const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);

/** A sample of what a literal sends: template holes become a value of the right shape. */
function sample(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => {
      const hole = span.expression.getText(file);
      const value = /code$/i.test(hole) ? "7" : /scope/i.test(hole) ? "local" : "sample";
      return value + span.literal.text;
    }).join("");
  }
  return null;
}

/** Messages, not argv or keys: at least two words and a letter. */
const isMessage = (text: string) => /\p{L}/u.test(text) && text.trim().split(/\s+/).length >= 2;

function messages(): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  const add = (node: ts.Expression | undefined): void => {
    if (!node) return;
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((e) => add(e as ts.Expression));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      add(node.whenTrue);
      add(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      add(node.right);
      return;
    }
    const text = sample(node);
    if (text !== null && isMessage(text)) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text });
  };
  const visit = (node: ts.Node, fn: string | null) => {
    if (ts.isFunctionDeclaration(node) && node.name) fn = node.name.text;
    if (ts.isNewExpression(node) && node.expression.getText(file) === "Error") add(node.arguments?.[0]);
    if (ts.isPropertyAssignment(node) && ["warnings", "error", "detail"].includes(node.name.getText(file))) add(node.initializer);
    if (ts.isReturnStatement(node) && fn === "errorOf") add(node.expression);
    if (ts.isVariableDeclaration(node) && /^[A-Z_]+$/.test(node.name.getText(file)) && node.initializer) add(node.initializer);
    ts.forEachChild(node, (child) => visit(child, fn));
  };
  visit(file, null);
  return found;
}

test("the scan finds the adapter's messages", () => {
  const texts = messages().map((m) => m.text);
  for (const known of ["timed out", "project scope needs a workspace directory", "Claude installs plugins from marketplace sources only."]) {
    assert.ok(texts.includes(known), known);
  }
  assert.ok(texts.includes("exit 7"), "template messages are sampled");
});

test("every Claude adapter message is localized by diagnostics.ts", () => {
  const t = ((key: string) => `<${key}>`) as Parameters<typeof localizeDiagnostic>[0];
  const unmapped = messages()
    .filter(({ text }) => localizeDiagnostic(t, text) === text)
    .map(({ line, text }) => `server/adapters/claude/index.ts:${line}: ${text}`);
  assert.deepEqual(unmapped, []);
});
