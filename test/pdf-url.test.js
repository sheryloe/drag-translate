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

test("Content-Type이 PDF인지 가린다", () => {
  for (const value of ["application/pdf", "Application/PDF", "application/pdf; charset=binary", "application/x-pdf"]) {
    assert.equal(pdfUrl.isPdfContentType(value), true, value);
  }
  for (const value of ["text/html", "application/pdfx", "application/octet-stream", "", undefined]) {
    assert.equal(pdfUrl.isPdfContentType(value), false, String(value));
  }
});

test("응답 머리 규칙 — GET·맨 위 화면·PDF Content-Type만, 내려받기(attachment)는 빼고 뷰어로 돌린다", () => {
  const viewer = "chrome-extension://abc/src/pdf/viewer.html";
  const rule = pdfUrl.pdfHeaderRule(viewer);
  assert.equal(rule.id, pdfUrl.PDF_HEADER_RULE_ID);
  assert.notEqual(rule.id, 1, "주소 규칙(1)과 다른 번호");
  assert.notEqual(rule.id, require("../src/shared/local-llm.js").ORIGIN_RULE_ID, "출처 규칙과 다른 번호");
  assert.equal(rule.action.type, "redirect");
  assert.equal(rule.action.redirect.regexSubstitution, `${viewer}?file=\\0`);
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"], "뷰어가 PDF를 받는 요청(xmlhttprequest)은 잡지 않는다 — 되돌림 없음");
  assert.deepEqual(rule.condition.requestMethods, ["get"]);
  assert.deepEqual(rule.condition.responseHeaders, [{ header: "content-type", values: ["application/pdf", "application/pdf;*", "application/x-pdf", "application/x-pdf;*"] }]);
  assert.deepEqual(rule.condition.excludedResponseHeaders, [{ header: "content-disposition", values: ["attachment*"] }]);
  // http(s)만 잡는다 — file:// 와 확장 화면은 빠진다.
  const filter = new RegExp(rule.condition.regexFilter);
  assert.equal(filter.test("https://intra.example.com/download?id=123"), true);
  assert.equal(filter.test("file:///D:/a.pdf"), false);
  assert.equal(filter.test(`${viewer}?file=https://x`), false);
  // 돌린 주소를 뷰어가 그대로 읽는다(\0 자리에 원래 주소가 인코딩 없이 붙는다).
  const original = "https://intra.example.com/download?id=123&type=pdf";
  const redirected = rule.action.redirect.regexSubstitution.replace("\\0", original);
  assert.equal(pdfUrl.fileFromSearch(new URL(redirected).search), original);
});

test("콘텐츠 스크립트가 알린 PDF — 옮길 때와 막을 때를 가른다", () => {
  const viewerBase = "chrome-extension://abc/src/pdf/viewer.html";
  const base = {
    url: "https://intra.example.com/download?id=123",
    contentType: "application/pdf",
    frameId: 0,
    enabled: true,
    autoOpen: true,
    headerRule: false,
    viewerBase,
    optedOut: [],
    recent: null,
    now: 100_000,
  };
  const reason = (patch) => pdfUrl.viewerDecision({ ...base, ...patch }).reason;
  assert.deepEqual(pdfUrl.viewerDecision(base), { open: true, reason: "open" });
  assert.equal(reason({ enabled: false }), "off");
  assert.equal(reason({ autoOpen: false }), "off");
  assert.equal(reason({ frameId: 3 }), "not-top", "틀(iframe) 속 PDF는 옮기지 않는다");
  assert.equal(reason({ contentType: "text/html" }), "not-pdf");
  assert.equal(reason({ url: `${viewerBase}?file=https://x` }), "viewer", "이미 뷰어 안");
  assert.equal(reason({ url: "file:///D:/docs/a" }), "scheme", "내 컴퓨터 PDF는 권한 문제로 옮기지 않는다");
  assert.equal(reason({ headerRule: true }), "rule", "크롬 128 이상은 요청 규칙이 맡는다");
  assert.equal(reason({ url: "https://x.org/a.pdf" }), "rule", "주소가 .pdf면 주소 규칙이 맡는다");
  assert.equal(reason({ optedOut: [base.url] }), "opted-out", "「원래 뷰어로 보기」를 고른 주소");
  assert.equal(reason({ recent: { url: base.url, at: base.now - 2000 } }), "loop", "방금 옮긴 주소를 다시 옮기지 않는다");
  assert.equal(reason({ recent: { url: base.url, at: base.now - pdfUrl.REDIRECT_GUARD_MS - 1 } }), "open", "시간이 지나면 다시 옮긴다");
  assert.equal(reason({ recent: { url: "https://other", at: base.now } }), "open");
  assert.equal(pdfUrl.viewerDecision(undefined).reason, "off");
});

test("파일 이름은 주소 마지막 조각을 풀어 쓴다", () => {
  assert.equal(pdfUrl.fileName("https://x.org/a/%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf?x=1"), "보고서.pdf");
  assert.equal(pdfUrl.fileName("not a url"), "not a url");
});
