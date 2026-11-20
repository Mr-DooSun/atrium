import assert from "node:assert/strict";
import { dirname, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Paseo supplies these modules even when a managed installation has no node_modules.
const hostModules = new Set([
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
]);

function moduleSpecifier(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  if (ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
    return node.arguments[0];
  }
}

test("runtime files import only Paseo host modules, relative paths and Node built-ins", () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const files = ts.sys.readDirectory(
    root, [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"], undefined,
    ["client/**/*", "server/**/*", "shared/**/*", "index.client.*", "index.server.*"],
  );
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, ts.sys.readFile(file)!, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const specifier = moduleSpecifier(node);
      if (specifier) {
        const name = ts.isStringLiteralLike(specifier) ? specifier.text : undefined;
        if (!name || (!hostModules.has(name) && !/^(?:\.{1,2}\/|node:)/.test(name))) {
          const { line } = source.getLineAndCharacterOfPosition(specifier.getStart(source));
          violations.push(`${relative(root, file)}:${line + 1} ${name ?? specifier.getText(source)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});
