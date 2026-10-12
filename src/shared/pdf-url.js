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

  const api = { PDF_RULE_REGEX, isPdfUrl, viewerUrl, fileFromSearch, fileName };
  root.DT = Object.assign(root.DT || {}, { pdfUrl: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
