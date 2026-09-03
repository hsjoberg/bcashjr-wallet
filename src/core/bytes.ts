import { hex } from "@scure/base";

export type Bytes = Uint8Array;

export const fromHex = (value: string): Bytes => hex.decode(value);
export const toHex = (value: Bytes): string => hex.encode(value);

export function concatBytes(...values: Bytes[]): Bytes {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

export function reverseBytes(value: Bytes): Bytes {
  return Uint8Array.from(value).reverse();
}

export function u32le(value: number): Bytes {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("Expected an unsigned 32-bit integer");
  }
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}

export function i64le(value: bigint): Bytes {
  if (value < -(1n << 63n) || value >= 1n << 63n) {
    throw new RangeError("Expected a signed 64-bit integer");
  }
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}

export function compactSize(value: number | bigint): Bytes {
  const n = typeof value === "number" ? BigInt(value) : value;
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("CompactSize value is out of range");
  }
  if (n < 0xfdn) return Uint8Array.of(Number(n));
  if (n <= 0xffffn) {
    const result = new Uint8Array(3);
    result[0] = 0xfd;
    new DataView(result.buffer).setUint16(1, Number(n), true);
    return result;
  }
  if (n <= 0xffff_ffffn) return concatBytes(Uint8Array.of(0xfe), u32le(Number(n)));
  const result = new Uint8Array(9);
  result[0] = 0xff;
  new DataView(result.buffer).setBigUint64(1, n, true);
  return result;
}

export function varBytes(value: Bytes): Bytes {
  return concatBytes(compactSize(value.length), value);
}

export function utf8(value: string): Bytes {
  return new TextEncoder().encode(value);
}

export function equalBytes(left: Bytes, right: Bytes): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function bytesToBase64(value: Bytes): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Bytes {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
