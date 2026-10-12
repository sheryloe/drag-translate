/* 서비스 워커 — 번역 요청을 보내고, 우클릭 메뉴와 「PDF를 번역 뷰어로 열기」 규칙을 관리한다. */
importScripts("shared/config.js", "shared/engines.js", "shared/pdf-url.js");

const { config, engines, pdfUrl } = self.DT;

const VIEWER_PAGE = chrome.runtime.getURL("src/pdf/viewer.html");
const RESULT_PAGE = chrome.runtime.getURL("src/result/result.html");
const PDF_RULE_ID = 1;
const OPEN_TAB_HOSTS = ["papago.naver.com", "translate.google.com"];
const PDF_LINK_PATTERNS = ["*://*/*.pdf", "*://*/*.PDF", "*://*/*.pdf?*", "*://*/*.PDF?*"];

/* ── 번역 ─────────────────────────────────────────── */

const cache = new Map();
const CACHE_LIMIT = 100;

async function translate(text, targetLang) {
  const { text: clean } = engines.clip(text, config.MAX_TEXT);
  if (!clean) throw new Error("번역할 글이 없습니다.");
  const target = config.LANGUAGES.some((lang) => lang.code === targetLang) ? targetLang : config.DEFAULTS.targetLang;
  const key = `${target}\u0000${clean}`;
  if (cache.has(key)) return cache.get(key);
  const result = await engines.translateGoogle(clean, target);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
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
  chrome.contextMenus.create({ id: "dt-pdf-link", title: "이 PDF를 번역 뷰어로 열기", contexts: ["link"], targetUrlPatterns: PDF_LINK_PATTERNS });
  chrome.contextMenus.create({
    id: "dt-pdf-page",
    title: "이 PDF를 번역 뷰어로 열기",
    contexts: ["page"],
    documentUrlPatterns: [...PDF_LINK_PATTERNS, "file:///*.pdf", "file:///*.PDF"],
  });
}

function openResultWindow(text) {
  return chrome.windows.create({ url: `${RESULT_PAGE}#${encodeURIComponent(text)}`, type: "popup", width: 460, height: 440 });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await config.load();
  const text = (info.selectionText || "").trim();
  switch (info.menuItemId) {
    case "dt-google": {
      // 크롬 기본 PDF 뷰어·크롬 내부 화면처럼 콘텐츠 스크립트가 없는 곳은 작은 결과 창으로 보인다.
      if (!tab || tab.id === undefined || pdfUrl.isPdfUrl(tab.url)) return void openResultWindow(text);
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "show-card", text, engine: "google" }, { frameId: info.frameId ?? 0 });
      } catch {
        await openResultWindow(text);
      }
      return;
    }
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
      return { ok: true, ...(await translate(message.text, message.targetLang)) };
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
