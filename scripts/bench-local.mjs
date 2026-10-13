/* 내 PC 번역 실측 — 확장의 로컬 엔진 코드(src/shared/local-llm.js)를 그대로 써서 실제 Ollama 서버에 붙여 본다.
 * 쓰는 법: npm run bench:local -- [모델 …] [--cpu] [--only en-01,ko-01] [--vision 그림모델] [--out 이름]
 *   모델     여럿을 차례로 잰다(기본: translategemma:4b). 쉼표로 이어 적어도 된다.
 *   --cpu    Ollama 요청에 num_gpu: 0을 넣어 그래픽카드 없이 CPU로만 돌린다(그래픽카드 없는 PC 어림).
 *   --only   bench/samples.json 중 이 id만 돈다(쉼표로 구분).
 *   --glossary 용어집 파일(예: bench/glossary-ic.txt)을 확장과 같은 방법으로 넣는다.
 *   --vision 그림 읽기 모델을 함께 잰다(docs/screenshot-pdf.jpg).
 *   --out    결과 파일 이름(기본: bench-날짜시각). 결과는 .scratch/에 .md(표)와 .json으로 남긴다.
 * 모델마다 돌고 있는 모델을 모두 내려 둔 뒤(keep_alive 0) 첫 번역(모델 불러오기 포함)과 이어지는 번역의 시간을 따로 잰다.
 * 서버 주소는 http://localhost:11434 고정 — 내 PC 밖으로는 아무것도 보내지 않는다. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const local = require(join(root, "src/shared/local-llm.js"));
const textTools = require(join(root, "src/shared/text-tools.js"));

const SERVER = "http://localhost:11434";
/** 짧은 문장 기준(글자 수) — 「짧은 문장 2초 안쪽」 판정에 쓴다. */
const SHORT = 80;

/* ── 인자 읽기 ── */
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const cpuAt = args.indexOf("--cpu");
const cpuOnly = cpuAt >= 0;
if (cpuOnly) args.splice(cpuAt, 1);
const only = flag("--only");
const visionModel = flag("--vision");
const glossaryFile = flag("--glossary");
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const outName = flag("--out") || `bench-${stamp}`;
const models = args.flatMap((arg) => arg.split(",")).map((name) => name.trim()).filter(Boolean);
if (!models.length) models.push("translategemma:4b");

const { samples: allSamples } = JSON.parse(readFileSync(join(root, "bench/samples.json"), "utf8"));
const wanted = only ? new Set(only.split(",").map((id) => id.trim())) : null;
const samples = wanted ? allSamples.filter((sample) => wanted.has(sample.id)) : allSamples;
/** 용어집 — 확장과 같이 글에 나오는 용어만 지시문에 넣는다(text-tools.js). */
const glossary = glossaryFile ? textTools.parseGlossary(readFileSync(join(root, glossaryFile), "utf8")) : [];

/* ── 도움 함수 ── */
const seconds = (start) => (Date.now() - start) / 1000;
const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const average = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN);

/** --cpu일 때 대화 요청에 num_gpu: 0을 넣는다. 확장 코드는 그대로 두고 보내는 길목에서만 바꾼다. */
function fetchFor(cpu) {
  if (!cpu) return undefined;
  return (url, init) => {
    if (init && typeof init.body === "string" && /\/api\/chat$/.test(url)) {
      const body = JSON.parse(init.body);
      body.options = { ...(body.options || {}), num_gpu: 0 };
      init = { ...init, body: JSON.stringify(body) };
    }
    return fetch(url, init);
  };
}

/** 돌고 있는 모델을 모두 내린다 — 다음 모델의 첫 번역에 불러오기 시간이 온전히 들어가게. */
async function unloadAll() {
  const data = await fetch(`${SERVER}/api/ps`).then((response) => response.json()).catch(() => null);
  for (const item of (data && data.models) || []) {
    await fetch(`${SERVER}/api/generate`, { method: "POST", body: JSON.stringify({ model: item.name, keep_alive: 0 }) }).catch(() => {});
  }
}

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/* ── 출처 확인 ── 크롬 확장은 「Origin: chrome-extension://…」을 붙인다. 확장은 이 출처를 local.LOCAL_ORIGIN으로 바꿔 보낸다(background.js). */
for (const origin of ["chrome-extension://abcdefghijklmnop", local.LOCAL_ORIGIN]) {
  const response = await fetch(`${SERVER}/api/tags`, { headers: { Origin: origin } }).catch(() => null);
  console.log(`[출처 확인] Origin: ${origin} → ${response ? response.status : "연결 실패"}`);
}
console.log(`표본 ${samples.length}개 · 모델 ${models.join(", ")}${cpuOnly ? " · CPU만(num_gpu 0)" : ""}${glossaryFile ? ` · 용어집 ${glossaryFile}(${glossary.length}개)` : ""}`);

