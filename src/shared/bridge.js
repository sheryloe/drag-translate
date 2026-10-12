/* 화면(웹 페이지·PDF 뷰어·결과 창)이 서비스 워커에 일을 맡기는 길.
 * 번역 요청은 확장 권한이 있는 서비스 워커가 보내야 페이지의 보안 정책(CORS)에 막히지 않는다. */
(function (root) {
  "use strict";

  async function call(message) {
    let reply;
    try {
      reply = await chrome.runtime.sendMessage(message);
    } catch {
      throw new Error("확장 프로그램이 다시 로드되었습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.");
    }
    if (!reply || reply.ok !== true) throw new Error((reply && reply.error) || "알 수 없는 오류가 났습니다.");
    return reply;
  }

  const api = {
    translate: (text, targetLang, engine) => call({ type: "translate", text, targetLang, engine }),
    testLocal: (opts) => call({ type: "local-test", opts }),
    listLocalModels: () => call({ type: "local-models" }),
    captureRegion: (rect, viewportWidth) => call({ type: "capture-region", rect, viewportWidth }),
    ocrImage: (image, mime) => call({ type: "ocr-image", image, mime }),
    startRegion: (tabId) => call({ type: "start-region", tabId }),
    createLocalModel: (name) => call({ type: "local-create", name }),
    openTab: (url) => call({ type: "open-tab", url }),
  };
  root.DT = Object.assign(root.DT || {}, { bridge: api });
})(globalThis);
