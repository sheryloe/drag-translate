const test = require("node:test");
const assert = require("node:assert/strict");
const tools = require("../src/shared/text-tools.js");

test("PDF 줄바꿈 — 문장 중간에서 끊긴 줄은 한 칸 띄어 잇는다", () => {
  const pdf = "The instrumentation and control system monitors the\nreactor coolant pressure and trips the plant when\nthe limits are exceeded.";
  assert.equal(tools.joinBrokenLines(pdf), "The instrumentation and control system monitors the reactor coolant pressure and trips the plant when the limits are exceeded.");
});

test("PDF 줄바꿈 — 줄 끝 하이픈 + 소문자는 하이픈을 빼고 붙인다", () => {
  assert.equal(tools.joinBrokenLines("the trans-\nlation of the docu-\nment"), "the translation of the document");
  assert.equal(tools.joinBrokenLines("see section 3-\nB for details"), "see section 3- B for details", "숫자 뒤 하이픈·대문자는 그대로");
});

test("PDF 줄바꿈 — 빈 줄은 문단, 목록과 짧은 문단 끝 줄은 줄바꿈을 남긴다", () => {
  const pdf = [
    "This procedure applies to all safety related software and must",
    "be followed by every engineer.",
    "",
    "Steps:",
    "1. Check the configuration baseline before any",
    "change is made.",
    "2. Record the change.",
    "- Keep the log.",
  ].join("\n");
  assert.equal(
    tools.joinBrokenLines(pdf),
    "This procedure applies to all safety related software and must be followed by every engineer.\n\nSteps:\n1. Check the configuration baseline before any change is made.\n2. Record the change.\n- Keep the log.",
  );
});

test("PDF 줄바꿈 — 한글은 띄어 잇고, 한자·가나끼리는 붙인다", () => {
  assert.equal(tools.joinBrokenLines("계측제어 설비의 정기 점검\n결과를 보고합니다."), "계측제어 설비의 정기 점검 결과를 보고합니다.");
  assert.equal(tools.joinBrokenLines("原子炉の圧力を監\n視する。"), "原子炉の圧力を監視する。");
  assert.equal(tools.joinBrokenLines("  앞뒤 빈칸  \r\n\r\n\r\n 둘째 문단 "), "앞뒤 빈칸\n\n둘째 문단");
});

test("문단 짝짓기 — 수가 같으면 문단끼리, 다르면 통째로", () => {
  assert.deepEqual(tools.pairParagraphs("A.\n\nB.", "가.\n나."), [
    { source: "A.", translation: "가." },
    { source: "B.", translation: "나." },
  ]);
  assert.deepEqual(tools.pairParagraphs("A.\nB.", "가 나."), [{ source: "A.\nB.", translation: "가 나." }]);
});

test("복사 — 번역문만 / 나란히 / 표(탭 구분 + HTML 표)", () => {
  const pairs = [
    { source: "Hello", translation: "안녕" },
    { source: 'Say "hi"\tnow', translation: "지금\n인사" },
  ];
  assert.deepEqual(tools.formatCopy(pairs, "translation"), { text: "안녕\n\n지금\n인사" });
  assert.deepEqual(tools.formatCopy(pairs, "pair"), { text: 'Hello\n안녕\n\nSay "hi"\tnow\n지금\n인사' });
  const table = tools.formatCopy(pairs, "table");
  assert.equal(table.text, '원문\t번역\nHello\t안녕\n"Say ""hi""\tnow"\t"지금\n인사"');
  assert.match(table.html, /^<table/);
  assert.match(table.html, /<th[^>]*>원문<\/th>/);
  assert.match(table.html, /Say &quot;hi&quot;/);
  assert.match(table.html, /지금<br>인사/);
  assert.deepEqual(tools.formatCopy(pairs, "모름"), tools.formatCopy(pairs, "translation"), "모르는 방식은 번역문만");
});

test("복사 방식 이름", () => {
  assert.deepEqual(tools.COPY_FORMATS, ["translation", "pair", "table"]);
  for (const format of tools.COPY_FORMATS) assert.ok(tools.COPY_FORMAT_NAMES[format]);
});

test("PDF 줄바꿈 — 짧은 제목 줄 뒤는 줄바꿈을 남긴다", () => {
  const pdf = "1. Purpose\nThis procedure describes the configuration manage-\nment of safety related software used in the\ninstrumentation and control system.";
  assert.equal(
    tools.joinBrokenLines(pdf),
    "1. Purpose\nThis procedure describes the configuration management of safety related software used in the instrumentation and control system.",
  );
});
