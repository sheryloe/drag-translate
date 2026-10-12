/* 웹 페이지에 붙는 콘텐츠 스크립트 — 드래그하면 번역 창을 띄우고, 우클릭 메뉴의 「번역」 요청을 받는다. */
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
  });
})();
