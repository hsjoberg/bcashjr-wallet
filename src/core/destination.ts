import { Address, NETWORK, OutScript } from "@scure/btc-signer";

export type SupportedDestinationType = "pkh" | "tr" | "wpkh" | "wsh";

export const DESTINATION_DUST_LIMITS: Readonly<Record<SupportedDestinationType, number>> = {
  pkh: 546,
  tr: 330,
  wpkh: 294,
  wsh: 330,
};

export interface SupportedDestination {
  address: string;
  type: SupportedDestinationType;
  script: Uint8Array;
  dustLimit: number;
}

function isCanonicalScript(type: SupportedDestinationType, script: Uint8Array): boolean {
  if (type === "pkh") {
    return script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 &&
      script[2] === 0x14 && script[23] === 0x88 && script[24] === 0xac;
  }
  if (type === "tr") return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
  if (type === "wpkh") return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
  return script.length === 34 && script[0] === 0x00 && script[1] === 0x20;
}

export function parseDestinationAddress(value: string): SupportedDestination {
  if (typeof value !== "string") {
    throw new Error("Destination must be a mainnet P2PKH, P2TR, P2WPKH, or P2WSH address");
  }
  const candidate = value.trim();
  const bech32 = /^bc1/iu.test(candidate);
  if (
    !candidate || candidate.length > 90 ||
    (bech32 && /[a-z]/u.test(candidate) && /[A-Z]/u.test(candidate))
  ) {
    throw new Error("Destination must be a mainnet P2PKH, P2TR, P2WPKH, or P2WSH address");
  }
  // Bech32 is case-insensitive when uniformly cased. Base58 is case-sensitive.
  const address = bech32 ? candidate.toLowerCase() : candidate;
  let decoded: ReturnType<ReturnType<typeof Address>["decode"]>;
  try {
    decoded = Address(NETWORK).decode(address);
  } catch {
    throw new Error("Destination must be a valid mainnet P2PKH, P2TR, P2WPKH, or P2WSH address");
  }
  if (
    decoded.type !== "pkh" && decoded.type !== "tr" && decoded.type !== "wpkh" &&
    decoded.type !== "wsh"
  ) {
    throw new Error("Only mainnet P2PKH, P2TR, P2WPKH, and P2WSH destinations are supported");
  }
  const type: SupportedDestinationType = decoded.type;
  if (decoded.type === "pkh") {
    if (!address.startsWith("1") || decoded.hash.length !== 20) {
      throw new Error("Destination has an unsupported P2PKH payload");
    }
  } else {
    const expectedPrefix = type === "tr" ? "bc1p" : "bc1q";
    const expectedLength = type === "wpkh" ? 20 : 32;
    const program = decoded.type === "tr" ? decoded.pubkey : decoded.hash;
    if (!address.startsWith(expectedPrefix) || program.length !== expectedLength) {
      throw new Error("Destination has an unsupported witness program");
    }
  }
  const script = OutScript.encode(decoded);
  if (!isCanonicalScript(type, script)) {
    throw new Error("Destination did not produce the expected standard output script");
  }
  return { address, type, script, dustLimit: DESTINATION_DUST_LIMITS[type] };
}
