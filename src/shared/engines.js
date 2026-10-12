/* 번역 엔진 — 구글은 그 자리에서 번역하고, 파파고는 웹사이트 주소를 만든다.
 * 요청 만들기·응답 읽기는 순수 함수로 두어 노드 시험으로 확인한다. */
(function (root) {
  "use strict";

  const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

  /** 너무 긴 선택은 앞부분만 쓴다. clipped가 true면 화면에 알린다. */
  function clip(text, max) {
    const clean = String(text ?? "").replace(/\s+\n/g, "\n").trim();
    if (clean.length <= max) return { text: clean, clipped: false };
    return { text: clean.slice(0, max), clipped: true };
  }

  /** 구글 번역 요청 — 긴 글도 주소 길이에 걸리지 않게 본문(POST)으로 보낸다. */
  function googleRequest(text, target, source = "auto") {
    const url = `${GOOGLE_ENDPOINT}?client=gtx&dt=t&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}`;
    return {
      url,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `q=${encodeURIComponent(text)}`,
      },
    };
  }

  /** 구글 응답 읽기 — [0]은 문장 조각 목록([번역, 원문, …]), [2]는 감지된 원문 언어. */
  function parseGoogle(data) {
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("구글 번역 응답의 모양이 예상과 다릅니다.");
    }
    const text = data[0].map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : "")).join("");
    if (!text.trim()) throw new Error("구글 번역이 빈 결과를 돌려주었습니다.");
    return { text, detected: typeof data[2] === "string" ? data[2] : null };
  }

  async function translateGoogle(text, target, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const { url, init } = googleRequest(text, target);
    let response;
    try {
      response = await doFetch(url, init);
    } catch {
      throw new Error("구글 번역 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    }
    if (response.status === 429) throw new Error("요청이 너무 잦아 구글이 잠시 막았습니다. 조금 뒤 다시 시도해 주세요.");
    if (!response.ok) throw new Error(`구글 번역 서버가 ${response.status} 오류로 응답했습니다.`);
    return parseGoogle(await response.json());
  }

  /** 파파고 웹사이트 주소 — sk(원문 언어)·tk(번역 언어)·st(글)를 미리 채워 연다. */
  function papagoWebUrl(text, target, source = "auto") {
    return `https://papago.naver.com/?sk=${encodeURIComponent(source)}&tk=${encodeURIComponent(target)}&st=${encodeURIComponent(text)}`;
  }

  /** 구글 번역 웹사이트 주소 — 결과를 더 자세히 보고 싶을 때. */
  function googleWebUrl(text, target, source = "auto") {
    return `https://translate.google.com/?sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}&op=translate`;
  }

  const api = { GOOGLE_ENDPOINT, clip, googleRequest, parseGoogle, translateGoogle, papagoWebUrl, googleWebUrl };
  root.DT = Object.assign(root.DT || {}, { engines: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
