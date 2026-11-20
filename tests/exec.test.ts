import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { failure, plain, run, type ExecResult } from "../server/core/exec.ts";

const node = process.execPath;
const js = (code: string, ...args: string[]) => run(node, ["-e", code, ...args]);
const result = (over: Partial<ExecResult>): ExecResult => ({
  code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null, truncated: false, ...over,
});

test("run: normal exit returns stdout, stderr and code 0", async () => {
  const r = await js('process.stdout.write("out"); process.stderr.write("err")');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "out");
  assert.equal(r.stderr, "err");
  assert.equal(r.timedOut, false);
  assert.equal(r.spawnError, null);
  assert.equal(r.truncated, false);
  assert.equal(failure(r), null);
});

test("run: a non-zero exit code is reported with its output", async () => {
  const r = await js('process.stderr.write("boom\\n"); process.exit(3)');
  assert.equal(r.code, 3);
  assert.equal(r.stderr, "boom\n");
  assert.equal(r.spawnError, null);
  assert.equal(failure(r), "boom");
});

test("run: a missing command yields spawnError and no code, never a rejection", async () => {
  const r = await run("atrium-definitely-not-installed-xyz", ["--version"]);
  assert.equal(r.code, null);
  assert.ok(r.spawnError && /ENOENT/.test(r.spawnError), `spawnError: ${r.spawnError}`);
  assert.equal(r.timedOut, false);
  assert.equal(failure(r), r.spawnError);
});

