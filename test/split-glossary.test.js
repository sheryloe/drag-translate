const test = require("node:test");
const assert = require("node:assert/strict");
const tools = require("../src/shared/text-tools.js");
const local = require("../src/shared/local-llm.js");

test("나누기 — 짧은 글은 한 조각", () => {
  assert.deepEqual(tools.splitForTranslation("Hello world."), [{ text: "Hello world.", sep: "" }]);
  assert.deepEqual(tools.splitForTranslation("  \n "), []);
});

test("나누기 — 짧은 문단은 줄바꿈째 묶고, 넘치면 다음 조각으로", () => {
  const chunks = tools.splitForTranslation("aaaa\nbbbb\n\ncccc", 10);
  assert.deepEqual(chunks, [
    { text: "aaaa\nbbbb", sep: "\n\n" },
    { text: "cccc", sep: "" },
  ]);
  for (const chunk of tools.splitForTranslation("x".repeat(30) + "\n" + "y".repeat(30), 40)) assert.ok(chunk.text.length <= 40);
});

test("나누기 — 긴 문단은 문장 단위로, 이음새는 빈칸", () => {
  const paragraph = "First sentence is here. Second sentence follows! Third one ends? Fourth.";
  const chunks = tools.splitForTranslation(`${paragraph}\nNext paragraph.`, 30);
  assert.deepEqual(chunks.map((chunk) => chunk.text), ["First sentence is here.", "Second sentence follows!", "Third one ends? Fourth.", "Next paragraph."]);
  assert.deepEqual(chunks.map((chunk) => chunk.sep), [" ", " ", "\n", ""]);
  for (const chunk of chunks) assert.ok(chunk.text.length <= 30);
});

test("나누기 — 문장 하나가 너무 길면 빈칸에서 자르고, 빈칸도 없으면 그 자리에서 자른다", () => {
  const words = tools.splitForTranslation("aaaa bbbb cccc dddd eeee ffff", 12);
  for (const chunk of words) assert.ok(chunk.text.length <= 12, chunk.text);
  assert.equal(words.map((chunk) => chunk.text).join(" "), "aaaa bbbb cccc dddd eeee ffff");
  const solid = tools.splitForTranslation("x".repeat(25), 10);
  assert.deepEqual(solid.map((chunk) => chunk.text.length), [10, 10, 5]);
});

test("이어 붙이기 — 번역을 원래 모양으로 잇고, 문장으로 나눈 문단은 한 짝으로 합친다", () => {
  const chunks = [
    { text: "Para one.\nPara two.", sep: "\n\n" },
    { text: "Long A.", sep: " " },
    { text: "Long B.", sep: "\n" },
    { text: "Last.", sep: "" },
  ];
  const { text, pairs } = tools.assemble(chunks, ["문단 하나.\n문단 둘.", "긴 가.", "긴 나.", "끝."]);
  assert.equal(text, "문단 하나.\n문단 둘.\n\n긴 가. 긴 나.\n끝.");
  assert.deepEqual(pairs, [
    { source: "Para one.", translation: "문단 하나." },
    { source: "Para two.", translation: "문단 둘." },
    { source: "Long A. Long B.", translation: "긴 가. 긴 나." },
    { source: "Last.", translation: "끝." },
  ]);
});

test("나누고 이어 붙이면 원문 모양이 그대로 돌아온다", () => {
  const source = "Title\n\nIntro line one.\nIntro line two.\n\n" + "Sentence number one is long enough. ".repeat(40).trim() + "\nEnd.";
  const chunks = tools.splitForTranslation(source, 200);
  assert.equal(tools.assemble(chunks, chunks.map((chunk) => chunk.text)).text, source);
});

test("용어집 읽기 — 「원어 = 번역어」, 빈 줄·주석·잘못된 줄은 건너뛴다", () => {
  const raw = "# 계측제어 용어\n계측제어 = I&C\n\n형상관리=configuration management\n원자로 냉각재 => reactor coolant\n잘못된 줄\n= 빈 원어\n";
  assert.deepEqual(tools.parseGlossary(raw), [
    { source: "계측제어", target: "I&C" },
    { source: "형상관리", target: "configuration management" },
    { source: "원자로 냉각재", target: "reactor coolant" },
  ]);
});

test("용어집 — 글에 나오는 용어만, 반대 방향 번역이면 뒤집어 넣는다", () => {
  const entries = tools.parseGlossary("계측제어 = I&C\n형상관리 = configuration management\n압력 전송기 = pressure transmitter");
  assert.deepEqual(tools.glossaryLinesFor(entries, "계측제어 설비의 압력 전송기"), ["계측제어 = I&C", "압력 전송기 = pressure transmitter"]);
  assert.deepEqual(tools.glossaryLinesFor(entries, "The I&C system and Configuration Management"), ["I&C = 계측제어", "configuration management = 형상관리"]);
  assert.deepEqual(tools.glossaryLinesFor(entries, "관계없는 글"), []);
  assert.equal(tools.glossaryLinesFor(entries, "계측제어 형상관리 압력 전송기", 2).length, 2, "개수 제한");
});

test("용어집을 번역 지시문에 넣는다 — 일반 모델과 번역 전용 모델 모두", () => {
  const lines = tools.glossaryLinesFor(tools.parseGlossary("계측제어 = I&C"), "계측제어 설비");
  const system = local.translateMessages("계측제어 설비", "en", lines, "qwen2.5:7b")[0].content;
  assert.match(system, /Glossary \(always translate these terms exactly like this\):\n- 계측제어 = I&C/);
  const single = local.translateMessages("계측제어 설비", "en", lines, "drag-translate")[0].content;
  assert.ok(
    single.endsWith(
      "Terminology (you must use the English term on the right for the term on the left):\n- 계측제어 → I&C\nPlease translate the following Korean text into English:\n\n\n계측제어 설비",
    ),
  );
  assert.doesNotMatch(local.translateMessages("설비", "en", [], "qwen2.5:7b")[0].content, /Glossary/);
});

test("용어집 번역어를 띄어쓰기만 달리 쓰면 바로잡는다", async () => {
  const lines = ["reactor protection system = 원자로보호계통", "configuration management = 형상관리"];
  assert.equal(local.applyGlossarySpacing("원자로 보호 계통과 형상 관리", lines), "원자로보호계통과 형상관리");
  assert.equal(local.applyGlossarySpacing("원자로보호계통", lines), "원자로보호계통");
  assert.equal(local.applyGlossarySpacing("다른 말", lines), "다른 말");
  const { fakeFetch } = require("./fake-fetch.js");
  const reply = await local.translateLocal("reactor protection system", "ko", { mode: "ollama", server: "http://localhost:11434", model: "drag-translate", timeout: 5 }, fakeFetch({ json: { message: { content: "원자로 보호 계통" } } }), lines);
  assert.equal(reply.text, "원자로보호계통");
});
