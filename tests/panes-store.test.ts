import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { captured } from "./helpers/react-stub.ts";
import { PANE_MAX_WIDTH, PANE_MIN_WIDTH, serializePanes, type PaneRef } from "../client/panes/layout.ts";

const stubUrl = new URL("./helpers/react-stub.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && context.parentURL?.includes("/client/panes/store.ts")) {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Store = typeof import("../client/panes/store.ts");
interface FakeStorage {
  data: Map<string, string>;
  writes: string[];
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const fakeStorage = (initial?: string): FakeStorage => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("atrium.panes.v1", initial);
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(v);
      data.set(k, v);
    },
  };
};

let seq = 0;
/** A fresh copy of the store module (its state is module-level) with the given localStorage. */
async function load(storage?: unknown): Promise<{ store: Store; subscribe: (l: () => void) => () => void }> {
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  const store = (await import(`../client/panes/store.ts?case=${seq++}`)) as Store;
  store.usePanes();
  assert.ok(captured.subscribe, "usePanes subscribes through useSyncExternalStore");
  return { store, subscribe: captured.subscribe };
}

const p = (key: string): PaneRef => ({ kind: "agent", key, id: key, hostId: "host" });
const keys = (ps: readonly PaneRef[]) => ps.map((x) => x.key);

test("starts empty without storage and updates through setPanes with a value or an updater", async () => {
  const { store } = await load(undefined);
  assert.deepEqual(store.getPanes(), []);
  assert.equal(store.getPaneWidths().size, 0);
  store.setPanes([p("a"), p("b")]);
  assert.deepEqual(keys(store.getPanes()), ["a", "b"]);
  store.setPanes((prev) => [...prev, p("c")]);
  assert.deepEqual(keys(store.getPanes()), ["a", "b", "c"]);
  store.setPanes([]);
  assert.deepEqual(store.getPanes(), []);
});

test("setPanes with the identical array or an updater returning prev is a no-op: no listener call, no write", async () => {
  const storage = fakeStorage();
  const { store, subscribe } = await load(storage);
  const list = [p("a")];
  store.setPanes(list);
  let calls = 0;
  subscribe(() => calls++);
  const writes = storage.writes.length;
  store.setPanes(list);
  store.setPanes((prev) => prev);
  assert.equal(calls, 0);
  assert.equal(storage.writes.length, writes);
});

test("duplicate pane keys never reach storage twice", async () => {
  const storage = fakeStorage();
  const { store } = await load(storage);
  store.setPanes([p("a"), p("a"), p("b")]);
  const saved = JSON.parse(storage.writes.at(-1) ?? "[]") as unknown[][];
  assert.deepEqual(saved.map((e) => e[2]), ["a", "b"]);
});

test("setPaneWidth clamps to the pane bounds and null resets to the default", async () => {
  const { store } = await load(undefined);
  store.setPanes([p("a")]);
  store.setPaneWidth("a", 500);
  assert.equal(store.getPaneWidths().get("a"), 500);
  store.setPaneWidth("a", 500.6);
  assert.equal(store.getPaneWidths().get("a"), 501);
  store.setPaneWidth("a", 0);
  assert.equal(store.getPaneWidths().get("a"), PANE_MIN_WIDTH);
  store.setPaneWidth("a", -300);
  assert.equal(store.getPaneWidths().get("a"), PANE_MIN_WIDTH);
  store.setPaneWidth("a", 1e9);
  assert.equal(store.getPaneWidths().get("a"), PANE_MAX_WIDTH);
  store.setPaneWidth("a", null);
  assert.equal(store.getPaneWidths().has("a"), false);
});

test("a non-finite width never stores NaN or Infinity", async () => {
  const { store } = await load(undefined);
  store.setPanes([p("a")]);
  store.setPaneWidth("a", 400);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    store.setPaneWidth("a", bad);
    for (const w of store.getPaneWidths().values()) assert.ok(Number.isFinite(w), `stored ${w} for ${bad}`);
  }
});