test("run: a timeout kills the child and reports timedOut", async () => {
  const started = Date.now();
  const r = await run(node, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.equal(r.spawnError, null);
  assert.ok(Date.now() - started < 8000, "returns promptly after the timeout");
  assert.equal(failure(r), "timed out");
});

test("run: the timeout also stops grandchildren that hold the pipes", async () => {
  const started = Date.now();
  const r = await run("sh", ["-c", "sleep 30 & wait"], { timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 8000);
});

test("run: output over maxOutputBytes is cut at the limit and flagged truncated", async () => {
  const r = await run(node, ["-e", 'process.stdout.write("x".repeat(100000))'], { maxOutputBytes: 1000 });
  assert.equal(r.truncated, true);
  assert.equal(Buffer.byteLength(r.stdout), 1000);
  assert.equal(failure(r), "output exceeded the size limit");
});

test("run: the cap applies to stderr as well", async () => {
  const r = await run(node, ["-e", 'process.stderr.write("y".repeat(5000))'], { maxOutputBytes: 100 });
  assert.equal(r.truncated, true);
  assert.equal(Buffer.byteLength(r.stderr), 100);
});

test("run: output of exactly maxOutputBytes is complete, not truncated", async () => {
  const r = await run(node, ["-e", 'process.stdout.write("x".repeat(1000))'], { maxOutputBytes: 1000 });
  assert.equal(r.truncated, false);
  assert.equal(r.stdout.length, 1000);
  assert.equal(failure(r), null);
});

test("run: multi-byte output split across chunks stays intact", async () => {
  const r = await run(node, ["-e", 'for (let i = 0; i < 2000; i++) process.stdout.write("한글🙂")']);
  assert.equal(r.stdout, "한글🙂".repeat(2000));
  assert.equal(r.truncated, false);
});

test("run: a cap on a 3-byte boundary keeps whole Korean characters", async () => {
  const r = await run(node, ["-e", 'process.stdout.write("가".repeat(1000))'], { maxOutputBytes: 300 });
  assert.equal(r.truncated, true);
  assert.equal(r.stdout, "가".repeat(100));
});

test("run: arguments with spaces, Korean and shell metacharacters arrive verbatim", async () => {
  const args = ["two words", "한글 인자", "$HOME `id` $(id) ; | & > *", "  leading", "", "quote'\"s", "--flag=값 있음"];
  const r = await js("process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), args);
});

test("run: cwd may contain spaces and Korean", async () => {
  const dir = await mkdtemp(join(tmpdir(), "아트리움 테스트 "));
  try {
    const r = await run(node, ["-e", "process.stdout.write(process.cwd())"], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await realpath(r.stdout), await realpath(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run: cwd null or undefined uses the current directory", async () => {
  for (const cwd of [null, undefined]) {
    const r = await run(node, ["-e", "process.stdout.write(process.cwd())"], { cwd });
    assert.equal(await realpath(r.stdout), await realpath(process.cwd()));
  }
});

test("run: a cwd that does not exist is a failure, not a throw", async () => {
  const r = await run(node, ["-e", "1"], { cwd: join(tmpdir(), "atrium-no-such-dir-" + Date.now()) });
  assert.equal(r.code, null);
  assert.ok(r.spawnError);
  assert.ok(failure(r));
});

test("run: stdin text is delivered and closed; without it stdin is closed immediately", async () => {
  const echo = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("["+s+"]"))';
  const withInput = await run(node, ["-e", echo], { stdin: "안녕 hello\n" });
  assert.equal(withInput.stdout, "[안녕 hello\n]");
  const without = await run(node, ["-e", echo], { timeoutMs: 5000 });
  assert.equal(without.stdout, "[]");
  assert.equal(without.timedOut, false);
});

test("run: a child that exits without reading a large stdin does not crash the host", async () => {
  const r = await run(node, ["-e", "process.exit(0)"], { stdin: "z".repeat(5_000_000) });
  assert.equal(r.code, 0);
});

test("run: env overrides apply, undefined removes a variable, NO_COLOR is set", async () => {
  process.env.ATRIUM_EXEC_TEST_REMOVE = "present";
  try {
    const r = await run(
      node,
      ["-e", "process.stdout.write(JSON.stringify([process.env.ATRIUM_EXEC_TEST_SET ?? null, process.env.ATRIUM_EXEC_TEST_REMOVE ?? null, process.env.NO_COLOR ?? null]))"],
      { env: { ATRIUM_EXEC_TEST_SET: "값 1", ATRIUM_EXEC_TEST_REMOVE: undefined } },
    );
    assert.deepEqual(JSON.parse(r.stdout), ["값 1", null, "1"]);
  } finally {
    delete process.env.ATRIUM_EXEC_TEST_REMOVE;
  }
});

test("run: a child killed by a signal has no exit code and counts as a failure", async () => {
  const r = await js('process.kill(process.pid, "SIGKILL")');
  assert.equal(r.code, null);
  assert.equal(r.timedOut, false);
  assert.ok(failure(r));
});

test("run: a background grandchild holding the pipes does not hang the result", async () => {
  const started = Date.now();
  const r = await run("sh", ["-c", "sleep 4 & echo hi"], { timeoutMs: 20000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "hi\n");
  assert.ok(Date.now() - started < 4000, "settles after the exit drain window, not when the grandchild ends");
});

test("run: concurrent runs do not mix their output", async () => {
  const rs = await Promise.all(
    Array.from({ length: 8 }, (_, i) => js("process.stdout.write(process.argv[1])", `값${i}`)),
  );
  assert.deepEqual(rs.map((r) => r.stdout), Array.from({ length: 8 }, (_, i) => `값${i}`));
});

test("plain: strips ANSI escapes and carriage returns, leaves other text alone", () => {
  assert.equal(plain("\u001b[31mred\u001b[0m"), "red");
  assert.equal(plain("\u001b[1;32m한글\u001b[0m 그대로"), "한글 그대로");
  assert.equal(plain("\u001b[?25lhidden cursor\u001b[?25h"), "hidden cursor");
  assert.equal(plain("a\r\nb\rc"), "a\nbc");
  assert.equal(plain(""), "");
  assert.equal(plain("no escapes [1m here"), "no escapes [1m here");
});

test("failure: null on success even when stderr has text", () => {
  assert.equal(failure(result({ stderr: "warning: something" })), null);
});

test("failure: precedence is spawnError, timeout, truncation, then exit code", () => {
  assert.equal(failure(result({ code: null, spawnError: "spawn x ENOENT", timedOut: true, truncated: true })), "spawn x ENOENT");
  assert.equal(failure(result({ code: null, timedOut: true, truncated: true })), "timed out");
  assert.equal(failure(result({ code: 0, truncated: true })), "output exceeded the size limit");
  assert.equal(failure(result({ code: 2, stderr: "bad" })), "bad");
});

test("failure: non-zero exit uses stderr, falls back to stdout, then to the exit code; text is plain and trimmed", () => {
  assert.equal(failure(result({ code: 1, stderr: "\u001b[31m오류 발생\u001b[0m\n", stdout: "ignored" })), "오류 발생");
  assert.equal(failure(result({ code: 1, stderr: "", stdout: "  from stdout \n" })), "from stdout");
  assert.equal(failure(result({ code: 7 })), "exit 7");
  assert.equal(failure(result({ code: 1, stderr: " \n ", stdout: "" })), "exit 1");
});
