/* 서비스 워커 — 번역 요청을 보내고, 우클릭 메뉴와 「PDF를 번역 뷰어로 열기」 규칙을 관리한다.
 * 구글 번역과 내 PC 번역 서버 요청은 모두 여기서 보낸다(페이지의 보안 정책에 막히지 않게). */
importScripts("shared/config.js", "shared/engines.js", "shared/text-tools.js", "shared/local-llm.js", "shared/models.js", "shared/pdf-url.js");

const { config, engines, text: textTools, local, models, pdfUrl } = self.DT;

const VIEWER_PAGE = chrome.runtime.getURL("src/pdf/viewer.html");
const RESULT_PAGE = chrome.runtime.getURL("src/result/result.html");
const PDF_RULE_ID = 1;
const OPEN_TAB_HOSTS = ["papago.naver.com", "translate.google.com"];
const PDF_LINK_PATTERNS = ["*://*/*.pdf", "*://*/*.PDF", "*://*/*.pdf?*", "*://*/*.PDF?*"];

/* ── 번역 ─────────────────────────────────────────── */

/** 번역 결과를 메모리에만 담아 같은 글을 다시 묻지 않는다(디스크에는 남기지 않는다).
 *  내 PC 번역은 몇 초씩 걸리므로 특히 쓸모가 있다. 오래된 것부터 버린다. */
const cache = new Map();
const CACHE_LIMIT = 300;

async function remember(key, work) {
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); // 최근에 쓴 것을 뒤로 보내 오래 남긴다.
    cache.set(key, hit);
    return hit;
  }
  const result = await work();
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}

async function translate(text, targetLang, engine) {
  const { text: clean } = engines.clip(text, config.MAX_TEXT);
  if (!clean) throw new Error("번역할 글이 없습니다.");
  const target = config.LANGUAGES.some((lang) => lang.code === targetLang) ? targetLang : config.DEFAULTS.targetLang;
  if (engine === "local") {
    // 내 PC 번역 — 설정의 서버(내 PC 주소만)로 보낸다. 모델이 바뀌면 다시 번역한다.
    const settings = await config.load();
    const opts = local.optionsFrom(settings);
    // 용어집 — 이 글에 나오는 용어만 지시문에 넣는다. 용어집이 바뀌면 다시 번역한다.
    const glossary = textTools.glossaryLinesFor(textTools.parseGlossary(settings.glossary), clean);
    const key = ["local", opts.mode, opts.server, opts.model, target, glossary.join("\n"), clean].join("\u0000");
    return remember(key, () => local.translateLocal(clean, target, opts, undefined, glossary));
  }
  return remember(["google", target, clean].join("\u0000"), () => engines.translateGoogle(clean, target));
}

/* ── PDF 자동 열기 규칙 ─────────────────────────────── */

async function syncPdfRule(settings) {
  const wanted = settings.enabled && settings.pdfAutoOpen;
  const addRules = wanted
    ? [{
        id: PDF_RULE_ID,
        priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: `${VIEWER_PAGE}?file=\\0` } },
        condition: { regexFilter: pdfUrl.PDF_RULE_REGEX, resourceTypes: ["main_frame"] },
      }]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PDF_RULE_ID], addRules });
}

/** 「원래 뷰어로 보기」 — 그 주소 하나만 이번 브라우저 세션 동안 자동 열기에서 뺀다. */
let nextSessionRuleId = 1000;
async function openNative(tabId, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("이 주소는 원래 뷰어로 다시 열 수 없습니다.");
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  if (!existing.some((rule) => rule.condition.regexFilter === `^${escaped}$`)) {
    nextSessionRuleId = Math.max(nextSessionRuleId, ...existing.map((rule) => rule.id + 1));
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{ id: nextSessionRuleId++, priority: 2, action: { type: "allow" }, condition: { regexFilter: `^${escaped}$`, resourceTypes: ["main_frame"] } }],
    });
  }
  await chrome.tabs.update(tabId, { url });
}

/* ── 우클릭 메뉴 ───────────────────────────────────── */

