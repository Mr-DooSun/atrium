import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("permission subscription tracks snapshots and updates per host and stops after cleanup", async () => {
  type Callbacks = { snapshot: (value: any) => void; update: (value: any) => void; error: () => void };
  const callbacks = new Map<string, Callbacks>();
  const signals = new Map<string, AbortSignal>();
  let state: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  let cleanup: (() => void) | undefined;
  const react = {
    useState: () => [state, (update: any) => { state = typeof update === "function" ? update(state) : update; }],
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
  };
  const plugin = {
    useHosts: () => [{ serverId: "one", status: "online" }, { serverId: "two", status: "online" }, { serverId: "offline", status: "offline" }],
    getPaseoClient: (id: string) => ({ agents: { list: async ({ signal }: { signal: AbortSignal }) => {
      signals.set(id, signal);
      return { subscription: { subscribe: (handlers: Callbacks) => callbacks.set(id, handlers), release: async () => {} } };
    } } }),
  };
  const js = ts.transpileModule(readFileSync(join(process.cwd(), "client/pending-permissions.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleExports: { usePendingPermissions?: () => void } = {};
  runInNewContext(js, { exports: moduleExports, require: (name: string) => name === "react" ? react : plugin, AbortController, Map, Set, JSON });
  moduleExports.usePendingPermissions!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...callbacks.keys()].sort(), ["one", "two"]);
  const one = callbacks.get("one")!;
  const two = callbacks.get("two")!;
  const agent = (id: string, waiting: boolean) => ({ id, pendingPermissions: waiting ? [{}] : [] });
  one.snapshot({ entries: [{ agent: agent("a", true) }, { agent: agent("b", false) }] });
  two.snapshot({ entries: [{ agent: agent("a", true) }] });
  assert.deepEqual([...state.get("one")!], ["a"]);
  one.update({ type: "agent_update", payload: { kind: "upsert", agent: agent("b", true) } });
  assert.deepEqual([...state.get("one")!].sort(), ["a", "b"]);
  one.update({ type: "agent_update", payload: { kind: "upsert", agent: agent("a", false) } });
  assert.deepEqual([...state.get("one")!], ["b"]);
  assert.deepEqual([...state.get("two")!], ["a"]);
  one.update({ type: "agent_update", payload: { kind: "remove", agentId: "b" } });
  assert.equal(state.has("one"), false);
  two.error();
  assert.equal(state.size, 0);
  cleanup!();
  assert.equal(signals.get("one")!.aborted, true);
  assert.equal(signals.get("two")!.aborted, true);
  one.snapshot({ entries: [{ agent: agent("late", true) }] });
  assert.equal(state.size, 0);
});

test("a subscription returned after unmount is released", async () => {
  let cleanup: (() => void) | undefined;
  let finish!: (value: unknown) => void;
  let released = 0;
  let subscribed = false;
  const react = {
    useState: () => [new Map(), () => {}],
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
  };
  const plugin = {
    useHosts: () => [{ serverId: "one", status: "online" }],
    getPaseoClient: () => ({ agents: { list: () => new Promise((resolve) => { finish = resolve; }) } }),
  };
  const js = ts.transpileModule(readFileSync(join(process.cwd(), "client/pending-permissions.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleExports: { usePendingPermissions?: () => void } = {};
  runInNewContext(js, { exports: moduleExports, require: (name: string) => name === "react" ? react : plugin, AbortController, Map, Set, JSON });
  moduleExports.usePendingPermissions!();
  cleanup!();
  finish({ subscription: { release: async () => { released++; }, subscribe: () => { subscribed = true; } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1);
  assert.equal(subscribed, false);
});
