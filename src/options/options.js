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
    for (const radio of document.querySelectorAll('input[name="localMode"]')) radio.checked = radio.value === settings.localMode;
    $("localServer").value = settings.localServer;
    $("localModel").value = settings.localModel;
    $("localTimeout").value = String(settings.localTimeout);
  }

  function showStatus(text) {
    $("status").textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => ($("status").textContent = ""), 3000);
  }

  async function save(patch) {
    paint(await DT.config.save(patch));
    showStatus("저장했습니다.");
  }

  paint(await DT.config.load());
  $("welcome").hidden = new URLSearchParams(location.search).get("welcome") !== "1" && !(await isFirstOpen());

  for (const id of ["enabled", "ignoreEditable", "pdfAutoOpen"]) {
    $(id).addEventListener("change", (event) => save({ [id]: event.target.checked }));
  }
  $("targetLang").addEventListener("change", (event) => save({ targetLang: event.target.value }));
  $("minLength").addEventListener("change", (event) => save({ minLength: Number(event.target.value) }));
  /* ── 내 PC 번역 ── */
  for (const radio of document.querySelectorAll('input[name="localMode"]')) {
    radio.addEventListener("change", async () => {
      // 다른 방식의 기본 주소를 쓰고 있었다면 고른 방식의 기본 주소로 함께 바꾼다.
      const current = await DT.config.load();
      const servers = DT.config.LOCAL_SERVERS;
      const patch = { localMode: radio.value };
      if (Object.values(servers).includes(current.localServer)) patch.localServer = servers[radio.value];
      save(patch);
    });
  }
  $("localServer").addEventListener("change", async (event) => {
    const server = DT.config.normalizeServerUrl(event.target.value);
    if (!server) {
      paint(await DT.config.load());
      showLocalResult("서버 주소는 localhost·127.0.0.1·[::1]만 쓸 수 있습니다. 보안 문서가 PC 밖으로 나가지 않게 하려는 것입니다.", "error");
      return;
    }
    save({ localServer: server });
  });
  $("localModel").addEventListener("change", (event) => save({ localModel: event.target.value.trim() }));
  $("localTimeout").addEventListener("change", (event) => save({ localTimeout: Number(event.target.value) }));

  function showLocalResult(text, kind) {
    $("localResult").textContent = text;
    $("localResult").className = `result ${kind || ""}`;
  }

  $("localTest").addEventListener("click", async () => {
    const button = $("localTest");
    button.disabled = true;
    showLocalResult("시험하는 중… 모델을 처음 불러올 때는 수십 초 걸릴 수 있습니다.");
    try {
      const reply = await DT.bridge.testLocal();
      fillModels(reply.models);
      showLocalResult(`연결됐습니다. (${(reply.ms / 1000).toFixed(1)}초)\n시험 번역: ${reply.sample}`, "ok");
    } catch (error) {
      showLocalResult(error && error.message ? error.message : String(error), "error");
    } finally {
      button.disabled = false;
    }
  });

  function fillModels(models) {
    if (!Array.isArray(models)) return;
    $("localModels").replaceChildren(
      ...models.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        return option;
      }),
    );
  }

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
