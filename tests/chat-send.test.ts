import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { clearOwnHostId } from "../server/core/host-id.ts";
import { registerChat } from "../server/chat.ts";
import { chatSend } from "../shared/chat/rpc.ts";

type Handler = (input: unknown, context: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();
registerChat({ handle(contract: { name: string }, h: Handler) { handlers.set(contract.name, h); } } as unknown as PluginServerContext);
const handler = handlers.get(chatSend.name)!;

interface World {
  host?: string | Error | null;
  agent?: { archivedAt?: string | null; workspaceId?: string | null } | null | Error;
  workspace?: { projectId: string } | null | Error;
  projects?: string[] | Error;
  sendError?: Error;
}
function fake(w: World = {}) {
  const sends: unknown[][] = [];
  const reads: string[] = [];
  const settle = <T>(value: T | Error): T => { if (value instanceof Error) throw value; return value; };
  const paseo = {
    hosts: { list: async () => {
      const host = w.host === undefined ? "srv_a" : w.host;
      if (host instanceof Error) throw host;
      return host === null ? {} : { self: { serverId: host } };
    } },
    agents: { ref: (id: string) => ({
      refresh: async () => {
        reads.push(`agent:${id}`);
        const agent = w.agent === undefined ? { workspaceId: "ws1" } : w.agent;
        const value = settle(agent);
        return value === null ? null : { agent: value };
      },
      send: async (...args: unknown[]) => { sends.push(args); if (w.sendError) throw w.sendError; },
    }) },
    workspaces: { ref: (id: string) => ({ refresh: async () => {
      reads.push(`workspace:${id}`);
      return settle(w.workspace === undefined ? { projectId: "p1" } : w.workspace);
    } }) },
    projects: { list: async () => ({ projects: settle(w.projects === undefined ? ["p1"] : w.projects).map((projectId) => ({ projectId })) }) },
  };
  return { paseo, sends, reads };
}
const send = (input: Record<string, unknown>, world?: World) => {
  const f = fake(world);
  const base = { agentId: "agent-1", hostId: "srv_a", text: "hello" };
  return handler(chatSend.input.parse({ ...base, ...input }), { paseo: f.paseo }).then((out) => ({ out: chatSend.output.parse(out), ...f }));
};
const unavailable = (reason: string) => ({ ok: false, error: { code: "agent_unavailable", reason, message: "This session is no longer available for messages." } });

describe("chat.send", () => {
  // The host id falls back to $PASEO_HOME/server-id; keep a real daemon home out of these cases.
  const savedHome = process.env.PASEO_HOME;
  let home = "";
  before(() => { home = mkdtempSync(join(tmpdir(), "atrium-chat-send-")); process.env.PASEO_HOME = home; });
  after(() => {
    clearOwnHostId();
    if (savedHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });
  beforeEach(() => clearOwnHostId());

  test("an active agent on this host: sends once, as a steer, with the text unchanged", async () => {
    const { out, sends } = await send({});
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(sends, [["hello", { activeTurnBehavior: "steer" }]]);
  });

  test("explicit steer behaves like omitted", async () => {
    const { out, sends } = await send({ activeTurnBehavior: "steer", text: "again" });
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(sends, [["again", { activeTurnBehavior: "steer" }]]);
  });

  const cases: [string, World, string][] = [
    ["archived", { agent: { archivedAt: "2026-01-01T00:00:00Z", workspaceId: "ws1" } }, "archived"],
    ["agent_missing", { agent: null }, "agent_missing"],
    ["workspace_missing (agent has no workspace)", { agent: { workspaceId: null } }, "workspace_missing"],
    ["workspace_missing (workspace is gone)", { workspace: null }, "workspace_missing"],
    ["project_missing", { projects: ["other"] }, "project_missing"],
    ["project_missing (no projects at all)", { projects: [] }, "project_missing"],
    ["host_unknown (daemon names nothing)", { host: null }, "host_unknown"],
    ["host_unknown (host lookup fails)", { host: new Error("unsupported_capability") }, "host_unknown"],
  ];
  for (const [name, world, reason] of cases) {
    test(`${name} -> agent_unavailable/${reason} and nothing is sent`, async () => {
      const { out, sends } = await send({}, world);
      assert.deepEqual(out, unavailable(reason));
      assert.deepEqual(sends, []);
    });
  }

  test("host_mismatch: another host's session is refused before the agent is even read", async () => {
    const { out, sends, reads } = await send({ hostId: "srv_b" });
    assert.deepEqual(out, unavailable("host_mismatch"));
    assert.deepEqual(sends, []);
    assert.deepEqual(reads, []);
  });

  test("a failing read cannot establish that sending is safe: validation_failed, nothing sent", async () => {
    for (const world of [{ agent: new Error("boom") }, { workspace: new Error("boom") }, { projects: new Error("boom") }]) {
      clearOwnHostId();
      const { out, sends } = await send({}, world);
      assert.equal(out.ok, false);
      assert.equal((out as { error: { code: string } }).error.code, "validation_failed");
      assert.deepEqual(sends, []);
    }
  });

  test("interrupt is validation_failed and nothing is sent or even read", async () => {
    const { out, sends, reads } = await send({ activeTurnBehavior: "interrupt" });
    assert.equal(out.ok, false);
    assert.equal((out as { error: { code: string } }).error.code, "validation_failed");
    assert.deepEqual(sends, []);
    assert.deepEqual(reads, []);
  });

  test("non-empty images or attachments are validation_failed with no send; empty arrays are not attachments", async () => {
    for (const extra of [{ images: [{ data: "x" }] }, { attachments: [{ id: "a" }] }, { images: [1], attachments: [2] }]) {
      const { out, sends } = await send(extra);
      assert.equal(out.ok, false, JSON.stringify(extra));
      assert.equal((out as { error: { code: string } }).error.code, "validation_failed");
      assert.deepEqual(sends, []);
    }
    const { out, sends } = await send({ images: [], attachments: [] });
    assert.deepEqual(out, { ok: true });
    assert.equal(sends.length, 1);
  });

  test("a failing send is reported as send_failed", async () => {
    const { out, sends } = await send({}, { sendError: new Error("secret detail") });
    assert.deepEqual(out, { ok: false, error: { code: "send_failed", message: "The message could not be sent." } });
    assert.equal(sends.length, 1);
    assert.ok(!JSON.stringify(out).includes("secret detail"));
  });

  test("the input contract: blank text, a bad host id and unknown fields never reach the handler", () => {
    const ok = { agentId: "a", hostId: "srv_a", text: "x" };
    assert.equal(chatSend.input.safeParse(ok).success, true);
    for (const bad of [{ text: "" }, { text: "  \n" }, { hostId: "" }, { hostId: "a b" }, { hostId: "x".repeat(257) }, { agentId: "" }, { activeTurnBehavior: "queue" }, { extra: 1 }]) {
      assert.equal(chatSend.input.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
    }
  });
});
