const test = require("node:test");
const assert = require("node:assert/strict");
const local = require("../src/shared/local-llm.js");
const { fakeFetch } = require("./fake-fetch.js");

const OLLAMA = { mode: "ollama", server: "http://localhost:11434", model: "qwen2.5:7b", timeout: 5 };
const OPENAI = { mode: "openai", server: "http://127.0.0.1:1234", model: "local-model", timeout: 5 };

test("요청은 생각 출력을 끄고 모델을 붙잡아 두며 답 길이를 막는다", () => {
  const body = JSON.parse(local.translateRequest("Hello world", "ko", OLLAMA).init.body);
  assert.equal(body.think, false);
  assert.equal(body.keep_alive, local.KEEP_ALIVE);
  assert.equal(body.options.num_ctx, local.TEXT_CTX);
  assert.equal(body.options.num_predict, local.maxOutputTokens("Hello world"));
  assert.ok(body.options.temperature <= 0.2);
  const openai = JSON.parse(local.translateRequest("Hello", "ko", OPENAI).init.body);
  assert.equal(openai.max_tokens, local.maxOutputTokens("Hello"));
  assert.equal(local.maxOutputTokens(""), 256);
  assert.equal(local.maxOutputTokens("x".repeat(5000)), 2048);
});

test("원문 언어 어림 — 글자 모양으로", () => {
  assert.equal(local.guessLanguage("계측제어 설비 점검"), "ko");
  assert.equal(local.guessLanguage("The I&C system"), "en");
  assert.equal(local.guessLanguage("これはテストです"), "ja");
  assert.equal(local.guessLanguage("这是一个测试"), "zh-CN");
  assert.equal(local.guessLanguage("Это тест"), "ru");
  assert.equal(local.guessLanguage("นี่คือการทดสอบ"), "th");
  assert.equal(local.guessLanguage("Đây là một bài kiểm tra"), "vi");
  assert.equal(local.guessLanguage("1234"), "en");
});

test("번역 전용 모델(TranslateGemma·맞춤 모델)은 지시문과 글을 한 메시지에, 빈 줄 두 개를 두고 보낸다", () => {
  assert.equal(local.usesSingleMessage("translategemma:4b"), true);
  assert.equal(local.usesSingleMessage("drag-translate"), true);
  assert.equal(local.usesSingleMessage("drag-translate:latest"), true);
  assert.equal(local.usesSingleMessage("drag-translate-vision"), false);
  assert.equal(local.usesSingleMessage("qwen2.5:7b"), false);
  const messages = local.translateMessages("계측제어 설비", "en", ["계측제어 = I&C"], "translategemma:4b");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /^You are a professional Korean \(ko\) to English \(en\) translator\./);
  assert.match(messages[0].content, /Always translate these terms exactly like this: 계측제어 = I&C\./);
  assert.ok(messages[0].content.endsWith("Please translate the following Korean text into English:\n\n\n계측제어 설비"));
  // 원문이 목표 언어와 같게 어림되면 흔한 쪽을 원문 언어로 둔다.
  assert.match(local.translateMessages("Hello", "en", [], "translategemma:4b")[0].content, /Korean \(ko\) to English/);
});

test("원문에 없던 한자가 섞이면 한 번 다시 시키고, 고쳐지면 고친 답을 쓴다", async () => {
  assert.equal(local.hasStrayHan("반응堆 압력", "reactor pressure", "ko"), true);
  assert.equal(local.hasStrayHan("原子炉 압력", "原子炉 pressure", "ko"), false);
  assert.equal(local.hasStrayHan("原子炉", "reactor", "ja"), false);
  let round = 0;
  const fetchImpl = fakeFetch(() => ({ json: { message: { content: ++round === 1 ? "반응堆 압력" : "원자로 압력" } } }));
  const result = await local.translateLocal("reactor pressure", "ko", OLLAMA, fetchImpl);
  assert.equal(result.text, "원자로 압력");
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[1].body.messages.at(-1).content, /Chinese characters/);
});

