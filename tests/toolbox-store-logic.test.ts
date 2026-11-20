// Store screen logic of the plugins toolbox, without rendering.
// Pure helpers live in client/toolbox/store-logic.ts and are imported directly. Only StateControl
// (a React component in store.tsx) is run in a sandbox: the file is transpiled with React,
// react-native and the UI kit stubbed, and the returned element tree is inspected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as types from "../shared/toolbox/types.ts";
import type { CatalogPlugin, Ecosystem, InstalledPlugin, PluginSourceKind } from "../shared/toolbox/types.ts";
import * as logic from "../client/toolbox/store-logic.ts";
import {
  ACTIVITY_OF, PROJECT_SCOPES, attention, avatarColor, catalogMeta, catalogSorts, initials, installedMeta, installedView,
  pluginFacts, rowFacts, takesExtras, toInput, trackKey, trackReducer, valueOk, versionText,
  type InstalledFilter, type InstalledSort, type SourceForm, type TrackState,
} from "../client/toolbox/store-logic.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const react = { createContext: () => ({ Provider: "Provider" }) };
const jsxRuntime = {
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  Fragment: "Fragment",
};

/** Any other import: every named export is a no-op component/function carrying its name. */
function stubModule(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === "__esModule") return true;
      return { [key as string]: () => null }[key as string];
    },
  });
}

function load(file: string, expose: string[], modules: Record<string, unknown> = {}): Any {
  const source = readFileSync(join(process.cwd(), file), "utf8") + `\n;Object.assign(exports, { ${expose.join(", ")} });\n`;
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (id: string) => {
    if (id in modules) return modules[id];
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id.endsWith("shared/toolbox/types")) return types;
    if (id === "./store-logic") return logic;
    return stubModule();
  };
  runInNewContext(js, { exports, require, console, Intl, URL });
  return exports;
}

// ---- track state machine ------------------------------------------------------------------------

describe("trackReducer", () => {
  const empty: TrackState<string> = {};
  const a = trackKey("claude", "p1", "tool@demo");
  const b = trackKey("claude", "p2", "tool@demo");

  test("start → running, with no error", () => {
    const s = trackReducer(empty, { type: "start", key: a, kind: "install", flow: "flow-1" });
    assert.deepEqual(s[a], { kind: "install", state: "running", error: null, flow: "flow-1" });
    assert.deepEqual(empty, {}, "the previous state is not mutated");
  });

  test("fail → failed with the error; a new start clears it", () => {
    let s = trackReducer(empty, { type: "start", key: a, kind: "update", flow: "f" });
    s = trackReducer(s, { type: "fail", key: a, kind: "update", error: "first error", flow: "f" });
    assert.deepEqual(s[a], { kind: "update", state: "failed", error: "first error", flow: "f" });
    s = trackReducer(s, { type: "start", key: a, kind: "update", flow: "f2" });
    assert.equal(s[a].state, "running");
    assert.equal(s[a].error, null);
  });

  for (const type of ["done", "retry", "dismiss"] as const) {
    test(`${type} removes the entry and leaves the others`, () => {
      let s = trackReducer(empty, { type: "start", key: a, kind: "install", flow: "fa" });
      s = trackReducer(s, { type: "fail", key: b, kind: "remove", error: "x", flow: "fb" });
      const before = s;
      s = trackReducer(s, { type, key: a });
      assert.equal(a in s, false);
      assert.deepEqual(s[b], { kind: "remove", state: "failed", error: "x", flow: "fb" });
      assert.equal(a in before, true, "the previous state is not mutated");
    });
  }

  test("keys are independent per plugin, place and action", () => {
    const c = trackKey("claude", "p1", "other@demo");
    const d = trackKey("paseo", null, "tool@demo");
    let s = trackReducer(empty, { type: "start", key: a, kind: "install", flow: "1" });
    s = trackReducer(s, { type: "start", key: b, kind: "update", flow: "2" });
    s = trackReducer(s, { type: "fail", key: c, kind: "remove", error: "e", flow: "3" });
    s = trackReducer(s, { type: "start", key: d, kind: "enable", flow: "4" });
    assert.equal(new Set([a, b, c, d]).size, 4);
    assert.deepEqual(Object.keys(s).sort(), [a, b, c, d].sort());
    s = trackReducer(s, { type: "done", key: b });
    assert.deepEqual(Object.values(s).map((t) => t.flow).sort(), ["1", "3", "4"]);
  });

  test("done/retry/dismiss of an unknown key is a no-op returning the same state", () => {
    const s = trackReducer(empty, { type: "start", key: a, kind: "install", flow: "f" });
    for (const type of ["done", "retry", "dismiss"] as const) assert.equal(trackReducer(s, { type, key: "nope" }), s);
  });

  test("activity kinds per plugin action", () => {
    assert.deepEqual({ ...ACTIVITY_OF }, { install: "install", update: "update", uninstall: "remove", enable: "enable", disable: "disable" });
  });
});

