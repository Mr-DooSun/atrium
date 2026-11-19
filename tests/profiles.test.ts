import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProfiles } from "../server/core/profiles.ts";
import { stubAdapter } from "../server/core/stub.ts";

const adapters = {
  claude: stubAdapter("claude", "claude", "CLAUDE_CONFIG_DIR"),
  codex: stubAdapter("codex", "codex", "CODEX_HOME"),
  antigravity: stubAdapter("antigravity", "agy", null),
};

function fakePaseo(config: unknown) {
  return {
    config: { get: async () => ({ requestId: "r", config }) },
    providers: { listAvailable: async () => ({ providers: [{ provider: "claude-pb1", available: true }] }) },
  } as never;
}

for (const [shape, config] of [
  ["SDK view (top-level providers)", { providers: { "claude-pb1": { extends: "claude", label: "pb1", command: ["/bin/pb1", "--x"], env: { CLAUDE_CONFIG_DIR: "/tmp/pb1" } } } }],
  ["config.json (agents.providers)", { agents: { providers: { "claude-pb1": { extends: "claude", label: "pb1", command: ["/bin/pb1", "--x"], env: { CLAUDE_CONFIG_DIR: "/tmp/pb1" } } } } }],
] as const) {
  test(`custom providers become profiles: ${shape}`, async () => {
    const profiles = await resolveProfiles(fakePaseo(config), adapters);
    const pb1 = profiles.find((p) => p.runtime.id === "claude-pb1");
    assert.ok(pb1, "claude-pb1 missing");
    assert.equal(pb1.profile.kind, "claude");
    assert.equal(pb1.runtime.command, "/bin/pb1");
    assert.deepEqual(pb1.runtime.args, ["--x"]);
    assert.equal(pb1.runtime.configHome, "/tmp/pb1");
  });
}
