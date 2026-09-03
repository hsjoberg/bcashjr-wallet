import type { PersistedCoin, WalletPublicState } from "./types.ts";
import type { SpendableCoin } from "./transaction.ts";

export function selectCoins(state: WalletPublicState, outpoints: string[]): PersistedCoin[] {
  if (!Array.isArray(outpoints) || outpoints.length === 0) {
    throw new Error("Select at least one output");
  }
  const unique = new Set(outpoints);
  if (unique.size !== outpoints.length) throw new Error("An output was selected more than once");
  return outpoints.map((outpoint) => {
    const coin = state.coins.find((candidate) => candidate.outpoint === outpoint);
    if (!coin) throw new Error(`Unknown output ${outpoint}`);
    return coin;
  });
}

export function toSpendableCoin(output: PersistedCoin): SpendableCoin {
  return {
    txid: output.txid,
    vout: output.vout,
    value: output.value,
    scriptPubKey: output.scriptPubKey,
    path: output.path,
  };
}
