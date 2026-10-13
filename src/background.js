/* 서비스 워커 — 번역 요청을 보내고, 우클릭 메뉴와 「PDF를 번역 뷰어로 열기」 규칙을 관리한다.
 * 구글 번역과 내 PC 번역 서버 요청은 모두 여기서 보낸다(페이지의 보안 정책에 막히지 않게). */
importScripts("shared/config.js", "shared/engines.js", "shared/text-tools.js", "shared/local-llm.js", "shared/models.js", "shared/pdf-url.js", "shared/page-limits.js");

const { config, engines, text: textTools, local, models, pdfUrl, pageLimits } = self.DT;

const VIEWER_PAGE = chrome.runtime.getURL("src/pdf/viewer.html");
const RESULT_PAGE = chrome.runtime.getURL("src/result/result.html");
const PDF_RULE_ID = 1;
const OPEN_TAB_HOSTS = ["papago.naver.com", "translate.google.com"];
const PDF_LINK_PATTERNS = ["*://*/*.pdf", "*://*/*.PDF", "*://*/*.pdf?*", "*://*/*.PDF?*"];

/* ── 내 PC 서버 요청 준비 ───────────────────────────── */

/** 내 PC 서버로 가는 이 확장의 요청은 출처를 http://127.0.0.1로 바꿔 보낸다 — Ollama 기본 설정의 403을 피한다.
 *  서비스 워커가 깨어날 때마다 다시 건다(같은 ID를 지우고 넣으므로 겹치지 않는다). 실패하면 403 안내로 넘어간다. */
const originReady = chrome.declarativeNetRequest
  .updateDynamicRules({ removeRuleIds: [local.ORIGIN_RULE_ID], addRules: [local.localOriginRule(chrome.runtime.id)] })
  .catch(() => {});

/** 서비스 워커 깨워 두기 — 크롬은 30초 넘게 응답을 기다리는 fetch가 있거나 30초 동안 할 일이 없으면 워커를 끝낸다.
 *  내 PC 모델은 처음 불러올 때 30초 가까이 걸리므로(실측: exaone3.5:7.8b 첫 번역 26.5초) 일하는 동안 20초마다
 *  확장 API를 불러 시계를 되돌린다. 일이 모두 끝나면 멈춘다. */
let busyCount = 0;
let awakeTimer = 0;
async function keepAwake(work) {
  busyCount += 1;
  if (!awakeTimer) awakeTimer = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20_000);
  try {
    return await work();
  } finally {
    busyCount -= 1;
    if (!busyCount) {
      clearInterval(awakeTimer);
      awakeTimer = 0;
    }
  }
}

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

/** 응답 머리(Content-Type) 규칙이 걸렸는가 — 크롬 128 미만은 그 조건을 몰라 거절한다.
 *  그때는 콘텐츠 스크립트가 알려 오는 「이 화면은 PDF」로 대신 옮긴다(아래 onPdfDetected). */
let headerRuleActive = false;

