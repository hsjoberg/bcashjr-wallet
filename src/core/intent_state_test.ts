import { assertWalletStateInvariants, reduceIntent, summarizeIntent } from "./intent_state.ts";
import { Bip86Keychain, entropyFromMnemonic } from "./keys.ts";
import { createSweepTemplate, signBtcSweep, signUnifiedSweep } from "./transaction.ts";
import { emptyPublicState, type IntentObservation, type TransactionIntent } from "./types.ts";

const RECOVERY =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const NOW = new Date(0).toISOString();
const SPLIT_INTENT_ID = "00000000-0000-4000-8000-000000000001";
const BTC_INTENT_ID = "00000000-0000-4000-8000-000000000002";

function signedPair() {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  try {
    const source = keychain.derive(0, 0);
    const destination = keychain.derive(0, 1);
    const spendable = [{
      txid: "81".repeat(32),
      vout: 2,
      value: 100_000,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    }];
    return {
      outpoint: `${spendable[0].txid}:${spendable[0].vout}`,
      unified: signUnifiedSweep(
        createSweepTemplate(spendable, destination.address, 2, 961_650),
        keychain,
      ),
      btc: signBtcSweep(
        createSweepTemplate(spendable, destination.address, 2, 961_650, "btc-standard"),
        keychain,
      ),
    };
  } finally {
    keychain.destroy();
    entropy.fill(0);
  }
}

function signedReplayChain() {
  const entropy = entropyFromMnemonic(RECOVERY);
  const keychain = new Bip86Keychain(entropy);
  try {
    const source = keychain.derive(0, 0);
    const replayDestination = keychain.derive(0, 1);
    const finalDestination = keychain.derive(0, 2);
    const sourceCoin = {
      txid: "83".repeat(32),
      vout: 1,
      value: 120_000,
      scriptPubKey: source.scriptPubKey,
      path: source.path,
    };
    const replay = signBtcSweep(
      createSweepTemplate([sourceCoin], replayDestination.address, 2, 961_650, "btc-standard"),
      keychain,
    );
    const replayedCoin = {
      txid: replay.txid,
      vout: 0,
      value: replay.outputValue,
      scriptPubKey: replayDestination.scriptPubKey,
      path: replayDestination.path,
    };
    const child = signBtcSweep(
      createSweepTemplate([replayedCoin], finalDestination.address, 2, 961_650, "btc-standard"),
      keychain,
    );
    return {
      sourceOutpoint: `${sourceCoin.txid}:${sourceCoin.vout}`,
      replayedOutpoint: `${replayedCoin.txid}:${replayedCoin.vout}`,
      replay,
      child,
    };
  } finally {
    keychain.destroy();
    entropy.fill(0);
  }
}

function observed(present: boolean, confirmed = false): IntentObservation {
  return {
    checkedAt: NOW,
    backendOk: true,
    tx: {
      present,
      confirmed: present && confirmed,
      confirmations: present && confirmed ? 2 : 0,
    },
  };
}

function assertThrows(operation: () => void, expected: string): void {
  let message = "";
  try {
    operation();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes(expected)) {
    throw new Error(`Expected "${expected}", received "${message}"`);
  }
}

