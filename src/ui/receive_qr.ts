import { encode, QrCodeDataType, type QrCodeGenerateResult } from "uqr";

export const QR_ALPHANUMERIC_MODE = 0b0010;
const QR_ALPHANUMERIC_CHARACTERS = /^[A-Z0-9 $%*+./:-]+$/u;

export interface ReceiveQrData {
  payload: string;
  matrix: boolean[][];
  size: number;
  mode: number;
}

function maskApplies(pattern: number, x: number, y: number): boolean {
  switch (pattern) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return x * y % 2 + x * y % 3 === 0;
    case 6:
      return (x * y % 2 + x * y % 3) % 2 === 0;
    case 7:
      return ((x + y) % 2 + x * y % 3) % 2 === 0;
    default:
      throw new Error("QR generator returned an invalid mask pattern");
  }
}

/** Reads the first four unmasked data bits, which are the QR segment mode indicator. */
export function readQrMode(qr: QrCodeGenerateResult): number {
  const bits: number[] = [];
  for (let right = qr.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < qr.size; vertical++) {
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        const upwards = ((right + 1) & 2) === 0;
        const y = upwards ? qr.size - 1 - vertical : vertical;
        if (qr.types[y][x] !== QrCodeDataType.Data) continue;
        const unmasked = qr.data[y][x] !== maskApplies(qr.maskPattern, x, y);
        bits.push(unmasked ? 1 : 0);
        if (bits.length === 4) {
          return bits.reduce((value, bit) => value << 1 | bit, 0);
        }
      }
    }
  }
  throw new Error("QR code has no data mode indicator");
}

export function createReceiveQr(address: string): ReceiveQrData {
  const payload = address.toUpperCase();
  if (!QR_ALPHANUMERIC_CHARACTERS.test(payload)) {
    throw new Error("Receive address cannot be represented in QR alphanumeric mode");
  }
  const encoded = encode(payload, {
    ecc: "Q",
    border: 0,
    boostEcc: false,
  });
  const mode = readQrMode(encoded);
  if (mode !== QR_ALPHANUMERIC_MODE) {
    throw new Error(`QR generator selected mode 0b${mode.toString(2).padStart(4, "0")}`);
  }
  return {
    payload,
    matrix: encoded.data,
    size: encoded.size,
    mode,
  };
}
