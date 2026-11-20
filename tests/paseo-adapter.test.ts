import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { paseoPluginsAdapter as adapter } from "../server/adapters/paseo/index.ts";
import { PASEO_PLUGIN_TRUST_WARNING } from "../shared/toolbox/warnings.ts";

const commit = "a".repeat(40);
const registry = {
  plugins: [
    {
      id: "example/first", name: "First", description: "One tool", categories: ["utils"],
      artifact: { kind: "git", remote: "https://github.com/example/kit.git", pluginPath: "plugins/first", commit },
      repository: { url: "https://github.com/example/kit/tree/main/plugins/first" },
      translations: { ko: { name: "첫 번째" } },
    },
    {
      id: "example/second", name: "Second", description: "In the same repository",
      artifact: { kind: "git", remote: "https://github.com/example/kit.git", pluginPath: "plugins/second" },
    },
    {
      id: "example/pkg", name: "Package", description: "Registry package", categories: ["formatting"],
      artifact: { kind: "npm", package: "@example/tool", version: "1.0.0" },
    },
    {
      id: "example/direct", name: "Direct",
      artifact: { kind: "git", remote: "https://github.com/example/direct.git" },
    },
  ],
};

const installed = [
  {
    id: "renamed", status: "running", enabled: true,
    installation: { identity: { kind: "git", remote: "https://github.com/example/kit.git", pluginPath: "plugins/first",
      registry: { id: "example/first", url: "https://plugins.paseo.sh" } } },
  },
  {
    id: "broken-package", status: "failed", enabled: true, error: "Failure for account@example.com",
    installation: { identity: { kind: "npm", packageName: "@example/tool", pluginPath: "." }, currentRevision: "1.0.0" },
  },
  { id: "direct", status: "disabled", enabled: false, remote: "git@github.com:example/direct.git" },
];

