import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { hiddenProjectKey } from "../shared/project-rpc.ts";
import { hiddenKeySet, isHiddenProject, visibleProjectBlocks } from "../client/sidebar-visibility.ts";
import { createReact, loadClient, plain } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
import * as naming from "../client/workspace-naming.ts";
const source = (file: string) => readFileSync(file, "utf8");
const { keepHiddenSlots } = loadClient<{ keepHiddenSlots(next: string[], previous: string[], hidden: Set<string>): string[] }>("client/project-order.tsx");
const keep = (next: string[], previous: string[], hidden: string[]) => plain(keepHiddenSlots(next, previous, new Set(hidden)));

describe("keepHiddenSlots: reordering the shown projects keeps hidden ones in place", () => {
  test("[a,H,b,c] with b moved first becomes [b,H,a,c]", () => {
    assert.deepEqual(keep(["b", "a", "c"], ["a", "H", "b", "c"], ["H"]), ["b", "H", "a", "c"]);
  });
  test("moving the last shown project to the front, and the first to the end", () => {
    assert.deepEqual(keep(["c", "a", "b"], ["a", "H", "b", "c"], ["H"]), ["c", "H", "a", "b"]);
    assert.deepEqual(keep(["b", "c", "a"], ["a", "H", "b", "c"], ["H"]), ["b", "H", "c", "a"]);
  });
  test("several hidden projects keep their own slots", () => {
    assert.deepEqual(keep(["c", "b", "a"], ["H1", "a", "H2", "b", "c"], ["H1", "H2"]), ["H1", "c", "H2", "b", "a"]);
  });
  test("a hidden project that is not in the saved order follows the shown ones; it is never lost", () => {
    assert.deepEqual(keep(["b", "a", "c"], ["a", "b", "c"], ["H"]), ["b", "a", "c"]);
    assert.deepEqual(keep(["b", "a", "H"], ["a", "b"], ["H"]), ["b", "a", "H"]);
    assert.deepEqual(keep(["b", "a", "c", "H"], ["a", "b"], ["H"]), ["b", "a", "c", "H"]);
  });
  test("shown projects missing from the saved order go after the filled slots", () => {
    assert.deepEqual(keep(["n1", "a", "n2"], ["a", "H"], ["H"]), ["n1", "H", "a", "n2"]);
  });
  test("nothing hidden: the new order is used as it is; an empty saved order is fine", () => {
    assert.deepEqual(keep(["b", "a"], ["a", "b"], []), ["b", "a"]);
    assert.deepEqual(keep(["b", "a"], [], ["H"]), ["b", "a"]);
  });
  test("every key appears exactly once, and the result never drops a shown key", () => {
    const out = keep(["x", "a", "b", "H"], ["a", "H", "H", "b", "gone"], ["H"]);
    assert.deepEqual([...out].sort(), ["H", "a", "b", "x"].sort());
    assert.equal(new Set(out).size, out.length);
  });
});

describe("hidden projects are scoped to their host", () => {
  test("the key separates the same project id on two hosts", () => {
    const hidden = new Set([hiddenProjectKey("srv_a", "same")]);
    assert.equal(hidden.has(hiddenProjectKey("srv_a", "same")), true);
    assert.equal(hidden.has(hiddenProjectKey("srv_b", "same")), false);
  });

  test("the sidebar no longer has any project removal path", () => {
    for (const file of ["client/nested-sidebar.tsx", "client/project-order.tsx", "client/hide-project.tsx", "index.client.tsx"]) {
      assert.doesNotMatch(source(file), /removeProject|remove-project|project\.remove|useRemoveProject/, file);
    }
  });
});

