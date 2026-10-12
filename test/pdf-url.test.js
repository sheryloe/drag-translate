const test = require("node:test");
const assert = require("node:assert/strict");
const pdfUrl = require("../src/shared/pdf-url.js");

test("경로가 .pdf로 끝나는 http(s)·file 주소만 PDF로 본다", () => {
  assert.equal(pdfUrl.isPdfUrl("https://example.com/a/b.pdf"), true);
  assert.equal(pdfUrl.isPdfUrl("https://example.com/a/B.PDF?x=1#page=2"), true);
  assert.equal(pdfUrl.isPdfUrl("file:///D:/docs/report.pdf"), true);
  assert.equal(pdfUrl.isPdfUrl("https://example.com/a.pdf.html"), false);
  assert.equal(pdfUrl.isPdfUrl("https://example.com/view?file=a.pdf"), false);
  assert.equal(pdfUrl.isPdfUrl("chrome://settings"), false);
  assert.equal(pdfUrl.isPdfUrl(undefined), false);
});

test("요청 규칙의 정규식은 isPdfUrl과 같은 http(s) 주소를 잡는다", () => {
  // RE2와 자바스크립트 정규식이 같은 뜻인 문법만 쓴다.
  const rule = new RegExp(pdfUrl.PDF_RULE_REGEX);
  for (const url of ["https://example.com/a.pdf", "http://x.org/B.Pdf?y=1&z=2", "https://x.org/a.pdf?q=1"]) {
    assert.equal(rule.test(url), true, url);
  }
  for (const url of ["https://example.com/a.pdf.html", "https://x.org/view?file=a.pdf", "file:///a.pdf"]) {
    assert.equal(rule.test(url), false, url);
  }
});

test("뷰어 주소의 file 값은 인코딩된 것과 요청 규칙이 그대로 붙인 것을 둘 다 읽는다", () => {
  const original = "https://example.com/docs/a b.pdf?x=1&y=2";
  const encoded = pdfUrl.viewerUrl("chrome-extension://id/src/pdf/viewer.html", original);
  assert.equal(pdfUrl.fileFromSearch(new URL(encoded).search), original);
  assert.equal(pdfUrl.fileFromSearch("?file=https://example.com/a.pdf?x=1&y=2"), "https://example.com/a.pdf?x=1&y=2");
  assert.equal(pdfUrl.fileFromSearch(""), null);
  assert.equal(pdfUrl.fileFromSearch("?other=1"), null);
  assert.equal(pdfUrl.fileFromSearch("?file=%E0%A4%A"), null);
});

test("파일 이름은 주소 마지막 조각을 풀어 쓴다", () => {
  assert.equal(pdfUrl.fileName("https://x.org/a/%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf?x=1"), "보고서.pdf");
  assert.equal(pdfUrl.fileName("not a url"), "not a url");
});
