// PDF.js(pdfjs-dist)에서 확장 프로그램이 쓰는 파일만 vendor/pdfjs로 복사한다.
// 사용: npm install && npm run vendor          (node_modules/pdfjs-dist에서)
//       node scripts/vendor-pdfjs.mjs <폴더>    (풀어 둔 pdfjs-dist 패키지 폴더에서)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2]
  ? resolve(process.argv[2])
  : dirname(createRequire(join(root, "package.json")).resolve("pdfjs-dist/package.json"));
const target = join(root, "vendor", "pdfjs");

if (!existsSync(join(source, "build", "pdf.min.mjs"))) {
  console.error(`pdfjs-dist 패키지를 찾지 못했습니다: ${source}\n먼저 npm install을 실행하세요.`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const copy = (from, to = from) => cpSync(join(source, from), join(target, to), { recursive: true });
copy("build/pdf.min.mjs");
copy("build/pdf.worker.min.mjs");
copy("web/pdf_viewer.mjs");
copy("web/pdf_viewer.css");
copy("web/images");
copy("cmaps"); // 한글·한자 글꼴이 든 PDF를 읽는 데 필요
copy("standard_fonts");
copy("iccs");
copy("LICENSE");
mkdirSync(join(target, "wasm"), { recursive: true });
for (const file of readdirSync(join(source, "wasm"))) {
  // PDF 안의 자바스크립트는 실행하지 않으므로 그 실행기(quickjs)는 뺀다.
  if (!file.startsWith("quickjs")) copy(`wasm/${file}`);
}

writeFileSync(
  join(target, "README.md"),
  `# PDF.js ${version}\n\n` +
    "[Mozilla PDF.js](https://github.com/mozilla/pdf.js)의 배포판(pdfjs-dist)에서 이 확장 프로그램이 쓰는 파일만 복사했다.\n" +
    "라이선스는 같은 폴더의 LICENSE(Apache License 2.0)와 wasm/LICENSE_* 를 따른다.\n\n" +
    "다시 만들기: `npm install && npm run vendor`\n",
);
console.log(`PDF.js ${version}을 ${target}에 복사했습니다.`);
