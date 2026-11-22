import "./helpers/isolated-home.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as projectRpc from "../shared/project-rpc.ts";
import { createReact, findAll, loadClient, plain, textOf, typeName } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ORDER_KEY = ["projectOrder", 2];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useHideProject and the hidden list", () => {
  let calls: [string, unknown][];
  let queryData: Map<string, unknown>;
  let invalidated: unknown[];
  let hideImpl: (input: Any) => Promise<Any>;
  let unhideImpl: (input: Any) => Promise<Any>;
  let projects: { key: string }[];
  let hosts: { serverId: string; label: string }[];
  let toasts: string[];

  function load(expose: string[]) {
    const { react, mount } = createReact();
    const queryClient = {
      getQueryData: (key: unknown) => queryData.get(JSON.stringify(key)),
      setQueryData: (key: unknown, value: unknown) => { queryData.set(JSON.stringify(key), value); },
      invalidateQueries: async (filter: { queryKey: unknown }) => { invalidated.push(filter.queryKey); },
    };
    const backend: Record<string, (input: Any) => Promise<Any>> = {
      "project.hide": (input) => hideImpl(input),
      "project.unhide": (input) => unhideImpl(input),
    };
    const mod = loadClient<Any>("client/hide-project.tsx", expose, {
      react,
      modules: {
        "@tanstack/react-query": { useQueryClient: () => queryClient },
        "@getpaseo/plugin/client": {
          useRpc: (rpc: { name: string }) => (input: unknown) => {
            calls.push([rpc.name, input]);
            const handler = backend[rpc.name];
            if (!handler) throw new Error(`unexpected RPC ${rpc.name}`);
            return handler(input);
          },
          useTranslation: () => ({ t: (key: string, params?: object) => params ? `${key}:${JSON.stringify(params)}` : key }),
          useHosts: () => hosts,
          useProjects: () => projects,
        },
        "@getpaseo/plugin/client/ui": { useToast: () => ({ error: (message: string) => toasts.push(message) }), Icon: "Icon", Modal: "Modal" },
        "../shared/project-rpc": projectRpc,
        "./project-order": { PROJECT_ORDER_KEY: ORDER_KEY },
        "./archive": { ArchiveModal: "ArchiveModal" },
        "./look": { ROW: { minHeight: 1, paddingVertical: 1 } },
        "./sidebar-strings": { sidebarText: {} },
      },
    });
    return { mod, mount };
  }
  const hiddenOf = (...ids: [string, string][]) => ids.map(([hostId, projectId]) => ({ hostId, projectId }));
  const hideCalls = () => calls.filter(([name]) => name === "project.hide");
  const ref = (hostId: string, id = "p1") => ({ id, hostId, key: "k" });

  beforeEach(() => {
    calls = []; queryData = new Map(); invalidated = []; toasts = []; projects = [];
    hosts = [{ serverId: "srv_a", label: "Laptop" }];
    queryData.set(JSON.stringify(ORDER_KEY), { order: ["x"], nodes: {}, hiddenProjects: [] });
    hideImpl = async ({ projectId, hostId }) => ({ ok: true, hiddenProjects: hiddenOf([hostId, projectId]) });
    unhideImpl = async () => ({ ok: true, hiddenProjects: [] });
  });

  test("a project of the sidebar's own host: one project.hide with its host id, the order query updated and refreshed, the dialog closed", async () => {
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject(ref("srv_a")), undefined);
    hook.tree().begin();
    assert.equal(hook.tree().confirming, true);
    hook.tree().confirm();
    await flush();
    assert.deepEqual(plain(calls), [["project.hide", { projectId: "p1", hostId: "srv_a" }]]);
    assert.equal(hook.tree().confirming, false);
    assert.equal(hook.tree().pending, false);
    assert.deepEqual(plain((queryData.get(JSON.stringify(ORDER_KEY)) as Any).hiddenProjects), hiddenOf(["srv_a", "p1"]));
    assert.deepEqual(invalidated, [ORDER_KEY]);
  });

  test("a project of ANOTHER host: project.hide exactly once with that project's host, no project.worktrees or any other call, the dialog closes", async () => {
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject(ref("srv_other", "remote-1")), undefined);
    hook.tree().begin();
    hook.tree().confirm();
    await flush();
    assert.deepEqual(plain(calls), [["project.hide", { projectId: "remote-1", hostId: "srv_other" }]]);
    assert.equal(hook.tree().confirming, false);
    assert.equal(hook.tree().error, null);
    assert.deepEqual(plain((queryData.get(JSON.stringify(ORDER_KEY)) as Any).hiddenProjects), hiddenOf(["srv_other", "remote-1"]));
  });

  test("the hook exposes no host gating any more", () => {
    const { mod, mount } = load(["useHideProject"]);
    const state = mount(() => mod.useHideProject(ref("srv_other")), undefined).tree();
    assert.deepEqual(Object.keys(state).sort(), ["begin", "cancel", "confirm", "confirming", "error", "pending"]);
  });

  test("an empty host id sends nothing and says it failed; the dialog stays open", async () => {
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject(ref("")), undefined);
    hook.tree().begin();
    hook.tree().confirm();
    await flush();
    assert.deepEqual(calls, []);
    assert.equal(hook.tree().error, "hideFailed");
    assert.equal(hook.tree().confirming, true);
    assert.equal(hook.tree().pending, false);
    assert.equal(invalidated.length, 0);
  });

  test("a second confirm while one is pending does not hide twice", async () => {
    let release: () => void = () => {};
    hideImpl = ({ projectId, hostId }) => new Promise((resolve) => { release = () => resolve({ ok: true, hiddenProjects: hiddenOf([hostId, projectId]) }); });
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject(ref("srv_a")), undefined);
    hook.tree().confirm();
    await flush();
    hook.tree().confirm();
    await flush();
    release();
    await flush();
    assert.equal(hideCalls().length, 1);
  });

  test("a failed hide keeps the dialog open with the server's message; a blank message falls back to hideFailed", async () => {
    hideImpl = async () => { throw new Error("Project target host is required and must be 1–256 characters without whitespace."); };
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject(ref("srv_a")), undefined);
    hook.tree().begin();
    hook.tree().confirm();
    await flush();
    assert.match(hook.tree().error, /^Project target host is required/);
    assert.equal(hook.tree().confirming, true);
    assert.equal(hook.tree().pending, false);
    assert.equal(invalidated.length, 0);
    hideImpl = async () => { throw new Error(""); };
    hook.tree().confirm();
    await flush();
    assert.equal(hook.tree().error, "hideFailed");
  });

  test("a hidden project the host no longer has reads 'not on this host (id)'; a known one shows its name", () => {
    const { mod, mount } = load(["HiddenProjectRow"]);
    const row = (e: Any) => mod.HiddenProjectRow({ entry: e, host: null, p: {} });
    const missing = mount(row, { hostId: "srv_a", projectId: "gone-1" });
    assert.match(textOf(missing.tree()), /hiddenMissing:\{"id":"gone-1"\}/);
    projects = [{ key: "My Project" }];
    const known = mount(row, { hostId: "srv_a", projectId: "p1" });
    assert.match(textOf(known.tree()), /My Project/);
    assert.doesNotMatch(textOf(known.tree()), /hiddenMissing/);
  });

  test("show again unhides that host's project and refreshes the order query; failure toasts", async () => {
    unhideImpl = async () => ({ ok: true, hiddenProjects: hiddenOf(["srv_a", "other"]) });
    const { mod, mount } = load(["HiddenProjectRow"]);
    const row = mount((e: Any) => mod.HiddenProjectRow({ entry: e, host: null, p: {} }), { hostId: "srv_b", projectId: "p1" });
    findAll(row.tree(), (el) => typeName(el) === "Pressable")[0].props.onPress();
    await flush();
    assert.deepEqual(plain(calls), [["project.unhide", { projectId: "p1", hostId: "srv_b" }]]);
    assert.deepEqual(plain((queryData.get(JSON.stringify(ORDER_KEY)) as Any).hiddenProjects), hiddenOf(["srv_a", "other"]));
    assert.deepEqual(invalidated, [ORDER_KEY]);
    unhideImpl = async () => { throw new Error("nope"); };
    findAll(row.tree(), (el) => typeName(el) === "Pressable")[0].props.onPress();
    await flush();
    assert.deepEqual(toasts, ["nope"]);
  });

  describe("the hidden list names hosts only when there is more than one", () => {
    const open = (hidden: Any[]) => {
      const { mod, mount } = load(["HiddenProjects"]);
      const view = mount(() => mod.HiddenProjects({ hidden, p: {} }), undefined);
      findAll(view.tree(), (el) => typeName(el) === "Pressable")[0].props.onPress();
      return findAll(view.tree(), (el) => typeName(el) === "HiddenProjectRow").map((el) => [el.props.entry.projectId, el.props.host]);
    };

    test("nothing hidden renders nothing; a closed list shows only the count", () => {
      const { mod, mount } = load(["HiddenProjects"]);
      assert.equal(mount(() => mod.HiddenProjects({ hidden: [], p: {} }), undefined).tree(), null);
      const closed = mount(() => mod.HiddenProjects({ hidden: hiddenOf(["srv_a", "1"], ["srv_b", "1"]), p: {} }), undefined);
      assert.match(textOf(closed.tree()), /hiddenProjects:\{"n":2\}/);
      assert.equal(findAll(closed.tree(), (el) => typeName(el) === "HiddenProjectRow").length, 0);
    });

    test("several hosts: each row carries its host's label; an unknown host shows its id; a blank label shows the id", () => {
      hosts = [{ serverId: "srv_a", label: "Laptop" }, { serverId: "srv_b", label: "Server" }, { serverId: "srv_c", label: "" }];
      assert.deepEqual(open(hiddenOf(["srv_a", "p1"], ["srv_b", "p1"], ["srv_z", "p2"], ["srv_c", "p3"])), [
        ["p1", "Laptop"], ["p1", "Server"], ["p2", "srv_z"], ["p3", "srv_c"],
      ]);
    });

    test("a single host: host is null on every row, even for a project of an unknown host", () => {
      hosts = [{ serverId: "srv_a", label: "Laptop" }];
      assert.deepEqual(open(hiddenOf(["srv_a", "p1"], ["srv_z", "p2"])), [["p1", null], ["p2", null]]);
    });

    test("a row with a host shows it next to the name; without, no host text", () => {
      const { mod, mount } = load(["HiddenProjectRow"]);
      const text = (host: string | null) => textOf(mount(() => mod.HiddenProjectRow({ entry: { hostId: "srv_a", projectId: "p1" }, host, p: {} }), undefined).tree());
      assert.match(text("Laptop"), /Laptop/);
      assert.doesNotMatch(text(null), /Laptop|null/);
    });
  });
});
