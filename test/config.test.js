const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/shared/config.js");

test("저장된 값이 없거나 깨졌으면 기본값을 쓴다", () => {
  assert.deepEqual(config.normalize(undefined), config.DEFAULTS);
  assert.deepEqual(config.normalize({ engine: "deepl", targetLang: "xx", minLength: 0, trigger: 1 }), config.DEFAULTS);
});

test("올바른 값은 그대로 남긴다", () => {
  const value = {
    ...config.DEFAULTS,
    enabled: false,
    engine: "local",
    targetLang: "ja",
    trigger: "icon",
    minLength: 5,
    ignoreEditable: false,
    pdfAutoOpen: false,
    localMode: "openai",
    localServer: "http://127.0.0.1:1234",
    localModel: "qwen2.5-7b-instruct",
    localTimeout: 300,
  };
  assert.deepEqual(config.normalize(value), value);
});

test("언어 이름을 돌려주고 모르는 코드는 코드 그대로 둔다", () => {
  assert.equal(config.languageName("en"), "영어");
  assert.equal(config.languageName("xx"), "xx");
});

test("언어 목록은 파파고가 지원하는 번역 대상 13개다", () => {
  assert.deepEqual(
    config.LANGUAGES.map((lang) => lang.code),
    ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "fr", "es", "ru", "de", "it"],
  );
});