test("setPaneWidth returns a new Map instance on change and keeps the old one on a no-op", async () => {
  const { store, subscribe } = await load(undefined);
  store.setPanes([p("a")]);
  const before = store.getPaneWidths();
  store.setPaneWidth("a", 400);
  const after = store.getPaneWidths();
  assert.notEqual(after, before, "a changed width must be a new reference for useSyncExternalStore");
  assert.equal(before.has("a"), false, "the previous snapshot is not mutated");
  let calls = 0;
  subscribe(() => calls++);
  store.setPaneWidth("a", 400);
  store.setPaneWidth("a", 400.2); // rounds to the same value
  assert.equal(store.getPaneWidths(), after);
  assert.equal(calls, 0);
  store.setPaneWidth("missing", null); // nothing to reset
  assert.equal(calls, 0);
});

test("a width for a pane that is not open does not throw and is not persisted", async () => {
  const storage = fakeStorage();
  const { store } = await load(storage);
  store.setPanes([p("a")]);
  assert.doesNotThrow(() => store.setPaneWidth("ghost", 400));
  const saved = JSON.parse(storage.writes.at(-1) ?? "[]") as unknown[][];
  assert.deepEqual(saved.map((e) => e[2]), ["a"]);
  assert.equal(saved[0].length, 3, "pane a has no custom width");
});

test("listeners are notified on pane and width changes, and not after unsubscribing", async () => {
  const { store, subscribe } = await load(undefined);
  let first = 0;
  let second = 0;
  const off = subscribe(() => first++);
  subscribe(() => second++);
  store.setPanes([p("a")]);
  store.setPaneWidth("a", 400);
  assert.equal(first, 2);
  assert.equal(second, 2);
  off();
  off(); // unsubscribing twice is harmless
  store.setPanes([p("a"), p("b")]);
  store.setPaneWidth("a", 450);
  assert.equal(first, 2, "no notification after unsubscribe");
  assert.equal(second, 4);
});

test("a listener that unsubscribes itself during a notification does not skip the others", async () => {
  const { store, subscribe } = await load(undefined);
  let other = 0;
  const off = subscribe(() => off());
  subscribe(() => other++);
  store.setPanes([p("a")]);
  assert.equal(other, 1);
  store.setPanes([p("b")]);
  assert.equal(other, 2);
});

test("state is persisted to storage and restored by a fresh load, widths included", async () => {
  const storage = fakeStorage();
  const first = await load(storage);
  first.store.setPanes([p("a"), p("b")]);
  first.store.setPaneWidth("b", 420);
  const second = await load(storage);
  assert.deepEqual(keys(second.store.getPanes()), ["a", "b"]);
  assert.equal(second.store.getPaneWidths().get("b"), 420);
  assert.equal(second.store.getPaneWidths().has("a"), false);
});

test("corrupt saved data starts empty", async () => {
  for (const bad of ["not json", "{}", "null", "[1,2,3]", ""]) {
    const { store } = await load(fakeStorage(bad));
    assert.deepEqual(store.getPanes(), [], `saved ${JSON.stringify(bad)}`);
    assert.equal(store.getPaneWidths().size, 0);
  }
});

test("storage that throws on read or write still leaves a working in-memory store", async () => {
  const hostile = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  const { store, subscribe } = await load(hostile);
  assert.deepEqual(store.getPanes(), []);
  let calls = 0;
  subscribe(() => calls++);
  assert.doesNotThrow(() => store.setPanes([p("a")]));
  assert.doesNotThrow(() => store.setPaneWidth("a", 400));
  assert.deepEqual(keys(store.getPanes()), ["a"]);
  assert.equal(store.getPaneWidths().get("a"), 400);
  assert.equal(calls, 2, "listeners still run when persisting fails");
});

test("a storage object without getItem is treated as no storage", async () => {
  const { store } = await load({});
  assert.doesNotThrow(() => store.setPanes([p("a")]));
  assert.deepEqual(keys(store.getPanes()), ["a"]);
});

