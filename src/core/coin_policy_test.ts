import { authorizeSpend, deriveCoinPolicy } from "./coin_policy.ts";
import { DEFAULT_SETTINGS, type PersistedCoin, type TransactionIntent } from "./types.ts";

const NOW = new Date(0).toISOString();
let nextIntentId = 1;

function intentId(): string {
  return `00000000-0000-4000-8000-${String(nextIntentId++).padStart(12, "0")}`;
}

function observed(present: boolean) {
  return {
    checkedAt: NOW,
    backendOk: true,
    tx: { present, confirmed: present, confirmations: present ? 2 : 0 },
    unspent: present,
  };
}

function coin(txid: string, blake: boolean, btc: boolean): PersistedCoin {
  return {
    outpoint: `${txid}:0`,
    txid,
    vout: 0,
    value: 10_000,
    address: "bc1ptest",
    scriptPubKey: `5120${"11".repeat(32)}`,
    path: "m/86'/0'/0'/0/0",
    blake: observed(blake),
    btc: observed(btc),
  };
}

function unified(
  txid: string,
  input: PersistedCoin,
  phase: TransactionIntent["phase"],
  shared = true,
): Extract<TransactionIntent, { kind: "blake-unified" }> {
  return {
    id: intentId(),
    kind: "blake-unified",
    chain: "blake",
    txid,
    rawTx: "00",
    createdAt: NOW,
    phase,
    inputOutpoints: [input.outpoint],
    sharedOutpoints: shared ? [input.outpoint] : [],
    parentReplayIntentIds: [],
    ...(phase === "prepared" ? {} : { broadcastStartedAt: NOW }),
  };
}

Deno.test("coin selection applies each chain's own confirmation target", () => {
  for (const [btcConfirmations, blakeConfirmations] of [[1, 6], [6, 1], [2, 2]]) {
    const settings = { ...DEFAULT_SETTINGS, btcConfirmations, blakeConfirmations };
    for (const [onBlake, onBtc] of [[true, true], [false, true], [true, false]]) {
      const funding = coin("10".repeat(32), onBlake, onBtc);
      const policy = deriveCoinPolicy(funding, onBlake && onBtc, [], settings);
      if (
        policy.btcSelectable !== (onBtc && btcConfirmations <= 2) ||
        policy.blakeSelectable !== (onBlake && blakeConfirmations <= 2)
      ) throw new Error("Coin selection used the other chain's confirmation target");
    }
  }
});

Deno.test("zero-confirmation funding is enabled independently per chain", () => {
  const funding = coin("10".repeat(32), true, true);
  for (const chain of ["btc", "blake"] as const) {
    funding[chain].tx = { present: true, confirmed: false, confirmations: 0 };
  }
  for (const chain of ["btc", "blake"] as const) {
    const settings = { ...DEFAULT_SETTINGS, [`${chain}Confirmations`]: 0 };
    const policy = deriveCoinPolicy(funding, true, [], settings);
    if (
      policy.btcSelectable !== (chain === "btc") || policy.blakeSelectable !== (chain === "blake")
    ) {
      throw new Error("Allowing zero confirmations affected the other chain");
    }
  }
});