// ---- source form ------------------------------------------------------------------------------

describe("source form", () => {
  test("value checks per kind", () => {
    const cases: [PluginSourceKind, string, boolean][] = [
      ["git", "example/kit", true],
      ["git", "https://github.com/example/kit", true],
      ["git", "git@github.com:example/kit.git", true],
      ["git", "has space/kit", false],
      ["git", "   ", false],
      ["git", "x".repeat(2049), false],
      ["npm", "@example/tool", true],
      ["npm", "tool@1.2.3", true],
      ["npm", "@example/tool@^1.2.0", true],
      ["npm", "has space", false],
      ["npm", "../evil", false],
      ["npm", "@/tool", false],
      ["local", "/Users/me/plugin", true],
      ["local", "C:\\plugins\\mine", true],
      ["local", "relative/plugin", false],
      ["local", "~/plugin", false],
      ["marketplace", "example/market", true],
      ["marketplace", "https://example.com/m.json", true],
      ["marketplace", "", false],
    ];
    for (const [kind, value, want] of cases) assert.equal(valueOk(kind, value), want, `${kind}: ${value}`);
  });

  test("only the fields of the chosen kind are sent, trimmed, empty as null", () => {
    const base = { value: "  example/kit  ", ref: " v1 ", version: " 1.0.0 ", path: " plugins/a ", plugin: " tool ", scope: null };
    const form = (extra: Partial<SourceForm>): SourceForm => ({ ...base, kind: "git", ...extra });
    assert.deepEqual(toInput(form({ kind: "git" }), true),
      { kind: "git", value: "example/kit", ref: "v1", version: null, path: "plugins/a", plugin: null, scope: null });
    assert.deepEqual(toInput(form({ kind: "npm" }), true),
      { kind: "npm", value: "example/kit", ref: null, version: "1.0.0", path: "plugins/a", plugin: null, scope: null });
    assert.deepEqual(toInput(form({ kind: "local" }), true),
      { kind: "local", value: "example/kit", ref: null, version: null, path: null, plugin: null, scope: null });
    assert.deepEqual(toInput(form({ kind: "marketplace", scope: "project" }), true),
      { kind: "marketplace", value: "example/kit", ref: null, version: null, path: null, plugin: "tool", scope: "project" });
    assert.equal(toInput(form({ ref: "   ", path: "" }), true).ref, null);
  });

  test("antigravity takes no ref, version or sub-path", () => {
    assert.equal(takesExtras("antigravity"), false);
    for (const eco of ["paseo", "claude", "codex"] as const) assert.equal(takesExtras(eco), true);
    const input = toInput({ kind: "git", value: "example/kit", ref: "main", version: "", path: "x", plugin: "", scope: null }, false);
    assert.equal(input.ref, null);
    assert.equal(input.path, null);
  });

  test("project scopes are scopes the server allows for claude", () => {
    for (const scope of PROJECT_SCOPES) assert.ok(types.ECOSYSTEM_CAPS.claude.scopes.includes(scope), scope);
  });
});

// ---- installed list ---------------------------------------------------------------------------

