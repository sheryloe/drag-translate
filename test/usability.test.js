const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const source = (file) => readFileSync(join(root, file), "utf8");
const limits = require("../src/shared/page-limits.js");
const pdfUrl = require("../src/shared/pdf-url.js");
const config = require("../src/shared/config.js");
const engines = require("../src/shared/engines.js");
const tools = require("../src/shared/text-tools.js");

/* ── 크롬 내부 화면에서 「화면 영역 골라 번역」 ── */

test("확장 프로그램이 들어갈 수 없는 화면을 주소로 가른다", () => {
  const kind = (url) => limits.blockedKind(url, pdfUrl.isPdfUrl);
  assert.equal(kind(undefined), "internal", "크롬 내부 화면은 탭 주소를 주지 않는다");
  assert.equal(kind(""), "internal");
  assert.equal(kind("chrome://settings/"), "internal");
  assert.equal(kind("edge://extensions/"), "internal");
  assert.equal(kind("about:blank"), "internal");
  assert.equal(kind("chrome-extension://other/page.html"), "internal");
  assert.equal(kind("view-source:https://example.com/"), "internal");
  assert.equal(kind("https://chromewebstore.google.com/detail/abc"), "store");
  assert.equal(kind("https://chrome.google.com/webstore/detail/abc"), "store");
  assert.equal(kind("https://microsoftedge.microsoft.com/addons/detail/abc"), "store");
  assert.equal(kind("https://example.com/a.pdf"), "pdf", "크롬 기본 PDF 뷰어");
  assert.equal(kind("file:///D:/docs/a.html"), "file");
  assert.equal(kind("https://example.com/"), "reload", "설치 전부터 열려 있던 탭 등");
});

test("까닭마다 사람이 할 일을 알리고, 모르는 까닭은 새로 고침 안내로", () => {
  for (const name of ["internal", "store", "pdf", "file", "reload"]) {
    const message = limits.blockedMessage(name);
    assert.ok(message.length > 20, name);
    assert.doesNotMatch(message, /[A-Za-z]{4,}/, `${name}: 영문 상태어 없이 한글로`);
  }
  assert.match(limits.blockedMessage("pdf"), /번역 뷰어로 열기/);
  assert.match(limits.blockedMessage("file"), /파일 URL에 대한 액세스 허용/);
  assert.equal(limits.blockedMessage("<script>"), limits.blockedMessage("reload"), "주소로 넘어온 이름은 정해 둔 문구로만 바뀐다");
});

