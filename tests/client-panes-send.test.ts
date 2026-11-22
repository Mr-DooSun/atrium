import "./helpers/isolated-home.ts";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, test } from "node:test";
import * as chatRpc from "../shared/chat/rpc.ts";
import * as timeline from "../client/panes/timeline.ts";
import { familyMoves } from "../client/panes/layout.ts";
import { paneGone, paneTitle, showHostRefused } from "../client/panes/pane-state.ts";
import { createReact, findAll, loadClient, plain, typeName } from "./helpers/client-sandbox.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const answer = (reason: string) => ({ ok: false, error: { code: "agent_unavailable", reason, message: "m" } });

describe("unavailableReason reads a send answer or error", () => {
  const { unavailableReason } = timeline;
  test("archived is archived; a gone agent, workspace or project is removed", () => {
    assert.equal(unavailableReason(answer("archived")), "archived");
    for (const reason of ["agent_missing", "workspace_missing", "project_missing"]) assert.equal(unavailableReason(answer(reason)), "removed", reason);
  });
  test("host_unknown and host_mismatch are not 'gone': the pane can be reopened elsewhere", () => {
    for (const reason of ["host_unknown", "host_mismatch"]) assert.equal(unavailableReason(answer(reason)), null, reason);
  });
  test("validation and send failures, success and junk are ordinary: null", () => {
    for (const value of [
      { ok: false, error: { code: "validation_failed", message: "m" } }, { ok: false, error: { code: "send_failed", message: "m" } },
      { ok: true }, null, undefined, "x", 3, [], { ok: false }, { ok: false, error: null },
    ]) assert.equal(unavailableReason(value), null, JSON.stringify(value));
  });
  test("thrown errors may carry the same code, or a bare 'not found' / 'archived' code", () => {
    assert.equal(unavailableReason({ code: "agent_unavailable", reason: "archived" }), "archived");
    assert.equal(unavailableReason({ code: "agent_not_found" }), "removed");
    assert.equal(unavailableReason({ code: "not_found" }), "removed");
    assert.equal(unavailableReason({ code: "agent_archived" }), "archived");
    assert.equal(unavailableReason(Object.assign(new Error("x"), { code: "ECONNRESET" })), null);
  });
});

