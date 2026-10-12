/* 글 다듬기 — PDF에서 깨진 줄바꿈 합치기, 원문·번역 짝짓기, 복사 모양 만들기.
 * 순수 함수만 두어 노드 시험으로 확인한다. */
(function (root) {
  "use strict";

  /** 줄 머리의 목록 기호 — 이런 줄은 앞 줄에 붙이지 않는다. */
  const LIST_MARK = /^(?:[-–•*·▪●○◦■□►▶※]|\d{1,3}[.)]|\(\d{1,3}\)|[a-zA-Z][.)]|[ⅰ-ⅻⅠ-Ⅻ①-⑳]|[가-하][.)])\s/;
  /** 문장 끝 표시. */
  const SENTENCE_END = /[.!?。！？:;…"”’)\]」』]$/;
  /** 띄어 쓰지 않는 글자(한자·가나) — 둘 사이에서 줄이 끊겼으면 빈칸 없이 붙인다. */
  const NO_SPACE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

  /** PDF에서 줄 끝마다 끊긴 문장을 합친다.
   *  - 빈 줄은 문단 나눔으로 남긴다.
   *  - 줄 끝 하이픈 + 다음 줄이 소문자로 시작 → 하이픈을 빼고 붙인다(trans-\nlation → translation).
   *  - 목록 기호로 시작하는 줄, 문장이 끝나고 눈에 띄게 짧은 줄(문단 끝) 뒤는 줄바꿈을 남긴다.
   *  - 나머지는 한 칸 띄어 잇는다(한자·가나끼리는 붙인다). */
  function joinBrokenLines(text) {
    const blocks = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/);
    return blocks
      .map((block) => {
        const lines = block.split("\n").map((line) => line.replace(/[ \t ]+$/g, "").replace(/^[ \t ]+/g, ""));
        const longest = Math.max(0, ...lines.map((line) => line.length));
        let out = "";
        let prev = "";
        for (const line of lines) {
          if (!line) continue;
          if (!out) {
            out = line;
          } else if (LIST_MARK.test(line) || (SENTENCE_END.test(prev) && prev.length < longest * 0.7)) {
            out += `\n${line}`;
          } else if (/[A-Za-zÀ-ɏ]-$/.test(prev) && /^[a-zß-ÿ]/.test(line)) {
            out = out.slice(0, -1) + line;
          } else if (NO_SPACE.test(prev.slice(-1)) && NO_SPACE.test(line[0])) {
            out += line;
          } else {
            out += ` ${line}`;
          }
          prev = line;
        }
        return out;
      })
      .filter(Boolean)
      .join("\n\n");
  }

  /** 문단 나누기 — 줄바꿈 하나 이상을 문단 경계로 본다. */
  function paragraphs(text) {
    return String(text ?? "")
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /** 원문·번역을 문단끼리 짝짓는다. 문단 수가 다르면 통째로 한 짝으로 둔다(어긋난 짝보다 낫다). */
  function pairParagraphs(source, translation) {
    const left = paragraphs(source);
    const right = paragraphs(translation);
    if (left.length && left.length === right.length) return left.map((text, index) => ({ source: text, translation: right[index] }));
    return [{ source: String(source ?? "").trim(), translation: String(translation ?? "").trim() }];
  }

  const COPY_FORMATS = Object.freeze(["translation", "pair", "table"]);
  const COPY_FORMAT_NAMES = Object.freeze({ translation: "번역문만", pair: "원문과 번역 나란히", table: "표(원문|번역)" });

  /** 탭 구분 칸 — 탭·줄바꿈·따옴표가 있으면 따옴표로 감싼다(엑셀이 한 칸으로 읽는다). */
  function tsvCell(value) {
    const text = String(value ?? "");
    return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

  /** 복사할 글 만들기. table은 엑셀·한글이 표로 붙여 넣도록 탭 구분 글과 HTML 표를 함께 만든다. */
  function formatCopy(pairs, format) {
    const list = Array.isArray(pairs) ? pairs.filter((pair) => pair && (pair.source || pair.translation)) : [];
    if (format === "pair") {
      return { text: list.map((pair) => `${pair.source}\n${pair.translation}`).join("\n\n") };
    }
    if (format === "table") {
      const rows = [["원문", "번역"], ...list.map((pair) => [pair.source, pair.translation])];
      const text = rows.map((row) => row.map(tsvCell).join("\t")).join("\n");
      const cell = (tag, value) => `<${tag} style="border:1px solid #999;padding:4px 6px;vertical-align:top">${escapeHtml(value).replace(/\n/g, "<br>")}</${tag}>`;
      const html =
        '<table style="border-collapse:collapse">' +
        rows.map((row, index) => `<tr>${row.map((value) => cell(index === 0 ? "th" : "td", value)).join("")}</tr>`).join("") +
        "</table>";
      return { text, html };
    }
    return { text: list.map((pair) => pair.translation).join("\n\n") };
  }

  const api = { joinBrokenLines, paragraphs, pairParagraphs, COPY_FORMATS, COPY_FORMAT_NAMES, tsvCell, formatCopy };
  root.DT = Object.assign(root.DT || {}, { text: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
