import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { hiddenProjectKey } from "../shared/project-rpc.ts";
import { displayedOrder, hiddenKeySet, isHiddenProject, keepHiddenSlots, orderKeyHost, reorderSection, sectionSaved, visibleProjectBlocks } from "../client/sidebar-visibility.ts";
import { applyOrder, move, placeAt, projectOrderKey } from "../shared/project-order.ts";
import { createReact, loadClient, plain, textOf } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
import * as naming from "../client/workspace-naming.ts";
const source = (file: string) => readFileSync(file, "utf8");
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

describe("reorderSection: one host's section at a time", () => {
  const key = (host: string, root: string) => projectOrderKey(host, root);
  const [A1, HA, A2, B1, B2] = [key("A", "/a1"), key("A", "/h"), key("A", "/a2"), key("B", "/b1"), key("B", "/b2")];
  const hiddenOf = (...keys: string[]) => new Set(keys);

  test("orderKeyHost and sectionSaved read the host a key names", () => {
    assert.equal(orderKeyHost(A1), "A");
    assert.equal(orderKeyHost("/legacy/root"), null);
    assert.equal(orderKeyHost("[odd folder"), null);
    assert.deepEqual(sectionSaved([A1, B1, A2, "/legacy"], "A"), [A1, A2]);
    assert.deepEqual(sectionSaved([A1, B1], null), [A1, B1], "no sections: the whole list");
  });

  test("repro: saved [A1,H(A),A2,B1,B2], H hidden, B2 moved up in B -> [A1,H,A2,B2,B1]", () => {
    const saved = [A1, HA, A2, B1, B2];
    const next = move([B1, B2], sectionSaved(saved, "B"), B2, -1);
    assert.deepEqual(reorderSection(saved, next, "B", hiddenOf(HA)), [A1, HA, A2, B2, B1]);
  });

  test("the same through a drag (placeAt)", () => {
    const saved = [A1, HA, A2, B1, B2];
    const next = placeAt([B1, B2], sectionSaved(saved, "B"), B2, 0);
    assert.deepEqual(reorderSection(saved, next, "B", hiddenOf(HA)), [A1, HA, A2, B2, B1]);
  });

  test("reordering A's shown projects keeps A's hidden slot and leaves B alone", () => {
    const saved = [A1, HA, A2, B1, B2];
    const viaMove = reorderSection(saved, move([A1, A2], sectionSaved(saved, "A"), A2, -1), "A", hiddenOf(HA));
    assert.deepEqual(viaMove, [A2, HA, A1, B1, B2]);
    const viaDrag = reorderSection(saved, placeAt([A1, A2], sectionSaved(saved, "A"), A2, 0), "A", hiddenOf(HA));
    assert.deepEqual(viaDrag, viaMove);
  });

  test("other hosts' hidden keys keep their slots too", () => {
    const HB = key("B", "/hb");
    const saved = [B1, HB, B2, A1, HA, A2];
    const out = reorderSection(saved, move([A1, A2], sectionSaved(saved, "A"), A2, -1), "A", hiddenOf(HA, HB));
    assert.deepEqual(out, [B1, HB, B2, A2, HA, A1]);
    const inB = reorderSection(saved, move([B1, B2], sectionSaved(saved, "B"), B2, -1), "B", hiddenOf(HA, HB));
    assert.deepEqual(inB, [B2, HB, B1, A1, HA, A2]);
  });

  test("a project new to the saved order goes to the front of its section, where it is shown", () => {
    const fresh = key("B", "/new");
    const saved = [A1, B1];
    assert.deepEqual(reorderSection(saved, [fresh, B1], "B", hiddenOf()), [A1, fresh, B1]);
    assert.deepEqual(reorderSection([A1], [fresh], "B", hiddenOf()), [A1, fresh], "an unseen section is appended");
    assert.deepEqual(reorderSection([], [fresh, B1], "B", hiddenOf()), [fresh, B1]);
  });

  test("host null (no sections) is exactly keepHiddenSlots", () => {
    const saved = ["a", "H", "b", "c"];
    for (const next of [["b", "a", "c"], ["c", "b", "a"], ["a", "b", "c", "n"]]) {
      assert.deepEqual(reorderSection(saved, next, null, hiddenOf("H")), keepHiddenSlots(next, saved, hiddenOf("H")));
    }
    assert.deepEqual(reorderSection(saved, ["b", "a", "c"], null, hiddenOf("H")), ["b", "H", "a", "c"]);
  });

  test("legacy root-only keys belong to no host section and are never moved by one", () => {
    const saved = ["/legacy", A1, B1, A2];
    assert.deepEqual(reorderSection(saved, [A2, A1], "A", hiddenOf()), ["/legacy", A2, B1, A1]);
  });

  test("every key appears once and nothing is lost", () => {
    const saved = [A1, HA, A2, B1, B2];
    const out = reorderSection(saved, [B2, B1, key("B", "/n")], "B", hiddenOf(HA));
    assert.equal(new Set(out).size, out.length);
    for (const k of saved) assert.ok(out.includes(k), k);
  });
});

