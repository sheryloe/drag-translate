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
          // 앞 줄이 폭의 60%도 안 되면 문장 중간에서 끊긴 줄이 아니라 제목·문단 끝이다(PDF 본문 줄은 거의 꽉 찬다).
          const shortLine = longest >= 30 && prev.length < longest * 0.6;
          if (!out) {
            out = line;
          } else if (/[A-Za-zÀ-ɏ]-$/.test(prev) && /^[a-zß-ÿ]/.test(line)) {
            out = out.slice(0, -1) + line;
          } else if (LIST_MARK.test(line) || shortLine || (SENTENCE_END.test(prev) && prev.length < longest * 0.7)) {
            out += `\n${line}`;
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

  /* ── 긴 글 나누기(6단계) ── */

  /** 한 번에 보내는 글자 수 — 작은 모델이 문맥 2048 안에서 지시문·원문·번역을 모두 담고 빨리 답하는 크기. */
  const CHUNK_SIZE = 700;

  /** 문장 끝에서 자른다. 문장 하나가 max보다 길면 빈칸 자리에서, 그것도 없으면 max에서 자른다. */
  function splitSentences(paragraph, max) {
    const sentences = paragraph.split(/(?<=[.!?。！？…])\s+/).filter(Boolean);
    const pieces = [];
    let current = "";
    const push = (piece) => {
      if (piece) pieces.push(piece);
    };
    for (let sentence of sentences) {
      while (sentence.length > max) {
        const cut = sentence.lastIndexOf(" ", max) > max / 2 ? sentence.lastIndexOf(" ", max) : max;
        push(current);
        current = "";
        push(sentence.slice(0, cut).trim());
        sentence = sentence.slice(cut).trim();
      }
      if (current && current.length + 1 + sentence.length > max) {
        push(current);
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    push(current);
    return pieces;
  }

  /** 번역용으로 나누기 — 짧은 문단은 줄바꿈째 묶어 요청 수를 줄이고, 긴 문단은 문장 단위로 자른다.
   *  돌려주는 조각마다 sep(뒤에 붙일 이음새)이 있어 번역을 같은 모양으로 이어 붙일 수 있다.
   *  sep이 " "이면 한 문단을 문장으로 나눈 것이다. */
  function splitForTranslation(text, max = CHUNK_SIZE) {
    const source = String(text ?? "").trim();
    if (!source) return [];
    const parts = source.split(/(\n+)/); // [문단, 이음새, 문단, …]
    const chunks = [];
    let group = "";
    let groupSep = "";
    const flush = (sep) => {
      if (group) chunks.push({ text: group, sep });
      group = "";
    };
    for (let i = 0; i < parts.length; i += 2) {
      const paragraph = parts[i].trim();
      const sep = parts[i + 1] ? (parts[i + 1].length > 1 ? "\n\n" : "\n") : "";
      if (!paragraph) continue;
      if (paragraph.length > max) {
        flush(groupSep);
        const pieces = splitSentences(paragraph, max);
        pieces.forEach((piece, index) => chunks.push({ text: piece, sep: index < pieces.length - 1 ? " " : sep }));
        continue;
      }
      if (group && group.length + groupSep.length + paragraph.length > max) flush(groupSep);
      group = group ? `${group}${groupSep}${paragraph}` : paragraph;
      groupSep = sep;
    }
    flush("");
    if (chunks.length) chunks[chunks.length - 1].sep = "";
    return chunks;
  }

  /** 조각 번역을 이어 붙이고, 복사용 원문·번역 짝을 만든다(문장으로 나눈 조각은 다시 한 문단으로 합친다). */
  function assemble(chunks, translations) {
    let text = "";
    const pairs = [];
    let carry = null; // 문장 단위로 나눈 문단을 모으는 중
    chunks.forEach((chunk, index) => {
      const translated = String(translations[index] ?? "").trim();
      text += translated + chunk.sep;
      if (chunk.sep === " " || carry) {
        carry = carry ? { source: `${carry.source} ${chunk.text}`, translation: `${carry.translation} ${translated}` } : { source: chunk.text, translation: translated };
        if (chunk.sep !== " ") {
          pairs.push(carry);
          carry = null;
        }
        return;
      }
      pairs.push(...pairParagraphs(chunk.text, translated));
    });
    if (carry) pairs.push(carry);
    return { text: text.trim(), pairs };
  }

  /* ── 용어집(6단계) ── */

  /** 「원어 = 번역어」 줄을 읽는다. 빈 줄·# 주석·= 없는 줄은 건너뛴다. */
  function parseGlossary(raw) {
    const entries = [];
    for (const line of String(raw ?? "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at <= 0) continue;
      const source = trimmed.slice(0, at).trim();
      const target = trimmed.slice(at + 1).replace(/^>/, "").trim();
      if (source && target) entries.push({ source, target });
    }
    return entries;
  }

  /** 이 글에 나오는 용어만 지시문에 넣는다(짧은 지시문이 작은 모델에 낫다).
   *  원어가 나오면 「원어 = 번역어」, 번역어 쪽이 나오면(반대 방향 번역) 「번역어 = 원어」로 넣는다. */
  function glossaryLinesFor(entries, text, limit = 40) {
    const haystack = String(text ?? "").toLowerCase();
    const lines = [];
    for (const { source, target } of entries || []) {
      if (lines.length >= limit) break;
      if (haystack.includes(source.toLowerCase())) lines.push(`${source} = ${target}`);
      else if (haystack.includes(target.toLowerCase())) lines.push(`${target} = ${source}`);
    }
    return lines;
  }

  const api = {
    joinBrokenLines,
    paragraphs,
    pairParagraphs,
    COPY_FORMATS,
    COPY_FORMAT_NAMES,
    tsvCell,
    formatCopy,
    CHUNK_SIZE,
    splitForTranslation,
    assemble,
    parseGlossary,
    glossaryLinesFor,
  };
  root.DT = Object.assign(root.DT || {}, { text: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
