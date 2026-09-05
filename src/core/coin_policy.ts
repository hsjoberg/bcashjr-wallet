import { intentBlocksOutpoint, splitProvidesConfirmedProtection } from "./intent_state.ts";
import type {
  ChainCoinObservation,
  ChainId,
  PersistedCoin,
  SpendRisk,
  SplitState,
  TrackedOutput,
  TransactionIntent,
  WalletSettings,
} from "./types.ts";

export interface CoinPolicy {
  output: TrackedOutput;
  blakeSelectable: boolean;
  btcSelectable: boolean;
  splittable: boolean;
  replayCandidate: boolean;
  btcRisks: SpendRisk[];
  btcReplayProtectionSplitIntentIds: string[];
}

export interface SpendAuthorization {
  splitInputCount: number;
  splitOutpoints: string[];
  risks: SpendRisk[];
  replayProtectionSplitIntentIds: string[];
}

function observationIsSpendable(
  observation: ChainCoinObservation,
  requiredConfirmations: number,
): boolean {
  if (!observation.backendOk || !observation.unspent || !observation.tx?.present) return false;
  return requiredConfirmations === 0 ||
    (observation.tx.confirmed &&
      observation.tx.confirmations >= requiredConfirmations);
}

function deriveSplitState(
  coin: PersistedCoin,
  knownShared: boolean,
  splitIntents: TransactionIntent[],
  confirmedSplit: boolean,
  settings: WalletSettings,
): SplitState {
  const { blake, btc } = coin;
  if (!blake.backendOk || !btc.backendOk || !blake.tx || !btc.tx) return "unknown";
  const onBlake = blake.tx.present && blake.unspent === true;
  const onBtc = btc.tx.present && btc.unspent === true;
  if (!onBlake && !onBtc) return "spent";

  if (onBlake && !onBtc) {
    return observationIsSpendable(blake, settings.blakeConfirmations) ? "blake-only" : "confirming";
  }
  if (!onBlake && onBtc) {
    if (!observationIsSpendable(btc, settings.btcConfirmations)) return "confirming";
    if (!knownShared) return "btc-only";
    return confirmedSplit ? "split" : "split-pending";
  }

  if (
    !observationIsSpendable(blake, settings.blakeConfirmations) ||
    !observationIsSpendable(btc, settings.btcConfirmations)
  ) {
    return "confirming";
  }
  return splitIntents.some((intent) => intent.phase !== "abandoned") ? "split-pending" : "unsplit";
}

