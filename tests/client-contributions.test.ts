// R-1: Paseo's app rejects a contribution whose id (or slash command name) is not /^[a-z][a-z0-9-]*$/
// (packages/app/src/plugins/evaluate.ts requireId) and a throw there fails the whole client entry, so
// no Atrium sidebar, panes or toolbox. The rule lives in the app, so this is our own copy of it, applied
// to what the real registration code contributes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadClient, createReact } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const APP_ID_RULE = /^[a-z][a-z0-9-]*$/;
const message = { message: (key: string) => key };

interface Contribution { method: string; field: "id" | "name"; value: unknown }

/** A client that records every add* contribution and refuses, like the app, an id breaking the rule. */
function fakeClient(options: { refuse?: (method: string) => boolean } = {}) {
  const contributions: Contribution[] = [];
  const removed: string[] = [];
  const client = new Proxy({} as Record<string, unknown>, {
    get(_target, method: string) {
      if (!method.startsWith("add")) return () => undefined;
      return (spec: Any) => {
        if (options.refuse?.(method)) throw new Error(`refused ${method}`);
        const field = method === "addSlashCommand" ? "name" : "id";
        const value = spec?.[field];
        if (typeof value !== "string" || !APP_ID_RULE.test(value)) throw new Error(`Invalid plugin contribution ${field}: ${JSON.stringify(value)}`);
        contributions.push({ method, field, value });
        return () => { removed.push(`${method}:${value}`); };
      };
    },
  });
  return { client, contributions, removed };
}

function loadEntry(warnings: unknown[][] = []) {
  const { react } = createReact();
  const globals = { console: { warn: (...args: unknown[]) => warnings.push(args), error() {}, log() {} } };
  const toolbox = loadClient<Any>("client/toolbox/index.tsx", [], { react, globals, modules: { "./strings": { toolboxText: message } } });
  const panes = loadClient<Any>("client/panes/index.tsx", [], {
    react, globals,
    modules: {
      "../chat-strings": { panesText: message },
      "./drop-bus": { onOpenInPanes: () => () => undefined, openInPanes() {} },
      "./store": { setPanes() {}, usePanes: () => [], watchOtherWindows: () => () => undefined },
      "./layout": { addPane: (list: unknown) => list },
    },
  });
  const badge = loadClient<Any>("client/worktree-badge-item.tsx", [], { react, globals, modules: { "./sidebar-strings": { sidebarText: message } } });
  const entry = loadClient<Any>("index.client.tsx", [], {
    react, globals,
    modules: {
      "./client/nested-sidebar": { NestedSidebar: () => null },
      "./client/sidebar-strings": { sidebarText: message },
      "./client/toolbox": toolbox,
      "./client/panes": panes,
      "./client/worktree-badge-item": badge,
    },
  });
  return entry.default as (client: unknown) => () => void;
}

describe("contributed ids follow the app's rule (R-1)", () => {
  test("the rule itself rejects what broke 0.3.x: dots, capitals, leading digits, underscores, empty", () => {
    for (const bad of ["atrium.worktree", "Atrium", "1panes", "_x", "a_b", "", "a b", "a/b"]) assert.equal(APP_ID_RULE.test(bad), false, bad);
    for (const ok of ["atrium", "panes-open-this", "toolbox-mcp", "worktree", "a1"]) assert.equal(APP_ID_RULE.test(ok), true, ok);
  });

  test("every item, badge, screen, command and slash command the client contributes passes it, and none throws", () => {
    const { client, contributions } = fakeClient();
    assert.doesNotThrow(() => loadEntry()(client));
    assert.ok(contributions.length >= 10, `only ${contributions.length} contributions were seen`);
    for (const { method, field, value } of contributions) {
      assert.match(String(value), APP_ID_RULE, `${method}.${field} = ${JSON.stringify(value)}`);
    }
  });

  test("the whole surface is there: sidebar view, panes entry, /mcp and /plugins screens, commands and the badge", () => {
    const { client, contributions } = fakeClient();
    loadEntry()(client);
    const idsOf = (method: string) => contributions.filter((c) => c.method === method).map((c) => c.value).sort();
    assert.deepEqual(idsOf("addSidebarView"), ["atrium"]);
    assert.deepEqual(idsOf("addScreen"), ["mcp", "panes", "plugins"]);
    assert.deepEqual(idsOf("addSidebarHeaderItem"), ["panes"]);
    assert.deepEqual(idsOf("addSlashCommand"), ["mcp", "plugin", "plugins"]);
    assert.deepEqual(idsOf("addWorkspaceRowBadgeItem"), ["worktree"]);
    assert.deepEqual(idsOf("addCommandCenterItem"), ["panes-open", "panes-open-this", "toolbox-mcp", "toolbox-plugins"]);
  });

  test("ids are unique within each kind of contribution", () => {
    const { client, contributions } = fakeClient();
    loadEntry()(client);
    const seen = new Set<string>();
    for (const c of contributions) {
      const key = `${c.method}:${c.value}`;
      assert.equal(seen.has(key), false, key);
      seen.add(key);
    }
  });

  test("the cleanup removes every contribution", () => {
    const { client, contributions, removed } = fakeClient();
    loadEntry()(client)();
    assert.deepEqual([...removed].sort(), contributions.map((c) => `${c.method}:${c.value}`).sort());
  });

  test("no contribution method outside the ones audited here slips in unchecked", () => {
    const { client, contributions } = fakeClient();
    loadEntry()(client);
    const audited = new Set(["addSidebarView", "addScreen", "addSidebarHeaderItem", "addSlashCommand", "addWorkspaceRowBadgeItem", "addCommandCenterItem"]);
    for (const { method } of contributions) assert.ok(audited.has(method), `${method} is new: check its id rule`);
  });
});

describe("the optional worktree badge cannot take the client down (R-1, 6d13626)", () => {
  test("when the host refuses the badge, everything else still registers and the failure is only a warning", () => {
    const warnings: unknown[][] = [];
    const { client, contributions } = fakeClient({ refuse: (method) => method === "addWorkspaceRowBadgeItem" });
    let cleanup: () => void = () => undefined;
    assert.doesNotThrow(() => { cleanup = loadEntry(warnings)(client); });
    const kinds = new Set(contributions.map((c) => c.method));
    for (const kept of ["addSidebarView", "addScreen", "addSidebarHeaderItem", "addSlashCommand", "addCommandCenterItem"]) assert.ok(kinds.has(kept), kept);
    assert.equal(kinds.has("addWorkspaceRowBadgeItem"), false);
    assert.equal(contributions.length, 12, "the sidebar, panes and toolbox contributions are all there");
    assert.ok(warnings.some((w) => String(w[0]).includes("worktree badge")), "logged, not thrown");
    assert.doesNotThrow(() => cleanup());
  });

  test("an invalid badge id alone would be refused by the host, and is swallowed the same way", () => {
    const { client, contributions } = fakeClient({ refuse: (method) => method === "addWorkspaceRowBadgeItem" });
    loadEntry()(client);
    assert.ok(contributions.some((c) => c.method === "addSidebarView" && c.value === "atrium"));
  });

  test("the other registrations are NOT shielded: an invalid id elsewhere still fails loudly", () => {
    const { client } = fakeClient({ refuse: (method) => method === "addScreen" });
    assert.throws(() => loadEntry()(client), /refused addScreen/);
  });
});
