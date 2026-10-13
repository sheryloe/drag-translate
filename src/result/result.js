/* 결과 창 — 크롬 기본 PDF 뷰어처럼 번역 창을 띄울 수 없는 곳에서 우클릭 「구글로 번역」·「내 PC로 번역」을 고르면 열린다.
 * 번역할 글은 주소의 # 뒤에, 엔진은 ?engine= 에 담겨 온다.
 * ?notice=까닭 으로 열리면 번역 대신 「이 화면에서는 안 되는 까닭」만 보인다(우클릭 「화면 영역 골라 번역」). */
(async function () {
  "use strict";

  const DT = globalThis.DT;
  const params = new URLSearchParams(location.search);
  const card = new DT.ui.TranslateCard({ inline: document.getElementById("root") });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.close();
  });

  if (params.has("notice")) {
    // 까닭 이름만 받아 정해 둔 문구로 바꾼다(주소에 담긴 글을 그대로 보이지 않는다).
    card.notice(DT.pageLimits.blockedMessage(params.get("notice")), null, "error");
    return;
  }

  let text = "";
  try {
    text = decodeURIComponent(location.hash.slice(1));
  } catch {
    text = location.hash.slice(1);
  }
  const settings = await DT.config.load();
  const engine = params.get("engine") === "local" ? "local" : "google";
  card.open(text, { ...settings, engine });
})();
