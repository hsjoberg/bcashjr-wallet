import * as jsQrModule from "jsqr";
import { createReceiveQr } from "./receive_qr.ts";
import { destinationFromQrPayload } from "./qr_scan.ts";

const BIP86_ADDRESS = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const P2PKH_ADDRESS = "1KZTJDo9qtAeE6dexQhcGSiU9e5n8cUyfW";
const P2WPKH_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH_ADDRESS = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const decodeQr = jsQrModule.default as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

Deno.test("camera decoder reads the wallet's uppercase receive QR", () => {
  const qr = createReceiveQr(BIP86_ADDRESS);
  const quietZone = 4;
  const scale = 5;
  const dimension = (qr.size + quietZone * 2) * scale;
  const pixels = new Uint8ClampedArray(dimension * dimension * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.matrix[y][x]) continue;
      for (let offsetY = 0; offsetY < scale; offsetY++) {
        for (let offsetX = 0; offsetX < scale; offsetX++) {
          const pixelX = (x + quietZone) * scale + offsetX;
          const pixelY = (y + quietZone) * scale + offsetY;
          const index = (pixelY * dimension + pixelX) * 4;
          pixels[index] = 0;
          pixels[index + 1] = 0;
          pixels[index + 2] = 0;
        }
      }
    }
  }
  const result = decodeQr(pixels, dimension, dimension);
  if (result?.data !== BIP86_ADDRESS.toUpperCase()) {
    throw new Error("Camera decoder did not recover the receive QR payload");
  }
});

Deno.test("camera QR payload accepts supported bare and BIP21 addresses", () => {
  for (const address of [P2PKH_ADDRESS, BIP86_ADDRESS, P2WPKH_ADDRESS, P2WSH_ADDRESS]) {
    const caseVariants = address.startsWith("bc1") ? [address, address.toUpperCase()] : [address];
    for (
      const payload of [
        ...caseVariants,
        `bitcoin:${address}?amount=0.001&label=Sweep`,
      ]
    ) {
      if (destinationFromQrPayload(payload) !== address) {
        throw new Error(`QR payload was not normalized: ${payload}`);
      }
    }
  }
});

Deno.test("camera QR payload rejects unsupported destinations", () => {
  for (
    const payload of [
      "not a wallet address",
      "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      `bitcoin:${BIP86_ADDRESS.slice(0, 8).toUpperCase()}${BIP86_ADDRESS.slice(8)}`,
    ]
  ) {
    try {
      destinationFromQrPayload(payload);
      throw new Error(`Unsupported QR payload was accepted: ${payload}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unsupported QR payload")) throw error;
    }
  }
});

Deno.test("camera QR payload rejects unsupported required BIP21 parameters", () => {
  try {
    destinationFromQrPayload(`bitcoin:${BIP86_ADDRESS}?amount=0.001&req-foo=bar`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('unsupported parameter "req-foo"')) {
      return;
    }
    throw error;
  }
  throw new Error("Unsupported required BIP21 parameter was silently ignored");
});