export function deriveCoinPolicy(
  coin: PersistedCoin,
  knownShared: boolean,
  intents: TransactionIntent[],
  settings: WalletSettings,
): CoinPolicy {
  const related = intents.filter((intent) =>
    intent.kind === "blake-replay"
      ? intent.walletInputOutpoints.includes(coin.outpoint) ||
        intent.walletOutpoints.includes(coin.outpoint)
      : intent.inputOutpoints.includes(coin.outpoint)
  );
  const splitIntents = related.filter((intent) =>
    intent.kind === "blake-unified" && intent.sharedOutpoints.includes(coin.outpoint)
  );
  const blocking = related.filter((intent) => intentBlocksOutpoint(intent, coin.outpoint));
  const blockingOnBlake = blocking.filter((intent) =>
    intent.kind !== "btc-spend" || intent.replayRisk === undefined
  );
  const blockingSplits = blocking.filter((intent) =>
    intent.kind === "blake-unified" && intent.sharedOutpoints.includes(coin.outpoint)
  );
  const unifiedSpends = related.filter((intent) =>
    intent.kind === "blake-unified" && intent.phase !== "abandoned"
  );
  const btcSpends = related.filter((intent) =>
    intent.kind === "btc-spend" && intent.phase !== "abandoned"
  );
  const replayIntents = related.filter((intent) =>
    intent.kind === "blake-replay" && intent.phase !== "abandoned"
  );
  const replayInputReservedOnBlake = replayIntents.some((intent) =>
    intent.kind === "blake-replay" && intent.walletInputOutpoints.includes(coin.outpoint)
  );
  const blockingBtc = blocking.some((intent) => intent.kind === "btc-spend");
  const blockingReplay = blocking.some((intent) => intent.kind === "blake-replay");
  const confirmedSplitIntentIds = splitIntents
    .filter((intent) => splitProvidesConfirmedProtection(intent, intents))
    .map((intent) => intent.id)
    .sort();
  const confirmedSplit = confirmedSplitIntentIds.length > 0;

  const blakeSpendable = observationIsSpendable(coin.blake, settings.blakeConfirmations);
  const btcSpendable = observationIsSpendable(coin.btc, settings.btcConfirmations);
  const onBlake = coin.blake.backendOk && coin.blake.unspent === true;
  const onBtc = coin.btc.backendOk && coin.btc.unspent === true;
  const splittable = onBlake && onBtc && blakeSpendable &&
    blockingOnBlake.length === 0 && unifiedSpends.length === 0 && !replayInputReservedOnBlake;
  const blakeOnlySpendable = onBlake && coin.btc.backendOk && coin.btc.unspent === false &&
    blakeSpendable && blockingOnBlake.length === 0 && unifiedSpends.length === 0 &&
    !replayInputReservedOnBlake;

  const pendingSplits = blockingSplits
    .filter((intent) => intent.phase === "seen" || intent.phase === "broadcast-unknown");
  const pendingSplitIntentIds = pendingSplits
    .map((intent) => intent.id)
    .sort();
  const pendingSplitSet = new Set(pendingSplitIntentIds);
  const incompatibleUnifiedIntent = blocking.some((intent) =>
    intent.kind === "blake-unified" && !pendingSplitSet.has(intent.id)
  );
  const blakeCopyAbsent = coin.blake.backendOk && coin.blake.unspent === false;
  const hasSplitIntent = splitIntents.some((intent) => intent.phase !== "abandoned");
  const replayCandidate = !knownShared && blakeCopyAbsent && btcSpendable &&
    blocking.length === 0 && !hasSplitIntent && replayIntents.length === 0;
  const replayRiskOverride = coin.blake.backendOk && !confirmedSplit &&
    !incompatibleUnifiedIntent && (knownShared || replayCandidate);
  const separated = blakeCopyAbsent && (!knownShared || confirmedSplit);
  const btcSelectable = btcSpendable && !blockingBtc && !blockingReplay &&
    btcSpends.length === 0 &&
    (separated || replayRiskOverride);
  const btcRisks: SpendRisk[] = replayRiskOverride
    ? [{
      kind: knownShared ? "shared-coin-replay" : "possible-funding-replay",
      splitIntentIds: pendingSplitIntentIds,
    }]
    : [];
  const btcReplayProtectionSplitIntentIds = knownShared && blakeCopyAbsent && confirmedSplit
    ? confirmedSplitIntentIds
    : [];
  return {
    output: {
      ...structuredClone(coin),
      wasShared: knownShared,
      splitState: deriveSplitState(coin, knownShared, splitIntents, confirmedSplit, settings),
    },
    blakeSelectable: splittable || blakeOnlySpendable,
    btcSelectable,
    splittable,
    replayCandidate,
    btcRisks,
    btcReplayProtectionSplitIntentIds,
  };
}

export function authorizeSpend(
  coins: PersistedCoin[],
  chain: ChainId,
  provenance: Record<string, unknown>,
  intents: TransactionIntent[],
  settings: WalletSettings,
): SpendAuthorization {
  const risks = new Map<string, Set<string>>();
  const replayProtectionSplitIntentIds = new Set<string>();
  const splitOutpoints: string[] = [];
  for (const coin of coins) {
    const policy = deriveCoinPolicy(coin, Boolean(provenance[coin.outpoint]), intents, settings);
    const allowed = chain === "btc" ? policy.btcSelectable : policy.blakeSelectable;
    if (!allowed) {
      if (chain === "btc" && policy.splittable) {
        throw new Error(`Output ${coin.outpoint} is shared; split it on BLAKE before BTC spend`);
      }
      throw new Error(
        `Output ${coin.outpoint} is ${policy.output.splitState}, not selectable for this action`,
      );
    }
    if (chain === "blake" && policy.splittable) splitOutpoints.push(coin.outpoint);
    if (chain === "btc") {
      policy.btcReplayProtectionSplitIntentIds.forEach((intentId) =>
        replayProtectionSplitIntentIds.add(intentId)
      );
      for (const risk of policy.btcRisks) {
        const intentIds = risks.get(risk.kind) ?? new Set<string>();
        risk.splitIntentIds.forEach((intentId) => intentIds.add(intentId));
        risks.set(risk.kind, intentIds);
      }
    }
  }
  splitOutpoints.sort();
  return {
    splitInputCount: splitOutpoints.length,
    splitOutpoints,
    // Every signature commits to the complete input set. One confirmed split
    // input is therefore enough to make the whole standard BTC transaction
    // invalid on BLAKE, even if other selected coins remain shared.
    risks: replayProtectionSplitIntentIds.size > 0
      ? []
      : [...risks.entries()].map(([kind, intentIds]) => ({
        kind: kind as SpendRisk["kind"],
        splitIntentIds: [...intentIds].sort(),
      })),
    replayProtectionSplitIntentIds: [...replayProtectionSplitIntentIds].sort(),
  };
}