describe("installed list filters, counts and sort", () => {
  const plugin = (name: string, extra: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
    id: `${name.toLowerCase()}@demo`, name, description: null, marketplace: "demo", enabled: true,
    version: null, source: null, error: null, ...extra,
  } as InstalledPlugin);
  const plugins = [
    plugin("Zeta"),
    plugin("alpha", { enabled: false }),
    plugin("Beta", { updateTo: "2.0.0" }),
    plugin("Gamma", { error: "boom", enabled: true }),
    plugin("delta", { updateTo: "1.1.0", enabled: false }),
    plugin("Echo", { enabled: null as never }),
  ];
  const view = (filter: InstalledFilter = "all", sort: InstalledSort = "name", text = "") =>
    installedView(plugins, pluginFacts, filter, text, sort);
  const names = (v: { shown: InstalledPlugin[] }) => v.shown.map((p) => p.name);

  test("counts per filter", () => {
    assert.deepEqual(view().counts, { all: 6, updates: 2, enabled: 3, disabled: 2, errors: 1 });
    assert.equal(view().total, 6);
  });

  test("each filter shows its plugins, by name", () => {
    assert.deepEqual(names(view("all")), ["alpha", "Beta", "delta", "Echo", "Gamma", "Zeta"]);
    assert.deepEqual(names(view("updates")), ["Beta", "delta"]);
    assert.deepEqual(names(view("errors")), ["Gamma"]);
    assert.deepEqual(names(view("enabled")), ["Beta", "Gamma", "Zeta"]);
    assert.deepEqual(names(view("disabled")), ["alpha", "delta"]);
  });

  test("a filter whose count is 0 falls back to all", () => {
    const v = installedView([plugin("Only")], pluginFacts, "errors", "", "name");
    assert.equal(v.filter, "all");
    assert.deepEqual(names(v), ["Only"]);
  });

  test("needs attention: errors, then updates, then disabled, then the rest; ties by name", () => {
    assert.deepEqual(names(view("all", "attention")), ["Gamma", "Beta", "delta", "alpha", "Echo", "Zeta"]);
    assert.equal(attention({ error: true, update: true, disabled: true }), 0);
    assert.equal(attention({ error: false, update: true, disabled: true }), 1);
    assert.equal(attention({ error: false, update: false, disabled: true }), 2);
    assert.equal(attention({ error: false, update: false, disabled: false }), 3);
  });

  test("search matches name, id, description and marketplace, case-insensitively", () => {
    assert.deepEqual(names(view("all", "name", "  GAM ")), ["Gamma"]);
    assert.equal(names(view("all", "name", "@demo")).length, 6);
    assert.deepEqual(names(view("updates", "name", "zeta")), []);
  });

  test("a row across profiles is in every state any of its entries is in", () => {
    const facts = rowFacts({
      id: "x@demo", name: "X", marketplace: "demo", description: null, source: null,
      entries: new Map([["a", plugin("X", { enabled: true })], ["b", plugin("X", { enabled: false, updateTo: "2" })]]),
    });
    assert.equal(facts.enabled, true);
    assert.equal(facts.disabled, true);
    assert.equal(facts.update, true);
    assert.equal(facts.error, false);
  });

  test("catalog sort control comes from ECOSYSTEM_CAPS and is hidden with a single sort", () => {
    for (const eco of Object.keys(types.ECOSYSTEM_CAPS) as Ecosystem[]) {
      const sorts = catalogSorts(eco);
      assert.deepEqual([...sorts], types.ECOSYSTEM_CAPS[eco].sorts.length ? [...types.ECOSYSTEM_CAPS[eco].sorts] : ["name"], eco);
      assert.equal(sorts[0], "name", `${eco}: name is the default`);
    }
    assert.ok(catalogSorts("paseo").length > 1);
    assert.equal(catalogSorts("codex").length, 1);
    assert.equal(catalogSorts("antigravity").length, 1);
    // The screen renders the control only when there is more than one sort.
    assert.match(readFileSync(join(process.cwd(), "client/toolbox/plugins-screen.tsx"), "utf8"), /sorts\.length > 1 \?/);
  });

  test("tracking keys", () => {
    assert.equal(trackKey("paseo", null, "example/a"), "paseo:paseo:example/a");
    assert.notEqual(trackKey("claude", "p1", "x"), trackKey("claude", "p2", "x"));
  });
});

// ---- store.tsx: StateControl (sandboxed) and metadata ----------------------------------------------------------------------------------

