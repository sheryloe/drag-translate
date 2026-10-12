/* PDF 번역 뷰어 — PDF.js로 쪽과 글자층을 그려, 드래그한 글을 번역 창으로 보낸다.
 * 크롬 기본 PDF 뷰어는 확장 프로그램이 선택한 글을 읽을 수 없어 이 뷰어를 따로 둔다. */
import * as pdfjsLib from "../../vendor/pdfjs/build/pdf.min.mjs";

// 뷰어 부품(pdf_viewer.mjs)은 globalThis.pdfjsLib를 읽으므로 먼저 세운 뒤 불러온다.
globalThis.pdfjsLib = pdfjsLib;
const { EventBus, PDFLinkService, PDFViewer } = await import("../../vendor/pdfjs/web/pdf_viewer.mjs");

const DT = globalThis.DT;
const VENDOR = new URL("../../vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${VENDOR}build/pdf.worker.min.mjs`;

const $ = (id) => document.getElementById(id);
const container = $("viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({
  container,
  viewer: $("viewer"),
  eventBus,
  linkService,
  textLayerMode: 1,
  annotationMode: pdfjsLib.AnnotationMode.ENABLE,
});
linkService.setViewer(viewer);

const translator = DT.ui.attachSelectionTranslator();

let loading = null;
let currentUrl = null;

/* ── 화면 알림 ─────────────────────────────────────── */

function showMessage(text, actions = []) {
  $("messageText").textContent = text;
  $("messageActions").replaceChildren(
    ...actions.map(({ label, primary, onClick }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (primary) button.className = "primary";
      button.addEventListener("click", onClick);
      return button;
    }),
  );
  $("message").hidden = false;
}

function hideMessage() {
  $("message").hidden = true;
}

const pickFile = { label: "파일 직접 열기", onClick: () => $("fileInput").click() };

async function showLoadError(error, url) {
  const actions = [];
  let text = `PDF를 불러오지 못했습니다.\n(${error && error.message ? error.message : error})`;
  if (url && url.startsWith("file:")) {
    const allowed = await new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve));
    if (!allowed) {
      text =
        "내 컴퓨터의 PDF를 이 뷰어로 열려면 권한이 하나 더 필요합니다.\n" +
        "크롬 확장 프로그램 관리 화면에서 「드래그 번역」의 「세부정보」를 열고 「파일 URL에 대한 액세스 허용」을 켜 주세요.\n" +
        "지금 바로 보려면 「파일 직접 열기」로 같은 파일을 고르면 됩니다.";
      actions.push({
        label: "확장 프로그램 관리 열기",
        primary: true,
        onClick: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
      });
    }
    actions.push(pickFile);
  } else if (url) {
    text += "\n로그인이 필요한 문서이거나 서버가 막았을 수 있습니다. 원래 뷰어로 열면 볼 수 있습니다(그때는 우클릭 메뉴로 번역).";
    actions.push({ label: "원래 뷰어로 보기", primary: true, onClick: openNative }, pickFile);
  } else {
    actions.push(pickFile);
  }
  showMessage(text, actions);
}

/* ── 문서 열기 ─────────────────────────────────────── */

async function openDocument(source, label, url) {
  hideMessage();
  if (loading) await loading.destroy().catch(() => {});
  currentUrl = url;
  $("native").hidden = !(url && /^https?:/i.test(url));
  $("title").textContent = label;
  document.title = `${label} — PDF 번역 뷰어`;
  loading = pdfjsLib.getDocument({
    ...source,
    cMapUrl: `${VENDOR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${VENDOR}standard_fonts/`,
    wasmUrl: `${VENDOR}wasm/`,
    iccUrl: `${VENDOR}iccs/`,
    isEvalSupported: false,
  });
  try {
    const doc = await loading.promise;
    viewer.setDocument(doc);
    linkService.setDocument(doc, null);
    $("pageCount").textContent = `/ ${doc.numPages}`;
    $("pageNumber").max = String(doc.numPages);
  } catch (error) {
    if (error && error.name === "AbortException") return;
    await showLoadError(error, url);
  }
}

/** 크롬 기본 뷰어로 다시 연다 — 서비스 워커가 이 주소만 자동 열기에서 빼 준 뒤 탭을 옮긴다. */
async function openNative() {
  if (!currentUrl) return;
  let reply = null;
  try {
    reply = await chrome.runtime.sendMessage({ type: "open-native", url: currentUrl });
  } catch {
    // 아래에서 알린다.
  }
  if (!reply || !reply.ok) showMessage(`원래 뷰어로 열지 못했습니다. ${reply && reply.error ? reply.error : ""}`, [pickFile]);
}

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showMessage("PDF 파일만 열 수 있습니다.", [pickFile]);
    return;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  await openDocument({ data }, file.name, null);
}

/* ── 이벤트 ───────────────────────────────────────── */

