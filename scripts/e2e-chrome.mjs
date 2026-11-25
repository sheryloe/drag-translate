/* 실제 크롬에 이 확장을 올려 내 PC 번역을 처음부터 끝까지 확인한다(사람 손 없이).
 *
 *   npm run e2e                      기본 모델(translategemma:4b)로
 *   set E2E_MODEL=qwen2.5:7b && npm run e2e
 *
 * 하는 일
 *   1. 따로 만든 크롬 프로필(.scratch/chrome-e2e)에 이 폴더를 확장으로 올려 띄운다(쓰는 크롬 프로필은 건드리지 않는다).
 *   2. 127.0.0.1에만 여는 시험 서버로 웹 페이지·PDF를 보여 준다. 글은 PC 밖으로 나가지 않는다(구글 엔진은 쓰지 않는다).
 *   3. 마우스로 실제로 드래그해 번역 창이 뜨고 내 PC 모델이 한국어로 옮기는지 본다.
 *   4. 결과를 표로 찍고 .scratch/e2e-result.json에 남긴다. 하나라도 틀리면 종료 코드 1.
 *
 * 크롬과 Ollama가 켜져 있어야 한다. 크롬 137부터 정식 크롬은 --load-extension을 무시하므로(크롬 157에서 확인)
 * 개발자 연결의 Extensions.loadUnpacked로 올린다. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const textTools = createRequire(import.meta.url)("../src/shared/text-tools.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRATCH = path.join(ROOT, ".scratch");
const PROFILE = path.join(SCRATCH, "chrome-e2e");
const RESULT_FILE = path.join(SCRATCH, "e2e-result.json");
const DEBUG_PORT = Number(process.env.E2E_PORT || 9333);
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const MODEL = process.env.E2E_MODEL || "translategemma:4b";
const OLLAMA = "http://127.0.0.1:11434";
const WAIT_MS = Number(process.env.E2E_WAIT || 300) * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── 크롬 개발자 연결(CDP) ── */

class Cdp {
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`크롬 개발자 연결을 열지 못했습니다: ${url}`));
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.waiting = new Map();
    this.listeners = new Set();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.waiting.has(message.id)) {
        const { resolve, reject } = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.next;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }

  async evaluate(sessionId, expression) {
    const reply = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (reply.exceptionDetails) {
      const detail = reply.exceptionDetails.exception ? reply.exceptionDetails.exception.description : reply.exceptionDetails.text;
      throw new Error(`페이지 안 실행 실패: ${detail}`);
    }
    return reply.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function poll(work, timeoutMs, everyMs = 300) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await work().catch(() => null);
    if (value) return value;
    if (Date.now() > until) return null;
    await sleep(everyMs);
  }
}

/** 압축 안 푼 확장의 ID — 시험용 프로필의 설정 파일(extensions.settings)에서 이 폴더를 가리키는 항목을 찾는다.
 *  크롬이 아직 파일을 안 썼으면 null(그때는 서비스 워커 주소로 찾는다). */
function unpackedExtensionId(folder) {
  const wanted = path.resolve(folder).toLowerCase();
  for (const name of ["Secure Preferences", "Preferences"]) {
    try {
      const prefs = JSON.parse(fs.readFileSync(path.join(PROFILE, "Default", name), "utf8"));
      const settings = (prefs.extensions && prefs.extensions.settings) || {};
      for (const [id, entry] of Object.entries(settings)) {
        if (entry && typeof entry.path === "string" && path.resolve(entry.path).toLowerCase() === wanted) return id;
      }
    } catch {
      // 파일이 아직 없거나 쓰는 중이다.
    }
  }
  return null;
}

async function devtoolsVersion() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  return response.json();
}

