import { test } from "node:test";
import assert from "node:assert/strict";
import { projectAppearance } from "../client/look.ts";

type Theme = Parameters<typeof projectAppearance>[1];
const theme = (surface0: string, border: string): Theme => ({ colors: { surface0, border } }) as Theme;
const light = theme("#ffffff", "#dddddd");
const dark = theme("#111111", "#333333");

test("project appearance is stable for a folder regardless of intervening projects", () => {
  const first = projectAppearance("/projects/alpha", light);
  projectAppearance("/projects/beta", light);
  assert.deepEqual(projectAppearance("/projects/alpha", light), first);
  assert.notEqual(projectAppearance("/projects/beta", light).accent, first.accent);
});

test("project appearance adapts its accent and divider to the theme", () => {
  const day = projectAppearance("/projects/alpha", light);
  const night = projectAppearance("/projects/alpha", dark);
  assert.notEqual(day.accent, night.accent);
  assert.notEqual(day.rail, night.rail);
  assert.equal(day.divider, light.colors.border);
  assert.equal(night.divider, dark.colors.border);
  assert.deepEqual(projectAppearance("/projects/alpha", dark), night);
});
