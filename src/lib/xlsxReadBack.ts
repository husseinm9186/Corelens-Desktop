import { inflateRawSync } from 'node:zlib';

import { expect } from 'vitest';

import { crc32 } from './xlsx';

/**
 * A zip read back the way any reader does it: from the directory at the end
 * to each file's own header, checking the sizes and the checksum on the way.
 * For tests only: it asserts as it reads.
 */
export function unzipStored(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  expect(at + view.getUint32(end + 12, true)).toBe(end);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(start, start + packed);
    const bytes = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    expect(bytes.length).toBe(size);
    expect(crc32(bytes)).toBe(crc);
    out.set(name, dec.decode(bytes));
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}

