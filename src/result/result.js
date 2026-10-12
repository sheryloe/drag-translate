/* 결과 창 — 크롬 기본 PDF 뷰어처럼 번역 창을 띄울 수 없는 곳에서 우클릭 「구글로 번역」·「내 PC로 번역」을 고르면 열린다.
 * 번역할 글은 주소의 # 뒤에, 엔진은 ?engine= 에 담겨 온다. */
(async function () {
  "use strict";

  const DT = globalThis.DT;
  let text = "";
  try {
    text = decodeURIComponent(location.hash.slice(1));
  } catch {
    text = location.hash.slice(1);
  }
  const settings = await DT.config.load();
  const card = new DT.ui.TranslateCard({ inline: document.getElementById("root") });
  const engine = new URLSearchParams(location.search).get("engine") === "local" ? "local" : "google";
  card.open(text, { ...settings, engine });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.close();
  });
})();
