import { Address, NETWORK } from "@scure/btc-signer";
import { encode } from "uqr";
import { createReceiveQr, QR_ALPHANUMERIC_MODE, readQrMode } from "./receive_qr.ts";

const BIP86_ADDRESS = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

Deno.test("receive QR uses an uppercase Bech32 address in alphanumeric mode", () => {
  const qr = createReceiveQr(BIP86_ADDRESS);
  if (qr.payload !== BIP86_ADDRESS.toUpperCase()) {
    throw new Error("QR payload was not converted entirely to uppercase");
  }
  if (qr.mode !== QR_ALPHANUMERIC_MODE) {
    throw new Error(`Expected QR alphanumeric mode 0b0010, got ${qr.mode}`);
  }

  const lowerDecoded = Address(NETWORK).decode(BIP86_ADDRESS);
  const upperDecoded = Address(NETWORK).decode(qr.payload);
  if (
    lowerDecoded.type !== "tr" || upperDecoded.type !== "tr" ||
    lowerDecoded.pubkey.toString() !== upperDecoded.pubkey.toString()
  ) {
    throw new Error("Uppercase QR payload does not decode to the displayed Taproot address");
  }

  const byteMode = encode(BIP86_ADDRESS, { ecc: "Q", border: 0, boostEcc: false });
  if (readQrMode(byteMode) !== 0b0100) {
    throw new Error("Lowercase control payload was not identified as QR byte mode");
  }
  if (qr.size >= byteMode.size) {
    throw new Error(
      `Expected alphanumeric QR to be smaller than byte mode (${qr.size} >= ${byteMode.size})`,
    );
  }
});