describe("pane Composer sends through chat.send only", () => {
  let sent: unknown[];
  let reply: () => Promise<Any>;
  let unavailable: unknown[];
  let hostRefused: number;
  let toasts: string[];
  let warnings: unknown[][];

  function open(agent = { id: "agent-1", hostId: "srv_a" }) {
    const { react, mount } = createReact();
    const mod = loadClient<Any>("client/panes/pane.tsx", ["Composer"], {
      react,
      globals: { console: { warn: (...args: unknown[]) => warnings.push(args), error() {}, log() {} } },
      modules: {
        "@getpaseo/plugin/client": {
          useRpc: (rpc: { name: string }) => { assert.equal(rpc.name, "chat.send"); return (input: unknown) => { sent.push(input); return reply(); }; },
          useAgent: () => false,
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "@getpaseo/plugin/client/ui": { TextInput: "TextInput", Icon: "Icon", useToast: () => ({ error: (message: string) => toasts.push(message) }) },
        "../../shared/chat/rpc": chatRpc,
        "./timeline": timeline,
      },
    });
    const composer = mount(() => mod.Composer({
      agent, p: {}, onUnavailable: (reason: unknown) => unavailable.push(reason), onHostRefused: () => { hostRefused++; },
    }), undefined);
    const input = () => findAll(composer.tree(), (el) => typeName(el) === "TextInput")[0];
    const sendButton = () => findAll(composer.tree(), (el) => typeName(el) === "Pressable" && el.props.accessibilityLabel === "send")[0];
    const type = (text: string) => input().props.onChangeText(text);
    return { composer, input, sendButton, type };
  }

  beforeEach(() => { sent = []; unavailable = []; hostRefused = 0; toasts = []; warnings = []; reply = async () => ({ ok: true }); });

  test("ok: one chat.send with the agent, its own host and the text; the box is cleared", async () => {
    const view = open();
    view.type("hello");
    view.sendButton().props.onPress();
    await flush();
    assert.deepEqual(plain(sent), [{ agentId: "agent-1", hostId: "srv_a", text: "hello" }]);
    assert.equal(view.input().props.value, "");
    assert.deepEqual([unavailable, hostRefused, toasts], [[], 0, []]);
  });

  test("the request never asks to interrupt or carries attachments", async () => {
    const view = open();
    view.type("x");
    view.sendButton().props.onPress();
    await flush();
    const request = plain(sent[0]) as Record<string, unknown>;
    for (const key of ["activeTurnBehavior", "images", "attachments"]) assert.equal(key in request, false, key);
  });

  test("a blank message sends nothing", async () => {
    const view = open();
    view.type("   \n ");
    view.sendButton().props.onPress();
    await flush();
    assert.deepEqual(sent, []);
  });

  for (const [name, reason, expected] of [["archived", "archived", "archived"], ["agent_missing", "agent_missing", "removed"]] as const) {
    test(`${name}: the pane is told the session is gone and the answer shows no error toast`, async () => {
      reply = async () => answer(reason);
      const view = open();
      view.type("hello");
      view.sendButton().props.onPress();
      await flush();
      assert.deepEqual(unavailable, [expected]);
      assert.deepEqual([hostRefused, toasts], [0, []]);
    });
  }

  test("host_mismatch: the notice is raised, the text stays in the input, nothing else happens", async () => {
    reply = async () => answer("host_mismatch");
    const view = open();
    view.type("keep me");
    view.sendButton().props.onPress();
    await flush();
    assert.equal(hostRefused, 1);
    assert.equal(view.input().props.value, "keep me");
    assert.deepEqual([unavailable, toasts], [[], []]);
    assert.equal(sent.length, 1, "one request, no retry through another path");
  });

  test("host_unknown behaves like host_mismatch", async () => {
    reply = async () => answer("host_unknown");
    const view = open();
    view.type("keep me");
    view.sendButton().props.onPress();
    await flush();
    assert.equal(hostRefused, 1);
    assert.equal(view.input().props.value, "keep me");
  });

  test("validation_failed and send_failed: a failure toast, the text stays, the server message is logged not shown", async () => {
    for (const code of ["validation_failed", "send_failed"]) {
      toasts = []; warnings = [];
      reply = async () => ({ ok: false, error: { code, message: "SERVER-SIDE DETAIL" } });
      const view = open();
      view.type("keep me");
      view.sendButton().props.onPress();
      await flush();
      assert.deepEqual(toasts, ["sendFailed"], code);
      assert.equal(view.input().props.value, "keep me", code);
      assert.deepEqual([unavailable, hostRefused], [[], 0], code);
      assert.ok(JSON.stringify(warnings).includes(code), "logged");
    }
  });

  test("a rejected request: gone errors mark the session gone; anything else toasts", async () => {
    reply = async () => { throw Object.assign(new Error("x"), { code: "agent_not_found" }); };
    const gone = open();
    gone.type("a");
    gone.sendButton().props.onPress();
    await flush();
    assert.deepEqual(unavailable, ["removed"]);
    reply = async () => { throw new Error("offline"); };
    const offline = open();
    offline.type("a");
    offline.sendButton().props.onPress();
    await flush();
    assert.deepEqual(toasts, ["sendFailed"]);
  });

  test("while a send is in flight the input is locked and a second press does not send again", async () => {
    let release: () => void = () => {};
    reply = () => new Promise((resolve) => { release = () => resolve({ ok: true }); });
    const view = open();
    view.type("once");
    view.sendButton().props.onPress();
    assert.equal(view.input().props.editable, false);
    view.sendButton().props.onPress();
    release();
    await flush();
    assert.equal(sent.length, 1);
  });
});

describe("panes never call the Paseo SDK send directly (source check)", () => {
  const dir = join(process.cwd(), "client", "panes");
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  test("no `.send(`, `agents.ref`, `usePaseo` or sendAgentMessage in client/panes", () => {
    assert.ok(files.length >= 3);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(text, /\.send\(/, file);
      assert.doesNotMatch(text, /agents\s*\.\s*ref\(|usePaseo\(|sendAgentMessage|\.sendMessage\(/, file);
    }
  });
  test("the composer is wired to chat.send", () => {
    assert.match(readFileSync(join(dir, "pane.tsx"), "utf8"), /useRpc\(chatSend\)/);
  });
  test("no other client code sends agent messages directly", () => {
    const all = readdirSync(join(process.cwd(), "client"), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
    for (const file of all) {
      const text = readFileSync(join(process.cwd(), "client", file), "utf8");
      assert.doesNotMatch(text, /agents\s*\.\s*ref\([^)]*\)\s*\.send\(/, file);
    }
  });
});

describe("pane rows", () => {
  test("U-2: a user row with a sender name is never merged with the next user row", () => {
    const row = (seq: number, extra: object = {}) => ({ id: String(seq), seq, kind: "user", text: `t${seq}`, ...extra }) as Any;
    const items = [row(1, { senderName: "Planner" }), row(2), row(3, { senderName: "Planner" }), row(4, { senderName: "Other" })];
    const shown = timeline.displayItems(items);
    assert.deepEqual(plain(shown.map((i: Any) => [i.id, i.text, i.senderName ?? null])), [
      ["1", "t1", "Planner"], ["2", "t2", null], ["3", "t3", "Planner"], ["4", "t4", "Other"],
    ]);
  });
  test("assistant chunks still join, and a user row between them splits them", () => {
    const item = (seq: number, kind: string, text: string) => ({ id: String(seq), seq, kind, text }) as Any;
    const shown = timeline.displayItems([item(1, "assistant", "a"), item(2, "assistant", "b"), item(3, "user", "u", ), item(4, "assistant", "c")]);
    assert.deepEqual(plain(shown.map((i: Any) => i.text)), ["ab", "u", "c"]);
  });
  test("the sender survives the server's chat item schema", () => {
    assert.equal(chatRpc.ChatItem.parse({ id: "1", seq: 1, kind: "user", text: "t", senderName: "Planner" }).senderName, "Planner");
  });
});

describe("move arrows (U-14)", () => {
  test("familyMoves: left only past the first block, right only before the last", () => {
    assert.deepEqual(familyMoves(0, 1), { canMoveLeft: false, canMoveRight: false }, "a single block has nowhere to go");
    assert.deepEqual(familyMoves(0, 3), { canMoveLeft: false, canMoveRight: true });
    assert.deepEqual(familyMoves(1, 3), { canMoveLeft: true, canMoveRight: true });
    assert.deepEqual(familyMoves(2, 3), { canMoveLeft: true, canMoveRight: false });
  });
  test("a block that is not in the list cannot move right", () => {
    assert.deepEqual(familyMoves(-1, 3), { canMoveLeft: false, canMoveRight: false });
    assert.deepEqual(familyMoves(0, 0), { canMoveLeft: false, canMoveRight: false });
  });
});

describe("pane state (U-4, R-4)", () => {
  const goneTitles = { archived: "Archived session", removed: "Session unavailable" };
  test("paneGone: the server's word wins; else absent long enough means removed; present is never gone", () => {
    assert.equal(paneGone({ refused: "archived", present: true, missing: false }), "archived");
    assert.equal(paneGone({ refused: "removed", present: true, missing: false }), "removed");
    assert.equal(paneGone({ refused: "archived", present: false, missing: true }), "archived", "a known reason beats a guess");
    assert.equal(paneGone({ refused: null, present: false, missing: true }), "removed");
    assert.equal(paneGone({ refused: null, present: false, missing: false }), null, "still within the grace period");
    assert.equal(paneGone({ refused: null, present: true, missing: true }), null);
  });
  test("showHostRefused: only for a session that is not gone", () => {
    assert.equal(showHostRefused(true, null), true);
    assert.equal(showHostRefused(true, "archived"), false);
    assert.equal(showHostRefused(true, "removed"), false);
    assert.equal(showHostRefused(false, null), false);
  });
  test("paneTitle: live sessions show their title or 'untitled'", () => {
    const live = { gone: null, lastTitle: "Old", untitled: "Untitled", goneTitles };
    assert.equal(paneTitle({ ...live, title: "Fix login" }), "Fix login");
    assert.equal(paneTitle({ ...live, title: "" }), "Untitled");
    assert.equal(paneTitle({ ...live, title: null }), "Untitled");
    assert.equal(paneTitle({ ...live, title: undefined }), "Untitled");
  });
  test("paneTitle: a gone session keeps the last title it had", () => {
    for (const gone of ["archived", "removed"] as const) {
      assert.equal(paneTitle({ gone, title: null, lastTitle: "Fix login", untitled: "Untitled", goneTitles }), "Fix login", gone);
      assert.equal(paneTitle({ gone, title: "Fresh", lastTitle: "Fix login", untitled: "Untitled", goneTitles }), "Fix login", "the snapshot title is not trusted once gone");
    }
  });
  test("paneTitle: without a remembered title, archived and removed use their own words", () => {
    const input = { title: null, lastTitle: null, untitled: "Untitled", goneTitles };
    assert.equal(paneTitle({ ...input, gone: "archived" }), "Archived session");
    assert.equal(paneTitle({ ...input, gone: "removed" }), "Session unavailable");
    assert.notEqual(paneTitle({ ...input, gone: "archived" }), paneTitle({ ...input, gone: "removed" }));
  });
});
