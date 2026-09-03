import {
  entropyFromMnemonic,
  mnemonicFromEntropy,
  PRODUCTION_SCRYPT,
  protectEntropy,
  unprotectEntropy,
} from "./keys.ts";
import { Bip86Keychain } from "./keys.ts";

const RECOVERY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_SCRYPT = { N: 16, r: 8, p: 1, dkLen: 32 } as const;

Deno.test("production wallet encryption uses the intended scrypt cost", () => {
  if (
    PRODUCTION_SCRYPT.N !== 2 ** 18 || PRODUCTION_SCRYPT.r !== 8 ||
    PRODUCTION_SCRYPT.p !== 1 || PRODUCTION_SCRYPT.dkLen !== 32
  ) {
    throw new Error("Production scrypt parameters changed unexpectedly");
  }
});

Deno.test("BIP39 and BIP86 derivation are deterministic", () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  if (mnemonicFromEntropy(entropy) !== RECOVERY) throw new Error("Mnemonic round-trip failed");
  const keychain = new Bip86Keychain(entropy);
  const address = keychain.derive(0, 0);
  if (address.address !== "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr") {
    throw new Error(`Unexpected BIP86 address ${address.address}`);
  }
  if (address.path !== "m/86'/0'/0'/0/0" || address.scriptPubKey.length !== 68) {
    throw new Error("Unexpected BIP86 derivation metadata");
  }
  keychain.destroy();
  entropy.fill(0);
});

Deno.test("wallet entropy requires authenticated password encryption", async () => {
  const entropy = entropyFromMnemonic(RECOVERY);
  let emptyRejected = false;
  try {
    await protectEntropy(entropy, "");
  } catch {
    emptyRejected = true;
  }
  if (!emptyRejected) throw new Error("Empty local encryption password was accepted");

  const encrypted = await protectEntropy(entropy, "correct horse", TEST_SCRYPT);
  if (encrypted.encryption !== "xchacha20-poly1305") {
    throw new Error("Encrypted mode was not selected");
  }
  const decrypted = await unprotectEntropy(encrypted, "correct horse");
  if (mnemonicFromEntropy(decrypted) !== RECOVERY) {
    throw new Error("Encrypted secret round-trip failed");
  }
  let rejected = false;
  try {
    await unprotectEntropy(encrypted, "wrong password");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Incorrect password was accepted");
  entropy.fill(0);
  decrypted.fill(0);
});