eventBus.on("pagesinit", () => {
  viewer.currentScaleValue = $("scale").value === "custom" ? "page-width" : $("scale").value;
  const page = /(?:^|&)page=(\d+)/.exec(location.hash.slice(1));
  if (page) viewer.currentPageNumber = Math.min(Number(page[1]), viewer.pagesCount);
});

eventBus.on("pagechanging", ({ pageNumber }) => {
  $("pageNumber").value = String(pageNumber);
  $("prev").disabled = pageNumber <= 1;
  $("next").disabled = pageNumber >= viewer.pagesCount;
});

eventBus.on("scalechanging", ({ presetValue, scale }) => {
  const select = $("scale");
  const preset = presetValue || String(scale);
  if ([...select.options].some((option) => option.value === preset && !option.hidden)) {
    select.value = preset;
  } else {
    const custom = select.querySelector('option[value="custom"]');
    custom.textContent = `${Math.round(scale * 100)}%`;
    custom.hidden = false;
    select.value = "custom";
  }
});

$("prev").addEventListener("click", () => viewer.previousPage());
$("next").addEventListener("click", () => viewer.nextPage());
$("pageNumber").addEventListener("change", (event) => {
  const value = Number(event.target.value);
  if (Number.isInteger(value) && value >= 1 && value <= viewer.pagesCount) viewer.currentPageNumber = value;
  else event.target.value = String(viewer.currentPageNumber);
});
$("zoomIn").addEventListener("click", () => viewer.increaseScale());
$("zoomOut").addEventListener("click", () => viewer.decreaseScale());
$("scale").addEventListener("change", (event) => {
  if (event.target.value !== "custom") viewer.currentScaleValue = event.target.value;
});
$("native").addEventListener("click", openNative);
$("region").addEventListener("click", () => DT.region.translateRegion(translator, cropPages));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openFile").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (event) => openFile(event.target.files[0]));

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  dragDepth += 1;
  $("drop").hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("drop").hidden = true;
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop").hidden = true;
  openFile(event.dataTransfer.files[0]);
});

/* ── 화면 영역 번역(스캔한 쪽) ─────────────────────────── */

/** 고른 영역에 걸친 쪽 그림(canvas)을 잘라 한 장으로 합친다 — 화면을 찍지 않고 그려 둔 쪽에서 바로 자르므로 또렷하다. */
async function cropPages(rect) {
  const scale = window.devicePixelRatio || 1;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width * scale));
  out.height = Math.max(1, Math.round(rect.height * scale));
  const context = out.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, out.width, out.height);
  let drawn = false;
  for (const canvas of container.querySelectorAll(".page canvas")) {
    const box = canvas.getBoundingClientRect();
    const left = Math.max(rect.x, box.left);
    const top = Math.max(rect.y, box.top);
    const right = Math.min(rect.x + rect.width, box.right);
    const bottom = Math.min(rect.y + rect.height, box.bottom);
    if (right <= left || bottom <= top || !box.width || !box.height) continue;
    const sx = canvas.width / box.width;
    const sy = canvas.height / box.height;
    context.drawImage(
      canvas,
      (left - box.left) * sx, (top - box.top) * sy, (right - left) * sx, (bottom - top) * sy,
      (left - rect.x) * scale, (top - rect.y) * scale, (right - left) * scale, (bottom - top) * scale,
    );
    drawn = true;
  }
  if (!drawn) throw new Error("고른 영역에 PDF 쪽이 없습니다.");
  // 모델에 맞는 크기로 — 너무 크면 줄이고, 한두 줄짜리는 키운다.
  const fit = DT.local.fitSize(out.width, out.height);
  let final = out;
  if (fit.width !== out.width || fit.height !== out.height) {
    final = document.createElement("canvas");
    final.width = fit.width;
    final.height = fit.height;
    const resized = final.getContext("2d");
    resized.imageSmoothingQuality = "high";
    resized.drawImage(out, 0, 0, fit.width, fit.height);
  }
  const blob = await new Promise((resolve) => final.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { image: btoa(binary), mime: "image/png" };
}

/** 팝업·우클릭 메뉴의 「화면 영역 골라 번역」 — 서비스 워커가 이 탭을 집어 알려 준다. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "viewer-pick-region") return;
  chrome.tabs.getCurrent((tab) => {
    if (!tab || tab.id !== message.tabId) return;
    sendResponse({ ok: true });
    DT.region.translateRegion(translator, cropPages);
  });
  return true;
});

/* ── 시작 ─────────────────────────────────────────── */

const fileUrl = DT.pdfUrl.fileFromSearch(location.search);
if (fileUrl) {
  openDocument({ url: fileUrl, withCredentials: true }, DT.pdfUrl.fileName(fileUrl), fileUrl);
} else {
  showMessage("번역할 PDF 파일을 이 창에 끌어 놓거나 「파일 열기」를 누르세요.\n열린 PDF에서 글자를 드래그하면 바로 번역합니다.", [
    { label: "파일 열기", primary: true, onClick: () => $("fileInput").click() },
  ]);
}