Deno.test("central coin policy derives shared, split, and replay-risk selection", () => {
  const shared = coin("11".repeat(32), true, true);
  let policy = deriveCoinPolicy(shared, true, [], DEFAULT_SETTINGS);
  if (
    !policy.splittable || !policy.blakeSelectable || !policy.btcSelectable ||
    policy.btcRisks[0]?.kind !== "shared-coin-replay" ||
    policy.btcRisks[0].splitIntentIds.length !== 0
  ) {
    throw new Error("Unsplit shared coin did not expose its acknowledged BTC escape path");
  }
  const authorization = authorizeSpend(
    [shared],
    "btc",
    { [shared.outpoint]: {} },
    [],
    DEFAULT_SETTINGS,
  );
  if (authorization.risks[0]?.kind !== "shared-coin-replay") {
    throw new Error("Spend authorization lost the shared-input replay risk");
  }

  const btcCopy = { ...shared, blake: observed(false) };
  policy = deriveCoinPolicy(btcCopy, true, [], DEFAULT_SETTINGS);
  if (
    !policy.btcSelectable || policy.output.splitState !== "split-pending" ||
    policy.btcRisks[0]?.kind !== "shared-coin-replay"
  ) {
    throw new Error("Previously shared BTC copy lost its replay-risk escape path");
  }

  const split = unified("22".repeat(32), shared, "confirmed");
  policy = deriveCoinPolicy(btcCopy, true, [split], DEFAULT_SETTINGS);
  if (!policy.btcSelectable || policy.output.splitState !== "split" || policy.btcRisks.length > 0) {
    throw new Error("Confirmed split did not release the BTC copy");
  }
  const anotherShared = coin("12".repeat(32), true, true);
  const protectedAuthorization = authorizeSpend(
    [btcCopy, anotherShared],
    "btc",
    { [btcCopy.outpoint]: {}, [anotherShared.outpoint]: {} },
    [split],
    DEFAULT_SETTINGS,
  );
  if (
    protectedAuthorization.risks.length !== 0 ||
    protectedAuthorization.replayProtectionSplitIntentIds[0] !== split.id
  ) {
    throw new Error("A confirmed split input did not protect the complete BTC transaction");
  }

  const pending = unified("33".repeat(32), shared, "seen");
  policy = deriveCoinPolicy(btcCopy, true, [pending], DEFAULT_SETTINGS);
  if (
    !policy.btcSelectable ||
    policy.btcRisks[0]?.splitIntentIds[0] !== pending.id
  ) throw new Error("Pending split did not emit its structured replay risk");

  policy = deriveCoinPolicy(shared, true, [pending], DEFAULT_SETTINGS);
  if (!policy.btcSelectable || policy.btcRisks[0]?.splitIntentIds[0] !== pending.id) {
    throw new Error("Backend-lagged BLAKE input defeated the replay-risk escape path");
  }
  for (
    const inactive of [
      unified("34".repeat(32), shared, "prepared"),
      unified("35".repeat(32), shared, "recoverable"),
    ]
  ) {
    if (deriveCoinPolicy(shared, true, [inactive], DEFAULT_SETTINGS).btcSelectable) {
      throw new Error(`Inactive ${inactive.phase} split released a conflicting BTC spend`);
    }
  }
});

Deno.test("central coin policy blocks contradictory history and governs replay outputs", () => {
  const btcOnly = coin("44".repeat(32), false, true);
  const btcOnlyPolicy = deriveCoinPolicy(btcOnly, false, [], DEFAULT_SETTINGS);
  if (
    !btcOnlyPolicy.replayCandidate ||
    btcOnlyPolicy.btcRisks[0]?.kind !== "possible-funding-replay"
  ) {
    throw new Error("Fresh BTC-only funding was not offered with its possible replay risk");
  }
  if (deriveCoinPolicy(btcOnly, true, [], DEFAULT_SETTINGS).replayCandidate) {
    throw new Error("Previously shared provenance was treated as fresh BTC-only funding");
  }

  const replay: TransactionIntent = {
    id: intentId(),
    kind: "blake-replay",
    chain: "blake",
    txid: btcOnly.txid,
    rawTx: "00",
    createdAt: NOW,
    phase: "seen",
    broadcastStartedAt: NOW,
    walletInputOutpoints: [],
    walletOutpoints: [btcOnly.outpoint],
  };
  const replayed = { ...btcOnly, blake: observed(true) };
  let policy = deriveCoinPolicy(replayed, true, [replay], {
    ...DEFAULT_SETTINGS,
    btcConfirmations: 0,
    blakeConfirmations: 0,
  });
  if (policy.blakeSelectable || policy.splittable) {
    throw new Error("Pending replay exposed a child spend");
  }
  replay.phase = "confirmed";
  policy = deriveCoinPolicy(replayed, true, [replay], {
    ...DEFAULT_SETTINGS,
    btcConfirmations: 0,
    blakeConfirmations: 0,
  });
  if (!policy.splittable) throw new Error("Confirmed replay did not release its output");

  const blakeOnly = coin("55".repeat(32), true, false);
  const spend = unified("66".repeat(32), blakeOnly, "confirmed", false);
  policy = deriveCoinPolicy(blakeOnly, false, [spend], DEFAULT_SETTINGS);
  if (policy.blakeSelectable) {
    throw new Error("An impossible restored input was selectable against confirmed spend history");
  }
});

