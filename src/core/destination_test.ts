import { toHex } from "./bytes.ts";
import { DESTINATION_DUST_LIMITS, parseDestinationAddress } from "./destination.ts";

const P2TR = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const P2PKH = "1KZTJDo9qtAeE6dexQhcGSiU9e5n8cUyfW";
const P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

Deno.test("destination parser allows canonical mainnet P2PKH, P2TR, P2WPKH, and P2WSH", () => {
  const cases = [
    {
      address: P2PKH,
      type: "pkh",
      script: "76a914cb9586c4a23060484e45617ea6f2543eb7e5997288ac",
      dustLimit: DESTINATION_DUST_LIMITS.pkh,
    },
    {
      address: P2TR,
      type: "tr",
      script: `5120${"a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c"}`,
      dustLimit: DESTINATION_DUST_LIMITS.tr,
    },
    {
      address: P2WPKH,
      type: "wpkh",
      script: "0014751e76e8199196d454941c45d1b3a323f1433bd6",
      dustLimit: DESTINATION_DUST_LIMITS.wpkh,
    },
    {
      address: P2WSH,
      type: "wsh",
      script: "00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262",
      dustLimit: DESTINATION_DUST_LIMITS.wsh,
    },
  ] as const;

  for (const expected of cases) {
    const input = expected.type === "pkh" ? expected.address : expected.address.toUpperCase();
    const parsed = parseDestinationAddress(input);
    if (
      parsed.address !== expected.address || parsed.type !== expected.type ||
      toHex(parsed.script) !== expected.script || parsed.dustLimit !== expected.dustLimit
    ) {
      throw new Error(`Unexpected parsed destination: ${JSON.stringify(parsed)}`);
    }
  }
});

Deno.test("destination parser rejects other networks, address types, and malformed encodings", () => {
  const rejected = [
    "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
    "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    "bc1pfeessrawgf",
    `${P2WPKH.slice(0, 8).toUpperCase()}${P2WPKH.slice(8)}`,
    `${P2WPKH.slice(0, -1)}x`,
  ];
  for (const address of rejected) {
    try {
      parseDestinationAddress(address);
      throw new Error(`Unsupported destination was accepted: ${address}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unsupported destination")) {
        throw error;
      }
    }
  }
});