test("closing a pane drops its custom width, so reopening it starts at the default; other panes keep theirs", async () => {
  const storage = fakeStorage();
  const { store } = await load(storage);
  store.setPanes([p("a"), p("b")]);
  store.setPaneWidth("a", 700);
  store.setPaneWidth("b", 450);
  store.setPanes([]);
  assert.equal(store.getPaneWidths().has("a"), false);
  store.setPanes([p("a")]);
  assert.equal(store.getPaneWidths().has("a"), false);
  // Closing only one of two keeps the other's width.
  store.setPanes([p("a"), p("b")]);
  store.setPaneWidth("a", 700);
  store.setPaneWidth("b", 450);
  store.setPanes([p("b")]);
  assert.equal(store.getPaneWidths().has("a"), false);
  assert.equal(store.getPaneWidths().get("b"), 450);
  store.setPanes([p("a"), p("b")]);
  assert.equal(store.getPaneWidths().has("a"), false);
  assert.equal(store.getPaneWidths().get("b"), 450);
  const reloaded = await load(storage);
  assert.equal(reloaded.store.getPaneWidths().has("a"), false);
  assert.equal(reloaded.store.getPaneWidths().get("b"), 450);
});

type Listener = (event: { key?: string | null; newValue?: string | null }) => void;
function fakeWindow() {
  const g = globalThis as { addEventListener?: unknown; removeEventListener?: unknown };
  const saved = { add: g.addEventListener, remove: g.removeEventListener };
  const added: Array<[string, Listener]> = [];
  const removed: Array<[string, Listener]> = [];
  g.addEventListener = (type: string, l: Listener) => void added.push([type, l]);
  g.removeEventListener = (type: string, l: Listener) => void removed.push([type, l]);
  return {
    added,
    removed,
    restore() {
      g.addEventListener = saved.add;
      g.removeEventListener = saved.remove;
    },
  };
}
const saveText = (...names: string[]) => serializePanes(names.map(p), new Map());

test("watchOtherWindows follows another window's save, ignores unrelated or identical events, and unregisters the same listener", async () => {
  const win = fakeWindow();
  try {
    const storage = fakeStorage();
    const { store, subscribe } = await load(storage);
    store.setPanes([p("a")]);
    const stop = store.watchOtherWindows();
    assert.equal(win.added.length, 1);
    assert.equal(win.added[0][0], "storage");
    const listener = win.added[0][1];
    let calls = 0;
    subscribe(() => calls++);

    listener({ key: "something.else", newValue: saveText("z") });
    assert.deepEqual(keys(store.getPanes()), ["a"]);
    listener({ key: "atrium.panes.v1", newValue: saveText("a") });
    assert.equal(calls, 0, "an identical value changes nothing");

    listener({ key: "atrium.panes.v1", newValue: saveText("a", "b") });
    assert.deepEqual(keys(store.getPanes()), ["a", "b"]);
    assert.equal(calls, 1);
    listener({ key: "atrium.panes.v1", newValue: null });
    assert.deepEqual(store.getPanes(), []);

    // key null means storage was cleared or replaced wholesale: reread it.
    storage.data.set("atrium.panes.v1", saveText("q"));
    listener({ key: null });
    assert.deepEqual(keys(store.getPanes()), ["q"]);

    stop();
    assert.equal(win.removed.length, 1);
    assert.equal(win.removed[0][0], "storage");
    assert.equal(win.removed[0][1], listener);
  } finally {
    win.restore();
  }
});

test("watchOtherWindows registers nothing without storage, and is harmless without window events", async () => {
  const win = fakeWindow();
  try {
    const { store } = await load(undefined);
    const stop = store.watchOtherWindows();
    assert.equal(win.added.length, 0);
    assert.doesNotThrow(() => stop());
    assert.equal(win.removed.length, 0);
  } finally {
    win.restore();
  }
  const { store } = await load(fakeStorage());
  assert.doesNotThrow(() => store.watchOtherWindows()());
});

test.after(() => hooks.deregister());
