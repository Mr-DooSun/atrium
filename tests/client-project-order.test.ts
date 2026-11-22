import "./helpers/isolated-home.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as orderRpc from "../shared/project-order.ts";
import { createReact, loadClient, plain } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = ["projectOrder", 2];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const H1 = { hostId: "srv_a", projectId: "h1" };

describe("useProjectOrder: a failed save undoes only what it changed", () => {
  let cache: Any;
  let invalidated: unknown[];
  let toasts: string[];
  let sends: { rpc: string; input: Any; reject: (e?: Error) => void; resolve: () => void }[];
  let failNow: boolean;

  function hook() {
    const { react, mount } = createReact();
    const queryClient = {
      getQueryData: () => cache,
      setQueryData: (_key: unknown, value: Any) => { cache = value; },
      invalidateQueries: async (filter: { queryKey: unknown }) => { invalidated.push(filter.queryKey); },
    };
    const send = (rpc: string) => (input: Any) => new Promise<void>((resolve, reject) => {
      sends.push({ rpc, input, resolve: () => resolve(), reject: (e) => reject(e ?? new Error("down")) });
      if (failNow) reject(new Error("down"));
    });
    const mod = loadClient<Any>("client/project-order.tsx", ["useProjectOrder"], {
      react,
      modules: {
        "@tanstack/react-query": { useQuery: () => ({ data: cache }), useQueryClient: () => queryClient },
        "@getpaseo/plugin/client": {
          useRpc: (rpc: { name: string }) => send(rpc.name),
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "@getpaseo/plugin/client/ui": { Icon: "Icon", Modal: "Modal", useToast: () => ({ error: (m: string) => toasts.push(m) }) },
        "../shared/project-order": orderRpc,
        "./look": { ROW: {}, TITLE_LINE: 1 },
        "./sidebar-strings": { sidebarText: {} },
      },
    });
    return mount(() => mod.useProjectOrder(), undefined);
  }

  beforeEach(() => {
    cache = { order: ["a", "b"], nodes: { g: ["x", "y"] }, hiddenProjects: [] };
    invalidated = []; toasts = []; sends = []; failNow = false;
  });

  test("it reads the saved order, nodes and hidden list; hidden is [] from an older server", () => {
    const view = hook();
    assert.deepEqual(plain([view.tree().saved, view.tree().nodes, view.tree().hidden]), [["a", "b"], { g: ["x", "y"] }, []]);
    cache = { order: [], nodes: {} };
    assert.deepEqual(plain(hook().tree().hidden), []);
  });

  test("save shows the new order at once and sends exactly it", () => {
    hook().tree().save(["b", "a"]);
    assert.deepEqual(plain(cache.order), ["b", "a"]);
    assert.deepEqual(plain(sends.map((s) => [s.rpc, s.input])), [["project.order.set", { order: ["b", "a"] }]]);
  });

  test("a successful save leaves the cache alone: no rollback, no refetch, no toast", async () => {
    hook().tree().save(["b", "a"]);
    sends[0].resolve();
    await flush();
    assert.deepEqual(plain(cache.order), ["b", "a"]);
    assert.deepEqual([invalidated, toasts], [[], []]);
  });

  test("save pending, a hide lands, the save is rejected: only the order rolls back; hiddenProjects stays; one refetch; one toast", async () => {
    hook().tree().save(["b", "a"]);
    cache = { ...cache, hiddenProjects: [H1] }; // project.hide answered meanwhile
    sends[0].reject();
    await flush();
    assert.deepEqual(plain(cache.order), ["a", "b"]);
    assert.deepEqual(plain(cache.hiddenProjects), [H1]);
    assert.deepEqual(plain(cache.nodes), { g: ["x", "y"] });
    assert.deepEqual(plain(invalidated), [KEY]);
    assert.deepEqual(toasts, ["orderFailed"]);
  });

  test("an unhide that lands meanwhile is not undone either", async () => {
    cache = { ...cache, hiddenProjects: [H1] };
    hook().tree().save(["b", "a"]);
    cache = { ...cache, hiddenProjects: [] };
    sends[0].reject();
    await flush();
    assert.deepEqual(plain(cache.hiddenProjects), []);
    assert.deepEqual(plain(cache.order), ["a", "b"]);
  });

  test("a failed save that happens instantly behaves the same", async () => {
    failNow = true;
    hook().tree().save(["b", "a"]);
    await flush();
    assert.deepEqual(plain(cache.order), ["a", "b"]);
    assert.deepEqual([invalidated.length, toasts], [1, ["orderFailed"]]);
  });

  test("saveNodes rolls back only its own group", async () => {
    const view = hook();
    view.tree().saveNodes("g", ["y", "x"]);
    cache = { ...cache, order: ["z"], nodes: { ...cache.nodes, other: ["o"] } }; // another save meanwhile
    assert.deepEqual(plain(sends[0].input), { group: "g", order: ["y", "x"] });
    sends[0].reject();
    await flush();
    assert.deepEqual(plain(cache.nodes), { g: ["x", "y"], other: ["o"] });
    assert.deepEqual(plain(cache.order), ["z"], "the order is not touched by a nodes rollback");
    assert.deepEqual([plain(invalidated), toasts], [[KEY], ["orderFailed"]]);
  });

  test("a nodes group that did not exist is removed again, not left empty", async () => {
    hook().tree().saveNodes("fresh", ["n1"]);
    assert.deepEqual(plain(cache.nodes.fresh), ["n1"]);
    sends[0].reject();
    await flush();
    assert.equal("fresh" in cache.nodes, false);
    assert.deepEqual(plain(cache.nodes), { g: ["x", "y"] });
  });

  test("two groups failing in turn roll back independently", async () => {
    const view = hook();
    view.tree().saveNodes("g", ["y", "x"]);
    view.tree().saveNodes("h", ["n"]);
    sends[1].reject();
    await flush();
    assert.deepEqual(plain(cache.nodes), { g: ["y", "x"] });
    sends[0].resolve();
    await flush();
    assert.deepEqual(plain(cache.nodes), { g: ["y", "x"] });
    assert.equal(toasts.length, 1);
  });
});
