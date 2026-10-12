const test = require("node:test");
const assert = require("node:assert/strict");
const engines = require("../src/shared/engines.js");

test("구글 요청은 글을 본문(POST)으로 보내고 언어를 주소에 싣는다", () => {
  const { url, init } = engines.googleRequest("Hello & 안녕", "ko");
  assert.match(url, /^https:\/\/translate\.googleapis\.com\/translate_a\/single\?client=gtx&dt=t&sl=auto&tl=ko$/);
  assert.equal(init.method, "POST");
  assert.equal(init.body, `q=${encodeURIComponent("Hello & 안녕")}`);
});

test("구글 응답의 문장 조각을 이어 붙이고 감지 언어를 읽는다", () => {
  // 실제 응답 모양(2026-10-12 확인): [[[번역, 원문, …], …], null, "en", …]
  const data = [[["안녕하세요. ", "Hello world. ", null, null, 3], ["이것은 테스트입니다.", "This is a test.", null, null, 3]], null, "en"];
  assert.deepEqual(engines.parseGoogle(data), { text: "안녕하세요. 이것은 테스트입니다.", detected: "en" });
});

test("구글 응답 모양이 다르거나 비면 오류를 낸다", () => {
  assert.throws(() => engines.parseGoogle({}), /모양/);
  assert.throws(() => engines.parseGoogle([[["", "x"]]]), /빈 결과/);
});

test("구글 번역 오류는 사람이 읽을 말로 바꾼다", async () => {
  const fake = (status) => async () => ({ ok: status === 200, status, json: async () => [] });
  await assert.rejects(engines.translateGoogle("a", "ko", fake(429)), /너무 잦아/);
  await assert.rejects(engines.translateGoogle("a", "ko", fake(500)), /500/);
  await assert.rejects(engines.translateGoogle("a", "ko", async () => { throw new Error("net"); }), /연결하지 못했습니다/);
});

test("구글 번역은 응답을 읽어 돌려준다", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, "POST");
    return { ok: true, status: 200, json: async () => [[["세계", "world"]], null, "en"] };
  };
  assert.deepEqual(await engines.translateGoogle("world", "ko", fetchImpl), { text: "세계", detected: "en" });
});

test("파파고·구글 웹 주소는 언어와 글을 미리 채운다", () => {
  assert.equal(engines.papagoWebUrl("a b&c", "ko"), "https://papago.naver.com/?sk=auto&tk=ko&st=a%20b%26c");
  assert.equal(engines.papagoWebUrl("x", "zh-CN"), "https://papago.naver.com/?sk=auto&tk=zh-CN&st=x");
  assert.equal(engines.googleWebUrl("a b", "en"), "https://translate.google.com/?sl=auto&tl=en&text=a%20b&op=translate");
});

test("긴 글은 앞부분만 남기고 잘렸다고 알린다", () => {
  assert.deepEqual(engines.clip("  abc  ", 5), { text: "abc", clipped: false });
  assert.deepEqual(engines.clip("abcdefgh", 5), { text: "abcde", clipped: true });
});
