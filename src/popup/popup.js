/* 도구 막대 팝업 — 켜기·끄기, 엔진, 언어를 바로 바꾸고 PDF를 번역 뷰어로 연다. */
(async function () {
  "use strict";

  const DT = globalThis.DT;
  const $ = (id) => document.getElementById(id);
  const VIEWER_PAGE = chrome.runtime.getURL("src/pdf/viewer.html");

  for (const lang of DT.config.LANGUAGES) {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = lang.name;
    $("targetLang").append(option);
  }

  function paint(settings) {
    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("off", !settings.enabled);
    $("state").textContent = settings.enabled ? "드래그하면 바로 번역합니다" : "꺼져 있습니다";
    for (const radio of document.querySelectorAll('input[name="engine"]')) radio.checked = radio.value === settings.engine;
    $("targetLang").value = settings.targetLang;
    $("localRow").hidden = settings.engine !== "local";
    $("localInfo").textContent = `${settings.localModel} · ${settings.localServer.replace(/^https?:\/\//, "")}`;
  }

  paint(await DT.config.load());

  $("enabled").addEventListener("change", async (event) => paint(await DT.config.save({ enabled: event.target.checked })));
  for (const radio of document.querySelectorAll('input[name="engine"]')) {
    radio.addEventListener("change", async () => paint(await DT.config.save({ engine: radio.value })));
  }
  $("targetLang").addEventListener("change", async (event) => paint(await DT.config.save({ targetLang: event.target.value })));

  $("localTest").addEventListener("click", async () => {
    const result = $("localResult");
    $("localTest").disabled = true;
    result.className = "result";
    result.textContent = "시험하는 중…";
    try {
      const reply = await DT.bridge.testLocal();
      result.className = "result ok";
      result.textContent = `연결됐습니다. 시험 번역: ${reply.sample}`;
    } catch (error) {
      result.className = "result error";
      result.textContent = error && error.message ? error.message : String(error);
    } finally {
      $("localTest").disabled = false;
    }
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && DT.pdfUrl.isPdfUrl(tab.url)) {
    $("openThisPdf").hidden = false;
    $("openThisPdf").addEventListener("click", async () => {
      await chrome.tabs.update(tab.id, { url: DT.pdfUrl.viewerUrl(VIEWER_PAGE, tab.url) });
      window.close();
    });
  }
  $("openPdfFile").addEventListener("click", async () => {
    await chrome.tabs.create({ url: VIEWER_PAGE });
    window.close();
  });
  $("options").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