/** 시험용 크롬을 띄운다(이미 떠 있으면 그것을 쓴다). 돌려주는 값: 이 스크립트가 띄웠으면 그 프로세스. */
async function ensureChrome() {
  if (await devtoolsVersion().catch(() => null)) return null;
  if (!fs.existsSync(CHROME)) throw new Error(`크롬을 찾지 못했습니다: ${CHROME} (CHROME 환경 변수로 경로를 줄 수 있습니다)`);
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${PROFILE}`,
      "--enable-unsafe-extension-debugging",
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  if (!(await poll(() => devtoolsVersion(), 20_000))) throw new Error("시험용 크롬이 20초 안에 뜨지 않았습니다.");
  return child;
}

/* ── 127.0.0.1에만 여는 시험 서버 ── */

const SHORT =
  "The instrumentation and control system monitors reactor coolant pressure and trips the plant when the limit is exceeded.";
const LONG = [
  "The safety system shall be designed so that no single failure prevents the protective action. Each channel shall be physically and electrically independent from the other channels, and the separation shall be maintained from the sensor to the actuation device.",
  "Software for the plant protection system shall be developed under a documented life cycle. Requirements, design, implementation, and testing activities shall be traceable to each other, and every change shall be reviewed before it is released to the site.",
  "The operator shall be able to bypass one channel for maintenance without losing the protective function. The bypass status shall be indicated in the main control room, and the system shall automatically remove the bypass when the condition is no longer valid.",
];
const PDF_LINES = ["Reactor trip setpoints shall be verified during periodic surveillance testing.", "The test results shall be recorded and reviewed by qualified personnel."];

function pagePage() {
  const paragraphs = LONG.map((text, index) => `<p id="l${index}">${text}</p>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>drag-translate e2e</title>
<style>body{font:18px/1.6 Arial,sans-serif;margin:40px;max-width:760px}</style></head>
<body><p id="short">${SHORT}</p><hr>${paragraphs}
<p><textarea id="box" rows="2" cols="60">Text inside an input box should not be translated.</textarea></p></body></html>`;
}

/** 글자 두 줄짜리 PDF(Helvetica) — 바이트 자리(xref)를 맞춰 손으로 만든다. */
function makePdf(lines) {
  const escape = (line) => line.replace(/[()\\]/g, "\\$&");
  const content = `BT /F1 14 Tf 72 720 Td 20 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function startFixtureServer() {
  const pdf = makePdf(PDF_LINES);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return response.end(pagePage());
    }
    if (url.pathname === "/doc.pdf" || url.pathname === "/download") {
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length });
      return response.end(pdf);
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* ── 번역 창 읽기·마우스 ── */

/** 번역 창(그림자 DOM)의 지금 모습. 창이 없거나 숨었으면 null. */
const READ_CARD = `(() => {
  const host = document.querySelector("[data-drag-translate]");
  const root = host && host.shadowRoot;
  const card = root && root.querySelector(".card");
  if (!card || card.hidden) return null;
  const body = root.querySelector(".body");
  const foot = root.querySelector(".foot");
  const pressed = root.querySelector('.engines button[aria-pressed="true"]');
  return {
    cls: body ? body.className : "", text: body ? body.innerText : "", raw: body ? body.textContent : "", foot: foot ? foot.innerText : "", engine: pressed ? pressed.textContent : "",
    hosts: document.querySelectorAll("[data-drag-translate]").length,
    selection: String(document.getSelection() || "").slice(0, 120),
    html: card.innerHTML.replace(/<style[\\s\\S]*?<\\/style>/g, "").slice(0, 1500),
  };
})()`;

async function waitForResult(cdp, session, timeoutMs = WAIT_MS) {
  const started = Date.now();
  let last = null;
  const card = await poll(async () => {
    const value = await cdp.evaluate(session, READ_CARD);
    last = value;
    return value && !/loading/.test(value.cls) ? value : null;
  }, timeoutMs, 400);
  return { card, last, timeoutMs, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

async function drag(cdp, session, from, to) {
  const mouse = (type, point, extra = {}) =>
    cdp.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra }, session);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y }, session);
  await mouse("mousePressed", from);
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await mouse("mouseMoved", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  await mouse("mouseReleased", to);
}

/** 사람이 하듯 Esc로 창을 닫고 글이 없는 곳을 눌러 선택을 푼다.
 *  선택이 남은 채 그 위를 다시 누르면 크롬은 새 선택 대신 「선택한 글 끌어 옮기기」를 시작한다. */
