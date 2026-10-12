// 아이콘 PNG(16·32·48·128)를 그린다 — 파란 바탕에 글 세 줄, 가운데 줄은 드래그로 고른 것처럼 노란 띠.
// 외부 도구 없이 node 내장 zlib로 PNG를 만든다. 사용: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // 한 픽셀을 4×4로 나눠 가장자리를 부드럽게

const BLUE = [47, 111, 235];
const AMBER = [255, 184, 48];
const WHITE = [255, 255, 255];

/** 단위 좌표(0~1)의 둥근 사각형 안인가. */
function inRoundRect(x, y, [x0, y0, x1, y1], r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// 아래에서 위로 칠한다(뒤에 올수록 위).
const LAYERS = [
  { box: [0.03, 0.03, 0.97, 0.97], r: 0.22, color: BLUE },
  { box: [0.16, 0.41, 0.74, 0.59], r: 0.05, color: AMBER },
  { box: [0.2, 0.24, 0.8, 0.34], r: 0.05, color: WHITE },
  { box: [0.2, 0.45, 0.68, 0.55], r: 0.05, color: WHITE },
  { box: [0.2, 0.66, 0.58, 0.76], r: 0.05, color: WHITE },
];

function pixel(px, py, size) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = (px + (sx + 0.5) / SAMPLES) / size;
      const y = (py + (sy + 0.5) / SAMPLES) / size;
      let color = null;
      for (const layer of LAYERS) if (inRoundRect(x, y, layer.box, layer.r)) color = layer.color;
      if (color) {
        r += color[0];
        g += color[1];
        b += color[2];
        a += 255;
      }
    }
  }
  const n = SAMPLES * SAMPLES;
  const alpha = a / n;
  // 반투명 가장자리는 색을 알파로 나눠 되돌린다(미리 곱하지 않은 PNG 색).
  const k = a > 0 ? 255 / a : 0;
  return [Math.round(r * k), Math.round(g * k), Math.round(b * k), Math.round(alpha)];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // 줄마다 필터 없음
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      const at = y * (size * 4 + 1) + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 비트 깊이
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(join(root, "icons"), { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(root, "icons", `icon${size}.png`), png(size));
}
console.log(`아이콘 ${SIZES.join("·")}px을 icons/에 만들었습니다.`);
