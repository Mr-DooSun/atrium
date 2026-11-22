import "./helpers/isolated-home.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as projectRpc from "../shared/project-rpc.ts";
import { createReact, findAll, loadClient, plain, textOf, typeName } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const { projectRemovalTarget } = loadClient<{ projectRemovalTarget(host: string, own: string | null | undefined): string }>("client/own-host.ts");
const ORDER_KEY = ["projectOrder", 2];
const OWN_KEY = ["atrium", "worktrees", "host"];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("hide project: which host may write", () => {
  test("projectRemovalTarget: only the daemon that named itself as the project's host may act", () => {
    assert.equal(projectRemovalTarget("srv_a", "srv_a"), "own");
    assert.equal(projectRemovalTarget("srv_b", "srv_a"), "other");
    for (const unnamed of [null, undefined, ""]) assert.equal(projectRemovalTarget("srv_a", unnamed), "unknown");
  });
});

describe("useHideProject and the hidden list", () => {
  let calls: [string, unknown][];
  let queryData: Map<string, unknown>;
  let invalidated: unknown[];
  let ownHost: string | null | undefined;
  let daemonAnswer: string | null;
  let hideImpl: (input: Any) => Promise<Any>;
  let unhideImpl: (input: Any) => Promise<Any>;
  let projects: { key: string }[];
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
      "project.worktrees": async () => ({ hostId: daemonAnswer, worktrees: {} }),
    };
    const mod = loadClient<Any>("client/hide-project.tsx", expose, {
      react,
      modules: {
        "@tanstack/react-query": { useQueryClient: () => queryClient },
        "@getpaseo/plugin/client": {
          useRpc: (rpc: { name: string }) => (input: unknown) => { calls.push([rpc.name, input]); return backend[rpc.name](input); },
          useTranslation: () => ({ t: (key: string, params?: object) => params ? `${key}:${JSON.stringify(params)}` : key }),
          useHosts: () => [{ serverId: "srv_b", label: "Laptop" }],
          useProjects: () => projects,
        },
        "@getpaseo/plugin/client/ui": { useToast: () => ({ error: (message: string) => toasts.push(message) }), Icon: "Icon", Modal: "Modal" },
        "../shared/project-rpc": projectRpc,
        "./own-host": { OWN_HOST_KEY: OWN_KEY, projectRemovalTarget, useNamedOwnHost: () => ownHost },
        "./project-order": { PROJECT_ORDER_KEY: ORDER_KEY },
        "./archive": { ArchiveModal: "ArchiveModal" },
        "./look": { ROW: { minHeight: 1, paddingVertical: 1 } },
        "./sidebar-strings": { sidebarText: {} },
      },
    });
    return { mod, mount };
  }
  const hiddenOf = (...ids: [string, string][]) => ids.map(([hostId, projectId]) => ({ hostId, projectId }));

  beforeEach(() => {
    calls = []; queryData = new Map(); invalidated = []; toasts = []; projects = [];
    ownHost = "srv_a"; daemonAnswer = "srv_a";
    queryData.set(JSON.stringify(ORDER_KEY), { order: ["x"], nodes: {}, hiddenProjects: [] });
    hideImpl = async ({ projectId, hostId }) => ({ ok: true, hiddenProjects: hiddenOf([hostId, projectId]) });
    unhideImpl = async () => ({ ok: true, hiddenProjects: [] });
  });

  const hideCalls = () => calls.filter(([name]) => name === "project.hide");

  test("same host: asks the daemon again, hides once with the project's own host id, updates and refreshes the order query", async () => {
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_a", key: "k" }), undefined);
    assert.equal(hook.tree().target, "own");
    hook.tree().begin();
    assert.equal(hook.tree().confirming, true);
    hook.tree().confirm();
    await flush();
    assert.deepEqual(plain(calls.map(([name]) => name)), ["project.worktrees", "project.hide"]);
    assert.deepEqual(plain(hideCalls()[0][1]), { projectId: "p1", hostId: "srv_a" });
    assert.equal(hook.tree().confirming, false);
    assert.equal(hook.tree().pending, false);
    assert.deepEqual(plain((queryData.get(JSON.stringify(ORDER_KEY)) as Any).hiddenProjects), hiddenOf(["srv_a", "p1"]));
    assert.deepEqual(invalidated, [ORDER_KEY]);
  });

  test("a project on another host never calls project.hide; the dialog stays open on the other-host notice", async () => {
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_b", key: "k" }), undefined);
    assert.equal(hook.tree().target, "other");
    hook.tree().begin();
    hook.tree().confirm();
    await flush();
    assert.deepEqual(hideCalls(), []);
    assert.equal(hook.tree().confirming, true);
    assert.equal(invalidated.length, 0);
  });

  test("an unknown daemon host (not named yet, or named nothing) never calls project.hide", async () => {
    for (const named of [null, undefined]) {
      calls = [];
      ownHost = named;
      daemonAnswer = null;
      const { mod, mount } = load(["useHideProject"]);
      const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_a", key: "k" }), undefined);
      assert.equal(hook.tree().target, named === null ? "unknown" : undefined);
      hook.tree().confirm();
      await flush();
      assert.deepEqual(hideCalls(), [], String(named));
    }
  });

  test("a stale 'own' answer is not trusted: the daemon's fresh answer decides, and the learned host is stored", async () => {
    ownHost = "srv_a";
    daemonAnswer = "srv_c"; // the sidebar was moved to another daemon meanwhile
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_a", key: "k" }), undefined);
    assert.equal(hook.tree().target, "own");
    hook.tree().confirm();
    await flush();
    assert.deepEqual(hideCalls(), []);
    assert.equal(queryData.get(JSON.stringify(OWN_KEY)), "srv_c");
  });

  test("a second confirm while one is pending does not hide twice", async () => {
    let release: () => void = () => {};
    hideImpl = ({ projectId, hostId }) => new Promise((resolve) => { release = () => resolve({ ok: true, hiddenProjects: hiddenOf([hostId, projectId]) }); });
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_a", key: "k" }), undefined);
    hook.tree().confirm();
    await flush();
    hook.tree().confirm();
    await flush();
    release();
    await flush();
    assert.equal(hideCalls().length, 1);
  });

  test("a failed hide keeps the dialog open with the server's message", async () => {
    hideImpl = async () => { throw new Error("Project target host does not match this daemon."); };
    const { mod, mount } = load(["useHideProject"]);
    const hook = mount(() => mod.useHideProject({ id: "p1", hostId: "srv_a", key: "k" }), undefined);
    hook.tree().begin();
    hook.tree().confirm();
    await flush();
    assert.equal(hook.tree().error, "Project target host does not match this daemon.");
    assert.equal(hook.tree().confirming, true);
    assert.equal(hook.tree().pending, false);
    assert.equal(invalidated.length, 0);
  });

  test("a hidden project the host no longer has reads 'not on this host (id)'; a known one shows its name", () => {
    const { mod, mount } = load(["HiddenProjectRow"]);
    const missing = mount((e: Any) => mod.HiddenProjectRow({ entry: e, p: {} }), { hostId: "srv_a", projectId: "gone-1" });
    assert.match(textOf(missing.tree()), /hiddenMissing:\{"id":"gone-1"\}/);
    projects = [{ key: "My Project" }];
    const known = mount((e: Any) => mod.HiddenProjectRow({ entry: e, p: {} }), { hostId: "srv_a", projectId: "p1" });
    assert.match(textOf(known.tree()), /My Project/);
    assert.doesNotMatch(textOf(known.tree()), /hiddenMissing/);
  });

  test("show again unhides that host's project and refreshes the order query; failure toasts", async () => {
    unhideImpl = async () => ({ ok: true, hiddenProjects: hiddenOf(["srv_a", "other"]) });
    const { mod, mount } = load(["HiddenProjectRow"]);
    const row = mount((e: Any) => mod.HiddenProjectRow({ entry: e, p: {} }), { hostId: "srv_b", projectId: "p1" });
    const [button] = findAll(row.tree(), (el) => typeName(el) === "Pressable");
    button.props.onPress();
    await flush();
    assert.deepEqual(plain(calls), [["project.unhide", { projectId: "p1", hostId: "srv_b" }]]);
    assert.deepEqual(plain((queryData.get(JSON.stringify(ORDER_KEY)) as Any).hiddenProjects), hiddenOf(["srv_a", "other"]));
    assert.deepEqual(invalidated, [ORDER_KEY]);
    unhideImpl = async () => { throw new Error("nope"); };
    findAll(row.tree(), (el) => typeName(el) === "Pressable")[0].props.onPress();
    await flush();
    assert.deepEqual(toasts, ["nope"]);
  });

  test("the list is hidden entirely when nothing is hidden, and counts otherwise", () => {
    const { mod, mount } = load(["HiddenProjects"]);
    assert.equal(mount(() => mod.HiddenProjects({ hidden: [], p: {} }), undefined).tree(), null);
    const some = mount(() => mod.HiddenProjects({ hidden: hiddenOf(["a", "1"], ["b", "1"]), p: {} }), undefined);
    assert.match(textOf(some.tree()), /hiddenProjects:\{"n":2\}/);
  });
});
