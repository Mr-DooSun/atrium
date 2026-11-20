import assert from "node:assert/strict";
import { test } from "node:test";
import { chatText, panesText } from "../client/chat-strings.ts";
import { sidebarText } from "../client/sidebar-strings.ts";

type Table = Readonly<Record<string, Readonly<Record<string, string>>>>;
const tables: Record<string, Table> = {
  sidebarText: sidebarText.resources as Table,
  chatText: chatText.resources as Table,
  panesText: panesText.resources as Table,
};

// The languages the sidebar table supports, region-less zh and pt included.
const languages = Object.keys(tables.sidebarText).sort();
const placeholders = (text: string) => [...new Set(text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])].map((p) => p.replace(/\s/g, "")).sort();

test("the language list is the 11 codes the sidebar supports", () => {
  assert.deepEqual(languages, ["ar", "en", "es", "fr", "ja", "ko", "pt", "pt-BR", "ru", "zh", "zh-CN"]);
});

for (const [name, table] of Object.entries(tables)) {
  test(`${name}: every supported language exists and has every English key`, () => {
    const en = table.en;
    assert.ok(en, "English is required");
    const problems: string[] = [];
    for (const lang of languages) {
      const entry = table[lang];
      if (!entry) {
        problems.push(`${lang}: whole language missing`);
        continue;
      }
      const missing = Object.keys(en).filter((k) => typeof entry[k] !== "string" || entry[k].trim() === "");
      if (missing.length) problems.push(`${lang}: ${missing.length} missing (${missing.join(", ")})`);
    }
    assert.deepEqual(problems, []);
  });

  test(`${name}: no language has keys English lacks`, () => {
    const problems: string[] = [];
    for (const [lang, entry] of Object.entries(table)) {
      const extra = Object.keys(entry).filter((k) => !(k in table.en));
      if (extra.length) problems.push(`${lang}: ${extra.join(", ")}`);
    }
    assert.deepEqual(problems, []);
  });

  test(`${name}: placeholders match English in every language`, () => {
    const problems: string[] = [];
    for (const [lang, entry] of Object.entries(table)) {
      for (const [key, text] of Object.entries(entry)) {
        if (typeof table.en[key] !== "string") continue;
        const want = placeholders(table.en[key]);
        const got = placeholders(text);
        if (want.join() !== got.join()) problems.push(`${lang}.${key}: ${got.join(" ") || "(none)"} != en ${want.join(" ") || "(none)"}`);
      }
    }
    assert.deepEqual(problems, []);
  });
}