async function setupMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "dt-google", title: "구글로 번역: “%s”", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "dt-papago", title: "파파고에서 번역: “%s”", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "dt-local", title: "내 PC로 번역: “%s”", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "dt-region", title: "화면 영역 골라 번역(내 PC)", contexts: ["page", "image"] });
  chrome.contextMenus.create({ id: "dt-pdf-link", title: "이 PDF를 번역 뷰어로 열기", contexts: ["link"], targetUrlPatterns: PDF_LINK_PATTERNS });
  chrome.contextMenus.create({
    id: "dt-pdf-page",
    title: "이 PDF를 번역 뷰어로 열기",
    contexts: ["page"],
    documentUrlPatterns: [...PDF_LINK_PATTERNS, "file:///*.pdf", "file:///*.PDF"],
  });
}

/* ── 화면 영역 번역 ─────────────────────────────────── */

/** 그림 바이트 → base64(큰 그림도 호출 스택이 넘치지 않게 나눠 바꾼다). */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 찍은 화면에서 고른 영역만 잘라 PNG(base64)로. 그림 픽셀/CSS 픽셀 비율은 찍은 폭 ÷ 창 폭으로 잰다(화면 배율·확대 모두 반영). */
async function cropCapture(dataUrl, rect, viewportWidth) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = viewportWidth > 0 ? bitmap.width / viewportWidth : 1;
  const box = local.cropBox(rect || {}, scale, bitmap.width, bitmap.height);
  if (!box) throw new Error("고른 영역이 너무 작습니다.");
  const size = local.fitSize(box.width, box.height);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, size.width, size.height);
  bitmap.close();
  return toBase64(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** 그 탭에서 영역 고르기를 시작한다 — 웹 페이지는 콘텐츠 스크립트, PDF 번역 뷰어는 뷰어 스스로. */
async function startRegion(tab) {
  if (!tab || tab.id === undefined) throw new Error("탭을 찾지 못했습니다.");
  if (typeof tab.url === "string" && tab.url.startsWith(VIEWER_PAGE)) {
    await chrome.runtime.sendMessage({ type: "viewer-pick-region", tabId: tab.id });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "pick-region" }, { frameId: 0 });
  } catch {
    throw new Error("이 화면에서는 영역 번역을 쓸 수 없습니다(크롬 내부 화면·웹 스토어·크롬 기본 PDF 뷰어). 설치 전부터 열려 있던 탭이면 새로 고쳐 주세요.");
  }
}

/** 결과 창 — 엔진은 주소의 ?engine=, 글은 # 뒤에 담는다. */
function openResultWindow(text, engine = "google") {
  return chrome.windows.create({ url: `${RESULT_PAGE}?engine=${engine}#${encodeURIComponent(text)}`, type: "popup", width: 460, height: 440 });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await config.load();
  const text = (info.selectionText || "").trim();
  switch (info.menuItemId) {
    case "dt-google":
    case "dt-local": {
      const engine = info.menuItemId === "dt-local" ? "local" : "google";
      // 크롬 기본 PDF 뷰어·크롬 내부 화면처럼 콘텐츠 스크립트가 없는 곳은 작은 결과 창으로 보인다.
      if (!tab || tab.id === undefined || pdfUrl.isPdfUrl(tab.url)) return void openResultWindow(text, engine);
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "show-card", text, engine }, { frameId: info.frameId ?? 0 });
      } catch {
        await openResultWindow(text, engine);
      }
      return;
    }
    case "dt-region":
      try {
        await startRegion(tab);
      } catch {
        // 콘텐츠 스크립트가 없는 화면 — 우클릭 메뉴에는 알릴 자리가 없어 조용히 넘어간다(팝업 단추는 이유를 보인다).
      }
      return;
    case "dt-papago":
      await chrome.tabs.create({ url: engines.papagoWebUrl(text, settings.targetLang), index: tab ? tab.index + 1 : undefined });
      return;
    case "dt-pdf-link":
      await chrome.tabs.create({ url: pdfUrl.viewerUrl(VIEWER_PAGE, info.linkUrl), index: tab ? tab.index + 1 : undefined });
      return;
    case "dt-pdf-page":
      if (tab && tab.id !== undefined) await chrome.tabs.update(tab.id, { url: pdfUrl.viewerUrl(VIEWER_PAGE, info.pageUrl || tab.url) });
      return;
  }
});

/* ── 화면에서 오는 요청 ─────────────────────────────── */

