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
    joinLines: false,
    copyFormat: "table",
    localMode: "openai",
    localServer: "http://127.0.0.1:1234",
    localModel: "qwen2.5-7b-instruct",
    localVisionModel: "",
    localTimeout: 300,
    localParallel: 2,
    glossary: "계측제어 = I&C",
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

test("용어집은 이 PC 저장소에, 나머지는 동기화 저장소에 둔다", async () => {
  const areas = { sync: {}, local: {} };
  const area = (name) => ({
    get: async (key) => ({ [key]: areas[name][key] }),
    set: async (value) => Object.assign(areas[name], value),
  });
  globalThis.chrome = { storage: { sync: area("sync"), local: area("local"), onChanged: { addListener() {} } } };
  try {
    await config.save({ engine: "local", glossary: "계측제어 = I&C" });
    assert.equal(areas.sync.settings.engine, "local");
    assert.equal("glossary" in areas.sync.settings, false);
    assert.equal(areas.local.glossary, "계측제어 = I&C");
    const loaded = await config.load();
    assert.equal(loaded.glossary, "계측제어 = I&C");
    await config.save({ targetLang: "en" });
    assert.equal(areas.local.glossary, "계측제어 = I&C", "다른 값을 바꿔도 용어집은 남는다");
    assert.equal(config.normalize({ glossary: "x".repeat(30000) }).glossary.length, 20000);
  } finally {
    delete globalThis.chrome;
  }
});
