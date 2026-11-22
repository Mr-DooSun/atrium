// The sidebar's worktree badge decision (worktreeBadge) and per-worktree color (worktreeColor).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isDark, palette, showsFolderChip, worktreeBadge, worktreeColor, type Palette } from "../client/look.ts";
import { checkoutKey, type WorktreeInfo } from "../shared/project-rpc.ts";

type GitInfo = Extract<WorktreeInfo, { kind: "git" }>;

function info(overrides: Partial<GitInfo> = {}): GitInfo {
  return {
    kind: "git",
    worktreePath: "/repos/app",
    mainWorktreePath: "/repos/app",
    isMain: true,
    branch: "main",
    defaultBranch: "main",
    head: "abc1234",
    detached: false,
    ...overrides,
  };
}

const linked = (overrides: Partial<GitInfo> = {}) =>
  info({ worktreePath: "/repos/app-feature", isMain: false, branch: "feature/x", ...overrides });

describe("worktreeBadge", () => {
  test("nothing outside git, and nothing before the lookup answers", () => {
    assert.equal(worktreeBadge({ kind: "none" }), null);
    assert.equal(worktreeBadge(null), null);
    assert.equal(worktreeBadge(undefined), null);
  });

  test("main checkout on its default branch: no badge", () => {
    assert.equal(worktreeBadge(info()), null);
    assert.equal(worktreeBadge(info({ branch: "develop", defaultBranch: "develop" })), null);
    assert.equal(worktreeBadge(info({ branch: "master", defaultBranch: "master" })), null);
  });

  test("main checkout with an unknown default branch: no badge on a branch", () => {
    assert.equal(worktreeBadge(info({ defaultBranch: null })), null);
    assert.equal(worktreeBadge(info({ branch: "feature/x", defaultBranch: null })), null);
  });

  test("detached main checkout shows even when the default branch is unknown", () => {
    assert.deepEqual(worktreeBadge(info({ branch: null, detached: true, defaultBranch: null })), {
      tone: "quiet",
      label: "abc1234",
      folder: null,
      detached: true,
    });
  });

  test("main checkout off its default branch: quiet badge with the branch", () => {
    assert.deepEqual(worktreeBadge(info({ branch: "feature/x" })), {
      tone: "quiet",
      label: "feature/x",
      folder: null,
      detached: false,
    });
    // develop is not the default when origin/HEAD says main.
    assert.equal(worktreeBadge(info({ branch: "develop" }))?.tone, "quiet");
    // Branch names compare exactly.
    assert.equal(worktreeBadge(info({ branch: "Main" }))?.tone, "quiet");
  });

  test("detached main checkout: quiet badge with the short commit", () => {
    assert.deepEqual(worktreeBadge(info({ branch: null, detached: true })), {
      tone: "quiet",
      label: "abc1234",
      folder: null,
      detached: true,
    });
  });

  test("unborn main checkout off the default (head null) still has a label", () => {
    const spec = worktreeBadge(info({ branch: "trunk", head: null }));
    assert.equal(spec?.label, "trunk");
    const detachedNoHead = worktreeBadge(info({ branch: null, detached: true, head: null }));
    assert.equal(detachedNoHead?.label, "HEAD");
  });

  test("linked worktree: always a badge, named by its folder", () => {
    assert.deepEqual(worktreeBadge(linked()), {
      tone: "linked",
      label: "feature/x",
      folder: "app-feature",
      detached: false,
    });
    // Even on the default branch, and even when the default is unknown.
    assert.equal(worktreeBadge(linked({ branch: "main" }))?.tone, "linked");
    assert.equal(worktreeBadge(linked({ defaultBranch: null }))?.tone, "linked");
  });

  test("detached linked worktree: linked badge with the short commit", () => {
    assert.deepEqual(worktreeBadge(linked({ branch: null, detached: true, head: "def5678" })), {
      tone: "linked",
      label: "def5678",
      folder: "app-feature",
      detached: true,
    });
  });

  test("folder names: trailing slash, Windows separators, spaces, Korean", () => {
    assert.equal(worktreeBadge(linked({ worktreePath: "/repos/app-feature/" }))?.folder, "app-feature");
    assert.equal(worktreeBadge(linked({ worktreePath: "C:\\repos\\app-win" }))?.folder, "app-win");
    assert.equal(worktreeBadge(linked({ worktreePath: "/repos/작업 트리 " }))?.folder, "작업 트리 ");
  });

  test("label is never empty", () => {
    const cases: GitInfo[] = [
      info({ branch: "x" }),
      info({ branch: null, detached: true }),
      info({ branch: null, detached: true, head: null }),
      linked(),
      linked({ branch: null, detached: true, head: null }),
    ];
    for (const c of cases) {
      const spec = worktreeBadge(c);
      assert.ok(spec && spec.label.length > 0, JSON.stringify(c));
    }
  });
});

