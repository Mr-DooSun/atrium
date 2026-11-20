// Locale quality beyond key parity: toolbox placeholders match English, no value is empty, and
// nothing is left in English where it should be translated. Key/placeholder parity for the sidebar,
// chat and panes tables is in i18n-parity.test.ts; key parity for the toolbox in toolbox-i18n.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toolboxText } from "../client/toolbox/strings.ts";
import { sidebarText } from "../client/sidebar-strings.ts";
import { chatText, panesText } from "../client/chat-strings.ts";

type Nested = { readonly [key: string]: string | Nested };
const flat = (o: Nested, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) =>
    typeof v === "string" ? [[prefix + k, v]] : Object.entries(flat(v, `${prefix}${k}.`))));

const tables: Record<string, Record<string, Nested>> = {
  toolbox: toolboxText.resources as unknown as Record<string, Nested>,
  sidebar: sidebarText.resources as unknown as Record<string, Nested>,
  chat: chatText.resources as unknown as Record<string, Nested>,
  panes: panesText.resources as unknown as Record<string, Nested>,
};

const placeholders = (text: string) =>
  [...new Set(text.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])].map((p) => p.replace(/\s/g, "")).sort().join(" ");

test("toolbox: every locale keeps English's {{placeholders}} for every key", () => {
  const en = flat(tables.toolbox.en);
  const problems: string[] = [];
  for (const [lang, table] of Object.entries(tables.toolbox)) {
    for (const [key, text] of Object.entries(flat(table))) {
      if (!(key in en)) continue;
      if (placeholders(text) !== placeholders(en[key])) problems.push(`${lang}.${key}: "${placeholders(text)}" != en "${placeholders(en[key])}"`);
    }
  }
  assert.deepEqual(problems, []);
});

test("no table has an empty or whitespace-only value", () => {
  const problems: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    for (const [lang, entry] of Object.entries(table)) {
      for (const [key, text] of Object.entries(flat(entry))) if (!text.trim()) problems.push(`${name}/${lang}.${key}`);
    }
  }
  assert.deepEqual(problems, []);
});

// Values that stay English in every language: product names, CLI tokens, code-like placeholders.
const TECHNICAL = /^(?:MCP|URL|Git|npm|Paseo|Claude|Codex|Antigravity|main|latest|npx|my-[\w-]+|@scope\/package|plugins\/[\w-]+|\/[\w/-]+|https?:\/\/\S+|\[[\w|]+\]|-y\n@[\w/-]+)$/;

// Words that are genuinely the same in that language (cognates), per language.
const SAME_IN: Record<string, readonly string[]> = {
  es: ["Error", "General", "Plugin"],
  fr: ["Absent", "Source", "Transport", "Version", "Plugin"],
  "pt-BR": ["Plugin", "Plugins", "Plugins: {{n}}", "Marketplace", "Marketplaces", "Branch {{branch}}"],
  // Pre-existing since #6: Korean developers commonly say "detached" for a detached HEAD.
  ko: ["detached {{head}}"],
};
const sameIn = (lang: string) => SAME_IN[lang] ?? SAME_IN[{ pt: "pt-BR", zh: "zh-CN" }[lang] ?? ""] ?? [];

test("nothing obviously translatable is left in English", () => {
  const problems: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    const en = flat(table.en);
    for (const [lang, entry] of Object.entries(table)) {
      if (lang === "en") continue;
      for (const [key, text] of Object.entries(flat(entry))) {
        if (text !== en[key] || TECHNICAL.test(text) || sameIn(lang).includes(text)) continue;
        // Purely symbolic text (only placeholders, numbers or punctuation) needs no translation.
        if (!/\p{L}/u.test(text.replace(/\{\{[^}]*\}\}/g, ""))) continue;
        problems.push(`${name}/${lang}.${key} = ${JSON.stringify(text)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("allowlist entries no longer needed are reported, not failed", (t) => {
  // Diagnostic only: a stale entry is harmless, and which entries are needed depends on which
  // in-flight string tables are present in the tree.
  const stale: string[] = [];
  for (const [lang, values] of Object.entries(SAME_IN)) {
    for (const value of values) {
      const used = Object.values(tables).some((table) => {
        const en = flat(table.en);
        return Object.entries(flat(table[lang] ?? {})).some(([k, v]) => v === value && en[k] === value);
      });
      if (!used) stale.push(`${lang}: ${value}`);
    }
  }
  if (stale.length) t.diagnostic(`allowlist entries not currently needed: ${stale.join(", ")}`);
});
