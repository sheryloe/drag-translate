/* 웹 페이지에 붙는 콘텐츠 스크립트 — 드래그하면 번역 창을 띄우고, 우클릭 메뉴의 「번역」·「화면 영역 골라 번역」 요청을 받는다. */
(function () {
  "use strict";

  if (window.__dragTranslateLoaded) return;
  window.__dragTranslateLoaded = true;

  // 주소가 .pdf로 끝나지 않는 PDF(download?id=123 같은 것) — 맨 위 화면이 PDF면 서비스 워커에 알린다.
  // 옮길지는 서비스 워커가 정한다(설정·「원래 뷰어로 보기」·되돌림 막기·요청 규칙이 이미 맡았는지).
  if (window === window.top && /^application\/(x-)?pdf$/i.test(document.contentType || "")) {
    chrome.runtime.sendMessage({ type: "pdf-detected", contentType: document.contentType }).catch(() => {});
  }

  const translator = globalThis.DT.ui.attachSelectionTranslator();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "show-card" && typeof message.text === "string") {
      translator.openText(message.text, message.engine);
      sendResponse({ ok: true });
    }
    if (message && message.type === "pick-region" && window === window.top) {
      // 화면 영역 번역 — 서비스 워커가 보이는 탭을 찍어 고른 영역만 잘라 준다.
      sendResponse({ ok: true });
      globalThis.DT.region.translateRegion(translator, (rect) => globalThis.DT.bridge.captureRegion(rect, window.innerWidth));
    }
  });
})();
