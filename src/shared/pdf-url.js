/* PDF 주소 — 번역 뷰어로 열지 판단하고, 뷰어 주소를 만들고 읽는다. */
(function (root) {
  "use strict";

  /** 크롬 요청 규칙(declarativeNetRequest, RE2 문법)에 그대로 쓰는 식 — 경로가 .pdf로 끝나는 http(s) 주소.
   *  경로에는 ?를 넣지 않는다. 그래야 "view?file=a.pdf"처럼 쿼리 값만 .pdf로 끝나는 페이지를 잡지 않는다. */
  const PDF_RULE_REGEX = "^https?://[^?#]*\\.[Pp][Dd][Ff](\\?[^#]*)?$";

  function isPdfUrl(url) {
    if (typeof url !== "string") return false;
    const path = url.split(/[?#]/)[0];
    return /^(https?|file):\/\//i.test(url) && /\.pdf$/i.test(path);
  }

  /** 뷰어 주소 — file 값은 인코딩해서 붙인다. */
  function viewerUrl(viewerBase, fileUrl) {
    return `${viewerBase}?file=${encodeURIComponent(fileUrl)}`;
  }

  /** 뷰어가 받은 location.search에서 PDF 주소를 꺼낸다.
   *  요청 규칙이 돌린 주소는 원래 주소가 인코딩 없이(?file=https://…?a=1&b=2) 붙어 오고,
   *  팝업·우클릭 메뉴가 연 주소는 인코딩되어(?file=https%3A…) 온다. 둘 다 읽는다. */
  function fileFromSearch(search) {
    if (typeof search !== "string" || !search.startsWith("?file=")) return null;
    const raw = search.slice("?file=".length);
    if (!raw) return null;
    if (/^(https?|file):/i.test(raw)) return raw;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  /** 주소에서 보기 좋은 파일 이름. */
  function fileName(url) {
    try {
      const path = new URL(url).pathname;
      const last = decodeURIComponent(path.split("/").pop() || "");
      return last || url;
    } catch {
      return url;
    }
  }

  /* ── 주소가 .pdf로 끝나지 않는 PDF(download?id=123 같은 것) ──
   * 크롬 128부터는 요청 규칙이 응답 머리(Content-Type)를 볼 수 있어 그것으로 돌린다.
   * 그보다 오래된 크롬에서는 콘텐츠 스크립트가 document.contentType을 보고 서비스 워커에 알린다. */

  /** 요청 규칙 번호 — 1: 주소가 .pdf, 2: 내 PC 서버 출처(local-llm.js), 3: 응답 머리가 PDF. */
  const PDF_HEADER_RULE_ID = 3;

  /** PDF로 보는 Content-Type 값(규칙의 values 문법 — 대소문자 구분 없음, *는 아무 글자). */
  const PDF_CONTENT_TYPES = Object.freeze(["application/pdf", "application/pdf;*", "application/x-pdf", "application/x-pdf;*"]);

  function isPdfContentType(value) {
    return typeof value === "string" && /^\s*application\/(x-)?pdf\s*(;|$)/i.test(value);
  }

  /** 응답 머리가 PDF인 http(s) 화면을 뷰어로 돌리는 규칙.
   *  - GET만: POST로 만든 PDF는 뷰어가 같은 내용을 다시 받을 수 없다.
   *  - 「내려받기」(Content-Disposition: attachment)는 크롬이 파일로 저장하는 응답이라 건드리지 않는다.
   *  - main_frame만: 뷰어가 PDF를 받는 요청(xmlhttprequest)은 잡지 않으므로 되돌림이 돌지 않는다. */
  function pdfHeaderRule(viewerBase) {
    return {
      id: PDF_HEADER_RULE_ID,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: `${viewerBase}?file=\\0` } },
      condition: {
        regexFilter: "^https?://.*$",
        resourceTypes: ["main_frame"],
        requestMethods: ["get"],
        responseHeaders: [{ header: "content-type", values: [...PDF_CONTENT_TYPES] }],
        excludedResponseHeaders: [{ header: "content-disposition", values: ["attachment*"] }],
      },
    };
  }

  /** 되돌림 막기 — 같은 탭에서 같은 주소를 이 시간 안에 다시 돌리지 않는다. */
  const REDIRECT_GUARD_MS = 15_000;

  /** 콘텐츠 스크립트가 「이 화면은 PDF」라고 알려 왔을 때 뷰어로 옮길지 정한다.
   *  reason: open(옮김) · off(설정 꺼짐) · not-top(틀 안) · not-pdf · viewer(이미 뷰어)
   *  · scheme(http(s)만 — file은 권한 문제로 뺌) · rule(요청 규칙이 이미 맡는 주소)
   *  · opted-out(「원래 뷰어로 보기」를 고른 주소) · loop(방금 옮긴 주소) */
  function viewerDecision(input) {
    const value = input || {};
    const url = typeof value.url === "string" ? value.url : "";
    const reason = (() => {
      if (!value.enabled || !value.autoOpen) return "off";
      if (value.frameId !== 0) return "not-top";
      if (!isPdfContentType(value.contentType)) return "not-pdf";
      if (value.viewerBase && url.startsWith(value.viewerBase)) return "viewer";
      if (!/^https?:\/\//i.test(url)) return "scheme";
      if (value.headerRule || isPdfUrl(url)) return "rule";
      if (Array.isArray(value.optedOut) && value.optedOut.includes(url)) return "opted-out";
      const recent = value.recent;
      if (recent && recent.url === url && Number(value.now) - Number(recent.at) < REDIRECT_GUARD_MS) return "loop";
      return "open";
    })();
    return { open: reason === "open", reason };
  }

  const api = {
    PDF_RULE_REGEX,
    PDF_HEADER_RULE_ID,
    PDF_CONTENT_TYPES,
    REDIRECT_GUARD_MS,
    isPdfUrl,
    isPdfContentType,
    pdfHeaderRule,
    viewerDecision,
    viewerUrl,
    fileFromSearch,
    fileName,
  };
  root.DT = Object.assign(root.DT || {}, { pdfUrl: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