/* ── 모델마다 표본을 차례로 번역 ── */
const report = { date: new Date().toISOString(), cpuOnly, glossary: glossaryFile || null, shortLimit: SHORT, models: [] };
for (const model of models) {
  await unloadAll();
  const opts = { mode: "ollama", server: SERVER, model, timeout: 600 };
  const doFetch = fetchFor(cpuOnly);
  const rows = [];
  for (const [index, sample] of samples.entries()) {
    const start = Date.now();
    let output;
    let error;
    try {
      const lines = glossary.length ? textTools.glossaryLinesFor(glossary, sample.text) : undefined;
      output = (await local.translateLocal(sample.text, sample.target, opts, doFetch, lines)).text;
    } catch (caught) {
      error = caught.message;
    }
    const took = seconds(start);
    rows.push({ id: sample.id, target: sample.target, chars: [...sample.text].length, seconds: round(took), first: index === 0, output, error });
    console.log(`[${model}] ${sample.id} ${took.toFixed(1)}초${index === 0 ? " (첫 번역, 불러오기 포함)" : ""}\n  ${sample.text}\n  → ${error ? `오류: ${error}` : output}`);
  }
  const rest = rows.filter((row) => !row.first && !row.error);
  const short = rest.filter((row) => row.chars <= SHORT);
  const summary = {
    model,
    first: rows[0] ? rows[0].seconds : null,
    restAverage: round(average(rest.map((row) => row.seconds))),
    shortAverage: round(average(short.map((row) => row.seconds))),
    shortMax: round(Math.max(...short.map((row) => row.seconds))),
    longAverage: round(average(rest.filter((row) => row.chars > SHORT).map((row) => row.seconds))),
    errors: rows.filter((row) => row.error).length,
  };
  console.log(`[${model}] 첫 번역 ${summary.first}초 · 이어지는 문장 평균 ${summary.restAverage}초 · 짧은 문장 평균 ${summary.shortAverage}초(최대 ${summary.shortMax}초) · 긴 문장 평균 ${summary.longAverage}초 · 오류 ${summary.errors}`);
  report.models.push({ summary, rows });
}

/* ── 그림 읽기(선택) ── */
if (visionModel) {
  const image = readFileSync(join(root, "docs/screenshot-pdf.jpg")).toString("base64");
  const opts = { mode: "ollama", server: SERVER, model: visionModel, visionModel, timeout: 600 };
  await unloadAll();
  for (const label of ["첫 읽기, 모델 불러오기 포함", "이어서 읽기"]) {
    const start = Date.now();
    try {
      const out = await local.recognizeImage(image, opts, fetchFor(cpuOnly), "image/jpeg");
      console.log(`[그림 읽기] ${seconds(start).toFixed(1)}초 (${label})\n  ${out.replace(/\n/g, "\n  ")}`);
    } catch (error) {
      console.log(`[그림 읽기] 오류: ${error.message}`);
    }
  }
}

/* ── 결과 남기기(.scratch/) ── */
const lines = [
  `# 내 PC 번역 실측 ${report.date}${cpuOnly ? " (CPU만, num_gpu 0)" : ""}${glossaryFile ? ` (용어집 ${glossaryFile})` : ""}`,
  "",
  `짧은 문장 = ${SHORT}자 이하. 첫 번역은 모델 불러오기 포함, 나머지는 이어지는 번역.`,
  "",
  "| 모델 | 첫 번역(초) | 이어지는 평균(초) | 짧은 문장 평균(초) | 짧은 문장 최대(초) | 긴 문장 평균(초) | 오류 |",
  "|---|---|---|---|---|---|---|",
  ...report.models.map(({ summary: s }) => `| ${s.model} | ${s.first} | ${s.restAverage} | ${s.shortAverage} | ${s.shortMax} | ${s.longAverage} | ${s.errors} |`),
  "",
  `| id | 원문 | ${models.join(" | ")} |`,
  `|---|---|${models.map(() => "---").join("|")}|`,
  ...samples.map((sample, index) => `| ${sample.id} | ${cell(sample.text)} | ${report.models.map(({ rows }) => cell(rows[index].error ? `오류: ${rows[index].error}` : `${rows[index].output} (${rows[index].seconds}초)`)).join(" | ")} |`),
  "",
];
mkdirSync(join(root, ".scratch"), { recursive: true });
writeFileSync(join(root, ".scratch", `${outName}.md`), lines.join("\n"), "utf8");
writeFileSync(join(root, ".scratch", `${outName}.json`), JSON.stringify(report, null, 2), "utf8");
console.log(`결과: .scratch/${outName}.md, .scratch/${outName}.json`);