test("우클릭 「화면 영역 골라 번역」이 실패하면 조용히 끝내지 않고 까닭 창을 연다", () => {
  const background = source("src/background.js");
  const region = /case "dt-region":([\s\S]*?)return;/.exec(background);
  assert.ok(region, "dt-region 처리");
  assert.match(region[1], /catch \(error\)/);
  assert.match(region[1], /openNoticeWindow\(/);
  assert.match(background, /\?notice=\$\{encodeURIComponent\(kind\)\}/);
  assert.match(background, /"shared\/page-limits\.js"/, "서비스 워커가 까닭 모듈을 싣는다");
  const result = source("src/result/result.js");
  assert.match(result, /params\.has\("notice"\)/);
  assert.match(result, /DT\.pageLimits\.blockedMessage\(/);
  assert.match(source("src/result/result.html"), /page-limits\.js/);
});

/* ── 주소가 .pdf로 끝나지 않는 PDF ── */

test("콘텐츠 스크립트는 맨 위 화면이 PDF일 때만 서비스 워커에 알리고, 서비스 워커가 판단해 옮긴다", () => {
  const content = source("src/content/content.js");
  assert.match(content, /window === window\.top && \/\^application\\\/\(x-\)\?pdf\$\/i\.test\(document\.contentType/);
  assert.match(content, /type: "pdf-detected"/);
  const background = source("src/background.js");
  assert.match(background, /case "pdf-detected":\s*return onPdfDetected\(message, sender\);/);
  assert.match(background, /pdfUrl\.viewerDecision\(/);
  assert.match(background, /pdfUrl\.pdfHeaderRule\(VIEWER_PAGE\)/);
  // 응답 머리 규칙을 모르는 크롬(128 미만)에서는 주소 규칙만 다시 건다.
  assert.match(background, /catch \{\s*headerRuleActive = false;\s*await chrome\.declarativeNetRequest\.updateDynamicRules\(\{ removeRuleIds, addRules: \[urlRule\] \}\);/);
  // 「원래 뷰어로 보기」를 고른 주소는 콘텐츠 스크립트 쪽 옮기기에서도 뺀다.
  assert.match(background, /async function openNative[\s\S]*?OPTED_OUT_KEY/);
});

/* ── 긴 글(30,000자) ── */

test("한 번에 번역하는 양은 30,000자, 구글 조각은 5,000자 안쪽", () => {
  assert.equal(config.MAX_TEXT, 30000);
  assert.ok(config.GOOGLE_CHUNK <= 5000);
});

/** 줄글을 만든다 — 문장 n개, 문단마다 문장 k개. */
function prose(sentences, perParagraph) {
  const out = [];
  for (let i = 0; i < sentences; i += 1) {
    out.push(`Sentence number ${i} explains how the safety function is verified before release.`);
    if ((i + 1) % perParagraph === 0) out.push("\n\n");
    else out.push(" ");
  }
  return out.join("").trim();
}

const squash = (value) => value.replace(/\s+/g, " ").trim();

test("긴 글(30,000자)을 내 PC 조각(700자)·구글 조각(4,500자)으로 나눠도 빠지거나 겹치는 글이 없다", () => {
  const long = prose(1000, 7); // 약 8만 자
  const { text } = engines.clip(long, config.MAX_TEXT);
  assert.ok(text.length > 29000 && text.length <= 30000, String(text.length));
  for (const size of [tools.CHUNK_SIZE, config.GOOGLE_CHUNK]) {
    const chunks = tools.splitForTranslation(text, size);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.text.length <= size, `${size}: ${chunk.text.length}`);
    assert.equal(squash(chunks.map((chunk) => chunk.text + chunk.sep).join("")), squash(text), `${size}: 이어 붙이면 원래 글`);
    // 번역을 그대로 돌려준다고 치면 조립한 결과도 원래 글과 같다(문단 모양 유지).
    const assembled = tools.assemble(chunks, chunks.map((chunk) => chunk.text));
    assert.equal(assembled.text, text.replace(/\n{3,}/g, "\n\n"));
  }
  assert.ok(tools.splitForTranslation(text, tools.CHUNK_SIZE).length >= 43, "30,000자 ÷ 700자 → 마흔 조각 넘게");
});

test("진행 표시는 긴 글에서도 조각 수와 백분율이 맞는다", () => {
  const text = engines.clip(prose(1000, 7), config.MAX_TEXT).text;
  const total = tools.splitForTranslation(text, tools.CHUNK_SIZE).length;
  assert.equal(tools.progressLabel("내 PC에서 번역 중…", 0, total), `내 PC에서 번역 중… 0/${total} 조각 (0%)`);
  assert.equal(tools.progressLabel("내 PC에서 번역 중…", total, total), `내 PC에서 번역 중… ${total}/${total} 조각 (100%)`);
  // 조각이 하나씩 끝날 때 백분율은 줄지 않고 100을 넘지 않는다.
  let last = -1;
  for (let done = 0; done <= total; done += 1) {
    const percent = Number(/\((\d+)%\)/.exec(tools.progressLabel("번역 중…", done, total))[1]);
    assert.ok(percent >= last && percent <= 100, `${done}/${total} → ${percent}%`);
    last = percent;
  }
  assert.equal(tools.progressLabel("번역 중…", total + 5, total), `번역 중… ${total}/${total} 조각 (100%)`, "넘친 값은 끝으로");
  assert.equal(tools.progressLabel("번역 중…", 0, 1), "번역 중…", "조각이 하나면 조각 수를 보이지 않는다");
});

test("번역 창은 긴 구글 글을 조각으로 보내고, 잘린 양을 알림에 쓴다", () => {
  const card = source("src/ui/card.js");
  assert.match(card, /this\.text\.length > DT\.config\.GOOGLE_CHUNK\) return this\.translateChunks\(token, "google"\)/);
  assert.match(card, /DT\.engines\.clipNote\(this\.text\.length, this\.omitted\)/);
  assert.match(card, /DT\.text\.progressLabel\(/);
  // 클립보드 API가 막혀도 복사 이벤트로 HTML 표를 함께 넣는다.
  assert.match(card, /event\.clipboardData\.setData\("text\/html", html\)/);
});
