const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const exists = (file) => existsSync(join(root, file));

test("매니페스트 3판이고 필요한 권한만 쓴다", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ["contextMenus", "declarativeNetRequest", "storage"]);
});

test("매니페스트가 가리키는 파일이 모두 있다", () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
  ];
  for (const file of files) assert.ok(exists(file), file);
});

test("콘텐츠 스크립트는 설정 → 엔진 → 글 다듬기 → 연결 → 번역 창 → 영역 고르기 → 시작 순서로 싣는다", () => {
  assert.deepEqual(manifest.content_scripts[0].js, [
    "src/shared/config.js",
    "src/shared/engines.js",
    "src/shared/text-tools.js",
    "src/shared/bridge.js",
    "src/ui/card.js",
    "src/ui/region.js",
    "src/content/content.js",
  ]);
});

test("HTML 화면이 부르는 스크립트·스타일 파일이 모두 있다(인라인 스크립트 없음)", () => {
  for (const page of ["src/pdf/viewer.html", "src/popup/popup.html", "src/options/options.html", "src/result/result.html"]) {
    const html = readFileSync(join(root, page), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page}: 확장 프로그램 보안 정책상 인라인 스크립트는 막힌다`);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^[a-z]+:/i.test(ref)) continue;
      assert.ok(existsSync(join(root, page, "..", ref)), `${page} → ${ref}`);
    }
  }
});

test("서비스 워커가 불러오는 공용 스크립트가 있다", () => {
  const source = readFileSync(join(root, "src/background.js"), "utf8");
  const [, list] = /importScripts\(([^)]*)\)/.exec(source);
  for (const [, file] of list.matchAll(/"([^"]+)"/g)) assert.ok(exists(join("src", file)), file);
});

test("매니페스트 판과 package.json 판이 같다(설치본 이름이 매니페스트 판을 쓴다)", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
});

test("내 PC 서버(localhost)에 요청하고 출처 규칙을 걸 권한이 있다", () => {
  // 서비스 워커의 fetch와 출처(Origin) 바꾸기 규칙(modifyHeaders)은 요청 주소에 대한 호스트 권한이 있어야 듣는다.
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
});

test("서비스 워커는 비동기 답을 위해 true를 돌려주고, 일하는 동안 깨워 두며, 출처 규칙을 건 뒤 요청한다", () => {
  const source = readFileSync(join(root, "src/background.js"), "utf8");
  const listener = /chrome\.runtime\.onMessage\.addListener\(\(message, sender, sendResponse\) => \{([\s\S]*?)\n\}\);/.exec(source);
  assert.ok(listener, "onMessage 리스너");
  assert.match(listener[1], /keepAwake\(/);
  assert.match(listener[1], /await originReady/);
  assert.match(listener[1], /return true;\s*$/);
  assert.match(source, /local\.localOriginRule\(chrome\.runtime\.id\)/);
  assert.match(source, /setInterval\(\(\) => chrome\.runtime\.getPlatformInfo\(\)/);
  // 같은 규칙 번호를 PDF 규칙과 함께 쓰지 않는다.
  const local = require("../src/shared/local-llm.js");
  assert.notEqual(local.ORIGIN_RULE_ID, Number(/const PDF_RULE_ID = (\d+)/.exec(source)[1]));
});

test("크롬에서만 도는 스크립트(서비스 워커·화면)도 문법 오류가 없다", () => {
  const vm = require("node:vm");
  const files = ["src/background.js", "src/content/content.js", "src/ui/card.js", "src/ui/region.js", "src/popup/popup.js", "src/options/options.js", "src/result/result.js", "src/shared/bridge.js"];
  for (const file of files) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(join(root, file), "utf8"), { filename: file }), file);
  }
});

test("PDF 뷰어가 쓰는 PDF.js 파일이 vendor에 있다", () => {
  for (const file of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "web/pdf_viewer.mjs", "web/pdf_viewer.css", "cmaps", "standard_fonts", "wasm", "iccs", "LICENSE"]) {
    assert.ok(exists(join("vendor/pdfjs", file)), file);
  }
});
