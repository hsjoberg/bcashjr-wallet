import { emptyPublicState } from "./types.ts";
import {
  acquireWalletDirectoryLock,
  FileWalletRepository,
  parseWalletState,
  walletDataDirectoryFor,
  type WalletDirectoryLock,
} from "./storage.ts";

Deno.test("wallet directory lock excludes another process instance", async () => {
  const directory = await Deno.makeTempDir({ prefix: "bcashjr-lock-test-" });
  let first: WalletDirectoryLock | undefined;
  let unexpectedSecond: WalletDirectoryLock | undefined;
  try {
    first = await acquireWalletDirectoryLock(directory);
    let message = "";
    try {
      unexpectedSecond = await acquireWalletDirectoryLock(directory);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("already using this data directory")) {
      throw new Error(`Concurrent wallet directory was not rejected: ${message}`);
    }
    await first.release();
    first = undefined;
    const reopened = await acquireWalletDirectoryLock(directory);
    await reopened.release();
  } finally {
    unexpectedSecond?.close();
    first?.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("wallet state loading preserves current settings exactly", () => {
  const state = emptyPublicState();
  state.settings.scanGap = 20;
  const loaded = parseWalletState(state);
  if (loaded.settings.scanGap !== 20) throw new Error("An explicit 20-address gap was rewritten");
});

Deno.test("wallet state loading rejects records missing current required fields", () => {
  const missingRecoveryAcknowledgement = emptyPublicState();
  delete (missingRecoveryAcknowledgement as { recoveryPhraseAcknowledged?: unknown })
    .recoveryPhraseAcknowledged;
  let recoveryError = "";
  try {
    parseWalletState(missingRecoveryAcknowledgement);
  } catch (error) {
    recoveryError = error instanceof Error ? error.message : String(error);
  }
  if (!recoveryError.includes("malformed")) {
    throw new Error(`Missing recovery acknowledgement was accepted: ${recoveryError}`);
  }

  const missingAmountUnit = emptyPublicState();
  delete (missingAmountUnit.settings as { amountUnit?: unknown }).amountUnit;
  let amountError = "";
  try {
    parseWalletState(missingAmountUnit);
  } catch (error) {
    amountError = error instanceof Error ? error.message : String(error);
  }
  if (!amountError.includes("malformed")) {
    throw new Error(`Missing amount denomination was accepted: ${amountError}`);
  }

  const missingIntentState = emptyPublicState();
  missingIntentState.intents = [{ txid: "11".repeat(32) } as never];
  let pendingError = "";
  try {
    parseWalletState(missingIntentState);
  } catch (error) {
    pendingError = error instanceof Error ? error.message : String(error);
  }
  if (!pendingError.includes("malformed transaction intent")) {
    throw new Error(`Pending transaction missing its state was accepted: ${pendingError}`);
  }
});

Deno.test("wallet state loading discards malformed public cache entries", () => {
  const state = emptyPublicState();
  state.recoveryScanComplete = true;
  state.addresses = [null as never];
  state.coins = [{ blake: null, btc: null } as never];
  const loaded = parseWalletState(state);
  if (loaded.addresses.length !== 0 || loaded.coins.length !== 0) {
    throw new Error("Malformed public cache entries survived state loading");
  }
  if (
    loaded.recoveryScanComplete || loaded.recoveryScan?.nextIndex !== 0 ||
    loaded.recoveryScan.trailingGap !== 0 ||
    !loaded.lastSyncError?.includes("Discarded 2 malformed public cache entries")
  ) {
    throw new Error("Discarding malformed cache entries did not schedule safe recovery");
  }
});

Deno.test("wallet state loading discards an unspent coin whose transaction is absent", () => {
  const state = emptyPublicState();
  const checkedAt = new Date(0).toISOString();
  const txid = "22".repeat(32);
  state.recoveryScanComplete = true;
  state.coins = [{
    outpoint: `${txid}:0`,
    txid,
    vout: 0,
    value: 50_000,
    address: "bc1ptest",
    scriptPubKey: `5120${"11".repeat(32)}`,
    path: "m/86'/0'/0'/0/0",
    blake: {
      checkedAt,
      backendOk: true,
      tx: { present: false, confirmed: false, confirmations: 0 },
      unspent: true,
    },
    btc: {
      checkedAt,
      backendOk: true,
      tx: { present: false, confirmed: false, confirmations: 0 },
      unspent: false,
    },
  }];

  const loaded = parseWalletState(state);
  if (loaded.coins.length !== 0) {
    throw new Error("Contradictory cached coin survived state loading");
  }
  if (
    loaded.recoveryScanComplete || loaded.recoveryScan?.nextIndex !== 0 ||
    loaded.recoveryScan.trailingGap !== 0 ||
    !loaded.lastSyncError?.includes("Discarded 1 malformed public cache entry")
  ) {
    throw new Error("Discarding a contradictory cached coin did not schedule safe recovery");
  }
});

Deno.test("wallet state repair retains shared provenance independently of malformed coins", () => {
  const state = emptyPublicState();
  const outpoint = `${"33".repeat(32)}:2`;
  state.sharedProvenance[outpoint] = { firstObservedAt: new Date(0).toISOString() };
  state.coins = [{
    outpoint,
    blake: null,
    btc: null,
  } as never];

  const loaded = parseWalletState(state);
  if (loaded.coins.length !== 0 || !loaded.sharedProvenance[outpoint]) {
    throw new Error("Malformed shared output lost its fail-closed provenance");
  }
});

Deno.test("wallet state loading rejects malformed scan and safety fields", () => {
  const malformedStates: Array<[string, (state: ReturnType<typeof emptyPublicState>) => void]> = [
    ["string recovery completion", (state) => {
      (state as unknown as { recoveryScanComplete: unknown }).recoveryScanComplete = "false";
    }],
    ["zero scan gap", (state) => state.settings.scanGap = 0],
    ["negative recovery index", (state) => {
      state.recoveryScan = { nextIndex: -1, trailingGap: 0 };
    }],
    ["impossible trailing gap", (state) => {
      state.recoveryScan = { nextIndex: 0, trailingGap: 1 };
    }],
    ["oversized trailing gap", (state) => {
      state.recoveryScan = { nextIndex: 1, trailingGap: 1_001 };
    }],
    ["credential-bearing backend URL", (state) => {
      state.settings.btcApiUrl = "https://example.com/api?token=secret";
    }],
  ];

  for (const [label, mutate] of malformedStates) {
    const state = emptyPublicState();
    mutate(state);
    let rejected = false;
    try {
      parseWalletState(state);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Accepted ${label}`);
  }
});

Deno.test("file repository atomically replaces durable wallet state", async () => {
  const directory = await Deno.makeTempDir({ prefix: "bcashjr-storage-test-" });
  try {
    const repository = new FileWalletRepository(directory);
    const first = emptyPublicState();
    first.settings.scanGap = 11;
    await repository.saveState(first);

    const second = emptyPublicState();
    second.settings.scanGap = 19;
    await repository.saveState(second);
    const loaded = await repository.loadState();
    if (loaded.settings.scanGap !== 19) throw new Error("Replacement state was not persisted");
    if ([...Deno.readDirSync(directory)].some((entry) => entry.name.endsWith(".tmp"))) {
      throw new Error("Atomic state save left a temporary file behind");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("non-Windows data directories fall back to HOME", () => {
  const linux = walletDataDirectoryFor(
    "linux",
    (name) => name === "HOME" ? "/home/alice" : undefined,
  );
  const mac = walletDataDirectoryFor(
    "darwin",
    (name) => name === "HOME" ? "/Users/alice" : undefined,
  );
  if (linux !== "/home/alice/.local/share/bcashjr-wallet") {
    throw new Error(`Unexpected Linux data directory ${linux}`);
  }
  if (mac !== "/Users/alice/Library/Application Support/bcashjr-wallet") {
    throw new Error(`Unexpected macOS data directory ${mac}`);
  }
});