const theme = (surface0: string) =>
  ({
    surface0,
    surface1: surface0,
    surface2: surface0,
    foreground: "#888888",
    foregroundMuted: "#888888",
    border: "#888888",
  }) as unknown as Parameters<typeof palette>[0];

const HEX = /^#[0-9a-f]{6}$/i;

describe("worktreeColor", () => {
  const dark = palette(theme("#101010"));
  const light = palette(theme("#ffffff"));

  test("both palettes hold distinct valid colors, and differ from each other", () => {
    for (const p of [dark, light]) {
      assert.ok(p.worktrees.length >= 2);
      for (const color of p.worktrees) assert.match(color, HEX);
      assert.equal(new Set(p.worktrees.map((c) => c.toLowerCase())).size, p.worktrees.length);
      for (const status of [p.success, p.danger, p.warning, p.running]) {
        assert.ok(!p.worktrees.includes(status), `worktree color equals status color ${status}`);
      }
    }
    assert.notDeepEqual(dark.worktrees, light.worktrees);
  });

  test("the same path always gets the same color, from that palette", () => {
    const paths = ["/repos/app", "/repos/app-feature", "/repos/작업 트리 ", "", "C:\\repos\\x", "/a".repeat(500)];
    for (const p of [dark, light]) {
      for (const path of paths) {
        const color = worktreeColor(p, path);
        assert.equal(worktreeColor(p, path), color);
        assert.ok(p.worktrees.includes(color), `${color} for ${path}`);
      }
    }
  });

  test("a path keeps its slot across themes", () => {
    for (const path of ["/repos/one", "/repos/two", "/repos/three"]) {
      assert.equal(
        dark.worktrees.indexOf(worktreeColor(dark, path)),
        light.worktrees.indexOf(worktreeColor(light, path)),
      );
    }
  });

  test("many worktrees spread over the palette", () => {
    const used = new Set(Array.from({ length: 64 }, (_, i) => worktreeColor(dark, `/repos/wt-${i}`)));
    assert.ok(used.size >= dark.worktrees.length - 1, `only ${used.size} colors used`);
  });

  test("works on a hand-built palette of one color", () => {
    const one = { ...dark, worktrees: ["#123456"] } satisfies Palette;
    assert.equal(worktreeColor(one, "/any"), "#123456");
  });

  test("short hex, alpha hex, and rgb() light backgrounds pick the light palette", () => {
    for (const bg of ["#fff", "#ffff", "#ffffff80", "rgb(255, 255, 255)", "rgba(250 250 250 / 0.5)"]) {
      assert.deepEqual(palette(theme(bg)).worktrees, light.worktrees, bg);
    }
    for (const bg of ["#000", "#1118", "rgb(16, 16, 16)"]) {
      assert.deepEqual(palette(theme(bg)).worktrees, dark.worktrees, bg);
    }
  });
});

