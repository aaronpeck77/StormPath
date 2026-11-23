/**
 * Minimal PNG codec for compositing inside a Worker.
 * decode: any 8-bit PNG → RGBA. encode: RGBA → PNG (filter 0 rows).
 * Uses Workers' built-in deflate streams — no dependencies.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out: number[] = [];
  const reader = new Response(
    new Blob([data]).stream().pipeThrough(ds)
  ).body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const b of value) out.push(b);
  }
  return Uint8Array.from(out);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const out: number[] = [];
  const reader = new Response(
    new Blob([data]).stream().pipeThrough(cs)
  ).body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const b of value) out.push(b);
  }
  return Uint8Array.from(out);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export interface RgbaImage {
  w: number;
  h: number;
  data: Uint8Array; // RGBA, w*h*4
}

export async function decodePng(png: Uint8Array): Promise<RgbaImage> {
  const dv = new DataView(png.buffer, png.byteOffset);
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error("not png");
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  while (pos < png.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!);
    const chunk = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12);
      bitDepth = png[pos + 16]!; colorType = png[pos + 17]!;
    } else if (type === "PLTE") plte = chunk;
    else if (type === "tRNS") trns = chunk;
    else if (type === "IDAT") idatParts.push(chunk.slice());
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} unsupported`);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (bpp === undefined) throw new Error(`colorType ${colorType} unsupported`);

  let idatLen = 0;
  for (const p of idatParts) idatLen += p.length;
  const idat = new Uint8Array(idatLen);
  let off = 0;
  for (const p of idatParts) { idat.set(p, off); off += p.length; }
  const raw = await inflate(idat);

  const stride = w * bpp;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let srcOff = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[srcOff++]!;
    const line = raw.subarray(srcOff, srcOff + stride);
    srcOff += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
      }
      cur[x] = v;
    }
    // expand to RGBA
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      if (colorType === 6) {
        px[d] = cur[s]!; px[d + 1] = cur[s + 1]!; px[d + 2] = cur[s + 2]!; px[d + 3] = cur[s + 3]!;
      } else if (colorType === 2) {
        px[d] = cur[s]!; px[d + 1] = cur[s + 1]!; px[d + 2] = cur[s + 2]!; px[d + 3] = 255;
      } else if (colorType === 3) {
        const idx = cur[s]! * 3;
        px[d] = plte![idx]!; px[d + 1] = plte![idx + 1]!; px[d + 2] = plte![idx + 2]!;
        px[d + 3] = trns && trns[cur[s]!] !== undefined ? trns[cur[s]!]! : 255;
      } else if (colorType === 0) {
        px[d] = px[d + 1] = px[d + 2] = cur[s]!; px[d + 3] = 255;
      } else {
        px[d] = px[d + 1] = px[d + 2] = cur[s]!; px[d + 3] = cur[s + 1]!;
      }
    }
    prev = cur;
  }
  return { w, h, data: px };
}

export async function encodePng(img: RgbaImage): Promise<Uint8Array> {
  const { w, h, data } = img;
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = await deflate(raw);

  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, body: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const head = new Uint8Array(4 + t.length + body.length);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, body.length);
    head.set(t, 4);
    head.set(body, 4 + t.length);
    for (const b of head) out.push(b);
    const crc = crc32(head.subarray(4));
    for (const b of [crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]) out.push(b);
  };

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));
  return Uint8Array.from(out);
}

/** Alpha-blend `top` onto `base` at (x, y). */
export function composite(base: RgbaImage, top: RgbaImage, x0: number, y0: number): void {
  for (let y = 0; y < top.h; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= base.h) continue;
    for (let x = 0; x < top.w; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= base.w) continue;
      const s = (y * top.w + x) * 4;
      const d = (dy * base.w + dx) * 4;
      const a = top.data[s + 3]! / 255;
      if (a === 0) continue;
      base.data[d] = Math.round(top.data[s]! * a + base.data[d]! * (1 - a));
      base.data[d + 1] = Math.round(top.data[s + 1]! * a + base.data[d + 1]! * (1 - a));
      base.data[d + 2] = Math.round(top.data[s + 2]! * a + base.data[d + 2]! * (1 - a));
      base.data[d + 3] = Math.min(255, top.data[s + 3]! + base.data[d + 3]!);
    }
  }
}
