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
  assert.deepEqual(engines.clip("  abc  ", 5), { text: "abc", clipped: false, omitted: 0 });
  assert.deepEqual(engines.clip("abcdefgh", 5), { text: "abcde", clipped: true, omitted: 3 });
});

test("자를 때 끝 1할 안에 문단·문장 끝이 있으면 거기서 자르고, 남은 글자 수를 센다", () => {
  const sentence = "A".repeat(95) + ". "; // 97자
  const long = sentence.repeat(400).trim(); // 38,800자 남짓
  const { text, clipped, omitted } = engines.clip(long, 30000);
  assert.equal(clipped, true);
  assert.ok(text.length <= 30000 && text.length >= 27000, String(text.length));
  assert.ok(text.endsWith("."), "문장 끝에서 자른다");
  assert.equal(text.length + omitted + 1, long.length, "자른 자리의 빈칸 하나를 빼면 앞뒤가 원래 길이");
  // 문장 끝이 없으면 max에서 자른다.
  assert.equal(engines.clip("가".repeat(40000), 30000).text.length, 30000);
  assert.equal(engines.clip("가".repeat(40000), 30000).omitted, 10000);
});

test("잘렸다는 알림은 번역한 양과 남은 양을 함께 보인다", () => {
  assert.equal(engines.clipNote(30000, 12345), "글이 길어 앞 30,000자만 번역합니다. 남은 12,345자는 번역하지 않았습니다 — 그 부분을 따로 드래그해 주세요.");
});

test("파파고·구글 웹사이트 주소에는 사이트가 받는 앞 5,000자만 싣는다", () => {
  const long = "가".repeat(12000);
  const st = new URL(engines.papagoWebUrl(long, "en")).searchParams.get("st");
  assert.equal(st.length, engines.WEB_MAX);
  const text = new URL(engines.googleWebUrl(long, "en")).searchParams.get("text");
  assert.equal(text.length, engines.WEB_MAX);
});