Deno.test("split protection requires every replay parent to remain confirmed", () => {
  const replayed = coin("71".repeat(32), true, true);
  const otherShared = coin("72".repeat(32), true, true);
  const btcCopy = { ...otherShared, blake: observed(false) };
  const parent: TransactionIntent = {
    id: intentId(),
    kind: "blake-replay",
    chain: "blake",
    txid: "73".repeat(32),
    rawTx: "00",
    createdAt: NOW,
    phase: "recoverable",
    broadcastStartedAt: NOW,
    walletInputOutpoints: [],
    walletOutpoints: [replayed.outpoint],
  };
  const split = unified("74".repeat(32), otherShared, "confirmed");
  split.inputOutpoints = [replayed.outpoint, otherShared.outpoint];
  split.sharedOutpoints = [...split.inputOutpoints];
  split.parentReplayIntentIds = [parent.id];

  let policy = deriveCoinPolicy(btcCopy, true, [parent, split], DEFAULT_SETTINGS);
  if (
    policy.output.splitState !== "split-pending" ||
    policy.btcRisks[0]?.kind !== "shared-coin-replay" ||
    policy.btcReplayProtectionSplitIntentIds.length !== 0
  ) {
    throw new Error("A split with a missing replay parent was trusted as confirmed protection");
  }

  parent.phase = "confirmed";
  policy = deriveCoinPolicy(btcCopy, true, [parent, split], DEFAULT_SETTINGS);
  if (
    policy.output.splitState !== "split" || policy.btcRisks.length !== 0 ||
    policy.btcReplayProtectionSplitIntentIds[0] !== split.id
  ) {
    throw new Error("A split with confirmed replay parents was not trusted as protection");
  }
});

Deno.test("confirmed funding replays keep their wallet inputs reserved on BLAKE", () => {
  const input = coin("75".repeat(32), true, false);
  const replay: TransactionIntent = {
    id: intentId(),
    kind: "blake-replay",
    chain: "blake",
    txid: "76".repeat(32),
    rawTx: "00",
    createdAt: NOW,
    phase: "confirmed",
    broadcastStartedAt: NOW,
    walletInputOutpoints: [input.outpoint],
    walletOutpoints: [`${"76".repeat(32)}:0`],
  };
  if (deriveCoinPolicy(input, false, [replay], DEFAULT_SETTINGS).blakeSelectable) {
    throw new Error("A confirmed replay released its source input for a conflicting BLAKE spend");
  }
});

Deno.test("acknowledged BTC-first spends leave the BLAKE copy selectable for protection", () => {
  const shared = coin("77".repeat(32), true, true);
  for (const phase of ["seen", "broadcast-unknown"] as const) {
    const btcFirst: TransactionIntent = {
      id: intentId(),
      kind: "btc-spend",
      chain: "btc",
      txid: "78".repeat(32),
      rawTx: "00",
      createdAt: NOW,
      phase,
      broadcastStartedAt: NOW,
      inputOutpoints: [shared.outpoint],
      replayRisk: {
        kinds: ["shared-coin-replay"],
        splitIntentIds: [],
        acknowledgedAt: NOW,
      },
    };

    const laggedPolicy = deriveCoinPolicy(shared, true, [btcFirst], DEFAULT_SETTINGS);
    if (!laggedPolicy.blakeSelectable || !laggedPolicy.splittable) {
      throw new Error(`${phase} acknowledged BTC spend blocked a shared BLAKE copy`);
    }

    const consumedOnBtc = { ...shared, btc: observed(false) };
    const observedPolicy = deriveCoinPolicy(consumedOnBtc, true, [btcFirst], DEFAULT_SETTINGS);
    if (!observedPolicy.blakeSelectable || observedPolicy.splittable) {
      throw new Error(`${phase} acknowledged BTC spend blocked its remaining BLAKE copy`);
    }
  }

  const unacknowledged: TransactionIntent = {
    id: intentId(),
    kind: "btc-spend",
    chain: "btc",
    txid: "79".repeat(32),
    rawTx: "00",
    createdAt: NOW,
    phase: "seen",
    broadcastStartedAt: NOW,
    inputOutpoints: [shared.outpoint],
  };
  if (deriveCoinPolicy(shared, true, [unacknowledged], DEFAULT_SETTINGS).blakeSelectable) {
    throw new Error("An unacknowledged BTC spend released a conflicting BLAKE action");
  }
});
