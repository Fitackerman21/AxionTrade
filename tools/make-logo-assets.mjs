// One-off generator for brand assets from the uploaded axion.png lockup
// (1536x1024 RGBA: glyph mark + "Axion" wordmark, near-black ink with blue/teal
// accents on transparent). Dark ink is invisible on the dark UI, so ink pixels
// are recoloured to a target colour while saturated accents are preserved.
//
// Writes:
//   public/brand/axion-lockup.png        light ink, full lockup
//   public/brand/axion-lockup-white.png  white ink, full lockup
//   public/brand/axion-mark.png          light ink, glyph crop
//   app/favicon.ico                      white mark, 256px ICO (PNG-compressed)
//   public/brand/meta.json               crop geometry for reference
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

const SRC = "/root/AxionTrade/axion.png";
const OUTDIR = "public/brand";
mkdirSync(OUTDIR, { recursive: true });

// ---------- PNG decode ----------
const buf = readFileSync(SRC);
let off = 8;
let width = 0, height = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString("ascii", off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
  } else if (type === "IDAT") idat.push(data);
  else if (type === "IEND") break;
  off += 12 + len;
}
if (!width) throw new Error("not a PNG");
const raw = inflateSync(Buffer.concat(idat));
const bpp = 4;
const stride = width * bpp;
const img = Buffer.alloc(height * stride);
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const rowIn = y * (stride + 1) + 1;
  const rowOut = y * stride;
  for (let x = 0; x < stride; x++) {
    const rawv = raw[rowIn + x];
    const left = x >= bpp ? img[rowOut + x - bpp] : 0;
    const up = y > 0 ? img[rowOut - stride + x] : 0;
    const ul = y > 0 && x >= bpp ? img[rowOut - stride + x - bpp] : 0;
    let v;
    if (f === 0) v = rawv;
    else if (f === 1) v = rawv + left;
    else if (f === 2) v = rawv + up;
    else if (f === 3) v = rawv + ((left + up) >> 1);
    else v = rawv + paeth(left, up, ul);
    img[rowOut + x] = v & 0xff;
  }
}
console.log("decoded", width, "x", height);

// ---------- geometry ----------
const idx = (x, y) => (y * width + x) * 4;
const rowOpaque = new Array(height).fill(0);
for (let y = 0; y < height; y++) {
  let c = 0;
  for (let x = 0; x < width; x++) if (img[idx(x, y) + 3] > 8) c++;
  rowOpaque[y] = c;
}
// split into vertical bands of consecutive non-empty rows
const bands = [];
let start = -1;
for (let y = 0; y <= height; y++) {
  const on = y < height && rowOpaque[y] > 0;
  if (on && start < 0) start = y;
  if (!on && start >= 0) {
    bands.push([start, y - 1]);
    start = -1;
  }
}
// merge bands separated by tiny gaps (<8px) — antialiasing can split strokes
const merged = [];
for (const b of bands) {
  const last = merged[merged.length - 1];
  if (last && b[0] - last[1] < 8) last[1] = b[1];
  else merged.push([...b]);
}
console.log("vertical bands:", merged.map((b) => b.join("..")).join(", "));

function bboxOfRows(y0, y1) {
  let minX = width, maxX = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      if (img[idx(x, y) + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return { x: minX, y: y0, w: maxX - minX + 1, h: y1 - y0 + 1 };
}
const markRect = bboxOfRows(merged[0][0], merged[0][1]);
const wordRect = merged.length > 1 ? bboxOfRows(merged[1][0], merged[1][1]) : null;
console.log("mark rect:", markRect, "word rect:", wordRect);
const union = {
  x: Math.min(markRect.x, wordRect ? wordRect.x : width),
  y: markRect.y,
  w: 0,
  h: 0,
};
union.w = Math.max(markRect.x + markRect.w, wordRect ? wordRect.x + wordRect.w : 0) - union.x;
union.h = (wordRect ? wordRect.y + wordRect.h : markRect.y + markRect.h) - union.y;
console.log("lockup rect:", union);

// ---------- recolour ----------
const LIGHT = [234, 236, 239]; // --foreground
const WHITE = [255, 255, 255];
function recolour(target) {
  const out = Buffer.from(img);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) continue;
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    const isAccent = maxc > 100 && maxc - minc > 60;
    if (!isAccent) {
      out[i] = target[0];
      out[i + 1] = target[1];
      out[i + 2] = target[2];
    }
  }
  return out;
}

