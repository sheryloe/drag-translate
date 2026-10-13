/* 내 PC에 맞는 모델 — 메모리·그래픽 메모리로 번역용·그림 읽기용 모델을 추천하고, 맞춤 모델 정의를 둔다.
 * 크기·라이선스는 2026-10-12 ollama.com/library와 Hugging Face 모델 카드에서 확인한 값이다.
 * 「실측」 표시는 RTX 4060 Laptop(그래픽 메모리 8GB)·메모리 32GB·Ollama 0.17.0에서 돌려 본 모델이다. */
(function (root) {
  "use strict";

  /** 모델 목록 — 번역은 작고 빠른 모델이 먼저다. size는 Ollama가 받는 4비트(Q4_K_M) 파일 크기(GB).
   *  measured: 이 노트북에서 돌려 본 결과를 note에 적었다. commercial: 회사 업무에 쓸 수 있는 라이선스인가. */
  const CATALOG = Object.freeze({
    "translategemma:4b": {
      size: 3.3,
      role: "번역",
      vision: false, // 그림 입력을 받긴 하지만 「글자 그대로 옮겨 적기」에는 빈 답을 냈다(실측)
      license: "Gemma 이용 약관",
      commercial: true,
      licenseNote: "상업 사용 허용, 구글 금지 용도 정책을 지켜야 함 — 사내 도입 전 약관 확인",
      note: "번역 전용 소형 모델(기본). 업무 문장 30개 중 오역 5건, 용어집을 넣으면 1건으로 비교한 모델 중 가장 적었고, 이어지는 짧은 문장 0.7~1.1초(실측, 그래픽카드). CPU만이면 약 5초.",
      measured: true,
    },
    "qwen3-vl:2b-instruct": {
      size: 1.9,
      role: "그림 읽기",
      vision: true,
      license: "Apache-2.0",
      commercial: true,
      licenseNote: "상업 사용 가능",
      note: "작은 시각 모델. 화면 글자 읽기 이어서 1초 안팎(실측). 번역도 하지만 기술 용어를 틀리게 옮겨(I&C → 이산화탄소) 번역용으로는 권하지 않음.",
      measured: true,
    },
    "translategemma:12b": {
      size: 8.1,
      role: "번역(품질 우선)",
      vision: false,
      license: "Gemma 이용 약관",
      commercial: true,
      licenseNote: "상업 사용 허용, 구글 금지 용도 정책을 지켜야 함 — 사내 도입 전 약관 확인",
      note: "품질을 더 원할 때. 용어집을 넣으면 업무 문장 30개 중 오역 0건이었지만 그래픽 메모리 8GB를 넘어 이어지는 짧은 문장 약 4.5초로 느리다(실측).",
      measured: true,
    },
    "qwen2.5vl:7b": {
      size: 6.0,
      role: "그림 읽기(품질 우선)",
      vision: true,
      license: "Apache-2.0",
      commercial: true,
      licenseNote: "상업 사용 가능",
      note: "줄바꿈을 살려 읽지만 이어서 읽기 10초 안팎, 처음 2분 남짓으로 느리고 한 줄을 빠뜨렸다(실측).",
      measured: true,
    },
    "qwen2.5:7b": {
      size: 4.7,
      role: "번역(범용)",
      vision: false,
      license: "Apache-2.0",
      commercial: true,
      licenseNote: "상업 사용 가능",
      note: "업무 문장 30개 중 오역 7건 — 중국어가 섞이고(反應堆…) 형상관리를 shape management로 옮겼다(실측). 권하지 않음.",
      measured: true,
    },
    "llama3.1:8b": {
      size: 4.9,
      role: "번역(범용)",
      vision: false,
      license: "Llama 3.1 Community License",
      commercial: true,
      licenseNote: "상업 사용 허용(월 사용자 7억 명 이하, 「Built with Llama」 표시 등 조건) — 사내 도입 전 약관 확인",
      note: "업무 문장 30개 중 오역 6건 — trip을 「여행」으로, 글 속 지시를 따라 시를 지었다(실측). 권하지 않음.",
      measured: true,
    },
    "gemma2:9b": {
      size: 5.4,
      role: "번역(범용)",
      vision: false,
      license: "Gemma 이용 약관",
      commercial: true,
      licenseNote: "상업 사용 허용, 구글 금지 용도 정책을 지켜야 함 — 사내 도입 전 약관 확인",
      note: "업무 문장 30개 중 오역 5건, 이어지는 짧은 문장 약 2.4초로 4B보다 느리다(실측). 권하지 않음.",
      measured: true,
    },
    "phi3.5:3.8b": {
      size: 2.2,
      role: "번역(범용)",
      vision: false,
      license: "MIT",
      commercial: true,
      licenseNote: "상업 사용 가능",
      note: "작지만 업무 문장 30개 중 오역 15건 이상 — 지시문을 답에 그대로 내거나 일본어로 답했다(실측). 쓰지 마세요.",
      measured: true,
    },
    "exaone3.5:7.8b": {
      size: 4.8,
      role: "번역(한국어)",
      vision: false,
      license: "EXAONE AI Model License 1.1 - NC",
      commercial: false,
      licenseNote: "비상업(NC) 라이선스 — 회사 업무에 쓰지 마세요",
      note: "한국어에 강하다고 알려졌지만 비상업 라이선스라 업무 사용 불가 — 추천에서 뺐다(엔진 동작 확인용으로만 실측).",
      measured: false,
    },
  });

  const RAM_CHOICES = Object.freeze([8, 16, 32]);
  const VRAM_CHOICES = Object.freeze([0, 4, 6, 8]);

  /** 메모리(GB)·그래픽 메모리(GB, 없으면 0) → 추천. 값은 고를 수 있는 칸 중 가까운 아래 칸으로 맞춘다.
   *  원칙: 소형 우선(번역 4B 이하 + 그림 읽기 2B, 합쳐 6GB 이하), 7B 이상은 「품질을 더 원할 때」로만 알린다. */
  function recommend(ramGb, vramGb) {
    const ram = [...RAM_CHOICES].reverse().find((value) => ramGb >= value) || RAM_CHOICES[0];
    const vram = [...VRAM_CHOICES].reverse().find((value) => vramGb >= value) || 0;
    let text = "translategemma:4b";
    let vision = "qwen3-vl:2b-instruct";
    let speed;
    const notes = [];
    const better = [];
    if (vram >= 8) {
      speed = "첫 번역 6~8초(모델 불러오기), 이어지는 짧은 문장 0.7~1.1초 — 실측: RTX 4060 8GB, 업무 문장 30개";
      if (ram >= 32) better.push("translategemma:12b", "qwen2.5vl:7b");
    } else if (vram >= 4) {
      speed = "이어지는 짧은 문장 1~3초(어림)";
      notes.push("두 모델을 번갈아 쓰면 그때마다 불러오느라 몇 초 더 걸립니다.");
    } else if (ram >= 16) {
      speed = "첫 번역 약 9초, 이어지는 짧은 문장 약 5초 — 실측: Ryzen 7 7435HS(8코어) CPU만";
      notes.push("그래픽 카드 없이 CPU로만 돌리면 느립니다. 7B 모델은 짧은 문장도 약 9초 걸려(실측) 4B 이하만 권합니다. 짧은 글 위주로 쓰세요.");
    } else {
      // 낮은 사양 — 2B 모델 하나로 번역과 그림 읽기를 함께 한다.
      text = "qwen3-vl:2b-instruct";
      speed = "이어지는 짧은 문장 5~15초(어림, CPU로만 돌림)";
      notes.push("메모리 8GB에서는 2B 모델 하나로 번역과 그림 읽기를 함께 합니다. 기술 용어는 용어집에 적어 두면 덜 틀립니다.");
    }
    notes.push("업무 문장은 용어집을 꼭 채우세요 — 계측제어 용어 29개를 넣자 오역이 30개 중 5건에서 1건으로 줄었습니다(실측, README 「실측」).");
    const total = vision === text ? CATALOG[text].size : CATALOG[text].size + CATALOG[vision].size;
    return {
      ram,
      vram,
      text: { name: text, ...CATALOG[text] },
      vision: { name: vision, ...CATALOG[vision] },
      download: Math.round(total * 10) / 10,
      speed,
      notes,
      better: better.map((name) => ({ name, ...CATALOG[name] })),
    };
  }

  /** 그래픽카드 이름(WebGL WEBGL_debug_renderer_info) → 그래픽 메모리 어림(GB). 내장 그래픽·알 수 없으면 0.
   *  크롬은 「ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x…) Direct3D11 …)」 꼴로 준다.
   *  같은 이름도 데스크톱·노트북판의 메모리가 달라 적은 쪽으로 잡는다. */
  function guessVram(renderer) {
    const name = String(renderer || "");
    if (!name || /SwiftShader|llvmpipe|Microsoft Basic Render|software/i.test(name)) return 0;
    const rtx = /RTX\s*(?:A)?(\d{4})/i.exec(name);
    if (rtx) {
      const tier = Number(rtx[1].slice(2)); // 4060 → 60
      const generation = Number(rtx[1].slice(0, 2)); // 4060 → 40
      if (tier >= 70) return 8;
      if (tier >= 60) return generation >= 40 ? 8 : 6;
      return 4;
    }
    if (/GTX\s*1[06][5-8]0|GTX\s*16\d0|Quadro|NVIDIA\s*T\d{3,4}|RTX\s*A\d{3,4}/i.test(name)) return 4;
    if (/Radeon\s*(?:RX|Pro)\s*\d|Arc\s*A\d{3}/i.test(name)) return 4;
    if (/NVIDIA|GeForce/i.test(name)) return 4;
    return 0; // Intel UHD·Iris, AMD Radeon(TM) Graphics(내장) 등
  }

  /** 확장에서 읽을 수 있는 PC 정보 → 사양 칸·가벼운/보통 판정·이유 한 줄.
   *  info: { deviceMemory: navigator.deviceMemory, cores: navigator.hardwareConcurrency, renderer: WebGL 그래픽카드 이름 }.
   *  크롬의 deviceMemory는 개인정보 때문에 8에서 끊겨(8 = 「8GB 이상」) 메모리는 코어 수로 한 번 더 어림한다.
   *  기준(실측, bench/samples.json): CPU만으로는 4B 번역 모델의 짧은 문장이 수 초 걸려 그래픽카드 4GB 이상이면 「보통」. */
  function guessSpec(info = {}) {
    const deviceMemory = Number(info.deviceMemory) || 0;
    const cores = Number(info.cores) || 0;
    const renderer = String(info.renderer || "").trim();
    const vram = guessVram(renderer);
    let ram;
    if (!deviceMemory) ram = cores >= 8 ? 16 : 8;
    else if (deviceMemory < 8) ram = 8;
    else ram = cores >= 12 ? 32 : cores >= 8 ? 16 : 8;
    const tier = vram >= 4 ? "normal" : "light";
    const gpu = renderer ? shortGpu(renderer) : "";
    const memoryText = deviceMemory ? (deviceMemory >= 8 ? "메모리 8GB 이상" : `메모리 약 ${deviceMemory}GB`) : "메모리 알 수 없음";
    const coreText = cores ? `CPU ${cores}스레드` : "CPU 알 수 없음";
    const gpuText = vram ? `그래픽카드 ${gpu}(약 ${vram}GB로 어림)` : gpu ? `내장 그래픽 ${gpu}` : "그래픽카드 확인 못 함";
    const reason =
      tier === "normal"
        ? `${gpuText}이 있어 보통 모델을 그래픽카드로 빠르게 돌릴 수 있습니다(${memoryText}, ${coreText}).`
        : `${gpuText} — 전용 그래픽카드가 없어 CPU로만 돌리므로 4B 이하 가벼운 모델을 권합니다(${memoryText}, ${coreText}).`;
    return { ram, vram, tier, tierLabel: tier === "normal" ? "보통 모델 권장" : "가벼운 모델 권장", reason };
  }

  /** 「ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)」 → 「NVIDIA GeForce RTX 4060 Laptop GPU」. */
  function shortGpu(renderer) {
    const angle = /^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s+Direct3D.*|\s+OpenGL.*|\s+Vulkan.*)?(?:,[^,]*)?\)$/i.exec(renderer);
    return (angle ? angle[2] : renderer).trim();
  }

  /** 맞춤 모델 — Ollama /api/create로 만들고, 같은 내용을 models/*.Modelfile에도 둔다(시험이 둘을 맞춰 본다).
   *  drag-translate: 번역 전용 TranslateGemma 바탕. 이 모델은 지시문을 사용자 메시지 안에서 받도록 배워
   *  SYSTEM을 넣지 않는다(확장이 요청마다 지시문을 붙인다). 온도를 낮추고, 6단계 나누기로 한 번에 보내는 글이
   *  짧으므로 문맥(num_ctx)을 2048로 줄여 빠르게 하고, 답 길이(num_predict)를 막아 되풀이를 끊는다.
   *  두 바탕 모델 모두 생각(추론) 출력이 없는 instruct 판이고, 확장은 요청에 think: false도 함께 보낸다.
   *  drag-translate-vision: 그림 속 글자를 그대로 옮겨 적게 하는 지시문을 SYSTEM에 둔다. */
  const CUSTOM_MODELS = Object.freeze([
    {
      name: "drag-translate",
      from: "translategemma:4b",
      parameters: { temperature: 0.1, num_ctx: 2048, num_predict: 1024 },
      system: "",
      purpose: "text",
    },
    {
      name: "drag-translate-vision",
      from: "qwen3-vl:2b-instruct",
      parameters: { temperature: 0, num_ctx: 4096, num_predict: 1536 },
      system:
        "You read text in images. Transcribe every piece of text in the image exactly as written, in reading order, keeping line breaks. Do not translate, summarize, describe, or add anything. If there is no text, reply with an empty message.",
      purpose: "vision",
    },
  ]);

  /** /api/create 요청 본문(Ollama 0.5 이후의 from·parameters·system 방식). */
  function createRequestBody(custom) {
    const body = { model: custom.name, from: custom.from, parameters: { ...custom.parameters }, stream: false };
    if (custom.system) body.system = custom.system;
    return body;
  }

  /** 같은 정의를 Modelfile 글로. */
  function modelfileText(custom) {
    const lines = [`FROM ${custom.from}`];
    for (const [key, value] of Object.entries(custom.parameters)) lines.push(`PARAMETER ${key} ${value}`);
    if (custom.system) lines.push(`SYSTEM """${custom.system}"""`);
    return `${lines.join("\n")}\n`;
  }

  /** /api/pull 진행 줄(NDJSON 한 줄) → 화면에 보일 상태. */
  function parsePullLine(line) {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return null;
    }
    if (!data || typeof data !== "object") return null;
    if (data.error) return { error: String(data.error) };
    const status = String(data.status || "");
    const percent = data.total > 0 && Number.isFinite(data.completed) ? Math.min(100, Math.floor((data.completed / data.total) * 100)) : null;
    return { status, percent, done: status === "success" };
  }

  /** 모델 크기 표시. */
  const sizeLabel = (gb) => `${gb.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}GB`;

  const api = { CATALOG, RAM_CHOICES, VRAM_CHOICES, CUSTOM_MODELS, recommend, guessVram, guessSpec, shortGpu, createRequestBody, modelfileText, parsePullLine, sizeLabel };
  root.DT = Object.assign(root.DT || {}, { models: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
