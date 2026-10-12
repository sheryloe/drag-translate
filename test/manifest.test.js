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

test("PDF 뷰어가 쓰는 PDF.js 파일이 vendor에 있다", () => {
  for (const file of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "web/pdf_viewer.mjs", "web/pdf_viewer.css", "cmaps", "standard_fonts", "wasm", "iccs", "LICENSE"]) {
    assert.ok(exists(join("vendor/pdfjs", file)), file);
  }
});