async function dismiss(cdp, session) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, session);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, session);
  const blank = await cdp.evaluate(session, `(() => { const r = document.querySelector("hr").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 4 }; })()`);
  await drag(cdp, session, blank, blank);
  const left = await cdp.evaluate(session, `String(document.getSelection() || "")`);
  if (left) throw new Error(`선택이 풀리지 않았습니다: ${left.slice(0, 40)}`);
  await sleep(300);
}

/** 요소 글의 첫 글자 앞·마지막 글자 뒤 화면 좌표. */
const textEnds = (selectorFrom, selectorTo = selectorFrom) => `(() => {
  const first = document.querySelector(${JSON.stringify(selectorFrom)});
  const last = document.querySelector(${JSON.stringify(selectorTo)});
  if (!first || !last) return null;
  const range = document.createRange();
  const startNode = first.firstChild; const endNode = last.lastChild;
  range.setStart(startNode, 0); range.setEnd(startNode, 1);
  const a = range.getClientRects()[0];
  range.setStart(endNode, endNode.textContent.length - 1); range.setEnd(endNode, endNode.textContent.length);
  const rects = range.getClientRects(); const b = rects[rects.length - 1];
  if (!a || !b) return null;
  return { from: { x: a.left + 1, y: a.top + a.height / 2 }, to: { x: b.right - 1, y: b.top + b.height / 2 } };
})()`;

