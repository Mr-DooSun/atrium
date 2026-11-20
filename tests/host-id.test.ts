import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearOwnHostId, ownHostId, type HostLister } from "../server/core/host-id.ts";

const savedEnv = { ...process.env };
let root: string;
let paseoHome: string;
let fakeHome: string;

function lister(impl: () => Promise<unknown>): HostLister & { calls: number } {
  const l = {
    calls: 0,
    hosts: {
      list() {
        l.calls++;
        return impl();
      },
    },
  };
  return l as unknown as HostLister & { calls: number };
}
const ok = (id = "srv_d") => lister(async () => ({ self: { serverId: id } }));
const failing = () => lister(async () => { throw new Error("unsupported_capability"); });
const hanging = () => lister(() => new Promise(() => {}));
const writeFile = (dir: string, text: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "server-id"), text);
};

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "atrium-host-id-")));
  paseoHome = join(root, "paseo home");
  fakeHome = join(root, "user home");
});
after(() => {
  clearOwnHostId();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  clearOwnHostId();
  rmSync(paseoHome, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  process.env.PASEO_HOME = paseoHome;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

describe("ownHostId", () => {
  test("the daemon's hosts.list wins over the PASEO_HOME file", async () => {
    writeFile(paseoHome, "srv_f\n");
    const paseo = ok("srv_d");
    assert.equal(await ownHostId(paseo), "srv_d");
    assert.equal(paseo.calls, 1);
  });

  test("a failing list falls back to $PASEO_HOME/server-id, trimmed", async () => {
    writeFile(paseoHome, "srv_f\n");
    assert.equal(await ownHostId(failing()), "srv_f");
  });

  test("an unusable list answer (empty, spaces, wrong type, no self) falls through to the file", async () => {
    for (const answer of [{ self: { serverId: "" } }, { self: { serverId: "a b" } }, { self: { serverId: 5 } }, {}, null]) {
      clearOwnHostId();
      writeFile(paseoHome, "srv_f");
      assert.equal(await ownHostId(lister(async () => answer)), "srv_f", JSON.stringify(answer));
    }
  });

  test("without PASEO_HOME the ~/.paseo guess is never read; failure gives null and is not retried at once", async () => {
    delete process.env.PASEO_HOME;
    writeFile(join(fakeHome, ".paseo"), "srv_wrong\n");
    const paseo = failing();
    assert.equal(await ownHostId(paseo), null);
    assert.equal(paseo.calls, 1);
    const started = performance.now();
    assert.equal(await ownHostId(paseo), null);
    assert.equal(await ownHostId(paseo), null);
    assert.equal(paseo.calls, 1, "list is not asked again inside the retry interval");
    assert.ok(performance.now() - started < 100);
  });

  test("a list that never answers gives up after about 3 seconds and uses the file", async () => {
    writeFile(paseoHome, "srv_f\n");
    const started = performance.now();
    assert.equal(await ownHostId(hanging()), "srv_f");
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 2500 && elapsed < 6000, `took ${Math.round(elapsed)}ms`);
  });

  test("called without a lister it uses the file only", async () => {
    writeFile(paseoHome, "srv_f\n");
    assert.equal(await ownHostId(), "srv_f");
    clearOwnHostId();
    rmSync(paseoHome, { recursive: true, force: true });
    assert.equal(await ownHostId(), null);
  });

  test("concurrent calls, with and without a lister, share one lookup and one list call", async () => {
    const paseo = lister(() => new Promise((resolve) => setTimeout(() => resolve({ self: { serverId: "srv_d" } }), 200)));
    const ids = await Promise.all([ownHostId(paseo), ownHostId(), ownHostId(paseo)]);
    assert.deepEqual(ids, ["srv_d", "srv_d", "srv_d"]);
    assert.equal(paseo.calls, 1);
  });

  test("a found id is cached for good: later calls do not ask again", async () => {
    const paseo = ok();
    assert.equal(await ownHostId(paseo), "srv_d");
    assert.equal(await ownHostId(paseo), "srv_d");
    assert.equal(await ownHostId(), "srv_d");
    assert.equal(paseo.calls, 1);
  });

  test("clearOwnHostId allows a fresh lookup after a failure", async () => {
    assert.equal(await ownHostId(failing()), null);
    clearOwnHostId();
    assert.equal(await ownHostId(ok("srv_e")), "srv_e");
  });

  test("an id with inner whitespace or over 256 characters is rejected", async () => {
    for (const bad of ["two words", "x".repeat(257), ""]) {
      clearOwnHostId();
      assert.equal(await ownHostId(lister(async () => ({ self: { serverId: bad } }))), null, bad.slice(0, 20));
    }
  });
});