describe("folded rows persist across reloads (U-7)", () => {
  function fresh(initial?: string) {
    const store = new Map<string, string>(initial === undefined ? [] : [["atrium.sidebar.collapsed.v1", initial]]);
    const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const { react, mount } = createReact();
    const mod = loadClient<Any>("client/collapsed-store.ts", [], { react, globals: { localStorage } });
    return { mod, store, mount };
  }
  const saved = (store: Map<string, string>) => JSON.parse(store.get("atrium.sidebar.collapsed.v1") ?? "null");

  test("toggling writes the folded keys; a reload reads them back; toggling again unfolds", () => {
    const first = fresh();
    first.mod.toggleCollapsed("[\"srv_a\",\"p1\"]");
    first.mod.toggleCollapsed("atrium:general");
    assert.deepEqual(saved(first.store), ["[\"srv_a\",\"p1\"]", "atrium:general"]);
    const reloaded = fresh(first.store.get("atrium.sidebar.collapsed.v1"));
    const [collapsed, toggle] = reloaded.mount(() => reloaded.mod.useCollapsed(), undefined).tree();
    assert.deepEqual([...collapsed].sort(), ["[\"srv_a\",\"p1\"]", "atrium:general"]);
    toggle("atrium:general");
    assert.deepEqual(saved(reloaded.store), ["[\"srv_a\",\"p1\"]"]);
  });

  test("malformed saved text reads as nothing folded", () => {
    for (const text of ["", "not json", "{}", "null", "\"x\"", "[1,2]"]) {
      assert.deepEqual([...fresh().mod.parseCollapsed(text)], [], text);
    }
    assert.deepEqual([...fresh().mod.parseCollapsed("[\"a\",1,null,\"b\"]")], ["a", "b"]);
    const { mod } = fresh("not json");
    mod.toggleCollapsed("k");
    assert.deepEqual([...mod.parseCollapsed(JSON.stringify(["k"]))], ["k"]);
  });

  test("the saved set is capped, dropping the oldest keys", () => {
    const { mod, store } = fresh();
    const cap = mod.MAX_COLLAPSED;
    for (let i = 0; i < cap + 5; i++) mod.toggleCollapsed(`k${i}`);
    const list = saved(store);
    assert.equal(list.length, cap);
    assert.equal(list[0], "k5");
    assert.equal(list.at(-1), `k${cap + 4}`);
    assert.equal(mod.parseCollapsed(JSON.stringify(Array.from({ length: cap + 3 }, (_, i) => `x${i}`))).size, cap);
  });

  test("without localStorage (native) it still folds for the session and never throws", () => {
    const { react, mount } = createReact();
    const mod = loadClient<Any>("client/collapsed-store.ts", [], { react });
    mod.toggleCollapsed("k");
    const [collapsed] = mount(() => mod.useCollapsed(), undefined).tree();
    assert.deepEqual([...collapsed], ["k"]);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
    const safe = loadClient<Any>("client/collapsed-store.ts", [], { react, globals: { localStorage: throwing } });
    assert.doesNotThrow(() => safe.toggleCollapsed("k"));
  });

  test("both the tree and the General section use the same persisted store (source check)", () => {
    assert.match(source("client/nested-sidebar.tsx"), /useCollapsed\(\)/);
    assert.match(source("client/chat.tsx"), /useCollapsed\(\)/);
    assert.doesNotMatch(source("client/nested-sidebar.tsx"), /useState<ReadonlySet<string>>/);
  });
});

describe("naming and input checks", () => {
  test("renameFallback: the branch when there is one, else the folder name (U-8)", () => {
    const { renameFallback } = loadClient<Any>("client/rename.tsx");
    assert.deepEqual(plain(renameFallback("feat/x", "/a/b")), { kind: "branch", name: "feat/x" });
    assert.deepEqual(plain(renameFallback(null, "/Users/me/work/atrium")), { kind: "folder", name: "atrium" });
    assert.deepEqual(plain(renameFallback(null, "C:\\work\\proj\\")), { kind: "folder", name: "proj" });
    assert.deepEqual(plain(renameFallback("", "/")), { kind: "folder", name: "/" });
  });

  test("mcpNameOk: one plain word, the Codex rule, at most 64 characters (U-17)", () => {
    const { mcpNameOk } = loadClient<Any>("client/toolbox/mcp-screen.tsx");
    for (const ok of ["github", "my_server", "a.b-c", "@scope/pkg", "ns:tool", "a".repeat(64), "  padded  "]) assert.equal(mcpNameOk(ok), true, ok);
    for (const bad of ["", "   ", "-lead", ".lead", "has space", "semi;colon", "a$b", "x".repeat(65), "한글", "--flag", "a\nb"]) assert.equal(mcpNameOk(bad), false, JSON.stringify(bad));
  });
});