// ---------- PNG encode ----------
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const st = w * 4;
  const rawOut = Buffer.alloc((st + 1) * h);
  for (let y = 0; y < h; y++) {
    rawOut[y * (st + 1)] = 2; // Up filter — artwork rows repeat vertically
    for (let x = 0; x < st; x++) {
      const cur = rgba[y * st + x];
      const up = y > 0 ? rgba[(y - 1) * st + x] : 0;
      rawOut[y * (st + 1) + 1 + x] = (cur - up) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rawOut, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crop(src, rect, pad) {
  const w = rect.w + pad * 2;
  const h = rect.h + pad * 2;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - pad + rect.x;
      const sy = y - pad + rect.y;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { w, h, data: out };
}

const lightSrc = recolour(LIGHT);
const whiteSrc = recolour(WHITE);

const lockup = crop(lightSrc, union, 8);
writeFileSync(`${OUTDIR}/axion-lockup.png`, encodePng(lockup.w, lockup.h, lockup.data));
console.log("wrote axion-lockup.png", lockup.w, "x", lockup.h);

const lockupW = crop(whiteSrc, union, 8);
writeFileSync(`${OUTDIR}/axion-lockup-white.png`, encodePng(lockupW.w, lockupW.h, lockupW.data));
console.log("wrote axion-lockup-white.png", lockupW.w, "x", lockupW.h);

const mark = crop(lightSrc, markRect, 8);
writeFileSync(`${OUTDIR}/axion-mark.png`, encodePng(mark.w, mark.h, mark.data));
console.log("wrote axion-mark.png", mark.w, "x", mark.h);

// small area-averaged mark for nav chrome (BrandMark renders ~26px)
function downscale(src, targetW) {
  const tw = targetW;
  const th = Math.round((src.h / src.w) * targetW);
  const out = Buffer.alloc(tw * th * 4);
  const rx = src.w / tw;
  const ry = src.h / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * rx), x1 = Math.min(src.w, Math.ceil((x + 1) * rx));
      const y0 = Math.floor(y * ry), y1 = Math.min(src.h, Math.ceil((y + 1) * ry));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * src.w + sx) * 4;
          const al = src.data[si + 3] / 255;
          r += src.data[si] * al; g += src.data[si + 1] * al; b += src.data[si + 2] * al;
          a += src.data[si + 3]; n++;
        }
      }
      const di = (y * tw + x) * 4;
      const al = a / 255 / Math.max(n, 1);
      const sum = al * n || 1;
      out[di] = Math.round(r / sum);
      out[di + 1] = Math.round(g / sum);
      out[di + 2] = Math.round(b / sum);
      out[di + 3] = Math.round(a / Math.max(n, 1));
    }
  }
  return { w: tw, h: th, data: out };
}
const markSm = downscale(mark, 128);
writeFileSync(`${OUTDIR}/axion-mark-sm.png`, encodePng(markSm.w, markSm.h, markSm.data));
console.log("wrote axion-mark-sm.png", markSm.w, "x", markSm.h);

// ---------- favicon: white mark contained in 256x256, ICO-wrapped PNG ----------
const side = Math.max(mark.w, mark.h);
const square = Buffer.alloc(side * side * 4);
{
  const ox = ((side - mark.w) / 2) | 0;
  const oy = ((side - mark.h) / 2) | 0;
  for (let y = 0; y < mark.h; y++) {
    for (let x = 0; x < mark.w; x++) {
      const si = (y * mark.w + x) * 4;
      const di = ((y + oy) * side + (x + ox)) * 4;
      square[di] = mark.data[si];
      square[di + 1] = mark.data[si + 1];
      square[di + 2] = mark.data[si + 2];
      square[di + 3] = mark.data[si + 3];
    }
  }
}
const FAV = 256;
const fav = Buffer.alloc(FAV * FAV * 4);
const ratio = side / FAV;
for (let y = 0; y < FAV; y++) {
  for (let x = 0; x < FAV; x++) {
    const sx = Math.min(((x + 0.5) * ratio) | 0, side - 1);
    const sy = Math.min(((y + 0.5) * ratio) | 0, side - 1);
    const si = (sy * side + sx) * 4;
    const di = (y * FAV + x) * 4;
    fav[di] = square[si];
    fav[di + 1] = square[si + 1];
    fav[di + 2] = square[si + 2];
    fav[di + 3] = square[si + 3];
  }
}
const favPng = encodePng(FAV, FAV, fav);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0; // 256 -> written as 0
header[7] = 0;
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(favPng.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync("app/favicon.ico", Buffer.concat([header, favPng]));
console.log("wrote app/favicon.ico", favPng.length + 22, "bytes");

writeFileSync(
  `${OUTDIR}/meta.json`,
  JSON.stringify({ source: "axion.png", markRect, wordRect, lockup: union }, null, 2),
);
console.log("wrote meta.json");
