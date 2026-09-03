import { RawTx } from "@scure/btc-signer";
import { fromHex, toHex } from "./bytes.ts";
import { DESTINATION_DUST_LIMITS } from "./destination.ts";
import { Bip86Keychain, entropyFromMnemonic } from "./keys.ts";
import {
  createSweepTemplate,
  feeNeedsExplicitConfirmation,
  signBtcSweep,
  type SignedSweep,
  signSweep,
} from "./transaction.ts";

const RECOVERY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const P2PKH = "1KZTJDo9qtAeE6dexQhcGSiU9e5n8cUyfW";
const P2PKH_SCRIPT = "76a914cb9586c4a23060484e45617ea6f2543eb7e5997288ac";
const P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2WSH = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
const P2WSH_SCRIPT = "00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262";

function twoInputCoins(keychain: Bip86Keychain) {
  const first = keychain.derive(0, 0);
  const second = keychain.derive(0, 1);
  // Deliberately reversed to exercise deterministic outpoint sorting too.
  return [
    {
      txid: "22".repeat(32),
      vout: 1,
      value: 50_000,
      scriptPubKey: second.scriptPubKey,
      path: second.path,
    },
    {
      txid: "11".repeat(32),
      vout: 0,
      value: 100_000,
      scriptPubKey: first.scriptPubKey,
      path: first.path,
    },
  ];
}

function assertTwoInputP2wshSweep(
  label: string,
  signed: SignedSweep,
  signatureLength: 64 | 65,
): void {
  const decoded = RawTx.decode(fromHex(signed.rawTx)) as {
    inputs: unknown[];
    outputs: Array<{ amount: bigint; script: Uint8Array }>;
    witnesses?: Uint8Array[][];
  };
  const signatures = decoded.witnesses?.map((stack) => stack[0]);
  if (
    decoded.inputs.length !== 2 || decoded.outputs.length !== 1 || signatures?.length !== 2 ||
    signatures.some((signature) =>
      !signature || signature.length !== signatureLength ||
      (signatureLength === 65 && signature[64] !== 0x21)
    ) ||
    toHex(decoded.outputs[0]?.script ?? new Uint8Array()) !== P2WSH_SCRIPT ||
    decoded.outputs[0]?.amount !== 149_662n || signed.vsize !== 169 || signed.fee !== 338 ||
    signed.outputValue !== 149_662
  ) {
    throw new Error(`${label} produced an unexpected two-input P2WSH sweep`);
  }
}

