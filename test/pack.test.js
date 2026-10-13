const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const load = () => import("../scripts/pack.mjs");

test("배포 묶음에는 크롬에 필요한 파일만 들어간다", async () => {
  const { listFiles } = await load();
  const files = listFiles(root);
  for (const need of ["manifest.json", "README.md", "docs/설치안내.md", "src/background.js", "src/shared/local-llm.js", "src/shared/page-limits.js", "icons/icon128.png", "vendor/pdfjs/build/pdf.min.mjs", "models/drag-translate.Modelfile"]) {
    assert.ok(files.includes(need), need);
  }
  for (const file of files) {
    assert.doesNotMatch(file, /^(test|scripts|node_modules|\.cache|dist)\/|^package(-lock)?\.json$|\.test\.js$/, file);
  }
  // docs에서는 직원용 설치 안내 한 장만 넣는다(스크린숏 등 개발 자료는 뺀다).
  assert.deepEqual(files.filter((file) => file.startsWith("docs/")), ["docs/설치안내.md"]);
  // 매니페스트가 가리키는 파일이 모두 묶음에 있다.
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const file of [manifest.background.service_worker, manifest.options_page, ...manifest.content_scripts[0].js]) assert.ok(files.includes(file), file);
});

test("설치 안내는 다섯 단계와 일괄 설치 절을 담고, 특정 모델 이름은 쓰지 않는다(추천은 설정 화면이 정한다)", () => {
  const guide = readFileSync(join(root, "docs/설치안내.md"), "utf8");
  for (const heading of ["## ① ", "## ② ", "## ③ ", "## ④ ", "## ⑤ ", "## 개발자 모드 없이 회사에서 일괄 설치하려면"]) {
    assert.ok(guide.includes(heading), heading);
  }
  for (const word of ["압축해제된 확장 프로그램을 로드합니다", "설정 화면의 추천 모델", "연결 시험", "403", "ExtensionInstallForcelist", "IT 담당 부서가 결정할 사항"]) {
    assert.ok(guide.includes(word), word);
  }
  assert.doesNotMatch(guide, /translategemma|qwen|exaone|gemma|llama\d|mistral|phi\d|[a-z][\w.-]*:\d+(\.\d+)?b\b/i, "모델 이름을 적지 않는다");
});

test("zip을 다시 읽으면 이름·내용·CRC가 원래와 같다", async () => {
  const { buildZip, crc32 } = await load();
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "CRC-32 표준 시험값");
  const entries = [
    { name: "manifest.json", data: Buffer.from('{"a":1}') },
    { name: "src/한글.txt", data: Buffer.from("가".repeat(500)) },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ];
  const zip = buildZip(entries);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), entries.length);
  let at = zip.readUInt32LE(end + 16);
  for (const entry of entries) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    assert.equal(name, entry.name);
    const localName = zip.readUInt16LE(offset + 26);
    const body = zip.subarray(offset + 30 + localName, offset + 30 + localName + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.deepEqual(data, entry.data, name);
    assert.equal(crc, crc32(entry.data));
    at += 46 + nameLength;
  }
});