describe("isDark", () => {
  test("hex in every length, any case, with surrounding space", () => {
    assert.equal(isDark("#000"), true);
    assert.equal(isDark("#FFF"), false);
    assert.equal(isDark("#fff0"), false, "alpha is ignored");
    assert.equal(isDark("#101010"), true);
    assert.equal(isDark("#F5F5F5"), false);
    assert.equal(isDark("#ffffff00"), false, "alpha is ignored");
    assert.equal(isDark("  #ffffff  "), false);
  });

  test("hex without '#' parses in every length", () => {
    assert.equal(isDark("fff"), false);
    assert.equal(isDark("000"), true);
    assert.equal(isDark("ffff"), false, "alpha is ignored");
    assert.equal(isDark("1118"), true);
    assert.equal(isDark("ffffff"), false);
    assert.equal(isDark("101010"), true);
    assert.equal(isDark("FFFFFF00"), false, "alpha is ignored");
    assert.equal(isDark("10101080"), true);
    assert.deepEqual(palette(theme("f5f5f5")).worktrees, palette(theme("#f5f5f5")).worktrees);
  });

  test("rgb() and rgba() with commas, spaces, slash alpha, and percentages", () => {
    assert.equal(isDark("rgb(0, 0, 0)"), true);
    assert.equal(isDark("rgb(255,255,255)"), false);
    assert.equal(isDark("RGBA(255, 255, 255, 0.1)"), false);
    assert.equal(isDark("rgb(240 240 240 / 50%)"), false);
    assert.equal(isDark("rgb(100%, 100%, 100%)"), false);
    assert.equal(isDark("rgb(10%, 10%, 10%)"), true);
    assert.equal(isDark("rgb(999, 999, 999)"), false, "channels are clamped");
  });

  test("luminance weights green over red and blue", () => {
    assert.equal(isDark("#00ff00"), false); // 0.7152 * 255 ≈ 182
    assert.equal(isDark("#ff0000"), true); // 0.2126 * 255 ≈ 54
    assert.equal(isDark("#0000ff"), true);
    assert.equal(isDark("#808080"), false); // 128 is the boundary: not dark
    assert.equal(isDark("#7f7f7f"), true);
  });

  test("anything unreadable counts as dark", () => {
    for (const bad of ["", "white", "#ff", "#fffff", "#ggg", "hsl(0, 0%, 100%)", "rgb(1, 2)", "rgb(a, b, c)", "ff", "fffff", "fffffff", "ggg", "##fff", "# fff"]) {
      assert.equal(isDark(bad), true, JSON.stringify(bad));
    }
  });
});

test("checkoutKey: same host, folder and branch share a badge; any difference splits it", () => {
  const wt = info({ worktreePath: "/wt/feat", isMain: false, branch: "feat/x" });
  assert.equal(checkoutKey("h1", wt), checkoutKey("h1", { ...wt }));
  assert.notEqual(checkoutKey("h1", wt), checkoutKey("h2", wt));
  assert.notEqual(checkoutKey("h1", wt), checkoutKey("h1", { ...wt, worktreePath: "/wt/other" }));
  assert.notEqual(checkoutKey("h1", wt), checkoutKey("h1", { ...wt, branch: "feat/y" }));
  const detached = { ...wt, detached: true, branch: null, head: "abc1234" };
  assert.notEqual(checkoutKey("h1", detached), checkoutKey("h1", { ...detached, head: "def5678" }));
});

describe("showsFolderChip", () => {
  test("a folder named after the branch's last part is not repeated", () => {
    assert.equal(showsFolderChip(worktreeBadge(linked({ worktreePath: "/w/observer-gaps", branch: "feat/observer-gaps" }))!), false);
    assert.equal(showsFolderChip(worktreeBadge(linked({ worktreePath: "/w/fix-x", branch: "fix-x" }))!), false);
  });

  test("a folder that says something else keeps its chip", () => {
    assert.equal(showsFolderChip(worktreeBadge(linked({ worktreePath: "/w/app-feature", branch: "feature/x" }))!), true);
    assert.equal(showsFolderChip(worktreeBadge(linked({ worktreePath: "/w/x", detached: true, head: "abc1234" }))!), true);
  });

  test("the main checkout has no chip", () => {
    assert.equal(showsFolderChip(worktreeBadge(info({ branch: "develop" }))!), false);
  });
});