describe("the other-host hide notices are gone", () => {
  test("hideOtherHost and hideHostUnknown appear nowhere in the shipped code or strings", () => {
    const files = [...readdirSync(".", { recursive: true, encoding: "utf8" })]
      .filter((f) => /^(client|server|shared)\//.test(f) && /\.(ts|tsx)$/.test(f))
      .concat(["index.client.tsx", "index.server.ts"]);
    assert.ok(files.length > 50);
    for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /hideOtherHost|hideHostUnknown/, file);
  });

  test("every language of the sidebar strings still has the hide keys it uses", async () => {
    const { sidebarText } = await import("../client/sidebar-strings.ts");
    const keys = ["hide", "hideTitle", "hideBody", "hideConfirm", "hiding", "hideFailed", "unhide", "unhideFailed", "hiddenProjects", "hiddenMissing", "orderFailed"];
    for (const key of keys) assert.ok((sidebarText.message as Any)(key, { n: 1, id: "x", name: "x" }), key);
  });
});

describe("displayedOrder: reordering starts from what the sidebar shows", () => {
  test("keys the saved order does not name come first, in their default order; the saved order follows intact", () => {
    assert.deepEqual(displayedOrder(["n1", "a", "n2", "b"], ["b", "a"]), ["n1", "n2", "b", "a"]);
    assert.deepEqual(displayedOrder(["a", "b"], []), ["a", "b"], "nothing saved: the default order");
    assert.deepEqual(displayedOrder([], ["b", "a"]), ["b", "a"]);
  });
  test("saved keys no project has now (an offline host's) keep their place", () => {
    assert.deepEqual(displayedOrder(["n", "a"], ["off1", "a", "off2"]), ["n", "off1", "a", "off2"]);
  });
  test("no duplicates, whichever list repeats a key", () => {
    assert.deepEqual(displayedOrder(["a", "a", "n", "n"], ["a", "a", "b"]), ["n", "a", "b"]);
    const out = displayedOrder(["x", "y", "x"], ["y", "z", "z"]);
    assert.equal(new Set(out).size, out.length);
  });
  test("it is exactly what applyOrder shows for the same inputs", () => {
    const keys = ["n1", "a", "n2", "b"];
    const saved = ["b", "off", "a"];
    assert.deepEqual(applyOrder(keys, saved, (k) => k), displayedOrder(keys, saved).filter((k) => keys.includes(k)));
  });
});

describe("hide, reorder the rest, unhide: the hidden project keeps its place (uxtester's scenario)", () => {
  const key = (host: string, root: string) => projectOrderKey(host, root);
  const [b2, b1, b3] = [key("B", "/b-two"), key("B", "/b-one"), key("B", "/b-three")];
  const [a1, a2] = [key("A", "/a-one"), key("A", "/a-two")];
  // The sidebar's default order of the section: b-two, b-one, b-three.
  const defaultKeys = [a1, b2, b1, b3, a2];

  /** What the sidebar does: displayedOrder -> move or placeAt among the shown -> reorderSection. */
  function reorder(saved: string[], hidden: Set<string>, how: "buttons" | "drag") {
    const base = displayedOrder(defaultKeys, saved);
    const shownB = applyOrder(defaultKeys.filter((k) => orderKeyHost(k) === "B" && !hidden.has(k)), saved, (k) => k);
    assert.deepEqual(shownB, [b2, b3], "b-one is hidden, the other two show in default order");
    const next = how === "buttons"
      ? move(shownB, sectionSaved(base, "B"), b3, -1)
      : placeAt(shownB, sectionSaved(base, "B"), b3, 0);
    return reorderSection(base, next, "B", hidden);
  }
  const sectionB = (order: string[]) => applyOrder(defaultKeys.filter((k) => orderKeyHost(k) === "B"), order, (k) => k);

  const cases: [string, string[]][] = [
    ["nothing saved", []],
    ["only the other host's keys saved", [a1, a2]],
    ["everything saved", [a1, b2, b1, b3, a2]],
    ["everything saved, other host's keys elsewhere", [b2, a2, b1, a1, b3]],
  ];
  for (const [name, saved] of cases) {
    for (const how of ["buttons", "drag"] as const) {
      test(`${name} (${how}): after unhide the order is b-three, b-one, b-two`, () => {
        const next = reorder(saved, new Set([b1]), how);
        assert.deepEqual(sectionB(next), [b3, b1, b2]);
      });
    }
  }

  test("the repro before the fix: starting from the unsaved order alone loses the hidden slot", () => {
    const wrong = reorderSection([], [b3, b2], "B", new Set([b1]));
    assert.deepEqual(sectionB(wrong), [b1, b3, b2], "b-one comes back first, as a new project would");
  });

  test("a project hidden in the middle of three stays in the middle through several reorders", () => {
    let saved: string[] = [];
    const hidden = new Set([b1]);
    saved = reorder(saved, hidden, "buttons");
    const shownB = applyOrder([b2, b3], saved, (k) => k);
    const base = displayedOrder(defaultKeys, saved);
    saved = reorderSection(base, move(shownB, sectionSaved(base, "B"), shownB[1], -1), "B", hidden);
    assert.deepEqual(sectionB(saved), [b2, b1, b3], "swapped back; b-one never moved");
  });
});

