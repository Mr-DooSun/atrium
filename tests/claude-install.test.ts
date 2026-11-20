// Claude plugin scopes, direct marketplace installs, marketplace actions and manifest metadata.
// The Claude CLI is a fixture script that records its argv; no network.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { claudeAdapter } from "../server/adapters/claude/index.ts";
import { parseCatalog, parseManifestMeta } from "../server/adapters/claude/parsers.ts";
import { codexPlugins } from "../server/adapters/codex/plugins.ts";

let dir = "";
let log = "";
let profile = { command: "/example/claude", args: [] as string[], env: {}, id: "claude-install", configHome: null };
const calls = async (): Promise<string[][]> =>
  (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
// Previews may read the catalog (plugin list / marketplace list); only mutations matter here.
const mutations = async () => (await calls()).filter((args) => !args.includes("list"));

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "atrium-claude-install-"));
  log = join(dir, "calls.log");
  const command = join(dir, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log("{}");
`);
  await chmod(command, 0o700);
  profile = { ...profile, command };
});

after(() => rm(dir, { recursive: true }));

describe("plugin scopes", () => {
  test("project and local scope without a cwd are not supported and never run", async () => {
    for (const scope of ["project", "local"]) {
      const plan = await claudeAdapter.previewAction(profile, "install", "tool", "demo", null, scope);
      assert.equal(plan.supported, false, scope);
      assert.match(plan.warnings[0], new RegExp(scope));
      const result = await claudeAdapter.runAction(profile, "install", "tool", "demo", null, scope);
      assert.equal(result.ok, false);
      assert.equal(result.error, plan.warnings[0]);
    }
    assert.deepEqual(await mutations(), []);
  });

  test("user scope needs no cwd; a scope becomes -s before the positional id", async () => {
    const user = await claudeAdapter.previewAction(profile, "install", "tool", "demo", null, "user");
    assert.equal(user.supported, true);
    assert.deepEqual(user.command.slice(1), ["plugin", "install", "--json", "-s", "user", "--", "tool@demo"]);
    const project = await claudeAdapter.previewAction(profile, "install", "tool", "demo", dir, "project");
    assert.equal(project.supported, true);
    assert.ok(project.warnings.includes(`project: ${dir}`));
    const none = await claudeAdapter.previewAction(profile, "install", "tool", "demo", null, null);
    assert.equal(none.command.includes("-s"), false);
  });

  test("a marketplace source install with project scope also needs a cwd", async () => {
    const source = { kind: "marketplace" as const, value: "example/market", plugin: "tool", scope: "local" };
    const plan = await claudeAdapter.previewSource!(profile, source, null);
    assert.equal(plan.supported, false);
    assert.match(plan.warnings[0], /local/);
    assert.equal((await claudeAdapter.installSource!(profile, source, null)).ok, false);
    assert.deepEqual(await mutations(), []);
  });
});

describe("direct marketplace install", () => {
  test("rejects non-marketplace kinds, bad plugin names and bad marketplace sources", async () => {
    for (const [source, reason] of [
      [{ kind: "git", value: "example/kit" }, /마켓플레이스/],
      [{ kind: "marketplace", value: "example/market", plugin: null }, /Plugin name is empty/],
      [{ kind: "marketplace", value: "example/market", plugin: "-rf" }, /must not start with "-"/],
      [{ kind: "marketplace", value: "example/market", plugin: "../x" }, /Plugin name is invalid/],
      [{ kind: "marketplace", value: "http://example.com/m.json", plugin: "tool" }, /https/],
      [{ kind: "marketplace", value: "https://u:p@example.com/m.json", plugin: "tool" }, /credentials/],
      [{ kind: "marketplace", value: "relative/path/market", plugin: "tool" }, /owner\/repo/],
      [{ kind: "marketplace", value: "-x", plugin: "tool" }, /must not start with "-"/],
    ] as const) {
      const plan = await claudeAdapter.previewSource!(profile, source, null);
      assert.equal(plan.supported, false, JSON.stringify(source));
      assert.match(plan.warnings[0], reason, JSON.stringify(source));
    }
  });

  test("keeps tokens in the marketplace URL out of what is shown", async () => {
    const value = "https://example.com/market.json?token=s3cr3t";
    const source = { kind: "marketplace" as const, value, plugin: "tool" };
    const plan = await claudeAdapter.previewSource!(profile, source, null);
    assert.equal(plan.supported, true);
    assert.equal(plan.source, "https://example.com/market.json");
    assert.doesNotMatch(JSON.stringify(plan), /s3cr3t/, "preview command/source must not show the token");

    const result = await claudeAdapter.installSource!(profile, source, null);
    assert.equal(result.ok, true, result.error ?? "");
    assert.doesNotMatch(JSON.stringify(result), /s3cr3t/);
    // The CLI itself still receives the full URL.
    assert.deepEqual((await calls()).at(-1), ["plugin", "install", "--json", "--marketplace", value, "--", "tool"]);
  });

  test("shown command is cleaned even when URL parsing normalizes the input", async () => {
    const source = { kind: "marketplace" as const, value: "https://Example.COM/market.json?token=s3cr3t", plugin: "tool" };
    const result = await claudeAdapter.installSource!(profile, source, null);
    assert.doesNotMatch(JSON.stringify(result.command), /s3cr3t/);
  });
});

describe("marketplace actions", () => {
  test("add accepts owner/repo, https URL and absolute path", async () => {
    for (const source of ["example/market", "https://example.com/market.json", dir]) {
      const plan = await claudeAdapter.previewMarketplaceAction!(profile, "add", source);
      assert.equal(plan.supported, true, source);
      assert.deepEqual(plan.command.slice(1, -1), ["plugin", "marketplace", "add", "--json", "--"]);
    }
  });

  test("add rejects other sources and runs nothing", async () => {
    const before = (await mutations()).length;
    for (const source of ["http://example.com/m.json", "https://u:p@example.com/m", "https://example.com/m#x",
      "relative/path/x", "./market", "-rf", join(dir, "missing"), "ftp://example.com/m"]) {
      const plan = await claudeAdapter.previewMarketplaceAction!(profile, "add", source);
      assert.equal(plan.supported, false, source);
      const result = await claudeAdapter.runMarketplaceAction(profile, "add", source);
      assert.equal(result.ok, false, source);
    }
    assert.equal((await mutations()).length, before);
  });

  test("remove and update take a marketplace name only", async () => {
    for (const action of ["remove", "update"] as const) {
      assert.equal((await claudeAdapter.previewMarketplaceAction!(profile, action, "demo-market.1")).supported, true);
      for (const name of ["example/market", "../x", "-rf", "a b", "https://example.com/m"]) {
        const plan = await claudeAdapter.previewMarketplaceAction!(profile, action, name);
        assert.equal(plan.supported, false, `${action} ${name}`);
        assert.match(plan.warnings[0], /Marketplace name/);
      }
    }
  });

  test("preview and run strip the query from the shown URL", async () => {
    const source = "https://example.com/market.json?sig=s3cr3t";
    const plan = await claudeAdapter.previewMarketplaceAction!(profile, "add", source);
    assert.equal(plan.command.at(-1), "https://example.com/market.json");
    assert.doesNotMatch(JSON.stringify(plan), /s3cr3t/);
    const result = await claudeAdapter.runMarketplaceAction(profile, "add", source);
    assert.equal(result.ok, true, result.error ?? "");
    assert.equal(result.command.at(-1), "https://example.com/market.json");
    assert.equal((await calls()).at(-1)?.at(-1), source);
  });

  test("codex marketplace preview hides URL tokens too", async () => {
    const plan = await codexPlugins.previewMarketplaceAction!(profile, "add", "https://example.com/m.git?token=s3cr3t");
    assert.equal(plan.supported, true);
    assert.doesNotMatch(JSON.stringify(plan), /s3cr3t/);
    assert.equal((await codexPlugins.previewMarketplaceAction!(profile, "add", "-rf")).supported, false);
  });
});

describe("parseManifestMeta", () => {
  test("never throws on malformed manifests", () => {
    for (const manifest of [null, undefined, 42, "text", [], {}, { plugins: "x" }, { plugins: {} },
      { plugins: [null, 1, "s", [], {}, { name: 5 }, { name: "  " }] },
      { plugins: [{ name: "odd", author: null, tags: "x", keywords: 3, category: 7, homepage: {}, version: [], license: false }] },
      { plugins: [{ name: "odd2", author: { name: { nested: true } }, tags: [null, {}, 1] }] }]) {
      assert.doesNotThrow(() => parseManifestMeta(manifest, "demo"), JSON.stringify(manifest));
    }
    const meta = parseManifestMeta({ plugins: [{ name: "odd", author: null, category: 7, homepage: {} }] }, "demo");
    assert.deepEqual(meta.get("odd@demo"), { author: null, homepage: null, license: null, version: null, categories: [] });
  });

  test("reads author, https homepage and categories; tags fill in only without a category", () => {
    const meta = parseManifestMeta({ plugins: [
      { name: "one", author: { name: "Ann" }, homepage: "https://example.com/one", category: "Dev", tags: ["x"], version: "1.0.0", license: "MIT" },
      { name: "two", author: "Bob", homepage: "http://example.com/two", tags: ["A", "b", "a", "C", "d"] },
      { name: "three", homepage: "javascript:alert(1)" },
    ] }, "demo");
    assert.deepEqual(meta.get("one@demo"), { author: "Ann", homepage: "https://example.com/one", license: "MIT", version: "1.0.0", categories: ["dev"] });
    assert.equal(meta.get("two@demo")?.author, "Bob");
    assert.equal(meta.get("two@demo")?.homepage, null);
    assert.equal(meta.get("two@demo")?.categories.length, 3);
    assert.equal(meta.get("three@demo")?.homepage, null);
  });

  test("catalog joins manifest metadata and marks the official marketplace", () => {
    const meta = parseManifestMeta({ plugins: [{ name: "two", author: "Ann", category: "Dev" }] }, "claude-plugins-official");
    const catalog = parseCatalog(
      { installed: [], available: [{ pluginId: "two@claude-plugins-official", name: "two", marketplaceName: "claude-plugins-official", installCount: 7 }] },
      [{ name: "claude-plugins-official", repo: "anthropics/claude-plugins-official" }],
      meta,
    );
    assert.equal(catalog.plugins[0].author, "Ann");
    assert.deepEqual(catalog.plugins[0].categories, ["dev"]);
    assert.equal(catalog.plugins[0].installs, 7);
    assert.equal(catalog.marketplaces[0].official, true);
  });
});

describe("phase 2: masking and marketplace source forms", () => {
  let failing = profile;
  before(async () => {
    // A CLI that fails and echoes its argv (raw and normalized URL forms) to stderr.
    const command = join(dir, "claude-failing");
    await writeFile(command, `#!/usr/bin/env node
const args = process.argv.slice(2);
console.error("Error: could not fetch " + args.join(" ") + " (normalized " + args.map(a => { try { return new URL(a).href } catch { return a } }).join(" ") + ")");
process.exitCode = 1;
`);
    await chmod(command, 0o700);
    failing = { ...profile, command };
  });

  test("uppercase host + token: the error message and command never show the token", async () => {
    const value = "https://Example.COM/Market.json?token=s3cr3t";
    const result = await claudeAdapter.installSource!(failing, { kind: "marketplace", value, plugin: "tool" }, null);
    assert.equal(result.ok, false);
    assert.ok(result.error, "a failure carries a message");
    assert.doesNotMatch(JSON.stringify(result), /s3cr3t/);
    const market = await claudeAdapter.runMarketplaceAction(failing, "add", value);
    assert.equal(market.ok, false);
    assert.doesNotMatch(JSON.stringify(market), /s3cr3t/);
  });

  test("git@host:owner/repo (with or without .git) is accepted as a marketplace source", async () => {
    for (const value of ["git@github.com:example/market", "git@github.com:example/market.git", "git@git.example.com:team/sub/market.git"]) {
      const add = await claudeAdapter.previewMarketplaceAction!(profile, "add", value);
      assert.equal(add.supported, true, value);
      assert.equal(add.command.at(-1), value);
      const install = await claudeAdapter.previewSource!(profile, { kind: "marketplace", value, plugin: "tool" }, null);
      assert.equal(install.supported, true, value);
    }
  });

  test("git@ sources with '..' or '-' segments are rejected", async () => {
    for (const value of ["git@github.com:example/../market", "git@github.com:../market", "git@github.com:-example/market",
      "git@github.com:example/-market.git", "git@github.com:example//market"]) {
      const add = await claudeAdapter.previewMarketplaceAction!(profile, "add", value);
      assert.equal(add.supported, false, value);
      const install = await claudeAdapter.previewSource!(profile, { kind: "marketplace", value, plugin: "tool" }, null);
      assert.equal(install.supported, false, value);
    }
  });

  test("a git@ host starting with '-' is rejected (not a valid hostname)", async () => {
    const value = "git@-oProxyCommand.example:example/market";
    assert.equal((await claudeAdapter.previewMarketplaceAction!(profile, "add", value)).supported, false);
  });
});
