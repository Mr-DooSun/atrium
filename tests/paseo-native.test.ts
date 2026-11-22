// Paseo plugin management belongs to the host's native Settings > Plugins. The compatibility adapter
// only refuses, and neither it nor the Toolbox handlers may run a CLI, read files or fetch anything.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoPluginsAdapter as adapter } from "../server/adapters/paseo/index.ts";
import { registerToolbox } from "../server/toolbox.ts";
import {
  listCatalog, listInstalledPlugins, previewMarketplaceAction, previewPluginAction, previewSourceInstall,
  runMarketplaceAction, runPluginAction, runSourceInstall,
} from "../shared/toolbox/rpc.ts";
import { PASEO_NATIVE_GALLERY_NOTICE } from "../shared/toolbox/warnings.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
registerToolbox({ handle(contract: { name: string }, h: Handler) { handlers.set(contract.name, h); } } as unknown as PluginServerContext);

// Any profile or host lookup through this context would throw, which would change the asserted message.
const ctx = { paseo: new Proxy({}, { get() { throw new Error("paseo API must not be touched"); } }) };
const call = (contract: { name: string }, input: unknown) => handlers.get(contract.name)!(input, ctx);

const saved = { bin: process.env.PASEO_BIN, home: process.env.PASEO_HOME };
const realFetch = globalThis.fetch;
let dir = "";
let log = "";
let fetchCalls: string[] = [];
const calls = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "atrium-paseo-native-"));
  log = join(dir, "calls.log");
  const command = join(dir, "paseo-fixture");
  process.env.PASEO_BIN = command;
  process.env.PASEO_HOME = join(dir, "home");
  await writeFile(command, `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log("[]");
`);
  await chmod(command, 0o700);
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
    fetchCalls.push(String(url));
    throw new Error("network is not allowed");
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const [key, value] of [["PASEO_BIN", saved.bin], ["PASEO_HOME", saved.home]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true });
});

const scope = { ecosystem: "paseo", profileId: null, cwd: null };

describe("the Paseo compatibility adapter only refuses", () => {
  test("listing rejects with the native Gallery notice", async () => {
    await assert.rejects(adapter.listInstalled(null), { message: PASEO_NATIVE_GALLERY_NOTICE });
    await assert.rejects(adapter.listCatalog(null, ""), { message: PASEO_NATIVE_GALLERY_NOTICE });
  });

  test("previews are unsupported and carry no command", async () => {
    for (const plan of [
      await adapter.previewAction(null, "install", "x", null, null, null),
      await adapter.previewSource!(null, { kind: "git", value: "example/kit" }, null),
      await adapter.previewMarketplaceAction!(null, "add", "example/market"),
    ]) {
      assert.deepEqual(plan, { command: [], source: null, warnings: [PASEO_NATIVE_GALLERY_NOTICE], supported: false });
    }
  });

  test("runs fail with the notice, ran nothing and need no reload", async () => {
    for (const result of [
      await adapter.runAction(null, "install", "x", null, null, null),
      await adapter.installSource!(null, { kind: "npm", value: "pkg" }, null),
      await adapter.runMarketplaceAction(null, "add", "example/market"),
    ]) {
      assert.deepEqual(result, { ok: false, command: [], output: "", error: PASEO_NATIVE_GALLERY_NOTICE, needsReload: false });
    }
    assert.equal((await adapter.checkUpdates!(null, null)).size, 0);
  });
});

describe("Toolbox handlers refuse Paseo without any I/O", () => {
  test("installed and catalog lists return the notice as their error, with nothing listed", async () => {
    const installed = await call(listInstalledPlugins, scope) as { plugins: unknown[]; error: string };
    assert.deepEqual(installed, { plugins: [], error: PASEO_NATIVE_GALLERY_NOTICE });
    const catalog = await call(listCatalog, { ...scope, query: "", offset: 0, limit: 50 }) as Record<string, unknown>;
    assert.deepEqual(catalog, { plugins: [], total: 0, marketplaces: [], error: PASEO_NATIVE_GALLERY_NOTICE, categories: [] });
  });

  test("plugin actions reject, whatever the action or scope", async () => {
    for (const action of ["install", "uninstall", "enable", "disable", "update"]) {
      for (const sc of [null, "user"]) {
        const input = { ...scope, action, pluginId: "example/alpha", marketplace: null, scope: sc };
        await assert.rejects(call(previewPluginAction, input), { message: PASEO_NATIVE_GALLERY_NOTICE });
        await assert.rejects(call(runPluginAction, input), { message: PASEO_NATIVE_GALLERY_NOTICE });
      }
    }
  });

  test("source previews and installs are refused for every kind, including inputs that used to be rejected specifically", async () => {
    const sources = [
      { kind: "git", value: "example/kit", ref: "a".repeat(40) },
      { kind: "git", value: "https://user:pw@github.com/a/b" },
      { kind: "npm", value: "pkg", version: "1.0.0" },
      { kind: "local", value: dir },
      { kind: "marketplace", value: "example/market", plugin: "x" },
    ];
    for (const source of sources) {
      const plan = await call(previewSourceInstall, { ...scope, source }) as { supported: boolean; command: string[]; warnings: string[] };
      assert.deepEqual([plan.supported, plan.command, plan.warnings], [false, [], [PASEO_NATIVE_GALLERY_NOTICE]], JSON.stringify(source));
      const run = await call(runSourceInstall, { ...scope, source }) as { ok: boolean; error: string; command: string[] };
      assert.deepEqual([run.ok, run.error, run.command], [false, PASEO_NATIVE_GALLERY_NOTICE, []], JSON.stringify(source));
    }
  });

  test("marketplace preview is refused; marketplace run rejects", async () => {
    for (const action of ["add", "remove", "update"]) {
      const input = { ...scope, action, source: "example/market" };
      const plan = await call(previewMarketplaceAction, input) as { supported: boolean; warnings: string[] };
      assert.deepEqual([plan.supported, plan.warnings], [false, [PASEO_NATIVE_GALLERY_NOTICE]]);
      await assert.rejects(call(runMarketplaceAction, input), { message: PASEO_NATIVE_GALLERY_NOTICE });
    }
  });

  test("a managed ecosystem is not refused as native: it asks for its profile instead", async () => {
    const installed = await call(listInstalledPlugins, { ecosystem: "claude", profileId: null, cwd: null }) as { error: string };
    assert.match(installed.error, /claude plugins need a profile/);
  });

  test("no CLI was run, no registry was fetched, no preview was stored", async () => {
    assert.deepEqual(await calls(), []);
    assert.deepEqual(fetchCalls, []);
  });
});