describe("reordering one host leaves the others' keys in place, saved or not", () => {
  const key = (host: string, root: string) => projectOrderKey(host, root);
  const [a1, a2, b1, b2, c1] = [key("A", "/a1"), key("A", "/a2"), key("B", "/b1"), key("B", "/b2"), key("C", "/c1")];
  const sectionKeysA = (list: string[]) => list.filter((k) => orderKeyHost(k) === "A");

  test("A reordered: B's and C's keys are where displayedOrder put them, saved or not", () => {
    // C is an offline host: its project is not in the current list but is saved; B is unsaved.
    const keys = [a1, a2, b1, b2];
    const saved = [c1, a1, a2];
    const base = displayedOrder(keys, saved);
    assert.deepEqual(base, [b1, b2, c1, a1, a2]);
    const next = move([a1, a2], sectionSaved(base, "A"), a2, -1);
    const out = reorderSection(base, next, "A", new Set());
    assert.deepEqual(out, [b1, b2, c1, a2, a1]);
    assert.deepEqual(out.filter((k) => orderKeyHost(k) !== "A"), base.filter((k) => orderKeyHost(k) !== "A"));
    assert.deepEqual(sectionKeysA(out), [a2, a1]);
  });

  test("the same when the other host's keys are unsaved offline-host keys only", () => {
    const base = displayedOrder([a1, a2], [c1]);
    const out = reorderSection(base, [a2, a1], "A", new Set());
    assert.deepEqual(out.filter((k) => k === c1), [c1]);
    assert.equal(out.indexOf(c1), base.indexOf(c1));
    assert.deepEqual(sectionKeysA(out), [a2, a1]);
  });

  test("another host's hidden key keeps its slot too", () => {
    const hb = key("B", "/hidden");
    const base = displayedOrder([a1, hb, a2, b1], [a1, hb, a2, b1]);
    const out = reorderSection(base, [a2, a1], "A", new Set([hb]));
    assert.deepEqual(out, [a2, hb, a1, b1]);
  });
});

describe("OtherHostNotice (another host's chat, named as the sidebar names it)", () => {
  function notice(hostId: string, hosts: { serverId: string; label: string }[]) {
    const { react, mount } = createReact();
    const mod = loadClient<Any>("client/panes/pane.tsx", ["OtherHostNotice"], {
      react,
      modules: {
        "@getpaseo/plugin/client": {
          useHosts: () => hosts,
          useTranslation: () => ({ t: (key: string, params?: object) => `${key}:${JSON.stringify(params ?? {})}` }),
        },
        "@getpaseo/plugin/client/ui": { Icon: "Icon" },
      },
    });
    return textOf(mount(() => mod.OtherHostNotice({ hostId, p: { muted: "x" } }), undefined).tree());
  }
  const hosts = [{ serverId: "srv_a", label: "Laptop" }, { serverId: "srv_b", label: "" }];

  test("a known host shows its label", () => {
    assert.equal(notice("srv_a", hosts), 'otherHost:{"host":"Laptop"}');
  });
  test("an unknown host shows its id", () => {
    assert.equal(notice("srv_z", hosts), 'otherHost:{"host":"srv_z"}');
    assert.equal(notice("srv_z", []), 'otherHost:{"host":"srv_z"}');
  });
  test("a host with an empty label shows its id", () => {
    assert.equal(notice("srv_b", hosts), 'otherHost:{"host":"srv_b"}');
  });
});
