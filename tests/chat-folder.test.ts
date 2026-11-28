import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHAT_DIR_NAME, isChatFolder } from "../shared/chat/folder.ts";

describe("isChatFolder: every host's free chat folder goes to General", () => {
  test("this daemon's own folder, by its exact path", () => {
    assert.equal(isChatFolder("/Users/me/.paseo-chat", "/Users/me/.paseo-chat"), true);
  });
  test("another host's folder under another home, by name", () => {
    assert.equal(isChatFolder("/home/server/.paseo-chat", "/Users/me/.paseo-chat"), true);
    assert.equal(isChatFolder("/root/.paseo-chat/", "/Users/me/.paseo-chat"), true);
    assert.equal(isChatFolder("C:\\Users\\win\\.paseo-chat", "/Users/me/.paseo-chat"), true);
  });
  test("found by name even before this daemon names its own folder", () => {
    assert.equal(isChatFolder("/home/server/.paseo-chat", null), true);
  });
  test("ordinary projects and look-alike names stay in the tree", () => {
    assert.equal(isChatFolder("/Users/me/work/atrium", "/Users/me/.paseo-chat"), false);
    assert.equal(isChatFolder("/Users/me/.paseo-chat/sub", "/Users/me/.paseo-chat"), false);
    assert.equal(isChatFolder("/Users/me/my.paseo-chat", "/Users/me/.paseo-chat"), false);
    assert.equal(isChatFolder("", "/Users/me/.paseo-chat"), false);
    assert.equal(isChatFolder(undefined, null), false);
  });
  test("the server makes its folder under the same name", () => {
    assert.equal(CHAT_DIR_NAME, ".paseo-chat");
  });
});
