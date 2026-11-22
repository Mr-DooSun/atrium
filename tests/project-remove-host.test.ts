import "./helpers/isolated-home.ts";
// Removing a project in Atrium only hides it in the sidebar. Visibility is stored per host beside the
// project order; no Paseo project, workspace, session or file is touched, and no CLI is run.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearOwnHostId } from "../server/core/host-id.ts";
import { getProjectOrder, setNodeOrder, setProjectOrder } from "../shared/project-order.ts";
import { hiddenProjectKey, hideProject, removeProject, unhideProject } from "../shared/project-rpc.ts";

type Handler = (input: unknown, context?: unknown) => Promise<unknown>;
interface Hidden { hostId: string; projectId: string }
interface Result { ok: true; hiddenProjects: Hidden[] }

describe("project hide / unhide / remove", () => {
  const savedEnv = { ...process.env };
  const handlers = new Map<string, Handler>();
  let root: string;
  let home: string;
  let store: string;
  let cliLog: string;
  let touched: string[] = [];

  /** A context whose Paseo API answers only the host lookup; any other use is recorded and fails. */
  const daemon = (serverId: string | Error) => ({
    paseo: new Proxy({
      hosts: { list: async () => { if (serverId instanceof Error) throw serverId; return { self: { serverId } }; } },
    } as Record<string, unknown>, {
      get(target, key) {
        if (key in target) return target[key as string];
        touched.push(String(key));
        throw new Error(`unexpected Paseo API use: ${String(key)}`);
      },
    }),
  });
  const call = (rpc: { name: string }, input: unknown, context?: unknown) => handlers.get(rpc.name)!(input, context);
  const hide = (input: Record<string, unknown>, context?: unknown) => call(hideProject, hideProject.input.parse(input), context) as Promise<Result>;
  const unhide = (input: Record<string, unknown>, context?: unknown) => call(unhideProject, unhideProject.input.parse(input), context) as Promise<Result>;
  const getOrder = () => call(getProjectOrder, {}) as Promise<{ order: string[]; nodes: Record<string, string[]>; hiddenProjects: Hidden[] }>;
  const onDisk = () => JSON.parse(readFileSync(store, "utf8"));
  const cliCalls = () => (existsSync(cliLog) ? readFileSync(cliLog, "utf8").trim().split("\n").filter(Boolean) : []);
  const A = daemon("srv_a");

  before(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "atrium-project-hide-")));
    home = join(root, "home");
    mkdirSync(home);
    store = join(home, "atrium", "project-order.json");
    cliLog = join(root, "cli.log");
    // The store reads PASEO_HOME when it is first imported, so this must come before the import.
    process.env.PASEO_HOME = home;
    process.env.PASEO_BIN = join(root, "paseo-fixture");
    writeFileSync(process.env.PASEO_BIN, `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(cliLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
    chmodSync(process.env.PASEO_BIN, 0o755);
    const server = { handle(contract: { name: string }, h: Handler) { handlers.set(contract.name, h); } } as unknown as PluginServerContext;
    const { registerProject } = await import("../server/project.ts");
    const { registerProjectOrder } = await import("../server/project-order.ts");
    registerProject(server);
    registerProjectOrder(server);
    for (const rpc of [hideProject, unhideProject, removeProject, getProjectOrder]) assert.ok(handlers.get(rpc.name), rpc.name);
  });
  beforeEach(() => {
    clearOwnHostId();
    touched = [];
    rmSync(join(home, "server-id"), { force: true });
    rmSync(join(home, "atrium"), { recursive: true, force: true });
  });
  after(() => {
    clearOwnHostId();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    rmSync(root, { recursive: true, force: true });
  });

  test("the store lives under the temp PASEO_HOME, never the real home", () => {
    assert.ok(store.startsWith(root));
    assert.equal(process.env.PASEO_HOME, home);
  });

  test("the contract: hostId is optional in the type, but short, whitespace-free and non-empty when present; the key is host scoped", () => {
    for (const rpc of [hideProject, unhideProject, removeProject]) {
      assert.equal(rpc.input.safeParse({ projectId: "p" }).success, true);
      assert.equal(rpc.input.safeParse({ projectId: "p", hostId: "srv_a" }).success, true);
      for (const bad of ["", " ", "a b", " srv_a", "srv_a\n", "x".repeat(257), 3, null]) {
        assert.equal(rpc.input.safeParse({ projectId: "p", hostId: bad }).success, false, `${rpc.name} ${JSON.stringify(bad)}`);
      }
      assert.equal(rpc.input.safeParse({ projectId: "", hostId: "srv_a" }).success, false);
    }
    assert.notEqual(hiddenProjectKey("h1", "p"), hiddenProjectKey("h2", "p"));
    assert.notEqual(hiddenProjectKey("h", "1p"), hiddenProjectKey("h1", "p"), "the boundary cannot be shifted");
  });

  test("hide persists in atrium/project-order.json and project.order.get returns it", async () => {
    assert.deepEqual((await getOrder()).hiddenProjects, []);
    const out = await hide({ projectId: "p1", hostId: "srv_a" }, A);
    assert.deepEqual(out, { ok: true, hiddenProjects: [{ hostId: "srv_a", projectId: "p1" }] });
    assert.deepEqual(onDisk().hiddenProjects, [{ hostId: "srv_a", projectId: "p1" }]);
    assert.deepEqual((await getOrder()).hiddenProjects, [{ hostId: "srv_a", projectId: "p1" }]);
    assert.deepEqual(getProjectOrder.output.parse(await getOrder()).hiddenProjects, [{ hostId: "srv_a", projectId: "p1" }]);
  });

  test("unhide restores the project; unhiding something that is not hidden is a no-op", async () => {
    await hide({ projectId: "p1", hostId: "srv_a" }, A);
    await hide({ projectId: "p2", hostId: "srv_a" }, A);
    assert.deepEqual((await unhide({ projectId: "p1", hostId: "srv_a" }, A)).hiddenProjects, [{ hostId: "srv_a", projectId: "p2" }]);
    assert.deepEqual((await getOrder()).hiddenProjects, [{ hostId: "srv_a", projectId: "p2" }]);
    assert.deepEqual((await unhide({ projectId: "never", hostId: "srv_a" }, A)).hiddenProjects, [{ hostId: "srv_a", projectId: "p2" }]);
    assert.deepEqual((await unhide({ projectId: "p2", hostId: "srv_a" }, A)).hiddenProjects, []);
    assert.deepEqual(onDisk().hiddenProjects, []);
  });

  test("hide is idempotent: no duplicate entries in the result or the file", async () => {
    for (let i = 0; i < 3; i++) await hide({ projectId: "p1", hostId: "srv_a" }, A);
    assert.deepEqual(onDisk().hiddenProjects, [{ hostId: "srv_a", projectId: "p1" }]);
    assert.equal((await getOrder()).hiddenProjects.length, 1);
  });

  test("the deprecated project.remove behaves as hide, and unhide undoes it", async () => {
    const out = await call(removeProject, removeProject.input.parse({ projectId: "p1", hostId: "srv_a" }), A) as Result;
    assert.deepEqual(out, { ok: true, hiddenProjects: [{ hostId: "srv_a", projectId: "p1" }] });
    assert.deepEqual((await getOrder()).hiddenProjects, [{ hostId: "srv_a", projectId: "p1" }]);
    await call(removeProject, { projectId: "p1", hostId: "srv_a" }, A);
    assert.equal((await getOrder()).hiddenProjects.length, 1, "removing twice does not stack");
    assert.deepEqual((await unhide({ projectId: "p1", hostId: "srv_a" }, A)).hiddenProjects, []);
  });

  test("the same project id on two hosts is hidden and restored independently", async () => {
    await hide({ projectId: "same", hostId: "srv_a" }, A);
    clearOwnHostId();
    const out = await hide({ projectId: "same", hostId: "srv_b" }, daemon("srv_b"));
    assert.deepEqual(out.hiddenProjects, [{ hostId: "srv_a", projectId: "same" }, { hostId: "srv_b", projectId: "same" }]);
    clearOwnHostId();
    assert.deepEqual((await unhide({ projectId: "same", hostId: "srv_a" }, A)).hiddenProjects, [{ hostId: "srv_b", projectId: "same" }]);
    assert.deepEqual((await getOrder()).hiddenProjects, [{ hostId: "srv_b", projectId: "same" }]);
  });

  test("hiding does not disturb the saved order, and ordering edits keep the hidden list", async () => {
    await call(setProjectOrder, setProjectOrder.input.parse({ order: ["a", "b"] }));
    await call(setNodeOrder, setNodeOrder.input.parse({ group: "g", order: ["x", "y"] }));
    await hide({ projectId: "p1", hostId: "srv_a" }, A);
    let stored = onDisk();
    assert.deepEqual([stored.order, stored.nodes, stored.hiddenProjects], [["a", "b"], { g: ["x", "y"] }, [{ hostId: "srv_a", projectId: "p1" }]]);
    await call(setProjectOrder, setProjectOrder.input.parse({ order: ["b", "a"] }));
    await call(setNodeOrder, setNodeOrder.input.parse({ group: "g", order: [] }));
    stored = onDisk();
    assert.deepEqual([stored.order, stored.hiddenProjects], [["b", "a"], [{ hostId: "srv_a", projectId: "p1" }]]);
    await unhide({ projectId: "p1", hostId: "srv_a" }, A);
    assert.deepEqual(onDisk().order, ["b", "a"]);
  });

  test("simultaneous hides and order edits do not overwrite each other", async () => {
    await Promise.all([
      ...["p1", "p2", "p3", "p4"].map((projectId) => hide({ projectId, hostId: "srv_a" }, A)),
      call(setProjectOrder, setProjectOrder.input.parse({ order: ["z"] })),
    ]);
    const stored = onDisk();
    assert.deepEqual(stored.hiddenProjects.map((h: Hidden) => h.projectId).sort(), ["p1", "p2", "p3", "p4"]);
    assert.deepEqual(stored.order, ["z"]);
  });

  test("a file from before hiding existed loads with no hidden projects; broken entries are dropped", async () => {
    mkdirSync(join(home, "atrium"), { recursive: true });
    writeFileSync(store, JSON.stringify({ order: ["a"], nodes: {} }));
    assert.deepEqual(await getOrder(), { order: ["a"], nodes: {}, hiddenProjects: [] });
    writeFileSync(store, JSON.stringify({ order: [], nodes: {}, hiddenProjects: [
      { hostId: "srv_a", projectId: "ok" }, { hostId: "srv_a", projectId: "ok" }, { hostId: "", projectId: "x" }, { projectId: "y" }, "junk", null,
    ] }));
    assert.deepEqual((await getOrder()).hiddenProjects, [{ hostId: "srv_a", projectId: "ok" }]);
    writeFileSync(store, JSON.stringify({ order: [], nodes: {}, hiddenProjects: "nope" }));
    assert.deepEqual((await getOrder()).hiddenProjects, []);
  });

  describe("rejections happen before any write", () => {
    const rejected = async (run: () => Promise<unknown>, message: RegExp) => {
      await assert.rejects(run, message);
      assert.equal(existsSync(store), false, "nothing was written");
    };

    for (const [name, rpc] of [["hide", hideProject], ["unhide", unhideProject], ["remove", removeProject]] as const) {
      test(`${name}: missing hostId`, async () => {
        await rejected(() => call(rpc, rpc.input.parse({ projectId: "p1" }), A), /target host is required/);
      });
      test(`${name}: empty or whitespace hostId, even when bypassing the schema`, async () => {
        for (const hostId of ["", "   "]) {
          assert.equal(rpc.input.safeParse({ projectId: "p1", hostId }).success, false);
          await rejected(() => call(rpc, { projectId: "p1", hostId }, A), /target host is required|does not match/);
        }
      });
      test(`${name}: unidentifiable daemon`, async () => {
        await rejected(() => call(rpc, rpc.input.parse({ projectId: "p1", hostId: "srv_a" }), daemon(new Error("unsupported_capability"))), /could not be identified/);
        await rejected(() => call(rpc, rpc.input.parse({ projectId: "p1", hostId: "srv_a" })), /could not be identified/);
      });
      test(`${name}: host mismatch`, async () => {
        await rejected(() => call(rpc, rpc.input.parse({ projectId: "p1", hostId: "srv_b" }), A), /does not match/);
      });
    }

    test("a rejected request leaves existing hidden state untouched", async () => {
      await hide({ projectId: "p1", hostId: "srv_a" }, A);
      const before = readFileSync(store, "utf8");
      await assert.rejects(hide({ projectId: "p2", hostId: "srv_b" }, A), /does not match/);
      await assert.rejects(unhide({ projectId: "p1", hostId: "srv_b" }, A), /does not match/);
      assert.equal(readFileSync(store, "utf8"), before);
    });
  });

  test("no path ever runs a CLI or touches the Paseo project/workspace/agent API", async () => {
    await hide({ projectId: "p1", hostId: "srv_a" }, A);
    await unhide({ projectId: "p1", hostId: "srv_a" }, A);
    await call(removeProject, { projectId: "p1", hostId: "srv_a" }, A);
    await assert.rejects(hide({ projectId: "p1", hostId: "srv_b" }, A));
    await assert.rejects(hide({ projectId: "p1" }, A));
    clearOwnHostId();
    await assert.rejects(call(removeProject, { projectId: "p1", hostId: "srv_a" }, daemon(new Error("x"))));
    assert.deepEqual(cliCalls(), []);
    assert.deepEqual(touched, [], "only paseo.hosts.list is used");
  });
});
