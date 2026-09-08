/**
 * Asset generators shared by the two rung-2 origins.
 *
 * Rung 2 serves the page from one origin and its font and one image from
 * another, so the off-origin guard's *allow* branch — subresources from any
 * origin are permitted and recorded (§6, "the crawl boundary") — is exercised
 * by a real request rather than only by a unit test. Both servers need the same
 * PNG encoder and the same licensed-font path, so it lives here rather than
 * being copied into the second one.
 */
import { deflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

/** A real, valid PNG: solid colour, w×h. Distinct bytes per colour and size. */
export function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x += 1) {
      // A faint gradient so the images are not literally identical.
      raw[off + 1 + x * 3] = (r + x) & 0xff;
      raw[off + 2 + x * 3] = (g + y) & 0xff;
      raw[off + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Inter, SIL OFL 1.1, from the pinned `@fontsource/inter` dependency.
 *
 * Not the OS copy: an OS-installed font makes the idempotency gate
 * non-reproducible on CI, which is the one thing that gate exists to be. Not a
 * committed binary either — a lockfile-pinned package is reproducible *and*
 * carries its own licence, which macOS's Noto copy ("All Rights Reserved", no
 * bundled licence) does not.
 */
export const FONT_PATH = fileURLToPath(
  new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url),
);
export const FONT_AVAILABLE = existsSync(FONT_PATH);
