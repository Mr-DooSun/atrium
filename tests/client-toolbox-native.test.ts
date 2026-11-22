import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as toolboxTypes from "../shared/toolbox/types.ts";
import { createReact, findAll, loadClient, typeName } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Text strings: every path resolves to its own dotted name, and calling one returns that name too. */
const words = (path = "t"): Any => new Proxy(() => path, {
  get: (_t, key) => (typeof key === "string" ? words(`${path}.${key}`) : undefined),
  apply: () => path,
});
const said = (value: Any): string => (typeof value === "function" ? value() : String(value));
const profile = (id: string, kind: string) => ({ id, kind, label: id, auth: { state: "ready" } });

describe("Plugins screen: Paseo is native-only (A-2)", () => {
  let rpcRequested: string[];
  let profiles: Any[];
  let queried: boolean;

  function render(params: Record<string, string>) {
    const { react, mount } = createReact();
    const mod = loadClient<Any>("client/toolbox/plugins-screen.tsx", ["PluginsBody"], {
      react,
      modules: {
        "@getpaseo/plugin/client": { useRpc: (rpc: { name: string }) => { rpcRequested.push(rpc.name); return async () => ({}); } },
        "@tanstack/react-query": { useQuery: () => { queried = true; return {}; } },
        "../../shared/toolbox/types": toolboxTypes,
        "./queries": { keys: {}, useProfiles: () => ({ query: { data: { profiles }, isSuccess: true, isPending: false, isError: false }, refresh() {}, refreshing: false }) },
        "./action-flow": { useActionFlow: () => ({ element: null }) },
        "./strings": { useToolboxText: () => words(), useToolboxStrings: () => ({}), ToolboxTextProvider: "P" },
        "./ui": { ALL_PROFILES: "__all__", Segmented: "Segmented", ScreenBody: "ScreenBody", EmptyState: "EmptyState", Notice: "Notice", LoadingLine: "LoadingLine", ProfileSwitcher: "ProfileSwitcher", ScopeBasis: "ScopeBasis", errorText: String },
        "./store-logic": { FILTERS: [], PROJECT_SCOPES: [], ACTIVITY_OF: {}, catalogSorts: () => ["name"] },
      },
    });
    return mount(() => mod.PluginsBody({ hostId: "h", hostLabel: "Laptop", params }), undefined);
  }
  const names = (tree: Any) => findAll(tree, () => true).map((el) => typeName(el));
  const tabOf = (tree: Any) => findAll(tree, (el) => typeName(el) === "Segmented")[0].props.value;

  beforeEach(() => { rpcRequested = []; queried = false; profiles = [profile("claude-1", "claude"), profile("codex-1", "codex")]; });

  test("the Paseo tab shows only the native Gallery notice: no list, profile, scope or install component, and no RPC or query", () => {
    const view = render({ tab: "paseo" });
    const rendered = names(view.tree());
    assert.equal(tabOf(view.tree()), "paseo");
    assert.ok(rendered.includes("EmptyState"));
    for (const managed of ["ProfileGate", "AllPlugins", "ProfileSwitcher", "ScopeBasis", "EcosystemView", "SourceInstallModal"]) {
      assert.ok(!rendered.includes(managed), managed);
    }
    const empty = findAll(view.tree(), (el) => typeName(el) === "EmptyState")[0];
    assert.equal(said(empty.props.title), "t.plugins.nativeTitle");
    assert.equal(said(empty.props.body), "t.plugins.nativeBody", "the body is built from the host's label");
    assert.deepEqual(rpcRequested, []);
    assert.equal(queried, false);
  });

  test("a managed tab does render its profile views", () => {
    const rendered = names(render({ tab: "claude" }).tree());
    assert.ok(rendered.includes("ProfileGate"));
    assert.ok(!rendered.includes("EmptyState"));
  });

  test("default tab: the agent's own CLI first", () => {
    assert.equal(tabOf(render({ profileId: "codex-1" }).tree()), "codex");
    assert.equal(tabOf(render({ profileId: "claude-1" }).tree()), "claude");
  });

  test("default tab: no agent CLI -> the first profile's kind", () => {
    profiles = [profile("codex-1", "codex"), profile("claude-1", "claude")];
    assert.equal(tabOf(render({}).tree()), "codex");
    profiles = [profile("agy-1", "antigravity")];
    assert.equal(tabOf(render({}).tree()), "antigravity");
  });

  test("default tab: no profiles at all -> claude, never the native Paseo tab", () => {
    profiles = [];
    const view = render({});
    assert.equal(tabOf(view.tree()), "claude");
    assert.ok(!names(view.tree()).some((n) => n === "EmptyState" && said(findAll(view.tree(), (el) => typeName(el) === "EmptyState")[0].props.title) === "t.plugins.nativeTitle"));
  });

  test("an explicit tab wins over the agent's CLI; an unknown profile id does not pick a tab", () => {
    assert.equal(tabOf(render({ tab: "antigravity", profileId: "codex-1" }).tree()), "antigravity");
    assert.equal(tabOf(render({ profileId: "nope" }).tree()), "claude");
    assert.equal(tabOf(render({ tab: "agy" }).tree()), "antigravity");
  });

  test("unknown profile id is flagged and never falls back silently", () => {
    const warning = findAll(render({ profileId: "nope" }).tree(), (el) => typeName(el) === "Notice")[0];
    assert.equal(warning.props.tone, "warning");
  });
});