describe("sidebar visibility (U-1)", () => {
  const hidden = (...pairs: [string, string][]) => hiddenKeySet(pairs.map(([hostId, projectId]) => ({ hostId, projectId })));
  const ref = (hostId: string, id: string) => ({ hostId, id });

  test("hiddenKeySet is host scoped and tolerates duplicates and an empty list", () => {
    assert.equal(hiddenKeySet([]).size, 0);
    assert.equal(hidden(["a", "1"], ["a", "1"], ["b", "1"]).size, 2);
    assert.deepEqual([...hidden(["a", "1"])], [hiddenProjectKey("a", "1")]);
  });

  test("isHiddenProject: host AND id, never id alone", () => {
    const keys = hidden(["srv_a", "same"]);
    assert.equal(isHiddenProject(ref("srv_a", "same"), keys), true);
    assert.equal(isHiddenProject(ref("srv_b", "same"), keys), false, "same id on another host");
    assert.equal(isHiddenProject(ref("srv_a", "other"), keys), false);
    assert.equal(isHiddenProject(ref("srv_a", "same"), hidden()), false);
  });

  test("visibleProjectBlocks: the same projectId on two hosts, only the hidden one drops", () => {
    const blocks = [{ projectKey: "ka", n: 1 }, { projectKey: "kb", n: 2 }, { projectKey: "kc", n: 3 }];
    const refs = new Map([["ka", ref("srv_a", "same")], ["kb", ref("srv_b", "same")], ["kc", ref("srv_a", "other")]]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden(["srv_a", "same"])).map((b) => b.n), [2, 3]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden(["srv_b", "same"])).map((b) => b.n), [1, 3]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden(["srv_a", "same"], ["srv_b", "same"])).map((b) => b.n), [3]);
  });

  test("visibleProjectBlocks: nothing hidden keeps every known block in order; blocks of unknown projects are dropped", () => {
    const blocks = [{ projectKey: "kb" }, { projectKey: "ghost" }, { projectKey: "ka" }];
    const refs = new Map([["ka", ref("h", "1")], ["kb", ref("h", "2")]]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden()).map((b) => b.projectKey), ["kb", "ka"]);
    assert.deepEqual(visibleProjectBlocks([], refs, hidden(["h", "1"])), []);
  });

  test("unhiding brings the project back in its place", () => {
    const blocks = [{ projectKey: "ka" }, { projectKey: "kb" }];
    const refs = new Map([["ka", ref("h", "1")], ["kb", ref("h", "2")]]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden(["h", "1"])).map((b) => b.projectKey), ["kb"]);
    assert.deepEqual(visibleProjectBlocks(blocks, refs, hidden()).map((b) => b.projectKey), ["ka", "kb"]);
  });
});

describe("workspace row naming (U-5)", () => {
  const { workspaceCustomTitle, workspaceRowLabel } = naming;

  test("workspaceCustomTitle: a title the user gave; null when unset or when it only mirrors the branch", () => {
    assert.equal(workspaceCustomTitle({ title: "Billing fix", branch: "main" }), "Billing fix");
    assert.equal(workspaceCustomTitle({ title: "main", branch: "main" }), null, "Paseo's own branch-derived name");
    assert.equal(workspaceCustomTitle({ title: null, branch: "main" }), null);
    assert.equal(workspaceCustomTitle({ title: "", branch: "main" }), null);
    assert.equal(workspaceCustomTitle({ title: "x", branch: null }), "x");
  });

  test("workspaceRowLabel: user title > the only agent's title > Paseo's name", () => {
    const base = { customTitle: null, name: "main", singleAgent: false, agentTitle: "Fix login" };
    assert.equal(workspaceRowLabel({ ...base, customTitle: "Mine", singleAgent: true }), "Mine");
    assert.equal(workspaceRowLabel({ ...base, singleAgent: true }), "Fix login");
    assert.equal(workspaceRowLabel(base), "main", "several agents: the workspace keeps its own name");
    assert.equal(workspaceRowLabel({ ...base, singleAgent: true, agentTitle: null }), "main");
    assert.equal(workspaceRowLabel({ ...base, singleAgent: true, agentTitle: undefined }), "main");
    assert.equal(workspaceRowLabel({ ...base, singleAgent: true, agentTitle: "" }), "main");
  });

  test("three workspaces on one branch read differently once they hold different agents", () => {
    const label = (agentTitle: string) => workspaceRowLabel({ customTitle: workspaceCustomTitle({ title: null, branch: "main" }), name: "main", singleAgent: true, agentTitle });
    assert.deepEqual(["A", "B", "C"].map(label), ["A", "B", "C"]);
  });
});
