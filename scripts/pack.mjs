/* 배포용 zip 만들기 — npm run pack
 * 외부 도구 없이 노드 내장 zlib만으로 dist/drag-translate-<버전>.zip을 만든다.
 * 크롬에 올리는 데 필요한 파일(manifest·icons·src·vendor·models·README)과 직원용 설치 안내(docs/설치안내.md)만 넣고,
 * 시험·개발 도구·캐시·docs의 나머지(스크린숏 등)는 뺀다.
 * zip을 풀어 그 폴더를 「압축해제된 확장 프로그램을 로드합니다」로 고르면 된다. */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 설치본에 꼭 있어야 하는 직원용 설치 안내. */
export const GUIDE = "docs/설치안내.md";
/** 넣을 것 — 맨 위 이름(또는 파일 하나의 상대 경로) 기준. */
export const INCLUDE = ["manifest.json", "README.md", GUIDE, "icons", "src", "vendor", "models"];
/** 어디에 있든 뺄 것. */
const EXCLUDE = /(^|\/)(node_modules|\.cache|\.git|test|dist)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$|\.test\.js$/;

/** 넣을 파일 목록(슬래시로 쓴 상대 경로, 이름순 — 같은 내용이면 같은 zip이 나오게). */
export function listFiles(root = ROOT) {
  const out = [];
  const walk = (path) => {
    const rel = relative(root, path).split(sep).join("/");
    if (EXCLUDE.test(rel)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) walk(join(path, name));
    } else {
      out.push(rel);
    }
  };
  for (const name of INCLUDE) {
    try {
      walk(join(root, name));
    } catch {
      // 없는 항목은 건너뛴다.
    }
  }
  return out.sort();
}

/* ── zip 쓰기(PKZIP 2.0: 저장 또는 deflate, 이름은 UTF-8) ── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 파일 시각은 고정 값(2026-10-12 00:00)으로 — 같은 내용이면 같은 zip이 나온다. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 12;

/** entries: [{ name, data(Buffer) }] → zip Buffer. */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function pack(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const files = listFiles(root);
  for (const need of ["manifest.json", GUIDE]) {
    if (!files.includes(need)) throw new Error(`설치본에 넣을 ${need}이(가) 없습니다.`);
  }
  const zip = buildZip(files.map((name) => ({ name, data: readFileSync(join(root, name)) })));
  const outDir = join(root, "dist");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `drag-translate-${manifest.version}.zip`);
  writeFileSync(outFile, zip);
  return { outFile, count: files.length, bytes: zip.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { outFile, count, bytes } = pack();
  console.log(`만들었습니다: ${relative(ROOT, outFile)} (파일 ${count}개, ${(bytes / 1024 / 1024).toFixed(1)}MB)`);
}
