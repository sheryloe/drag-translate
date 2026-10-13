/* 확장 프로그램이 손댈 수 없는 화면 — 「화면 영역 골라 번역」이 듣지 않을 때 그 까닭을 사람 말로 알린다.
 * 서비스 워커(importScripts)·결과 창·노드 시험이 함께 쓴다. 순수 함수만 둔다. */
(function (root) {
  "use strict";

  /** 크롬이 확장 프로그램을 막는 웹 스토어 주소. */
  const STORE_PREFIXES = Object.freeze([
    "https://chromewebstore.google.com/",
    "https://chrome.google.com/webstore",
    "https://microsoftedge.microsoft.com/addons",
  ]);

  /** 브라우저 내부 화면의 주소 머리. */
  const INTERNAL_SCHEMES = /^(chrome|edge|about|brave|opera|vivaldi|whale|devtools|view-source|chrome-search|chrome-untrusted|chrome-extension|extension):/i;

  const MESSAGES = Object.freeze({
    internal:
      "이 화면은 크롬 내부 화면(설정·새 탭·확장 프로그램 관리 등)이라 확장 프로그램이 들어갈 수 없습니다. 번역할 웹 페이지나 PDF 번역 뷰어에서 다시 해 주세요.",
    store: "크롬 웹 스토어 화면은 크롬이 확장 프로그램을 막아 둡니다. 다른 탭에서 다시 해 주세요.",
    pdf: "크롬 기본 PDF 뷰어에서는 영역을 고를 수 없습니다. 우클릭 「이 PDF를 번역 뷰어로 열기」로 연 뒤 다시 해 주세요.",
    file:
      "내 컴퓨터의 파일 화면에서 쓰려면 권한이 하나 더 필요합니다. 크롬 확장 프로그램 관리 화면에서 「드래그 번역」의 「세부정보」를 열고 「파일 URL에 대한 액세스 허용」을 켠 뒤 이 탭을 새로 고쳐 주세요.",
    reload:
      "이 탭에는 아직 드래그 번역이 붙지 않았습니다. 설치·갱신 전부터 열려 있던 탭이면 새로 고친 뒤 다시 해 주세요. 그래도 안 되면 회사 정책으로 확장 프로그램이 막힌 사이트일 수 있습니다.",
  });

  /** 탭 주소로 까닭을 가른다. 「모든 사이트」 권한이 있어도 크롬 내부 화면은 탭 주소를 주지 않으므로 빈 주소도 내부 화면으로 본다. */
  function blockedKind(url, isPdf) {
    const value = typeof url === "string" ? url.trim() : "";
    if (!value) return "internal";
    if (STORE_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix.toLowerCase()))) return "store";
    if (INTERNAL_SCHEMES.test(value)) return "internal";
    if (typeof isPdf === "function" && isPdf(value)) return "pdf";
    if (/^file:/i.test(value)) return "file";
    return "reload";
  }

  function blockedMessage(kind) {
    return MESSAGES[kind] || MESSAGES.reload;
  }

  const api = { STORE_PREFIXES, MESSAGES, blockedKind, blockedMessage };
  root.DT = Object.assign(root.DT || {}, { pageLimits: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
