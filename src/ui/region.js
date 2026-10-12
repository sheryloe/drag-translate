/* 화면 영역 고르기 — 화면 위에 덮개를 깔고 사용자가 끈 사각형을 돌려준다(그림 속 글자 번역용).
 * 웹 페이지(콘텐츠 스크립트)와 PDF 번역 뷰어가 함께 쓴다. 고른 영역은 화면 좌표(CSS 픽셀)다. */
(function (root) {
  "use strict";

  const DT = root.DT;
  const MIN_SIZE = 8;

  const STYLE = `
    :host { all: initial; }
    .veil {
      position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair;
      background: rgba(10, 16, 28, 0.25); user-select: none; -webkit-user-select: none;
      font-family: Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;
    }
    .hint {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      background: #1f2430; color: #e8ebf2; font-size: 14px; padding: 8px 14px; border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); pointer-events: none; white-space: nowrap;
    }
    .box {
      position: fixed; border: 2px solid #6c9cff; background: rgba(108, 156, 255, 0.12);
      box-shadow: 0 0 0 9999px rgba(10, 16, 28, 0.25); pointer-events: none;
    }
    [hidden] { display: none !important; }
  `;

  let active = null;

  /** 사각형 하나를 고르게 한다. Esc·오른쪽 단추·너무 작은 끌기는 취소(null). */
  function pick() {
    if (active) return active;
    active = new Promise((resolve) => {
      const host = document.createElement("div");
      host.setAttribute("data-drag-translate-region", "");
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      const veil = document.createElement("div");
      veil.className = "veil";
      veil.setAttribute("role", "dialog");
      veil.setAttribute("aria-label", "번역할 화면 영역 고르기");
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "번역할 글자가 있는 영역을 끌어서 고르세요 · Esc 취소";
      const box = document.createElement("div");
      box.className = "box";
      box.hidden = true;
      veil.append(hint, box);
      shadow.append(style, veil);
      document.documentElement.append(host);

      let start = null;
      let rect = null;
      const finish = (value) => {
        window.removeEventListener("keydown", onKey, true);
        host.remove();
        active = null;
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      };
      window.addEventListener("keydown", onKey, true);
      veil.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        finish(null);
      });
      veil.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return finish(null);
        event.preventDefault();
        veil.setPointerCapture(event.pointerId);
        start = { x: event.clientX, y: event.clientY };
        rect = { x: start.x, y: start.y, width: 0, height: 0 };
        hint.hidden = true;
      });
      veil.addEventListener("pointermove", (event) => {
        if (!start) return;
        rect = {
          x: Math.min(start.x, event.clientX),
          y: Math.min(start.y, event.clientY),
          width: Math.abs(event.clientX - start.x),
          height: Math.abs(event.clientY - start.y),
        };
        Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        box.hidden = false;
      });
      veil.addEventListener("pointerup", () => {
        if (!start) return;
        start = null;
        finish(rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE ? rect : null);
      });
      veil.focus && veil.focus();
    });
    return active;
  }

  /** 덮개가 화면에서 완전히 사라질 때까지 기다린다(찍을 때 덮개가 함께 찍히지 않게). */
  const afterPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));

  /** 고른 영역 아래쪽 왼편 — 번역 창을 띄울 자리. */
  const anchorOf = (rect) => ({ clientX: rect.x, clientY: rect.y + rect.height });

  const errorText = (error) => (error && error.message ? error.message : String(error));

  /** 화면 영역 번역 한 번 — 영역 고르기 → 찍기(capture) → 내 PC 모델로 글자 읽기 → 번역 창.
   *  capture(rect)는 { image(base64), mime }을 돌려준다. 웹 페이지는 서비스 워커가 탭을 찍고,
   *  PDF 뷰어는 쪽 그림(canvas)에서 바로 자른다. 그림은 내 PC 서버로만 간다. */
  async function translateRegion(translator, capture) {
    const rect = await pick();
    if (!rect) return;
    await afterPaint();
    const point = anchorOf(rect);
    let shot;
    try {
      shot = await capture(rect);
    } catch (error) {
      translator.notice(`화면을 찍지 못했습니다. ${errorText(error)}`, point, "error");
      return;
    }
    translator.notice("그림 속 글자를 내 PC에서 읽는 중…", point, "busy");
    try {
      const { text } = await DT.bridge.ocrImage(shot.image, shot.mime);
      translator.openAt(text, "local", point);
    } catch (error) {
      translator.notice(`그림을 읽지 못했습니다. ${errorText(error)}`, point, "error");
    }
  }

  DT.region = { pick, afterPaint, anchorOf, translateRegion };
})(globalThis);