async function syncPdfRule(settings) {
  const wanted = settings.enabled && settings.pdfAutoOpen;
  const urlRule = {
    id: PDF_RULE_ID,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${VIEWER_PAGE}?file=\\0` } },
    condition: { regexFilter: pdfUrl.PDF_RULE_REGEX, resourceTypes: ["main_frame"] },
  };
  const removeRuleIds = [PDF_RULE_ID, pdfUrl.PDF_HEADER_RULE_ID];
  if (!wanted) {
    headerRuleActive = false;
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    return;
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [urlRule, pdfUrl.pdfHeaderRule(VIEWER_PAGE)] });
    headerRuleActive = true;
  } catch {
    headerRuleActive = false;
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [urlRule] });
  }
}

/** 서비스 워커가 다시 깨어나면 변수가 비므로, 걸려 있는 규칙을 보고 응답 머리 규칙 여부를 되살린다. */
const headerRuleKnown = chrome.declarativeNetRequest
  .getDynamicRules()
  .then((rules) => {
    headerRuleActive = rules.some((rule) => rule.id === pdfUrl.PDF_HEADER_RULE_ID);
  })
  .catch(() => {});

/** 「원래 뷰어로 보기」를 고른 주소 — 콘텐츠 스크립트 쪽 옮기기도 이 주소는 건너뛴다(브라우저를 닫으면 지워진다). */
const OPTED_OUT_KEY = "pdfOptedOut";
async function optedOutUrls() {
  try {
    const kept = await chrome.storage.session.get(OPTED_OUT_KEY);
    return Array.isArray(kept[OPTED_OUT_KEY]) ? kept[OPTED_OUT_KEY] : [];
  } catch {
    return [];
  }
}

/** 탭마다 마지막으로 뷰어로 옮긴 주소·시각 — 같은 주소를 거듭 옮기는 되돌림을 막는다. */
const recentRedirects = new Map();

/** 콘텐츠 스크립트가 「이 화면은 PDF(Content-Type)」라고 알려 왔다 — 요청 규칙이 못 잡은 PDF를 뷰어로 옮긴다. */
async function onPdfDetected(message, sender) {
  if (!sender.tab || sender.tab.id === undefined) return { ok: true, opened: false, reason: "no-tab" };
  await headerRuleKnown;
  const settings = await config.load();
  const url = String(sender.url || sender.tab.url || "");
  const decision = pdfUrl.viewerDecision({
    url,
    contentType: String(message.contentType || ""),
    frameId: sender.frameId,
    enabled: settings.enabled,
    autoOpen: settings.pdfAutoOpen,
    headerRule: headerRuleActive,
    viewerBase: VIEWER_PAGE,
    optedOut: await optedOutUrls(),
    recent: recentRedirects.get(sender.tab.id),
    now: Date.now(),
  });
  if (!decision.open) return { ok: true, opened: false, reason: decision.reason };
  recentRedirects.set(sender.tab.id, { url, at: Date.now() });
  await chrome.tabs.update(sender.tab.id, { url: pdfUrl.viewerUrl(VIEWER_PAGE, url) });
  return { ok: true, opened: true };
}

/** 「원래 뷰어로 보기」 — 그 주소 하나만 이번 브라우저 세션 동안 자동 열기에서 뺀다. */
let nextSessionRuleId = 1000;
async function openNative(tabId, url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("이 주소는 원래 뷰어로 다시 열 수 없습니다.");
  const opted = await optedOutUrls();
  if (!opted.includes(url)) {
    await chrome.storage.session.set({ [OPTED_OUT_KEY]: [...opted, url].slice(-200) }).catch(() => {});
  }
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
    // 콘텐츠 스크립트가 없는 화면 — 주소로 까닭을 갈라 사람이 할 일을 알린다.
    const kind = pageLimits.blockedKind(tab.url, pdfUrl.isPdfUrl);
    throw Object.assign(new Error(pageLimits.blockedMessage(kind)), { kind });
  }
}

/** 결과 창 — 엔진은 주소의 ?engine=, 글은 # 뒤에 담는다. */
function openResultWindow(text, engine = "google") {
  return chrome.windows.create({ url: `${RESULT_PAGE}?engine=${engine}#${encodeURIComponent(text)}`, type: "popup", width: 460, height: 440 });
}

/** 우클릭 메뉴로 시작한 일이 이 화면에서 안 될 때 — 까닭을 작은 창으로 알린다(정해 둔 까닭 이름만 넘긴다). */
function openNoticeWindow(kind) {
  return chrome.windows.create({ url: `${RESULT_PAGE}?notice=${encodeURIComponent(kind)}`, type: "popup", width: 460, height: 260 });
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
      } catch (error) {
        // 콘텐츠 스크립트가 없는 화면 — 우클릭 메뉴에는 알릴 자리가 없어 작은 창으로 까닭을 보인다(팝업 단추는 팝업 안에 보인다).
        await openNoticeWindow((error && error.kind) || "reload").catch(() => {});
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
    case "pdf-detected":
      return onPdfDetected(message, sender);
    case "open-native":
      if (!sender.tab || sender.tab.id === undefined) throw new Error("탭을 찾지 못했습니다.");
      await openNative(sender.tab.id, String(message.url || ""));
      return { ok: true };
    default:
      throw new Error("알 수 없는 요청입니다.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  keepAwake(async () => {
    await originReady;
    return handle(message, sender);
  }).then(sendResponse, (error) => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
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
  port.onMessage.addListener((message) => keepAwake(async () => {
    try {
      await originReady;
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
  }));
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