Deno.test("intent reducer retains signed recovery data through broadcast, confirmation, and reorg", () => {
  const signed = signedPair();
  let intent: TransactionIntent = {
    id: SPLIT_INTENT_ID,
    kind: "blake-unified",
    chain: "blake",
    txid: signed.unified.txid,
    rawTx: signed.unified.rawTx,
    createdAt: NOW,
    phase: "prepared",
    inputOutpoints: [signed.outpoint],
    sharedOutpoints: [signed.outpoint],
    parentReplayIntentIds: [],
  };
  intent = reduceIntent(intent, { type: "broadcast-started", at: NOW });
  if (intent.phase !== "broadcast-unknown" || !intent.rawTx) {
    throw new Error("Broadcast start lost the signed transaction");
  }
  intent = reduceIntent(intent, { type: "broadcast-result", at: NOW });
  if (intent.phase !== "seen") throw new Error("Accepted broadcast was not marked seen");
  intent = reduceIntent(intent, {
    type: "observed",
    observation: observed(true, true),
    recoverable: false,
    requiredConfirmations: 1,
  });
  if (intent.phase !== "confirmed") throw new Error("Confirmation was not reduced");
  intent = reduceIntent(intent, {
    type: "observed",
    observation: observed(false),
    recoverable: true,
    requiredConfirmations: 1,
  });
  if (intent.phase !== "recoverable") throw new Error("Reorg did not reactivate recovery");
  const summary = summarizeIntent(intent, [intent]);
  if (!summary.canRebroadcast || !summary.canAbandon) {
    throw new Error("Recoverable intent did not expose guarded recovery actions");
  }
  const originalOutpoint = summary.outpoints[0];
  summary.outpoints[0] = `${"99".repeat(32)}:0`;
  const intentOutpoint = intent.kind === "blake-replay"
    ? intent.walletOutpoints[0]
    : intent.inputOutpoints[0];
  if (intentOutpoint !== originalOutpoint) {
    throw new Error("Intent summary exposed its authoritative outpoint array");
  }
  intent = reduceIntent(intent, { type: "abandoned", at: NOW });
  if (intent.phase !== "abandoned" || !intent.rawTx) {
    throw new Error("Abandonment erased the durable audit record");
  }
  intent = reduceIntent(intent, {
    type: "observed",
    observation: observed(false),
    recoverable: true,
    requiredConfirmations: 1,
  });
  if (intent.phase !== "abandoned") {
    throw new Error("An absent abandoned transaction was unexpectedly revived");
  }
  intent = reduceIntent(intent, {
    type: "observed",
    observation: observed(true),
    recoverable: false,
    requiredConfirmations: 1,
  });
  if (intent.phase !== "seen" || intent.abandonedAt !== undefined) {
    throw new Error("An exposed abandoned transaction was not revived when it reappeared");
  }
});

Deno.test("an exposed abandoned BTC intent still binds its protective split", () => {
  const signed = signedPair();
  const split: TransactionIntent = {
    id: SPLIT_INTENT_ID,
    kind: "blake-unified",
    chain: "blake",
    txid: signed.unified.txid,
    rawTx: signed.unified.rawTx,
    createdAt: NOW,
    phase: "recoverable",
    broadcastStartedAt: NOW,
    inputOutpoints: [signed.outpoint],
    sharedOutpoints: [signed.outpoint],
    parentReplayIntentIds: [],
  };
  const btc: TransactionIntent = {
    id: BTC_INTENT_ID,
    kind: "btc-spend",
    chain: "btc",
    txid: signed.btc.txid,
    rawTx: signed.btc.rawTx,
    createdAt: NOW,
    phase: "abandoned",
    broadcastStartedAt: NOW,
    abandonedAt: NOW,
    inputOutpoints: [signed.outpoint],
    replayProtection: { splitIntentIds: [split.id] },
  };
  const state = emptyPublicState();
  state.sharedProvenance[signed.outpoint] = { firstObservedAt: NOW };
  state.intents = [split, btc];
  assertWalletStateInvariants(state);
  if (summarizeIntent(split, state.intents, state.sharedProvenance).canAbandon) {
    throw new Error("Local BTC abandonment released split protection for an exposed transaction");
  }
});

Deno.test("an unexposed prepared intent can be abandoned while its parent is unavailable", () => {
  const signed = signedPair();
  const parentId = "00000000-0000-4000-8000-000000000003";
  const parent: TransactionIntent = {
    id: parentId,
    kind: "blake-replay",
    chain: "blake",
    txid: "81".repeat(32),
    rawTx: "00",
    createdAt: NOW,
    phase: "recoverable",
    broadcastStartedAt: NOW,
    walletInputOutpoints: [],
    walletOutpoints: [signed.outpoint],
  };
  const prepared: TransactionIntent = {
    id: SPLIT_INTENT_ID,
    kind: "blake-unified",
    chain: "blake",
    txid: signed.unified.txid,
    rawTx: signed.unified.rawTx,
    createdAt: NOW,
    phase: "prepared",
    inputOutpoints: [signed.outpoint],
    sharedOutpoints: [signed.outpoint],
    parentReplayIntentIds: [parentId],
  };
  const summary = summarizeIntent(prepared, [parent, prepared]);
  if (summary.blockedBy[0] !== parentId || summary.canRebroadcast || !summary.canAbandon) {
    throw new Error("Unavailable parent trapped a provably unbroadcast prepared intent");
  }
});

