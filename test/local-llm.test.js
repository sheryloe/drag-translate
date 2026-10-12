const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/shared/config.js");
const local = require("../src/shared/local-llm.js");

const OLLAMA = { mode: "ollama", server: "http://localhost:11434", model: "qwen2.5:7b", timeout: 5 };
const OPENAI = { mode: "openai", server: "http://127.0.0.1:1234", model: "local-model", timeout: 5 };

/** 가짜 fetch — 주소와 요청을 적어 두고 정해 둔 응답을 돌려준다. */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const value = typeof reply === "function" ? reply(url, init) : reply;
    if (value instanceof Error) throw value;
    const { status = 200, json = {}, text } = value;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (text !== undefined ? text : JSON.stringify(json)),
    };
  };
  impl.calls = calls;
  return impl;
}

test("서버 주소는 localhost·127.0.0.1·[::1]만 받는다", () => {
  assert.equal(config.normalizeServerUrl("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(config.normalizeServerUrl("localhost:1234"), "http://localhost:1234");
  assert.equal(config.normalizeServerUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080");
  assert.equal(config.normalizeServerUrl("http://[::1]:11434"), "http://[::1]:11434");
  assert.equal(config.normalizeServerUrl("https://LOCALHOST:8443"), "https://localhost:8443");
  for (const bad of [
    "http://192.168.0.10:11434",
    "http://example.com",
    "http://localhost.example.com",
    "http://127.0.0.1.nip.io",
    "http://user:pw@localhost:11434",
    "file:///C:/x",
    "ftp://localhost",
    "",
    undefined,
  ]) {
    assert.equal(config.normalizeServerUrl(bad), null, String(bad));
  }
});

test("설정에 잘못된 서버 주소가 들어오면 방식의 기본 주소로 되돌린다", () => {
  assert.equal(config.normalize({ localServer: "http://10.0.0.5:11434" }).localServer, "http://localhost:11434");
  assert.equal(config.normalize({ localMode: "openai", localServer: "evil.com" }).localServer, "http://localhost:1234");
  assert.equal(config.normalize({ localTimeout: 5 }).localTimeout, config.DEFAULTS.localTimeout);
  assert.equal(config.normalize({ localModel: "  gemma3:4b " }).localModel, "gemma3:4b");
});

test("Ollama 요청은 /api/chat에 stream false로 지시문과 글을 보낸다", () => {
  const { url, init } = local.translateRequest("Hello", "ko", OLLAMA);
  assert.equal(url, "http://localhost:11434/api/chat");
  assert.equal(init.method, "POST");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "qwen2.5:7b");
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /Korean \(한국어\)/);
  assert.match(body.messages[0].content, /Do not add, omit, summarize, or explain/);
  assert.match(body.messages[0].content, /no quotation marks/);
  assert.deepEqual(body.messages[1], { role: "user", content: "Hello" });
});

test("OpenAI 호환 요청은 /v1/chat/completions로 보낸다", () => {
  const { url, init } = local.translateRequest("안녕", "en", OPENAI);
  assert.equal(url, "http://127.0.0.1:1234/v1/chat/completions");
  const body = JSON.parse(init.body);
  assert.equal(body.stream, false);
  assert.equal(body.model, "local-model");
  assert.match(body.messages[0].content, /into English/);
});

test("응답에서 모델이 쓴 글을 꺼낸다", () => {
  assert.equal(local.parseChat("ollama", { message: { role: "assistant", content: "안녕" } }), "안녕");
  assert.equal(local.parseChat("openai", { choices: [{ message: { content: "hi" } }] }), "hi");
  assert.throws(() => local.parseChat("ollama", {}), /모양/);
  assert.throws(() => local.parseChat("openai", { choices: [] }), /모양/);
});

test("응답 정리 — 생각 과정·머리말·감싼 따옴표·코드 울타리·끝 설명을 걷어 낸다", () => {
  assert.equal(local.cleanOutput("<think>음…</think>\n\n안녕하세요.", "Hello."), "안녕하세요.");
  assert.equal(local.cleanOutput("번역: 안녕하세요.", "Hello."), "안녕하세요.");
  assert.equal(local.cleanOutput("Translation: Hello.", "안녕."), "Hello.");
  assert.equal(local.cleanOutput("“안녕하세요.”", "Hello."), "안녕하세요.");
  assert.equal(local.cleanOutput('"안녕"', '"Hi"'), '"안녕"', "원문이 따옴표로 시작하면 남긴다");
  assert.equal(local.cleanOutput("```\n첫 줄\n둘째 줄\n```", "a\nb"), "첫 줄\n둘째 줄");
  assert.equal(local.cleanOutput("안녕하세요.\n\n(참고: 존댓말로 옮겼습니다.)", "Hello."), "안녕하세요.");
  assert.equal(local.cleanOutput("  첫 문단\n\n둘째 문단  ", "a\n\nb"), "첫 문단\n\n둘째 문단");
});

test("내 PC 번역은 요청을 보내고 정리한 결과를 돌려준다", async () => {
  const fetchImpl = fakeFetch({ json: { message: { content: "번역: 계측제어 시스템" } } });
  const result = await local.translateLocal("I&C system", "ko", OLLAMA, fetchImpl);
  assert.deepEqual(result, { text: "계측제어 시스템", detected: null });
  assert.equal(fetchImpl.calls[0].url, "http://localhost:11434/api/chat");
  assert.ok(fetchImpl.calls[0].init.signal, "시간 제한용 신호를 건다");
});

test("내 PC 주소가 아니면 요청하지 않는다", async () => {
  const fetchImpl = fakeFetch({ json: {} });
  await assert.rejects(local.translateLocal("a", "ko", { ...OLLAMA, server: "http://8.8.8.8:11434" }, fetchImpl), /localhost·127\.0\.0\.1·\[::1\]만/);
  assert.equal(fetchImpl.calls.length, 0);
  await assert.rejects(local.translateLocal("a", "ko", { ...OLLAMA, model: " " }, fetchImpl), /모델 이름/);
});

test("오류 문구 — 서버 꺼짐·시간 초과·출처 막힘·모델 없음·기타", async () => {
  await assert.rejects(local.translateLocal("a", "ko", OLLAMA, fakeFetch(new TypeError("Failed to fetch"))), /내 PC 번역 서버가 꺼져 있습니다\. Ollama를 켜 주세요\./);
  await assert.rejects(local.translateLocal("a", "ko", OPENAI, fakeFetch(new TypeError("Failed to fetch"))), /LM Studio/);
  await assert.rejects(local.translateLocal("a", "ko", OLLAMA, fakeFetch({ status: 403, text: "" })), /OLLAMA_ORIGINS/);
  await assert.rejects(
    local.translateLocal("a", "ko", OLLAMA, fakeFetch({ status: 404, json: { error: 'model "qwen2.5:7b" not found, try pulling it first' } })),
    /모델 「qwen2\.5:7b」이\(가\) 내 PC에 없습니다\. 명령 창에서 「ollama pull qwen2\.5:7b」/,
  );
  await assert.rejects(
    local.translateLocal("a", "ko", OPENAI, fakeFetch({ status: 400, json: { error: { message: "No models loaded. Please load a model." } } })),
    /LM Studio에서 모델을 불러온 뒤/,
  );
  await assert.rejects(local.translateLocal("a", "ko", OLLAMA, fakeFetch({ status: 500, json: { error: "out of memory" } })), /500 오류로 답했습니다\. \(out of memory\)/);
  await assert.rejects(local.translateLocal("a", "ko", OLLAMA, fakeFetch({ json: { message: { content: "  " } } })), /빈 답/);
});

test("시간 안에 답이 없으면 멈추고 알린다", async () => {
  const hang = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  await assert.rejects(local.translateLocal("a", "ko", { ...OLLAMA, timeout: 0.05 }, hang), /0\.05초 안에 답하지 않았습니다/);
});

test("모델 목록 — Ollama는 /api/tags, OpenAI 호환은 /v1/models", async () => {
  const ollama = fakeFetch({ json: { models: [{ name: "qwen2.5:7b" }, { name: "gemma3:latest" }] } });
  assert.deepEqual(await local.listModels(OLLAMA, ollama), ["qwen2.5:7b", "gemma3:latest"]);
  assert.equal(ollama.calls[0].url, "http://localhost:11434/api/tags");
  const openai = fakeFetch({ json: { data: [{ id: "qwen2.5-7b-instruct" }] } });
  assert.deepEqual(await local.listModels(OPENAI, openai), ["qwen2.5-7b-instruct"]);
  assert.equal(openai.calls[0].url, "http://127.0.0.1:1234/v1/models");
  assert.equal(local.hasModel(["gemma3:latest"], "gemma3"), true);
  assert.equal(local.hasModel(["gemma3"], "gemma3:latest"), true);
  assert.equal(local.hasModel(["gemma3:4b"], "gemma3"), false);
});

test("연결 시험 — 모델이 없으면 받아 둔 목록과 함께 알리고, 있으면 짧은 글을 번역해 본다", async () => {
  const missing = fakeFetch({ json: { models: [{ name: "llama3:8b" }] } });
  await assert.rejects(local.testConnection(OLLAMA, "ko", missing), /ollama pull qwen2\.5:7b[\s\S]*받아 둔 모델: llama3:8b/);
  const ok = fakeFetch((url) => (url.endsWith("/api/tags") ? { json: { models: [{ name: "qwen2.5:7b" }] } } : { json: { message: { content: "안녕하세요. 연결 시험입니다." } } }));
  const reply = await local.testConnection(OLLAMA, "ko", ok);
  assert.equal(reply.sample, "안녕하세요. 연결 시험입니다.");
  assert.deepEqual(reply.models, ["qwen2.5:7b"]);
});
