import { parseDestinationAddress } from "../core/destination.ts";

const BIP21_PREFIX = /^bitcoin:/iu;

export function destinationFromQrPayload(payload: string): string {
  let candidate = payload.trim();
  if (BIP21_PREFIX.test(candidate)) {
    const paymentUri = candidate.replace(BIP21_PREFIX, "");
    const queryStart = paymentUri.indexOf("?");
    candidate = queryStart < 0 ? paymentUri : paymentUri.slice(0, queryStart);
    if (queryStart >= 0) {
      const parameters = new URLSearchParams(paymentUri.slice(queryStart + 1));
      for (const name of parameters.keys()) {
        if (/^req-/iu.test(name)) {
          throw new Error(`Bitcoin payment URI requires unsupported parameter "${name}"`);
        }
      }
    }
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      throw new Error("QR code contains a malformed Bitcoin payment URI");
    }
  }
  candidate = candidate.trim();
  if (!candidate || candidate.length > 128) {
    throw new Error("QR code does not contain a destination address");
  }
  try {
    return parseDestinationAddress(candidate).address;
  } catch {
    throw new Error(
      "QR code must contain a valid mainnet P2PKH, P2TR, P2WPKH, or P2WSH address",
    );
  }
}
