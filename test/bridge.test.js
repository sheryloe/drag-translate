const test = require("node:test");
const assert = require("node:assert/strict");
const bridge = require("../src/shared/bridge.js");

test("배경 작업이 답 없이 끝나면 다시 시도하라고 알린다(확장 다시 로드와 구별)", () => {
  assert.match(bridge.explainSendError(new Error("The message port closed before a response was received.")), /배경 작업이 답을 주기 전에 멈췄습니다/);
  assert.match(bridge.explainSendError(new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received")), /배경 작업/);
});

test("확장을 다시 로드한 탭은 새로 고치라고 알린다", () => {
  assert.match(bridge.explainSendError(new Error("Extension context invalidated.")), /페이지를 새로 고친 뒤/);
  assert.match(bridge.explainSendError(undefined), /페이지를 새로 고친 뒤/);
});