test("maps Paseo CLI state, matches catalog sources, caches the registry and prepares action commands", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toolbox-paseo-fixture-"));
  const command = join(dir, "paseo-fixture");
  const previousBin = process.env.PASEO_BIN;
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_BIN = command;
  delete process.env.PASEO_HOME;
  t.after(async () => {
    if (previousBin === undefined) delete process.env.PASEO_BIN;
    else process.env.PASEO_BIN = previousBin;
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    await rm(dir, { recursive: true });
  });
  await writeFile(command, `#!/usr/bin/env node
const argv = process.argv.slice(2);
const homeIndex = argv.indexOf("--home");
if (homeIndex !== -1) argv.splice(homeIndex, 2);
const args = argv.join(" ");
if (args === "plugin ls --json") console.log(JSON.stringify(${JSON.stringify(installed)}));
else if (args === "plugin enable direct --json") console.log("{}");
else if (/^plugin update (renamed|direct) --check --json$/.test(args)) console.log(JSON.stringify([
  { id: args.split(" ")[2], outcome: "update", target: { kind: "git", commit: ${JSON.stringify(commit)} } },
]));
else if (args === "plugin update direct --ref ${commit} --json") console.log(JSON.stringify([
  { id: "direct", outcome: "updated" },
]));
else if (args === "plugin add npm:@example/tool@1.0.0 --json") console.log("{}");
else process.exitCode = 2;
`);
  await chmod(command, 0o700);

  const fetchRegistry = t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    assert.equal(url, "https://plugins.paseo.sh/index.json");
    return new Response(JSON.stringify(registry));
  });
  const rows = await adapter.listInstalled(null);
  assert.deepEqual(rows.map(({ status, enabled }) => [status, enabled]), [
    ["running", true], ["failed", true], ["disabled", false],
  ]);
  assert.equal(rows[1].version, "1.0.0");
  assert.equal(rows[1].error, "Failure for <redacted>");
  assert.equal(rows[2].source, "ssh://github.com/example/direct.git");
  const catalog = await adapter.listCatalog(null, "");
  assert.deepEqual(catalog.plugins.map(({ installed }) => installed), [true, false, true, true]);
  assert.equal(catalog.marketplaces[0].pluginCount, 4);
  assert.deepEqual((await adapter.listCatalog(null, "FORMATTING")).plugins.map(({ id }) => id), ["example/pkg"]);
  assert.equal(fetchRegistry.mock.callCount(), 1);

  assert.equal((await adapter.runAction(null, "install", "example/pkg", catalog.marketplaces[0].name)).ok, false);
  const install = await adapter.previewAction(null, "install", "example/pkg", catalog.marketplaces[0].name);
  assert.deepEqual(install.command, [command, "plugin", "add", "npm:@example/tool@1.0.0", "--json"]);
  assert.equal(install.source, "npm:@example/tool@1.0.0");
  assert.match(install.warnings[0], /unsandboxed/);
  assert.equal(install.warnings.filter((warning) => warning === PASEO_PLUGIN_TRUST_WARNING).length, 1);
  const git = await adapter.previewAction(null, "install", "example/first", null);
  assert.deepEqual(git.command, [command, "plugin", "add", "git:https://github.com/example/kit.git",
    "--ref", `${commit}^{commit}`, "--json", "--path", "plugins/first"]);
  assert.ok(git.source);
  assert.match(git.source, new RegExp(commit));
  const update = await adapter.previewAction(null, "update", "direct", null);
  assert.deepEqual(update.command, [command, "plugin", "update", "direct", "--ref", commit, "--json"]);
  assert.equal(update.source, `ssh://github.com/example/direct.git @ ${commit}`);
  const ranInstall = await adapter.runAction(null, "install", "example/pkg", catalog.marketplaces[0].name);
  assert.equal(ranInstall.ok, true);
  assert.deepEqual(ranInstall.command, install.command);
  const ranUpdate = await adapter.runAction(null, "update", "direct", null);
  assert.equal(ranUpdate.ok, true);
  assert.deepEqual(ranUpdate.command, update.command);
  const alternateHome = join(dir, "other home");
  process.env.PASEO_HOME = alternateHome;
  const stale = await adapter.runAction(null, "install", "example/pkg", catalog.marketplaces[0].name);
  assert.equal(stale.ok, false);
  assert.match(stale.error ?? "", /Open a new preview/);
  const customPreview = await adapter.previewAction(null, "install", "example/pkg", catalog.marketplaces[0].name);
  assert.deepEqual(customPreview.command, [...install.command, "--home", alternateHome]);
  assert.equal(customPreview.relativeHome, undefined);
  const customRun = await adapter.runAction(null, "install", "example/pkg", catalog.marketplaces[0].name);
  assert.equal(customRun.ok, true);
  assert.deepEqual(customRun.command, customPreview.command);
  const customUpdate = await adapter.previewAction(null, "update", "direct", null);
  assert.deepEqual(customUpdate.command, [...update.command, "--home", alternateHome]);
  const customUpdateRun = await adapter.runAction(null, "update", "direct", null);
  assert.equal(customUpdateRun.ok, true);
  assert.deepEqual(customUpdateRun.command, customUpdate.command);
  process.env.PASEO_HOME = homedir();
  assert.equal((await adapter.previewAction(null, "enable", "direct", null)).relativeHome, "");
  process.env.PASEO_HOME = join(homedir(), ".paseo", "my home");
  const insidePreview = await adapter.previewAction(null, "enable", "direct", null);
  assert.equal(insidePreview.relativeHome, ".paseo/my home");
  assert.equal(insidePreview.command.at(-1), process.env.PASEO_HOME);
  process.env.PASEO_HOME = `${homedir()}-other`;
  assert.equal((await adapter.previewAction(null, "enable", "direct", null)).relativeHome, undefined);
  for (const [home, expected] of [
    [`${homedir()}${sep}..${sep}outside`, undefined],
    [`${homedir()}${sep}`, ""],
    [`${homedir()}${sep}.paseo${sep}`, ".paseo"],
    [`${homedir()}-other${sep}.paseo`, undefined],
  ] as const) {
    process.env.PASEO_HOME = home;
    const preview = await adapter.previewAction(null, "enable", "direct", null);
    assert.equal(preview.relativeHome, expected, home);
    assert.equal(preview.command.at(-1), home, "execution argument retains original path");
  }
  delete process.env.PASEO_HOME;
  const registryUpdate = await adapter.previewAction(null, "update", "renamed", null);
  assert.equal(registryUpdate.supported, false);
  assert.equal(registryUpdate.warnings.filter((warning) => warning === PASEO_PLUGIN_TRUST_WARNING).length, 1);
  assert.deepEqual(registryUpdate.command, [command, "plugin", "update", "renamed"]);
  assert.ok(registryUpdate.source);
  assert.match(registryUpdate.source, new RegExp(commit));
  const registryUpdateResult = await adapter.runAction(null, "update", "renamed", null);
  assert.ok(registryUpdateResult.error);
  assert.match(registryUpdateResult.error, /interactive review/);
  assert.equal((await adapter.runAction(null, "enable", "direct", null)).ok, true);
  assert.equal((await adapter.previewAction(null, "install", "example/missing", null)).supported, false);
  assert.equal((await adapter.runMarketplaceAction(null, "add", "example.com")).ok, false);
});
