const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const models = require("../src/shared/models.js");
const config = require("../src/shared/config.js");

test("추천은 소형 우선 — 번역·그림 읽기 모델을 합쳐 6GB 이하로", () => {
  for (const ram of models.RAM_CHOICES) {
    for (const vram of models.VRAM_CHOICES) {
      const pick = models.recommend(ram, vram);
      assert.ok(pick.download <= 6, `${ram}/${vram}: ${pick.download}GB`);
      assert.ok(pick.text.size <= 3.5 && pick.vision.size <= 3.5, "기본값은 4B 이하");
      assert.equal(pick.vision.vision, true, "그림 읽기 모델은 시각 모델");
      assert.equal(pick.text.commercial, true, "기본값은 회사 업무에 쓸 수 있는 라이선스");
      assert.equal(pick.vision.commercial, true);
    }
  }
});

test("이 노트북(RTX 4060 8GB·메모리 32GB)은 소형 기본 + 7B급은 품질 우선 선택으로만", () => {
  const pick = models.recommend(32, 8);
  assert.equal(pick.text.name, "translategemma:4b");
  assert.equal(pick.vision.name, "qwen3-vl:2b-instruct");
  assert.equal(pick.download, 5.2);
  assert.deepEqual(pick.better.map((item) => item.name), ["translategemma:12b", "qwen2.5vl:7b"]);
  assert.equal(pick.text.name, config.DEFAULTS.localModel, "설정 기본값과 같다");
  assert.equal(pick.vision.name, config.DEFAULTS.localVisionModel);
});

test("낮은 사양(그래픽 없음·메모리 8GB)은 2B 모델 하나로", () => {
  const pick = models.recommend(8, 0);
  assert.equal(pick.text.name, pick.vision.name);
  assert.equal(pick.download, 1.9);
  assert.equal(models.recommend(4, 0).ram, 8, "칸보다 작으면 가장 작은 칸");
  assert.equal(models.recommend(64, 24).vram, 8, "칸보다 크면 가장 큰 칸");
});

test("비상업 라이선스 모델은 추천에 나오지 않는다", () => {
  const nonCommercial = Object.entries(models.CATALOG).filter(([, item]) => !item.commercial).map(([name]) => name);
  assert.deepEqual(nonCommercial, ["exaone3.5:7.8b"]);
  for (const ram of models.RAM_CHOICES) {
    for (const vram of models.VRAM_CHOICES) {
      const pick = models.recommend(ram, vram);
      for (const name of [pick.text.name, pick.vision.name, ...pick.better.map((item) => item.name)]) assert.ok(!nonCommercial.includes(name));
    }
  }
});

test("그래픽카드 이름으로 그래픽 메모리 어림 — 내장 그래픽·소프트웨어 렌더러는 0", () => {
  const cases = [
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)", 8],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)", 6],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Ti Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)", 4],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)", 8],
    ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)", 4],
    ["ANGLE (AMD, AMD Radeon RX 6600M Direct3D11 vs_5_0 ps_5_0, D3D11)", 4],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", 0],
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", 0],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", 0],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", 0],
    ["", 0],
  ];
  for (const [renderer, vram] of cases) assert.equal(models.guessVram(renderer), vram, renderer);
});

test("PC 정보로 가벼운/보통 모델 판정과 이유 한 줄", () => {
  const laptop = models.guessSpec({
    deviceMemory: 8,
    cores: 16,
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  });
  assert.deepEqual([laptop.ram, laptop.vram, laptop.tier, laptop.tierLabel], [32, 8, "normal", "보통 모델 권장"]);
  assert.match(laptop.reason, /NVIDIA GeForce RTX 4060 Laptop GPU/);
  assert.doesNotMatch(laptop.reason, /ANGLE|Direct3D|0x/);

  const office = models.guessSpec({ deviceMemory: 8, cores: 8, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)" });
  assert.deepEqual([office.ram, office.vram, office.tier, office.tierLabel], [16, 0, "light", "가벼운 모델 권장"]);
  assert.match(office.reason, /내장 그래픽 Intel\(R\) UHD Graphics 620/);
  assert.match(office.reason, /CPU로만/);

  const small = models.guessSpec({ deviceMemory: 4, cores: 4 });
  assert.deepEqual([small.ram, small.vram, small.tier], [8, 0, "light"]);
  assert.match(small.reason, /그래픽카드 확인 못 함/);

  const unknown = models.guessSpec();
  assert.equal(unknown.tier, "light", "아무것도 모르면 가벼운 쪽으로");
  for (const spec of [laptop, office, small, unknown]) {
    assert.ok(models.RAM_CHOICES.includes(spec.ram) && models.VRAM_CHOICES.includes(spec.vram), "설정 화면의 칸에 그대로 넣을 수 있다");
    assert.equal(spec.reason.split("\n").length, 1, "이유는 한 줄");
  }
});

test("models/*.Modelfile은 맞춤 모델 정의와 같다", () => {
  for (const custom of models.CUSTOM_MODELS) {
    const file = readFileSync(join(__dirname, "..", "models", `${custom.name}.Modelfile`), "utf8");
    const body = file.split("\n").filter((line) => !line.startsWith("#")).join("\n");
    assert.equal(body, models.modelfileText(custom), custom.name);
    assert.ok(models.CATALOG[custom.from], `${custom.from}은 목록에 있는 모델`);
    assert.ok(custom.parameters.temperature <= 0.2);
    assert.ok(custom.parameters.num_ctx <= 4096);
    assert.ok(custom.parameters.num_predict > 0);
  }
});

test("/api/create 본문 — from·parameters, SYSTEM은 있을 때만", () => {
  const [text, vision] = models.CUSTOM_MODELS;
  assert.deepEqual(models.createRequestBody(text), {
    model: "drag-translate",
    from: "translategemma:4b",
    parameters: { temperature: 0.1, num_ctx: 2048, num_predict: 1024 },
    stream: false,
  });
  const body = models.createRequestBody(vision);
  assert.equal(body.from, "qwen3-vl:2b-instruct");
  assert.match(body.system, /Transcribe every piece of text/);
});

test("/api/pull 진행 줄 읽기", () => {
  assert.deepEqual(models.parsePullLine('{"status":"pulling manifest"}'), { status: "pulling manifest", percent: null, done: false });
  assert.deepEqual(models.parsePullLine('{"status":"pulling abc","total":200,"completed":50}'), { status: "pulling abc", percent: 25, done: false });
  assert.deepEqual(models.parsePullLine('{"status":"success"}'), { status: "success", percent: null, done: true });
  assert.deepEqual(models.parsePullLine('{"error":"pull model manifest: file does not exist"}'), { error: "pull model manifest: file does not exist" });
  assert.equal(models.parsePullLine("not json"), null);
});
