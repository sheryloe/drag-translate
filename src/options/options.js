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
    $("joinLines").checked = settings.joinLines;
    $("copyFormat").value = settings.copyFormat;
    $("targetLang").value = settings.targetLang;
    $("minLength").value = String(settings.minLength);
    for (const radio of document.querySelectorAll('input[name="engine"]')) radio.checked = radio.value === settings.engine;
    for (const radio of document.querySelectorAll('input[name="trigger"]')) radio.checked = radio.value === settings.trigger;
    for (const radio of document.querySelectorAll('input[name="localMode"]')) radio.checked = radio.value === settings.localMode;
    $("localServer").value = settings.localServer;
    $("localModel").value = settings.localModel;
    $("localVisionModel").value = settings.localVisionModel;
    $("localTimeout").value = String(settings.localTimeout);
    $("localParallel").value = String(settings.localParallel);
    if (document.activeElement !== $("glossary")) $("glossary").value = settings.glossary;
    current = settings;
  }

  let current = DT.config.DEFAULTS;
  /** Ollama에 받아 둔 모델 이름(읽지 못했으면 null). */
  let installed = null;

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

  $("copyFormat").addEventListener("change", (event) => save({ copyFormat: event.target.value }));
  for (const id of ["enabled", "ignoreEditable", "pdfAutoOpen", "joinLines"]) {
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
  $("localVisionModel").addEventListener("change", (event) => save({ localVisionModel: event.target.value.trim() }));
  $("localTimeout").addEventListener("change", (event) => save({ localTimeout: Number(event.target.value) }));
  $("localParallel").addEventListener("change", (event) => save({ localParallel: Number(event.target.value) }));
  $("glossary").addEventListener("change", async (event) => {
    await save({ glossary: event.target.value });
    const count = DT.text.parseGlossary(event.target.value).length;
    showStatus(`용어집을 저장했습니다(${count}개).`);
  });

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
      installed = reply.models;
      renderRecommend();
      const vision = reply.vision ? `\n${reply.vision.message}` : "";
      showLocalResult(`연결됐습니다. (${(reply.ms / 1000).toFixed(1)}초)\n시험 번역: ${reply.sample}${vision}`, reply.vision && reply.vision.ok === false ? "error" : "ok");
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

  /* ── 내 PC에 맞는 모델 ── */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showModelResult(text, kind) {
    $("modelResult").textContent = text;
    $("modelResult").className = `result ${kind || ""}`;
  }

  const isInstalled = (name) => Array.isArray(installed) && installed.some((item) => item === name || item.replace(/:latest$/, "") === name);

  /** 추천 모델 한 칸 — 이름·크기·라이선스·설명과 「받기」·「이 모델 쓰기」 단추. */
  function pickRow(title, item, settingKey) {
    const row = el("div", "pick");
    row.append(el("span", "name", `${title}: ${item.name}`));
    const actions = el("div", "actions");
    if (isInstalled(item.name)) actions.append(el("span", "have", "받아 둠"));
    else if (current.localMode === "ollama") {
      const pull = el("button", "btn", `받기(${DT.models.sizeLabel(item.size)})`);
      pull.type = "button";
      pull.addEventListener("click", () => pullModel(item.name));
      actions.append(pull);
    }
    if (settingKey && current[settingKey] !== item.name) {
      const use = el("button", "btn", "이 모델 쓰기");
      use.type = "button";
      use.addEventListener("click", () => save({ [settingKey]: item.name }));
      actions.append(use);
    } else if (settingKey) {
      actions.append(el("span", "have", "쓰는 중"));
    }
    row.append(actions);
    const license = el("span", item.commercial ? "meta" : "meta warn", `${DT.models.sizeLabel(item.size)} · ${item.license} — ${item.licenseNote}`);
    row.append(license, el("span", "desc", item.note));
    return row;
  }

  function renderRecommend() {
    const pick = DT.models.recommend(Number($("specRam").value), Number($("specVram").value));
    const box = $("recommend");
    const rows = [pickRow("번역용", pick.text, "localModel")];
    if (pick.vision.name !== pick.text.name) rows.push(pickRow("그림 읽기용", pick.vision, "localVisionModel"));
    else rows.push(el("div", "summary", "그림 읽기도 같은 모델로 합니다."));
    const summary = el("div", "summary", `받는 양 합계 약 ${DT.models.sizeLabel(pick.download)} · 속도: ${pick.speed}`);
    const notes = [...pick.notes];
    if (pick.better.length) notes.push(`품질을 더 원할 때(크고 느림): ${pick.better.map((item) => `${item.name}(${DT.models.sizeLabel(item.size)})`).join(", ")}`);
    if (notes.length) {
      const list = el("ul");
      for (const note of notes) list.append(el("li", "", note));
      summary.append(list);
    }
    if (installed === null) summary.append(el("div", "muted", "Ollama가 꺼져 있거나 막혀 있어 받아 둔 모델을 읽지 못했습니다. 「연결 시험」으로 원인을 확인하세요."));
    box.replaceChildren(...rows, summary);
  }

  async function refreshInstalled() {
    try {
      installed = (await DT.bridge.listLocalModels()).models;
      fillModels(installed);
    } catch {
      installed = null;
    }
    renderRecommend();
  }

  /** 모델 받기 — 서비스 워커가 /api/pull을 부르고 진행률을 연결(port)로 보내 준다. 창을 닫으면 멈춘다. */
  let pulling = null;
  function pullModel(name) {
    if (pulling) return showModelResult("이미 받는 중입니다. 끝난 뒤 다시 눌러 주세요.", "error");
    const progress = $("pullProgress");
    progress.hidden = false;
    progress.removeAttribute("value");
    showModelResult(`「${name}」 받는 중… 이 창을 닫으면 멈춥니다.`);
    pulling = chrome.runtime.connect({ name: "local-pull" });
    const finish = (text, kind) => {
      progress.hidden = true;
      showModelResult(text, kind);
      if (pulling) pulling.disconnect();
      pulling = null;
      refreshInstalled();
    };
    pulling.onMessage.addListener((message) => {
      if (message.error) return finish(`받지 못했습니다. ${message.error}`, "error");
      if (message.finished) return finish(`「${name}」을(를) 받았습니다.`, "ok");
      if (message.percent !== null && message.percent !== undefined) {
        progress.value = message.percent;
        showModelResult(`「${name}」 받는 중… ${message.percent}%`);
      }
    });
    pulling.onDisconnect.addListener(() => {
      if (pulling) finish("받기가 끊겼습니다. 명령 창에서 「ollama pull " + name + "」로 받아도 됩니다.", "error");
    });
    pulling.postMessage({ model: name });
  }

  /** 맞춤 모델 만들기 — 바탕 모델이 있는 것만 만들고, 만든 모델을 쓰도록 설정을 바꾼다. */
  $("createCustom").addEventListener("click", async () => {
    const button = $("createCustom");
    button.disabled = true;
    showModelResult("맞춤 모델을 만드는 중…");
    const done = [];
    const skipped = [];
    try {
      for (const custom of DT.models.CUSTOM_MODELS) {
        if (Array.isArray(installed) && !isInstalled(custom.from)) {
          skipped.push(`${custom.name}(바탕 모델 ${custom.from}을 먼저 받아 주세요)`);
          continue;
        }
        await DT.bridge.createLocalModel(custom.name);
        done.push(custom);
      }
      const patch = {};
      for (const custom of done) patch[custom.purpose === "vision" ? "localVisionModel" : "localModel"] = custom.name;
      if (done.length) await save(patch);
      const lines = [];
      if (done.length) lines.push(`만들고 설정에 넣었습니다: ${done.map((custom) => custom.name).join(", ")}`);
      if (skipped.length) lines.push(`건너뜀: ${skipped.join(", ")}`);
      showModelResult(lines.join("\n"), skipped.length ? "error" : "ok");
    } catch (error) {
      showModelResult(`만들지 못했습니다. ${error && error.message ? error.message : error}`, "error");
    } finally {
      button.disabled = false;
      refreshInstalled();
    }
  });

  /** 그래픽카드 이름 — WebGL이 알려 주는 렌더러(없거나 막혀 있으면 빈 글). */
  function gpuRenderer() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return "";
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    } catch {
      return "";
    }
  }

  /** 이 PC 사양 어림 — 판정은 models.js의 순수 함수(guessSpec)가 한다. */
  const guess = DT.models.guessSpec({ deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, renderer: gpuRenderer() });
  $("specGuess").textContent = `자동 판정: ${guess.tierLabel} — ${guess.reason}`;

  /** 고른 사양은 이 PC에만 기억한다. 고른 적이 없으면 자동 판정으로 채운다. */
  const { pcSpec } = await chrome.storage.local.get("pcSpec");
  $("specRam").value = String(pcSpec ? pcSpec.ram : guess.ram);
  $("specVram").value = String(pcSpec ? pcSpec.vram : guess.vram);
  for (const id of ["specRam", "specVram"]) {
    $(id).addEventListener("change", () => {
      chrome.storage.local.set({ pcSpec: { ram: Number($("specRam").value), vram: Number($("specVram").value) } });
      renderRecommend();
    });
  }
  DT.config.onChange((settings) => {
    current = settings;
    renderRecommend();
  });
  refreshInstalled();

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