Deno.test("BIP86 unified sweep is finalized with a 0x21 Schnorr signature", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  const source = keychain.derive(0, 0);
  const destination = keychain.derive(0, 1);
  const template = createSweepTemplate(
    [{
      txid: "11".repeat(32),
      vout: 3,
      value: 100_000,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    }],
    destination.address,
    2,
    900_000,
  );
  const signed = signSweep(template, keychain);
  const decoded = RawTx.decode(fromHex(signed.rawTx)) as { witnesses?: Uint8Array[][] };
  const signature = decoded.witnesses?.[0]?.[0];
  if (!signature || signature.length !== 65 || signature[64] !== 0x21) {
    throw new Error("Final witness does not carry SIGHASH_ALL|SIGHASH_UNIFIED");
  }
  if (signed.vsize !== 112 || signed.fee !== 224 || signed.outputValue !== 99_776) {
    throw new Error(`Unexpected sweep economics: ${JSON.stringify(signed)}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(signed.txid)) throw new Error("Invalid signed transaction id");
  keychain.destroy();
  entropy.fill(0);
});

Deno.test("BIP86 BTC sweep uses a 64-byte SIGHASH_DEFAULT signature", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  const source = keychain.derive(0, 0);
  const destination = keychain.derive(0, 1);
  const template = createSweepTemplate(
    [{
      txid: "11".repeat(32),
      vout: 3,
      value: 100_000,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    }],
    destination.address,
    2,
    900_000,
    "btc-standard",
  );
  const signed = signBtcSweep(template, keychain);
  const decoded = RawTx.decode(fromHex(signed.rawTx)) as { witnesses?: Uint8Array[][] };
  const signature = decoded.witnesses?.[0]?.[0];
  if (!signature || signature.length !== 64) {
    throw new Error("BTC witness did not use an implicit SIGHASH_DEFAULT signature");
  }
  if (signed.vsize !== 111 || signed.fee !== 222 || signed.outputValue !== 99_778) {
    throw new Error(`Unexpected BTC sweep economics: ${JSON.stringify(signed)}`);
  }
  if (signed.txid !== "4a2264688497268a1d625ef4e074da5d0b10842c0ea22ceff5835fb80d454853") {
    throw new Error(`Unexpected BTC transaction id ${signed.txid}`);
  }
  keychain.destroy();
  entropy.fill(0);
});

Deno.test("two BIP86 inputs produce a valid BTC P2WSH sweep", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  try {
    const template = createSweepTemplate(
      twoInputCoins(keychain),
      P2WSH,
      2,
      900_000,
      "btc-standard",
    );
    if (template.coins[0].txid !== "11".repeat(32)) {
      throw new Error("BTC sweep inputs were not sorted deterministically");
    }
    assertTwoInputP2wshSweep("BTC", signBtcSweep(template, keychain), 64);
  } finally {
    keychain.destroy();
    entropy.fill(0);
  }
});

Deno.test("two BIP86 inputs produce a valid unified P2WSH sweep", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  try {
    const template = createSweepTemplate(
      twoInputCoins(keychain),
      P2WSH,
      2,
      900_000,
    );
    if (template.coins[0].txid !== "11".repeat(32)) {
      throw new Error("Unified sweep inputs were not sorted deterministically");
    }
    assertTwoInputP2wshSweep("BLAKE", signSweep(template, keychain), 65);
  } finally {
    keychain.destroy();
    entropy.fill(0);
  }
});

Deno.test("Taproot inputs can sweep to P2PKH, P2WPKH, and P2WSH on both chains", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  const source = keychain.derive(0, 0);
  const cases = [
    {
      address: P2PKH,
      script: P2PKH_SCRIPT,
      unifiedVsize: 103,
      btcVsize: 102,
    },
    {
      address: P2WPKH,
      script: "0014751e76e8199196d454941c45d1b3a323f1433bd6",
      unifiedVsize: 100,
      btcVsize: 99,
    },
    {
      address: P2WSH,
      script: P2WSH_SCRIPT,
      unifiedVsize: 112,
      btcVsize: 111,
    },
  ];

  for (const expected of cases) {
    const coin = {
      txid: "33".repeat(32),
      vout: 1,
      value: 100_000,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    };
    const unifiedTemplate = createSweepTemplate([coin], expected.address, 2, 900_000);
    const unified = signSweep(unifiedTemplate, keychain);
    const btcTemplate = createSweepTemplate(
      [coin],
      expected.address,
      2,
      900_000,
      "btc-standard",
    );
    const btc = signBtcSweep(btcTemplate, keychain);

    for (
      const [label, signed, expectedVsize, signatureLength] of [
        ["BLAKE", unified, expected.unifiedVsize, 65],
        ["BTC", btc, expected.btcVsize, 64],
      ] as const
    ) {
      const decoded = RawTx.decode(fromHex(signed.rawTx)) as {
        outputs: Array<{ script: Uint8Array }>;
        witnesses?: Uint8Array[][];
      };
      if (
        signed.vsize !== expectedVsize || signed.fee !== expectedVsize * 2 ||
        toHex(decoded.outputs[0]?.script ?? new Uint8Array()) !== expected.script ||
        decoded.witnesses?.[0]?.[0]?.length !== signatureLength
      ) {
        throw new Error(`${label} produced an unexpected ${expected.address} sweep`);
      }
    }
  }
  keychain.destroy();
  entropy.fill(0);
});

Deno.test("supported destinations enforce their standard dust thresholds", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  const source = keychain.derive(0, 0);
  const cases = [
    { address: P2PKH, dustLimit: DESTINATION_DUST_LIMITS.pkh, vsize: 103 },
    { address: P2WPKH, dustLimit: DESTINATION_DUST_LIMITS.wpkh, vsize: 100 },
    { address: P2WSH, dustLimit: DESTINATION_DUST_LIMITS.wsh, vsize: 112 },
  ];

  for (const expected of cases) {
    const coin = (value: number) => ({
      txid: "44".repeat(32),
      vout: 0,
      value,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    });
    const exact = createSweepTemplate(
      [coin(expected.dustLimit + expected.vsize)],
      expected.address,
      1,
      900_000,
    );
    if (exact.outputValue !== expected.dustLimit) {
      throw new Error(`Exact dust threshold was not accepted for ${expected.address}`);
    }
    try {
      createSweepTemplate(
        [coin(expected.dustLimit + expected.vsize - 1)],
        expected.address,
        1,
        900_000,
      );
      throw new Error(`Below-dust output was accepted for ${expected.address}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Below-dust output")) throw error;
    }
  }
  keychain.destroy();
  entropy.fill(0);
});

Deno.test("fee rates stop at 100 sat/vB and costly small sweeps require confirmation", () => {
  if (!feeNeedsExplicitConfirmation(1_336, 919, 8.2)) {
    throw new Error("A fee consuming most of a small sweep was not marked high");
  }
  if (!feeNeedsExplicitConfirmation(1_000_000, 5_000, 50)) {
    throw new Error("A 50 sat/vB fee was not marked high");
  }
  if (feeNeedsExplicitConfirmation(100_000, 1_000, 5)) {
    throw new Error("A modest fee was incorrectly marked high");
  }
});
