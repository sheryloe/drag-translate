/* 웹 페이지에 붙는 콘텐츠 스크립트 — 드래그하면 번역 창을 띄우고, 우클릭 메뉴의 「번역」·「화면 영역 골라 번역」 요청을 받는다. */
(function () {
  "use strict";

  if (window.__dragTranslateLoaded) return;
  window.__dragTranslateLoaded = true;

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
