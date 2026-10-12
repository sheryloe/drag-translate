/* 설정 화면 — 바꾸는 즉시 저장한다. */
(async function () {
  "use strict";

  const DT = globalThis.DT;
  const $ = (id) => document.getElementById(id);
  let statusTimer = 0;

  for (const lang of DT.config.LANGUAGES) {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = lang.name;
    $("targetLang").append(option);
  }

  function paint(settings) {
    $("enabled").checked = settings.enabled;
    $("ignoreEditable").checked = settings.ignoreEditable;
    $("pdfAutoOpen").checked = settings.pdfAutoOpen;
    $("targetLang").value = settings.targetLang;
    $("minLength").value = String(settings.minLength);
    for (const radio of document.querySelectorAll('input[name="engine"]')) radio.checked = radio.value === settings.engine;
    for (const radio of document.querySelectorAll('input[name="trigger"]')) radio.checked = radio.value === settings.trigger;
  }

  async function save(patch) {
    paint(await DT.config.save(patch));
    $("status").textContent = "저장했습니다.";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => ($("status").textContent = ""), 1500);
  }

  paint(await DT.config.load());
  $("welcome").hidden = new URLSearchParams(location.search).get("welcome") !== "1" && !(await isFirstOpen());

  for (const id of ["enabled", "ignoreEditable", "pdfAutoOpen"]) {
    $(id).addEventListener("change", (event) => save({ [id]: event.target.checked }));
  }
  $("targetLang").addEventListener("change", (event) => save({ targetLang: event.target.value }));
  $("minLength").addEventListener("change", (event) => save({ minLength: Number(event.target.value) }));
  for (const name of ["engine", "trigger"]) {
    for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
      radio.addEventListener("change", () => save({ [name]: radio.value }));
    }
  }

  const allowed = await new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve));
  $("fileAccess").textContent = allowed
    ? "켜져 있습니다. file:///로 여는 PDF도 번역 뷰어로 볼 수 있습니다."
    : "꺼져 있습니다. 「확장 프로그램 관리 열기」 → 「세부정보」 → 「파일 URL에 대한 액세스 허용」을 켜면 file:///로 여는 PDF도 번역 뷰어로 열 수 있습니다. 켜지 않아도 「PDF 파일 열기」로 파일을 골라 볼 수 있습니다.";
  $("manage").addEventListener("click", () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
  $("openViewer").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/pdf/viewer.html") }));

  /** 설치 직후 처음 여는 설정 화면이면 안내를 보인다(한 번만). */
  async function isFirstOpen() {
    const { welcomed } = await chrome.storage.local.get("welcomed");
    if (welcomed) return false;
    await chrome.storage.local.set({ welcomed: true });
    return true;
  }
})();