async function handle(message, sender) {
  switch (message && message.type) {
    case "translate":
      return { ok: true, ...(await translate(message.text, message.targetLang, message.engine)) };
    case "local-test": {
      // 설정 화면에서 바꾼 값으로 바로 시험할 수 있게 받은 값을 먼저 쓴다.
      const settings = await config.load();
      const opts = { ...local.optionsFrom(settings), ...(message.opts || {}) };
      return { ok: true, ...(await local.testConnection(opts, settings.targetLang)) };
    }
    case "capture-region": {
      // 보이는 탭을 찍어 고른 영역만 잘라 돌려준다. 찍은 그림은 어디에도 저장하지 않는다.
      if (!sender.tab || sender.tab.windowId === undefined) throw new Error("탭을 찾지 못했습니다.");
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
      return { ok: true, image: await cropCapture(dataUrl, message.rect, Number(message.viewportWidth)), mime: "image/png" };
    }
    case "ocr-image": {
      // 그림 속 글자 읽기는 엔진 설정과 상관없이 늘 내 PC 모델로만 한다.
      const image = String(message.image || "");
      if (!image || image.length > 20_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 1000))) throw new Error("그림을 받지 못했습니다.");
      const mime = /^image\/(png|jpeg|webp)$/.test(message.mime) ? message.mime : "image/png";
      const settings = await config.load();
      return { ok: true, text: await local.recognizeImage(image, local.optionsFrom(settings), undefined, mime) };
    }
    case "start-region": {
      if (!fromExtensionPage(sender)) throw new Error("팝업에서만 할 수 있습니다.");
      await startRegion(await chrome.tabs.get(Number(message.tabId)));
      return { ok: true };
    }
    case "local-models": {
      const settings = await config.load();
      return { ok: true, models: await local.listModels(local.optionsFrom(settings)) };
    }
    case "local-create": {
      // 맞춤 모델 만들기 — 설정 화면에서 사용자가 눌렀을 때만. 정해 둔 정의(models.js)만 만든다.
      if (!fromExtensionPage(sender)) throw new Error("설정 화면에서만 할 수 있습니다.");
      const custom = models.CUSTOM_MODELS.find((item) => item.name === message.name);
      if (!custom) throw new Error("알 수 없는 맞춤 모델입니다.");
      const settings = await config.load();
      // 만들기는 바탕 모델을 복사하므로 번역보다 오래 걸릴 수 있어 넉넉히 기다린다.
      const opts = { ...local.optionsFrom(settings), timeout: Math.max(settings.localTimeout, 300) };
      await local.ollamaPost(opts, "/api/create", models.createRequestBody(custom));
      return { ok: true, name: custom.name };
    }
    case "open-tab": {
      const url = String(message.url || "");
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        // 아래에서 막힌다.
      }
      if (!OPEN_TAB_HOSTS.includes(host)) throw new Error("열 수 없는 주소입니다.");
      const index = sender.tab ? sender.tab.index + 1 : undefined;
      await chrome.tabs.create({ url, index });
      return { ok: true };
    }
    case "open-native":
      if (!sender.tab || sender.tab.id === undefined) throw new Error("탭을 찾지 못했습니다.");
      await openNative(sender.tab.id, String(message.url || ""));
      return { ok: true };
    default:
      throw new Error("알 수 없는 요청입니다.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
  return true;
});

/** 확장 자신의 화면(설정·팝업)에서 온 요청인가 — 웹 페이지 위의 콘텐츠 스크립트와 구별한다. */
function fromExtensionPage(sender) {
  return Boolean(sender && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL("")));
}

/* ── 모델 받기(진행률을 길게 보내야 해서 연결(port)로 주고받는다) ─────── */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "local-pull" || !fromExtensionPage(port.sender)) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    try {
      const settings = await config.load();
      await local.pullModel(
        local.optionsFrom(settings),
        String(message && message.model),
        (line) => {
          const progress = models.parsePullLine(line);
          if (progress) port.postMessage(progress);
        },
        undefined,
        controller.signal,
      );
      port.postMessage({ finished: true });
    } catch (error) {
      if (!controller.signal.aborted) port.postMessage({ error: error && error.message ? error.message : String(error) });
    }
  });
});

/* ── 시작 ─────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener(async (details) => {
  await setupMenus();
  await syncPdfRule(await config.load());
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncPdfRule(await config.load());
});

config.onChange((settings) => {
  syncPdfRule(settings).catch(() => {});
});