test("그림 읽기 요청 — Ollama는 images, OpenAI 호환은 data URL, 그림 읽기 모델을 따로 쓴다", () => {
  const ollama = JSON.parse(local.recognizeRequest({ ...OLLAMA, visionModel: "qwen3-vl:2b-instruct" }, "QUJD").init.body);
  assert.equal(ollama.model, "qwen3-vl:2b-instruct");
  assert.deepEqual(ollama.messages[0].images, ["QUJD"]);
  assert.match(ollama.messages[0].content, /Transcribe all text/);
  assert.equal(ollama.options.num_ctx, 4096);
  const openai = JSON.parse(local.recognizeRequest(OPENAI, "QUJD", "image/jpeg").init.body);
  assert.equal(openai.model, "local-model");
  assert.deepEqual(openai.messages[0].content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
});

test("그림 읽기 — 그림을 못 읽는 모델이면 시각 모델을 고르라고 알린다", async () => {
  const textOnly = fakeFetch((url) => (url.endsWith("/api/show") ? { json: { capabilities: ["completion"] } } : { json: {} }));
  await assert.rejects(local.recognizeImage("QUJD", OLLAMA, textOnly), /그림을 읽을 수 있는 모델\(예: 시각 모델\)을 골라 주세요/);
  assert.equal(textOnly.calls.length, 1, "그림을 보내기 전에 멈춘다");
  const refusal = fakeFetch({ json: { choices: [{ message: { content: "I'm sorry, but I cannot read text from an image as my environment does not support image input." } }] } });
  await assert.rejects(local.recognizeImage("QUJD", OPENAI, refusal), /시각 모델/);
  const errored = fakeFetch({ status: 500, json: { error: "this model does not support images" } });
  await assert.rejects(local.recognizeImage("QUJD", OPENAI, errored), /시각 모델/);
  const vision = fakeFetch((url) => (url.endsWith("/api/show") ? { json: { capabilities: ["completion", "vision"] } } : { json: { message: { content: "Drag Translate\nsample" } } }));
  assert.equal(await local.recognizeImage("QUJD", { ...OLLAMA, visionModel: "qwen3-vl:2b-instruct" }, vision), "Drag Translate\nsample");
  const empty = fakeFetch((url) => (url.endsWith("/api/show") ? { json: { capabilities: ["vision"] } } : { json: { message: { content: "" } } }));
  await assert.rejects(local.recognizeImage("QUJD", OLLAMA, empty), /글자를 찾지 못했습니다/);
});

test("연결 시험은 그림 읽기 가능 여부도 알려 준다", async () => {
  const reply = (caps) =>
    fakeFetch((url) => {
      if (url.endsWith("/api/tags")) return { json: { models: [{ name: "qwen2.5:7b" }, { name: "qwen3-vl:2b-instruct" }] } };
      if (url.endsWith("/api/show")) return { json: { capabilities: caps } };
      return { json: { message: { content: "안녕하세요." } } };
    });
  const ok = await local.testConnection({ ...OLLAMA, visionModel: "qwen3-vl:2b-instruct" }, "ko", reply(["completion", "vision"]));
  assert.equal(ok.vision.ok, true);
  const no = await local.testConnection({ ...OLLAMA, visionModel: "qwen2.5:7b" }, "ko", reply(["completion"]));
  assert.equal(no.vision.ok, false);
  assert.match(no.vision.message, /시각 모델/);
  const missing = await local.testConnection({ ...OLLAMA, visionModel: "gemma3:4b" }, "ko", reply(["vision"]));
  assert.match(missing.vision.message, /ollama pull gemma3:4b/);
  const openai = await local.testConnection(OPENAI, "ko", fakeFetch((url) => (url.endsWith("/v1/models") ? { json: { data: [{ id: "local-model" }] } } : { json: { choices: [{ message: { content: "안녕" } }] } })));
  assert.equal(openai.vision.ok, null);
});

test("모델 받기 — /api/pull 진행 줄을 조각이 나뉘어 와도 한 줄씩 넘기고, Ollama가 아니면 막는다", async () => {
  const chunks = ['{"status":"pulling manifest"}\n{"status":"pull', 'ing a","total":10,"completed":5}\n', '{"status":"success"}'];
  const encoder = new TextEncoder();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { value: undefined, done: true }) }) },
    };
  };
  const lines = [];
  await local.pullModel(OLLAMA, "qwen3-vl:2b-instruct", (line) => lines.push(JSON.parse(line).status), fetchImpl);
  assert.deepEqual(lines, ["pulling manifest", "pulling a", "success"]);
  assert.deepEqual(calls[0], { url: "http://localhost:11434/api/pull", body: { model: "qwen3-vl:2b-instruct", stream: true } });
  await assert.rejects(local.pullModel(OPENAI, "x", () => {}, fetchImpl), /Ollama에서만/);
  await assert.rejects(local.pullModel(OLLAMA, "bad name; rm", () => {}, fetchImpl), /올바르지 않습니다/);
  await assert.rejects(local.pullModel(OLLAMA, "x", () => {}, fakeFetch({ status: 403, text: "" })), /OLLAMA_ORIGINS/);
});

test("번역 전용 모델은 시각 기능이 있어도 그림 읽기에 쓰지 않는다(실측: 빈 답)", async () => {
  const fetchImpl = fakeFetch({ json: { capabilities: ["completion", "vision"] } });
  await assert.rejects(local.recognizeImage("QUJD", { ...OLLAMA, model: "translategemma:4b" }, fetchImpl), /번역 전용 모델 「translategemma:4b」은\(는\) 그림 속 글자를 옮겨 적지 못합니다/);
  assert.equal(fetchImpl.calls.length, 0);
});
