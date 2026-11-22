import "./helpers/isolated-home.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectOrder, setProjectOrder } from "../shared/project-order.ts";

const oldData = '{"order":["old"],"nodes":{"group":["child"]}}';
const newData = '{"order":["new"],"nodes":{}}';

for (const scenario of ["migrate", "existing", "empty"] as const) {
  test(`project order migration: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "atrium-order-"));
    const previous = process.env.PASEO_HOME;
    process.env.PASEO_HOME = home;
    try {
      const legacy = join(home, "nested-agents", "project-order.json");
      const current = join(home, "atrium", "project-order.json");
      if (scenario !== "empty") {
        await mkdir(join(home, "nested-agents"));
        await writeFile(legacy, oldData);
      }
      if (scenario === "existing") {
        await mkdir(join(home, "atrium"));
        await writeFile(current, newData);
      }
      const { registerProjectOrder } = await import(`../server/project-order.ts?scenario=${scenario}`);
      const handlers = new Map();
      registerProjectOrder({ handle: (rpc: unknown, handler: unknown) => handlers.set(rpc, handler) } as never);
      const result = await handlers.get(getProjectOrder)({});
      assert.deepEqual(result, scenario === "migrate" ? { ...JSON.parse(oldData), hiddenProjects: [] } : scenario === "existing" ? { ...JSON.parse(newData), hiddenProjects: [] } : { order: [], nodes: {}, hiddenProjects: [] });
      if (scenario === "empty") {
        await assert.rejects(readFile(current), { code: "ENOENT" });
        await handlers.get(setProjectOrder)({ order: ["first"] });
        assert.deepEqual(JSON.parse(await readFile(current, "utf8")), { order: ["first"], nodes: {}, hiddenProjects: [] });
      } else {
        assert.equal(await readFile(current, "utf8"), scenario === "migrate" ? oldData : newData);
        assert.equal(await readFile(legacy, "utf8"), oldData);
      }
    } finally {
      if (previous === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
}

test("project order: a file with hiddenProjects keeps it through reads and order edits; files without it load as []", async () => {
  const home = await mkdtemp(join(tmpdir(), "atrium-order-hidden-"));
  const previous = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  try {
    const current = join(home, "atrium", "project-order.json");
    await mkdir(join(home, "atrium"));
    const hidden = [{ hostId: "srv_a", projectId: "p1" }];
    await writeFile(current, JSON.stringify({ order: ["o"], nodes: {}, hiddenProjects: hidden }));
    const { registerProjectOrder } = await import(`../server/project-order.ts?scenario=${"hidden"}`);
    const handlers = new Map();
    registerProjectOrder({ handle: (rpc: unknown, handler: unknown) => handlers.set(rpc, handler) } as never);
    assert.deepEqual(await handlers.get(getProjectOrder)({}), { order: ["o"], nodes: {}, hiddenProjects: hidden });
    await handlers.get(setProjectOrder)({ order: ["n"] });
    assert.deepEqual(JSON.parse(await readFile(current, "utf8")), { order: ["n"], nodes: {}, hiddenProjects: hidden });
    // An older client's schema default: output parsing fills in [] when the field is absent.
    assert.deepEqual(getProjectOrder.output.parse({ order: [], nodes: {} }).hiddenProjects, []);
  } finally {
    if (previous === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
