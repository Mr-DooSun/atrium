import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { toolboxText } from "../client/toolbox/strings.ts";
import { localizeDiagnostic } from "../client/toolbox/diagnostics.ts";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [path] : keys(child as object, path);
  }).sort();
}

test("all nine toolbox languages contain the same keys as English", () => {
  const resources = toolboxText.resources;
  for (const locale of ["ko", "ja", "zh-CN", "es", "fr", "pt-BR", "ru", "ar"] as const) {
    assert.deepEqual(keys(resources[locale]), keys(resources.en), locale);
  }
});

test("unsupported locale resolves toolbox text to English", async () => {
  // The SDK exposes its translation runtime to the host, not through its public plugin entry.
  const require = createRequire(import.meta.url);
  const sdkRoot = dirname(require.resolve("@getpaseo/plugin"));
  const { PluginTranslationRuntime } = await import(pathToFileURL(join(sdkRoot, "client/translations.js")).href);
  const runtime = new PluginTranslationRuntime({ getLocale: () => "de", subscribe: () => () => {} });
  try {
    assert.equal(runtime.resolve(toolboxText.message("back.label")), toolboxText.resources.en.back.label);
    assert.equal(runtime.resolve(toolboxText.message("back.toChat", { title: "Example" })), "Back to chat · Example");
  } finally { runtime.dispose(); }
});

test("diagnostics localize known messages and preserve unknown provider output", () => {
  const translate = ((key: string, options?: { detail?: string }) => `${key}:${options?.detail ?? ""}`) as Parameters<typeof localizeDiagnostic>[0];
  assert.equal(localizeDiagnostic(translate, "timed out"), "diagnostic.timeout:");
  assert.equal(localizeDiagnostic(translate, "Unknown profile: sample"), "diagnostic.unknownProfile:sample");
  assert.equal(localizeDiagnostic(translate, "provider-specific failure"), "provider-specific failure");
});