async function openTab(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Target.activateTarget", { targetId });
  await cdp.send("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}

async function closeTab(cdp, tab) {
  await cdp.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => {});
}

/** 콘텐츠 스크립트가 붙을 때까지 기다린다(document_idle). */
async function waitForContentScript(cdp, session) {
  await poll(() => cdp.evaluate(session, `document.readyState === "complete"`), 15_000);
  await sleep(600);
}

/* ── 확인 항목 ── */

const HANGUL = /[가-힣]/;
const results = [];

function record(name, ok, detail, extra = {}) {
  results.push({ name, ok, detail, ...extra });
  console.log(`${ok ? "통과" : "실패"} · ${name} · ${detail}`);
}

/** 번역 결과가 맞는지 — 오류가 아니고, 한글이 있고, 내 PC 표시가 붙었는가. */
function judgeTranslation(name, outcome, extraCheck) {
  const { card, seconds } = outcome;
  if (!card) {
    if (outcome.last) console.log(`  마지막 창 모습: ${JSON.stringify(outcome.last)}`);
    return record(name, false, `${Math.round(outcome.timeoutMs / 1000)}초 안에 번역 창이 끝나지 않았습니다${outcome.last ? "" : "(창이 뜨지 않음)"}`, { seconds });
  }
  if (!/^body( |$)/.test(card.cls) || card.hosts !== 1) console.log(`  창 모습: ${JSON.stringify(card)}`);
  if (/error/.test(card.cls)) return record(name, false, card.text, { seconds });
  const problems = [];
  if (!HANGUL.test(card.text)) problems.push("한국어 번역문이 아닙니다");
  if (!/밖으로 보내지 않음/.test(card.foot)) problems.push("「밖으로 보내지 않음」 표시가 없습니다");
  if (extraCheck) problems.push(...extraCheck(card));
  if (problems.length) console.log(`  창 모습: ${JSON.stringify(card)}`);
  record(name, problems.length === 0, problems.length ? `${problems.join(", ")}: ${card.text.slice(0, 80)}` : `${seconds}초 · ${card.text.slice(0, 60)}…`, { seconds, output: card.text });
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const tags = await fetch(`${OLLAMA}/api/tags`).then((response) => response.json()).catch(() => null);
  if (!tags) throw new Error("Ollama가 꺼져 있습니다. 켜고 다시 돌려 주세요.");
  if (!tags.models.some((item) => item.name === MODEL || item.name === `${MODEL}:latest`)) throw new Error(`Ollama에 「${MODEL}」이 없습니다(ollama pull ${MODEL}).`);
  if (process.env.OLLAMA_ORIGINS) console.log(`참고: OLLAMA_ORIGINS=${process.env.OLLAMA_ORIGINS} — 출처 바꾸기 규칙 없이도 통과할 수 있습니다.`);

  await ensureChrome();
  const cdp = await Cdp.open((await devtoolsVersion()).webSocketDebuggerUrl);
  const server = await startFixtureServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  let extensionId = "";

  try {
    // 확장 올리기 — 크롬 개발자 연결의 Extensions.loadUnpacked(크롬 126부터, --enable-unsafe-extension-debugging 필요).
    // 같은 폴더를 다시 올리면 새로 읽어 들인다(고친 코드가 바로 반영된다).
    try {
      ({ id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: ROOT }));
    } catch (error) {
      extensionId = unpackedExtensionId(ROOT) || "";
      if (!extensionId) throw new Error(`확장을 올리지 못했습니다: ${error.message} — 시험용 크롬을 끄고 다시 돌려 주세요.`);
    }

    // 확장의 서비스 워커를 찾는다(자고 있으면 설정 화면을 열어 깨운다).
    const findWorker = async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.find(
        (info) => info.type === "service_worker" && /\/src\/background\.js$/.test(info.url) && (!extensionId || info.url.startsWith(`chrome-extension://${extensionId}/`)),
      );
    };
    let worker = await findWorker();
    let wake = null;
    if (!worker && extensionId) {
      wake = await openTab(cdp, `chrome-extension://${extensionId}/src/options/options.html`);
      worker = await poll(findWorker, 10_000);
    }
    if (!worker) throw new Error(`확장이 올라가지 않았습니다(ID ${extensionId || "모름"}). 크롬을 끄고 다시 돌려 주세요.`);
    extensionId = new URL(worker.url).host;
    const extensionBase = `chrome-extension://${extensionId}/`;
    record("확장 올리기", true, `ID ${extensionId}`);
    const { sessionId: sw } = await cdp.send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
    await cdp.send("Runtime.enable", {}, sw);
    if (wake) await closeTab(cdp, wake);

    // 설정 — 내 PC 엔진, 드래그 즉시, 넉넉한 시간. 구글은 쓰지 않는다(시험 글을 밖으로 보내지 않게).
    await cdp.evaluate(
      sw,
      `self.DT.config.save({ enabled: true, engine: "local", trigger: "instant", localMode: "ollama", localServer: "${OLLAMA}", localModel: ${JSON.stringify(MODEL)}, localTimeout: 300, targetLang: "ko", pdfAutoOpen: true, ignoreEditable: true, glossary: "" }).then(() => true)`,
    );
    const rules = await cdp.evaluate(sw, `chrome.declarativeNetRequest.getDynamicRules().then((list) => list.map((rule) => rule.id))`);
    record("Ollama 출처 바꾸기 규칙 걸림", rules.includes(2), `걸린 규칙 ${JSON.stringify(rules)}`);

    // 1. 웹 페이지 — 짧은 문장을 드래그. 모델을 메모리에서 내려 두어 처음 켠 PC처럼 모델 불러오기부터 잰다.
    await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model: MODEL, keep_alive: 0 }) }).catch(() => {});
    const page = await openTab(cdp, `${base}/`);
    await waitForContentScript(cdp, page.sessionId);
    const short = await cdp.evaluate(page.sessionId, textEnds("#short"));
    await drag(cdp, page.sessionId, short.from, short.to);
    judgeTranslation("웹 페이지 드래그 → 내 PC 번역(첫 번역, 모델 불러오기 포함)", await waitForResult(cdp, page.sessionId));

    // 2. 같은 문장 다시 — 서비스 워커 기억(캐시)에서 바로 나와야 한다
    await dismiss(cdp, page.sessionId);
    await drag(cdp, page.sessionId, short.from, short.to);
    const again = await waitForResult(cdp, page.sessionId, 20_000);
    judgeTranslation("같은 글 다시 드래그(기억해 둔 번역)", again, () => (again.seconds > 3 ? [`${again.seconds}초 걸렸습니다(3초 넘음)`] : []));

    // 3. 문단 셋을 한꺼번에 — 700자 조각으로 나눠 차례로
    await dismiss(cdp, page.sessionId);
    const long =await cdp.evaluate(page.sessionId, textEnds("#l0", "#l2"));
    await drag(cdp, page.sessionId, long.from, long.to);
    const sawProgress = await poll(async () => {
      const card = await cdp.evaluate(page.sessionId, READ_CARD);
      return card && /조각/.test(card.text) ? card.text.split("\n")[0] : null;
    }, 30_000, 200);
    const selected = await cdp.evaluate(page.sessionId, `String(document.getSelection() || "")`);
    const chunks = textTools.splitForTranslation(textTools.joinBrokenLines(selected));
    console.log(`  선택 글 문단 이음새 ${JSON.stringify(selected.match(/\n+/g))} → 조각 ${chunks.length}개 ${JSON.stringify(chunks.map((chunk) => [chunk.text.length, chunk.sep]))}`);
    judgeTranslation("긴 글(문단 셋) 나눠 번역", await waitForResult(cdp, page.sessionId), (card) => {
      const problems = [];
      if (!sawProgress) problems.push("「n/전체 조각」 진행 표시를 보지 못했습니다");
      const paragraphs = card.text.split(/\n\s*\n/).filter((part) => part.trim()).length;
      if (paragraphs < 3) problems.push(`문단이 ${paragraphs}개입니다(원문 3개)`);
      return problems;
    });

    // 3-1. 「복사: 표」 — 단추를 실제로 눌러 클립보드에 HTML 표(제목 줄 + 문단 셋)와 탭 구분 글이 들어가는지
    await cdp.send("Browser.grantPermissions", { origin: base, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await cdp.send("Page.bringToFront", {}, page.sessionId);
    const copyButton = await cdp.evaluate(
      page.sessionId,
      `(() => { const root = document.querySelector("[data-drag-translate]").shadowRoot;
        const format = root.querySelector("select.copy-format"); format.value = "table"; format.dispatchEvent(new Event("change"));
        const r = [...root.querySelectorAll(".icon-btn")].find((b) => b.textContent === "복사").getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    await drag(cdp, page.sessionId, copyButton, copyButton);
    const clip = await poll(
      () =>
        cdp.evaluate(
          page.sessionId,
          `navigator.clipboard.read().then(async (items) => { const item = items[0]; const read = async (type) => item.types.includes(type) ? (await item.getType(type)).text() : ""; return { html: await read("text/html"), text: await read("text/plain") }; })`,
        ).then((value) => (value && value.text ? value : null)),
      5_000,
    );
    if (!clip) {
      record("「복사: 표」 클립보드", false, "클립보드에 아무것도 들어가지 않았습니다");
    } else {
      const rows = (clip.html.match(/<tr>/g) || []).length;
      const lines = clip.text.split(/\r?\n/); // 윈도 클립보드는 줄바꿈을 \r\n으로 바꿔 담는다
      const ok = rows === 4 && /<th/.test(clip.html) && lines[0] === "원문\t번역" && lines.length === 4 && lines.slice(1).every((line) => line.includes("\t"));
      record("「복사: 표」 클립보드", ok, `HTML 표 ${rows}줄(제목 포함), 글 ${lines.length}줄 · 첫 줄 ${JSON.stringify(lines[0])}`);
    }
    await cdp.evaluate(page.sessionId, `(() => { const f = document.querySelector("[data-drag-translate]").shadowRoot.querySelector("select.copy-format"); f.value = "translation"; f.dispatchEvent(new Event("change")); return true; })()`);

    // 4. 입력칸 안의 선택은 번역하지 않는다
    await dismiss(cdp, page.sessionId);
    const box =await cdp.evaluate(page.sessionId, `(() => { const r = document.querySelector("#box").getBoundingClientRect(); return { from: { x: r.left + 6, y: r.top + 14 }, to: { x: r.left + 200, y: r.top + 14 } }; })()`);
    await drag(cdp, page.sessionId, box.from, box.to);
    await sleep(1500);
    const boxCard = await cdp.evaluate(page.sessionId, READ_CARD);
    record("입력칸 안 선택은 번역하지 않음", !boxCard, boxCard ? `창이 떴습니다: ${boxCard.text.slice(0, 40)}` : "창 안 뜸");
    await closeTab(cdp, page);

    // 5. .pdf 주소 → 번역 뷰어로 열리고, 뷰어에서 드래그 번역
    const viewerPrefix = `${extensionBase}src/pdf/viewer.html`;
    const pdfTab = await openTab(cdp, `${base}/doc.pdf`);
    const viewerUrl = await poll(async () => {
      const url = await cdp.evaluate(pdfTab.sessionId, "location.href");
      return url.startsWith(viewerPrefix) ? url : null;
    }, 15_000);
    record(".pdf 주소를 번역 뷰어로 열기", Boolean(viewerUrl), viewerUrl ? "뷰어로 옮겨짐" : "뷰어로 옮겨지지 않음");
    if (viewerUrl) {
      const spans = await poll(
        () => cdp.evaluate(pdfTab.sessionId, `(() => { const list = [...document.querySelectorAll(".textLayer span")].filter((s) => s.textContent.trim()); return list.length ? list.length : null; })()`),
        20_000,
      );
      if (!spans) {
        record("PDF 뷰어 드래그 번역", false, "글자 층(.textLayer)이 그려지지 않았습니다");
      } else {
        await sleep(500);
        const ends = await cdp.evaluate(
          pdfTab.sessionId,
          `(() => { const list = [...document.querySelectorAll(".textLayer span")].filter((s) => s.textContent.trim()); const a = list[0].getBoundingClientRect(); const b = list[list.length - 1].getBoundingClientRect(); return { from: { x: a.left + 1, y: a.top + a.height / 2 }, to: { x: b.right - 1, y: b.top + b.height / 2 } }; })()`,
        );
        await drag(cdp, pdfTab.sessionId, ends.from, ends.to);
        judgeTranslation("PDF 뷰어 드래그 → 내 PC 번역", await waitForResult(cdp, pdfTab.sessionId));
      }
    }
    await closeTab(cdp, pdfTab);

    // 6. 주소가 .pdf로 끝나지 않는 PDF(download?id=1) — 머리(Content-Type)로 알아보고 뷰어로
    const download = await openTab(cdp, `${base}/download?id=1`);
    const downloadViewer = await poll(async () => {
      const url = await cdp.evaluate(download.sessionId, "location.href");
      return url.startsWith(viewerPrefix) ? url : null;
    }, 15_000);
    record(".pdf가 아닌 PDF 주소를 뷰어로 열기", Boolean(downloadViewer), downloadViewer ? "뷰어로 옮겨짐" : "크롬 기본 뷰어에 남음");
    await closeTab(cdp, download);

    // 7. 설정 화면 「연결 시험」
    const options = await openTab(cdp, `${extensionBase}src/options/options.html`);
    await poll(() => cdp.evaluate(options.sessionId, `document.readyState === "complete" && document.getElementById("localModel").value !== ""`), 10_000);
    await cdp.evaluate(options.sessionId, `document.getElementById("localTest").click(), true`);
    const test = await poll(async () => {
      const text = await cdp.evaluate(options.sessionId, `document.getElementById("localResult").innerText`);
      return text && !text.startsWith("시험하는 중") ? text : null;
    }, 120_000, 500);
    // 그림 읽기 줄(시각 모델 유무)은 글 번역과 따로라 판정에 넣지 않는다 — 첫 두 줄(연결·시험 번역)만 본다.
    const [connected = "", sample = ""] = (test || "").split("\n");
    record("설정 화면 「연결 시험」", connected.startsWith("연결됐습니다") && HANGUL.test(sample), test ? test.replace(/\s+/g, " ").slice(0, 160) : "답 없음");
    await closeTab(cdp, options);
  } finally {
    server.close();
    const summary = { when: new Date().toISOString(), model: MODEL, chrome: (await devtoolsVersion().catch(() => ({}))).Browser, results };
    fs.writeFileSync(RESULT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
    // 시험용 크롬(따로 만든 프로필)은 닫는다. 창을 남겨 들여다보려면 E2E_KEEP=1.
    if (!process.env.E2E_KEEP) await cdp.send("Browser.close").catch(() => {});
    cdp.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length}개 중 ${results.length - failed.length}개 통과 · 기록 ${path.relative(ROOT, RESULT_FILE)}`);
  process.exitCode = failed.length ? 1 : 0;
}

// 끝나면 바로 나간다 — 크롬 연결·타이머가 남아 노드가 기다리지 않게.
main()
  .catch((error) => {
    console.error(`멈춤: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