Deno.test("wallet invariants bind raw inputs, provenance, and emergency overlap", () => {
  const signed = signedPair();
  const split: TransactionIntent = {
    id: SPLIT_INTENT_ID,
    kind: "blake-unified",
    chain: "blake",
    txid: signed.unified.txid,
    rawTx: signed.unified.rawTx,
    createdAt: NOW,
    phase: "seen",
    broadcastStartedAt: NOW,
    inputOutpoints: [signed.outpoint],
    sharedOutpoints: [signed.outpoint],
    parentReplayIntentIds: [],
  };
  const btc: TransactionIntent = {
    id: BTC_INTENT_ID,
    kind: "btc-spend",
    chain: "btc",
    txid: signed.btc.txid,
    rawTx: signed.btc.rawTx,
    createdAt: NOW,
    phase: "prepared",
    inputOutpoints: [signed.outpoint],
    replayRisk: {
      kinds: ["shared-coin-replay"],
      splitIntentIds: [split.id],
      acknowledgedAt: NOW,
    },
  };
  const state = emptyPublicState();
  state.sharedProvenance[signed.outpoint] = { firstObservedAt: NOW };
  state.intents = [split, btc];
  assertWalletStateInvariants(state);

  const noProvenance = structuredClone(state);
  noProvenance.sharedProvenance = {};
  assertThrows(
    () => assertWalletStateInvariants(noProvenance),
    "lost shared provenance",
  );

  const noAcknowledgement = structuredClone(state);
  delete (noAcknowledgement.intents[1] as Extract<
    TransactionIntent,
    { kind: "btc-spend" }
  >).replayRisk;
  assertThrows(
    () => assertWalletStateInvariants(noAcknowledgement),
    "incompatible active intents",
  );

  const wrongInput = structuredClone(state);
  (wrongInput.intents[0] as Extract<
    TransactionIntent,
    { kind: "blake-unified" }
  >).inputOutpoints = [`${"82".repeat(32)}:0`];
  assertThrows(
    () => assertWalletStateInvariants(wrongInput),
    "input metadata does not match",
  );
});

Deno.test("an acknowledged BTC-first spend can overlap its later BLAKE spend during reorg", () => {
  const signed = signedPair();
  const blakeSpend: TransactionIntent = {
    id: SPLIT_INTENT_ID,
    kind: "blake-unified",
    chain: "blake",
    txid: signed.unified.txid,
    rawTx: signed.unified.rawTx,
    createdAt: NOW,
    phase: "seen",
    broadcastStartedAt: NOW,
    inputOutpoints: [signed.outpoint],
    sharedOutpoints: [],
    parentReplayIntentIds: [],
  };
  const btcSpend: TransactionIntent = {
    id: BTC_INTENT_ID,
    kind: "btc-spend",
    chain: "btc",
    txid: signed.btc.txid,
    rawTx: signed.btc.rawTx,
    createdAt: NOW,
    phase: "recoverable",
    broadcastStartedAt: NOW,
    inputOutpoints: [signed.outpoint],
    replayRisk: {
      kinds: ["shared-coin-replay"],
      splitIntentIds: [],
      acknowledgedAt: NOW,
    },
  };
  const state = emptyPublicState();
  state.intents = [blakeSpend, btcSpend];
  assertWalletStateInvariants(state);

  delete (state.intents[1] as Extract<
    TransactionIntent,
    { kind: "btc-spend" }
  >).replayRisk;
  assertThrows(() => assertWalletStateInvariants(state), "incompatible active intents");
});

Deno.test("an acknowledged BTC-first child can overlap a reorged replay parent", () => {
  const signed = signedReplayChain();
  const replayId = "00000000-0000-4000-8000-000000000003";
  const parent: TransactionIntent = {
    id: replayId,
    kind: "blake-replay",
    chain: "blake",
    txid: signed.replay.txid,
    rawTx: signed.replay.rawTx,
    createdAt: NOW,
    phase: "recoverable",
    broadcastStartedAt: NOW,
    walletInputOutpoints: [signed.sourceOutpoint],
    walletOutpoints: [signed.replayedOutpoint],
  };
  const btcSpend: TransactionIntent = {
    id: BTC_INTENT_ID,
    kind: "btc-spend",
    chain: "btc",
    txid: signed.child.txid,
    rawTx: signed.child.rawTx,
    createdAt: NOW,
    phase: "seen",
    broadcastStartedAt: NOW,
    inputOutpoints: [signed.replayedOutpoint],
    replayRisk: {
      kinds: ["possible-funding-replay"],
      splitIntentIds: [],
      acknowledgedAt: NOW,
    },
  };
  const state = emptyPublicState();
  state.intents = [parent, btcSpend];
  assertWalletStateInvariants(state);

  delete (state.intents[1] as Extract<
    TransactionIntent,
    { kind: "btc-spend" }
  >).replayRisk;
  assertThrows(() => assertWalletStateInvariants(state), "incompatible active intents");
});