describe("store cards", () => {
  const Button = function Button() { return null; };
  const IconButton = function IconButton() { return null; };
  const t = {
    common: { retry: "Retry" },
    plugins: {
      installedBadge: "Installed",
      actions: { install: "Install", update: "Update" },
      state: {
        dismiss: "Dismiss",
        running: { install: "Installing", update: "Updating", remove: "Removing", enable: "Enabling", disable: "Disabling" },
        failed: { install: "Install failed", update: "Update failed", remove: "Remove failed", enable: "Enable failed", disable: "Disable failed" },
      },
    },
  };
  const store = load("client/toolbox/store.tsx", ["StateControl"], {
    "./ui": stubModule({ Button, IconButton, useLook: () => ({ p: { danger: "red", success: "green" } }) }),
    "./strings": stubModule({ useToolboxText: () => t }),
  });

  type Node = { type: unknown; props: Record<string, unknown> } | null;
  const flat = (node: Node): { type: unknown; props: Record<string, unknown> }[] => {
    if (!node || typeof node !== "object") return [];
    const kids = ([] as unknown[]).concat(node.props.children ?? []) as Node[];
    return [node, ...kids.flatMap(flat)];
  };
  const control = (state: object, extra: object = {}): Node =>
    store.StateControl({ state, onInstall: () => {}, onUpdate: () => {}, busy: false, ...extra });
  const activity = (kind: string, s: "running" | "failed", calls: string[] = []) =>
    ({ kind, state: s, error: s === "failed" ? "boom" : null, retry: () => calls.push("retry"), dismiss: () => calls.push("dismiss") });

  test("idle: install when not installed, update when an update is known, else an installed mark", () => {
    const install = control({ installed: false, updateTo: null, activity: null });
    assert.equal(install?.type, Button);
    assert.equal(install?.props.label, "Install");
    assert.equal(install?.props.tone, "primary");
    const update = control({ installed: true, updateTo: "2.0.0", activity: null });
    assert.equal(update?.props.label, "Update");
    const done = control({ installed: true, updateTo: null, activity: null });
    assert.ok(flat(done).some((n) => n.props.children === "Installed"));
    assert.equal(control({ installed: true, updateTo: null, activity: null }, { hideInstalled: true }), null);
    assert.equal(control({ installed: false, updateTo: null, activity: null }, { onInstall: null }), null);
  });

  test("running: a loading button saying what is happening, whatever else is true", () => {
    for (const kind of ["install", "update", "remove", "enable", "disable"]) {
      const node = control({ installed: true, updateTo: "2.0.0", activity: activity(kind, "running") });
      assert.equal(node?.type, Button);
      assert.equal(node?.props.loading, true);
      assert.equal(node?.props.label, t.plugins.state.running[kind as "install"]);
    }
  });

  test("failed: what failed, retry and dismiss wired to the activity; retry disabled while busy", () => {
    const calls: string[] = [];
    const node = control({ installed: false, updateTo: null, activity: activity("update", "failed", calls) }, { busy: true });
    const nodes = flat(node);
    assert.ok(nodes.some((n) => n.props.children === "Update failed"));
    const retry = nodes.find((n) => n.type === Button);
    const dismiss = nodes.find((n) => n.type === IconButton);
    assert.equal(retry?.props.label, "Retry");
    assert.equal(retry?.props.disabled, true);
    (retry?.props.onPress as () => void)();
    (dismiss?.props.onPress as () => void)();
    assert.deepEqual(calls, ["retry", "dismiss"]);
  });

  test("metadata: https-only icon and homepage, finite installs, clean categories", () => {
    const base = { id: "a", name: "A", description: null, marketplace: null, source: null, categories: [], installed: false } as CatalogPlugin;
    assert.deepEqual(catalogMeta({ ...base, iconUrl: "https://example.com/i.png" }).picture, { kind: "url", url: "https://example.com/i.png" });
    for (const iconUrl of ["http://example.com/i.png", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "  ", null])
      assert.equal(catalogMeta({ ...base, iconUrl }).picture, null, String(iconUrl));
    const m = catalogMeta({ ...base, homepage: "http://x.com", installs: Number.NaN as never, categories: ["a", " ", 3 as never], featured: "yes" as never });
    assert.equal(m.homepage, null);
    assert.equal(m.installs, null);
    assert.deepEqual([...m.categories], ["a"]);
    assert.equal(m.featured, false);
    assert.equal(installedMeta({ id: "x", name: "X", iconUrl: "https://e.com/x.png", author: " Ann " } as never).author, "Ann");
  });

  test("version text: v-prefix for semver, short hash for commits", () => {
    assert.equal(versionText("1.2.0"), "v1.2.0");
    assert.equal(versionText("a".repeat(40)), "aaaaaaa");
    assert.equal(versionText("latest"), "latest");
  });
});

// ---- icon fallback ------------------------------------------------------------------------------

describe("icon fallback", () => {
  const p = { muted: "gray", worktrees: ["c0", "c1", "c2", "c3", "c4", "c5"] };

  test("initials from the first two words", () => {
    assert.equal(initials("Account Switcher"), "AS");
    assert.equal(initials("ado"), "A");
    assert.equal(initials("@example/my-tool"), "EM");
    assert.equal(initials("한국 플러그인"), "한플");
    assert.equal(initials("---"), "-");
    assert.equal(initials(""), "?");
  });

  test("the same name always gets the same color from the palette", () => {
    const names = ["alpha", "beta", "gamma", "delta", "Account Switcher", "x"];
    for (const name of names) {
      assert.equal(avatarColor(p, name), avatarColor(p, name));
      assert.ok(p.worktrees.includes(avatarColor(p, name)));
    }
    assert.ok(new Set(names.map((n) => avatarColor(p, n))).size > 1, "names spread over colors");
    assert.equal(avatarColor({ muted: "gray", worktrees: [] }, "x"), "gray");
  });

  test("an https iconUrl is the picture; anything else falls back to initials (null picture)", () => {
    const base = { id: "a", name: "A", description: null, marketplace: null, source: null, categories: [], installed: false } as CatalogPlugin;
    assert.deepEqual(catalogMeta({ ...base, iconUrl: "https://example.com/a.svg" }).picture, { kind: "url", url: "https://example.com/a.svg" });
    assert.equal(catalogMeta({ ...base, iconUrl: "http://example.com/a.svg" }).picture, null);
  });
});
