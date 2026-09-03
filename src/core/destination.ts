import { Address, NETWORK, OutScript } from "@scure/btc-signer";

export type SupportedDestinationType = "tr" | "wpkh" | "wsh";

export const DESTINATION_DUST_LIMITS: Readonly<Record<SupportedDestinationType, number>> = {
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
  if (type === "tr") return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
  if (type === "wpkh") return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
  return script.length === 34 && script[0] === 0x00 && script[1] === 0x20;
}

export function parseDestinationAddress(value: string): SupportedDestination {
  if (typeof value !== "string") {
    throw new Error("Destination must be a mainnet P2TR, P2WPKH, or P2WSH address");
  }
  const candidate = value.trim();
  if (!candidate || candidate.length > 90 || /[a-z]/u.test(candidate) && /[A-Z]/u.test(candidate)) {
    throw new Error("Destination must be a mainnet P2TR, P2WPKH, or P2WSH address");
  }
  const address = candidate.toLowerCase();
  let decoded: ReturnType<ReturnType<typeof Address>["decode"]>;
  try {
    decoded = Address(NETWORK).decode(address);
  } catch {
    throw new Error("Destination must be a valid mainnet P2TR, P2WPKH, or P2WSH address");
  }
  if (decoded.type !== "tr" && decoded.type !== "wpkh" && decoded.type !== "wsh") {
    throw new Error("Only mainnet P2TR, P2WPKH, and P2WSH destinations are supported");
  }
  const type: SupportedDestinationType = decoded.type;
  const expectedPrefix = type === "tr" ? "bc1p" : "bc1q";
  const expectedLength = type === "wpkh" ? 20 : 32;
  const program = decoded.type === "tr" ? decoded.pubkey : decoded.hash;
  if (!address.startsWith(expectedPrefix) || program.length !== expectedLength) {
    throw new Error("Destination has an unsupported witness program");
  }
  const script = OutScript.encode(decoded);
  if (!isCanonicalScript(type, script)) {
    throw new Error("Destination did not produce the expected standard output script");
  }
  return { address, type, script, dustLimit: DESTINATION_DUST_LIMITS[type] };
}
