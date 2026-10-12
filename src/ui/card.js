/* 번역 창 — 글자를 드래그하면 선택 옆에 뜬다. 웹 페이지(콘텐츠 스크립트)·PDF 뷰어·결과 창이 함께 쓴다.
 * 페이지의 스타일과 섞이지 않게 그림자 DOM 안에 그린다. 필요한 것: DT.config · DT.engines · DT.bridge */
(function (root) {
  "use strict";

  const DT = root.DT;
  const ICON_SIZE = 30;
  const GAP = 8;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card, .fab {
      --bg: #ffffff; --fg: #1d2433; --muted: #5d6779; --line: #dde2ea; --soft: #f3f5f9;
      --accent: #2f6feb; --accent-fg: #ffffff; --danger: #c0392b; --shadow: 0 10px 28px rgba(18, 28, 45, 0.18);
      font-family: Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, -apple-system, sans-serif;
      color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .card, .fab {
        --bg: #1f2430; --fg: #e8ebf2; --muted: #a3acbd; --line: #343b4a; --soft: #283040;
        --accent: #6c9cff; --accent-fg: #0d1320; --danger: #ff8a7a; --shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      }
    }
    .card {
      position: fixed; z-index: 2147483647; width: min(380px, calc(100vw - 16px));
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow);
      font-size: 14px; line-height: 1.55; display: flex; flex-direction: column; max-height: min(420px, calc(100vh - 16px));
    }
    .card.inline { position: static; width: 100%; max-height: none; box-shadow: none; }
    .head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--line); }
    .engines { display: inline-flex; background: var(--soft); border-radius: 7px; padding: 2px; }
    .engines button {
      font: inherit; font-size: 13px; border: 0; background: transparent; color: var(--muted);
      padding: 3px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap;
    }
    .engines button[aria-pressed="true"] { background: var(--bg); color: var(--fg); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    select {
      font: inherit; font-size: 13px; color: var(--fg); background: var(--bg); border: 1px solid var(--line);
      border-radius: 6px; padding: 3px 6px; margin-left: auto; max-width: 112px;
    }
    .icon-btn {
      font: inherit; font-size: 13px; border: 1px solid transparent; background: transparent; color: var(--muted);
      border-radius: 6px; padding: 3px 7px; cursor: pointer; line-height: 1.2;
    }
    .icon-btn:hover, .engines button:hover { color: var(--fg); background: var(--soft); }
    button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .body { padding: 10px 12px; overflow: auto; white-space: pre-wrap; word-break: break-word; user-select: text; }
    .body.loading { color: var(--muted); }
    .body.error { color: var(--danger); }
    .busy { height: 3px; margin-top: 8px; background: var(--soft); border-radius: 2px; overflow: hidden; }
    .busy i { display: block; width: 35%; height: 100%; background: var(--accent); border-radius: 2px; animation: dt-busy 1.2s ease-in-out infinite; }
    @keyframes dt-busy { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
    @media (prefers-reduced-motion: reduce) { .busy i { animation: none; width: 100%; opacity: .5; } }
    .source {
      color: var(--muted); font-size: 13px; border-left: 3px solid var(--line); padding-left: 8px; margin-bottom: 10px;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: normal;
    }
    .primary {
      font: inherit; font-weight: 600; border: 0; border-radius: 7px; padding: 8px 12px; width: 100%;
      background: var(--accent); color: var(--accent-fg); cursor: pointer;
    }
    .hint { color: var(--muted); font-size: 12px; margin-top: 8px; white-space: normal; }
    .foot { display: flex; align-items: center; gap: 8px; padding: 6px 12px 8px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
    .foot a { margin-left: auto; color: var(--accent); text-decoration: none; cursor: pointer; }
    .foot a:hover { text-decoration: underline; }
    .note { font-size: 12px; color: var(--muted); padding: 0 12px 8px; }
    .fab {
      position: fixed; z-index: 2147483647; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; border-radius: 50%;
      border: 0; background: var(--accent); color: var(--accent-fg); font-size: 13px; font-weight: 700;
      box-shadow: var(--shadow); cursor: pointer; padding: 0;
    }
    [hidden] { display: none !important; }
  `;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value);
    }
    for (const child of children || []) node.append(child);
    return node;
  }

  /** 선택 영역의 화면 위치. 입력칸 안처럼 위치를 못 얻으면 null. */
  function selectionRect(selection) {
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    const box = range.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, endX: rect.right, endBottom: rect.bottom };
  }

  function pointRect(event) {
    const x = event && typeof event.clientX === "number" ? event.clientX : 16;
    const y = event && typeof event.clientY === "number" ? event.clientY : 16;
    return { top: y, bottom: y, left: x, right: x, endX: x, endBottom: y };
  }

  function isEditable(node) {
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!element || !element.closest) return false;
    return Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
  }

  class TranslateCard {
    /** inline: 이 요소 안에 고정해 그린다(결과 창). 없으면 선택 옆에 띄운다. */
    constructor({ inline = null } = {}) {
      this.inline = inline;
      this.host = null;
      this.token = 0;
      this.text = "";
      this.clipped = false;
      this.result = "";
      this.anchor = null;
      this.range = null;
      this.engine = DT.config.DEFAULTS.engine;
      this.lang = DT.config.DEFAULTS.targetLang;
    }

    ensure() {
      if (this.host) return;
      this.host = el("div", { "data-drag-translate": "" });
      const shadow = this.host.attachShadow({ mode: "open" });
      shadow.append(el("style", { text: STYLE }));
      this.card = el("div", { class: this.inline ? "card inline" : "card", role: "dialog", "aria-label": "드래그 번역" });
      this.card.hidden = true;
      this.fab = el("button", { class: "fab", type: "button", title: "선택한 글 번역", "aria-label": "선택한 글 번역", text: "번" });
      this.fab.hidden = true;
      shadow.append(this.card, this.fab);
      (this.inline || document.documentElement).append(this.host);
      this.fab.addEventListener("click", () => {
        this.fab.hidden = true;
        if (this.pending) this.open(this.pending.text, this.pending.settings, this.pending.range);
      });
    }

    /** 이 이벤트가 번역 창(또는 아이콘) 안에서 났는가. */
    contains(event) {
      return Boolean(this.host && event.composedPath && event.composedPath().includes(this.host));
    }

    get isOpen() {
      return Boolean(this.card && !this.card.hidden);
    }

    hide() {
      if (!this.host || this.inline) return;
      this.card.hidden = true;
      this.fab.hidden = true;
      this.pending = null;
      this.range = null;
      this.token += 1;
      clearInterval(this.timer);
    }

    /** 아이콘 모드 — 선택 끝에 작은 「번」 단추만 보인다. */
    showIcon(text, settings, range) {
      this.ensure();
      this.card.hidden = true;
      this.pending = { text, settings, range };
      const rect = (range && selectionRect({ rangeCount: 1, getRangeAt: () => range })) || pointRect();
      const left = Math.min(Math.max(GAP, rect.endX + 4), window.innerWidth - ICON_SIZE - GAP);
      const top = Math.min(Math.max(GAP, rect.endBottom + 4), window.innerHeight - ICON_SIZE - GAP);
      this.fab.style.left = `${left}px`;
      this.fab.style.top = `${top}px`;
      this.fab.hidden = false;
    }

    open(rawText, settings, range, event) {
      this.ensure();
      this.fab.hidden = true;
      const { text, clipped } = DT.engines.clip(rawText, DT.config.MAX_TEXT);
      this.text = text;
      this.clipped = clipped;
      this.engine = settings.engine;
      this.lang = settings.targetLang;
      this.range = range || null;
      this.fallbackRect = event ? pointRect(event) : null;
      this.render();
      this.card.hidden = false;
      this.position();
      if (this.translatesInPlace) this.translate();
    }

    /** 그 자리에서 번역하는 엔진인가(구글·내 PC). 파파고는 새 탭으로 연다. */
    get translatesInPlace() {
      return this.engine === "google" || this.engine === "local";
    }

    render() {
      const engineButton = (engine, label, title) => {
        const button = el("button", { type: "button", "aria-pressed": String(this.engine === engine), text: label, title });
        button.addEventListener("click", () => this.setEngine(engine));
        return button;
      };
      const engines = el("div", { class: "engines", role: "group", "aria-label": "번역 엔진" }, [
        engineButton("google", "구글", "구글 번역 — 글이 구글 서버로 갑니다"),
        engineButton("papago", "파파고 ↗", "파파고 사이트를 새 탭으로 엽니다"),
        engineButton("local", "내 PC", "PC 안의 언어 모델로 번역 — 밖으로 보내지 않습니다"),
      ]);

      const select = el("select", { "aria-label": "번역할 언어", title: "번역할 언어" });
      for (const lang of DT.config.LANGUAGES) {
        const option = el("option", { value: lang.code, text: lang.name });
        if (lang.code === this.lang) option.selected = true;
        select.append(option);
      }
      select.addEventListener("change", () => this.setLang(select.value));

      const copy = el("button", { class: "icon-btn", type: "button", title: "번역문 복사", text: "복사" });
      copy.addEventListener("click", () => this.copy(copy));
      copy.hidden = !this.translatesInPlace;
      const close = el("button", { class: "icon-btn", type: "button", title: "닫기 (Esc)", "aria-label": "닫기", text: "✕" });
      close.addEventListener("click", () => (this.inline ? window.close() : this.hide()));

      this.body = el("div", { class: "body", "aria-live": "polite" });
      this.detectedLabel = el("span", { text: this.engine === "local" ? "내 PC 번역 · 밖으로 보내지 않음" : "" });
      const foot = [this.detectedLabel];
      // 내 PC 번역 중에는 글을 밖으로 보내는 링크를 두지 않는다(보안 문서를 실수로 내보내지 않게).
      if (this.engine !== "local") {
        const web = el("a", { href: "#", text: this.engine === "google" ? "구글 번역에서 열기 ↗" : "구글로 바로 보기" });
        web.addEventListener("click", (event) => {
          event.preventDefault();
          if (this.engine === "google") DT.bridge.openTab(DT.engines.googleWebUrl(this.text, this.lang)).catch(() => {});
          else this.setEngine("google");
        });
        foot.push(web);
      }

      const children = [el("div", { class: "head" }, [engines, select, copy, close]), this.body];
      if (this.clipped) children.push(el("div", { class: "note", text: `글이 길어 앞 ${DT.config.MAX_TEXT.toLocaleString("ko-KR")}자만 번역합니다.` }));
      children.push(el("div", { class: "foot" }, foot));
      this.card.replaceChildren(...children);

      if (this.engine === "papago") this.renderPapago();
    }

    renderPapago() {
      const button = el("button", { class: "primary", type: "button", text: "파파고에서 번역 보기 ↗" });
      button.addEventListener("click", () => this.openPapago());
      this.body.className = "body";
      this.body.replaceChildren(
        el("div", { class: "source", text: this.text }),
        button,
        el("div", { class: "hint", text: "파파고는 새 탭에서 번역합니다. 그 자리에서 바로 보려면 위의 「구글」을 누르세요." }),
      );
      setTimeout(() => button.focus({ preventScroll: true }), 0);
    }

    openPapago() {
      DT.bridge.openTab(DT.engines.papagoWebUrl(this.text, this.lang)).catch((error) => this.showError(error));
    }

    /** 진행 표시 — 내 PC 번역은 구글보다 느려 지난 시간을 보이고 막대를 움직인다. */
    showProgress(label) {
      this.body.className = "body loading";
      this.progressText = el("span", { text: label });
      this.body.replaceChildren(this.progressText, el("div", { class: "busy", "aria-hidden": "true" }, [el("i")]));
    }

    startTimer(token, label) {
      const started = Date.now();
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (token !== this.token || !this.progressText) return clearInterval(this.timer);
        this.progressText.textContent = `${label} ${Math.round((Date.now() - started) / 1000)}초`;
      }, 1000);
    }

    async translate() {
      const token = ++this.token;
      const engine = this.engine;
      this.result = "";
      this.detectedLabel.textContent = engine === "local" ? "내 PC 번역 · 밖으로 보내지 않음" : "";
      if (engine === "local") {
        this.showProgress("내 PC에서 번역 중…");
        this.startTimer(token, "내 PC에서 번역 중…");
      } else {
        this.body.className = "body loading";
        this.body.textContent = "번역 중…";
      }
      this.position();
      try {
        const reply = await DT.bridge.translate(this.text, this.lang, engine);
        if (token !== this.token) return;
        this.result = reply.text;
        this.body.className = "body";
        this.body.textContent = reply.text;
        if (reply.detected) this.detectedLabel.textContent = `원문: ${DT.config.languageName(reply.detected)}`;
      } catch (error) {
        if (token !== this.token) return;
        this.showError(error);
      } finally {
        if (token === this.token) clearInterval(this.timer);
      }
      this.position();
    }

    showError(error) {
      this.body.className = "body error";
      this.body.textContent = `번역하지 못했습니다. ${error && error.message ? error.message : ""}`;
    }

    setEngine(engine) {
      if (engine === this.engine) {
        if (engine === "papago") this.openPapago();
        return;
      }
      this.engine = engine;
      DT.config.save({ engine }).catch(() => {});
      this.render();
      this.position();
      if (this.translatesInPlace) this.translate();
    }

    setLang(code) {
      this.lang = code;
      DT.config.save({ targetLang: code }).catch(() => {});
      if (this.translatesInPlace) this.translate();
    }

    async copy(button) {
      if (!this.result) return;
      try {
        await navigator.clipboard.writeText(this.result);
      } catch {
        const area = el("textarea", {});
        area.value = this.result;
        this.card.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      button.textContent = "복사됨";
      setTimeout(() => (button.textContent = "복사"), 1200);
    }

    /** 선택 아래에 두고, 아래 자리가 모자라면 위로 올린다. 화면 밖으로 나가지 않게 한다. */
    position() {
      if (this.inline || !this.card || this.card.hidden) return;
      let rect = this.range ? selectionRect({ rangeCount: 1, getRangeAt: () => this.range }) : null;
      if (!rect) rect = this.fallbackRect || { top: GAP, bottom: GAP, left: window.innerWidth / 2 - 190, right: window.innerWidth / 2 + 190 };
      const width = this.card.offsetWidth;
      const height = this.card.offsetHeight;
      let left = Math.min(Math.max(GAP, rect.left), window.innerWidth - width - GAP);
      let top = rect.bottom + GAP;
      if (top + height > window.innerHeight - GAP && rect.top - GAP - height >= GAP) top = rect.top - GAP - height;
      top = Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - height - GAP));
      left = Math.max(GAP, left);
      this.card.style.left = `${left}px`;
      this.card.style.top = `${top}px`;
    }
  }

  /** 드래그 감지 — 마우스를 놓을 때 선택된 글이 있으면 번역 창(또는 아이콘)을 띄운다. */
  function attachSelectionTranslator() {
    const card = new TranslateCard();
    let settings = DT.config.DEFAULTS;
    DT.config.load().then((value) => (settings = value)).catch(() => {});
    DT.config.onChange((value) => {
      settings = value;
      if (!value.enabled) card.hide();
    });

    function handleMouseUp(event) {
      if (!settings.enabled || event.button !== 0 || card.contains(event)) return;
      // 선택이 마우스를 놓은 직후 확정되므로 한 박자 늦게 읽는다.
      setTimeout(() => {
        const selection = document.getSelection();
        const text = selection ? selection.toString().trim() : "";
        if (text.length < settings.minLength) return;
        if (settings.ignoreEditable && (isEditable(event.target) || isEditable(document.activeElement))) return;
        const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        if (card.isOpen && text === card.text) return;
        if (settings.trigger === "icon") card.showIcon(text, settings, range);
        else card.open(text, settings, range, event);
      }, 0);
    }

    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("mousedown", (event) => {
      if (!card.contains(event)) card.hide();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") card.hide();
    }, true);
    const follow = (event) => {
      if (event && card.contains(event)) return;
      card.position();
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);

    return {
      card,
      /** 우클릭 메뉴에서 온 글 — 지금 선택 옆(없으면 화면 위쪽)에 띄운다. engine을 주면 그 엔진으로 연다. */
      openText(text, engine) {
        const selection = document.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        card.open(text, { ...settings, engine: engine || settings.engine }, range);
      },
    };
  }

  DT.ui = { TranslateCard, attachSelectionTranslator, selectionRect, isEditable };
})(globalThis);
