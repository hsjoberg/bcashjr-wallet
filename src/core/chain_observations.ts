import type { EsploraTxStatus, EsploraUtxo } from "./esplora.ts";
import type { ChainCoinObservation, ChainTxStatus, IntentObservation } from "./types.ts";

function confirmations(status: EsploraTxStatus, tipHeight: number): number {
  return status.confirmed && status.block_height !== undefined
    ? Math.max(0, tipHeight - status.block_height + 1)
    : 0;
}

function normalizedStatus(status: EsploraTxStatus, tipHeight: number): ChainTxStatus {
  return {
    present: true,
    confirmed: status.confirmed,
    blockHeight: status.block_height,
    blockHash: status.block_hash,
    confirmations: confirmations(status, tipHeight),
  };
}

export function failedObservation(error: unknown): ChainCoinObservation {
  return {
    checkedAt: new Date().toISOString(),
    backendOk: false,
    tx: null,
    unspent: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function intentObservation(
  status: EsploraTxStatus | null,
  tipHeight: number,
): IntentObservation {
  return {
    checkedAt: new Date().toISOString(),
    backendOk: true,
    tx: status
      ? normalizedStatus(status, tipHeight)
      : { present: false, confirmed: false, confirmations: 0 },
  };
}

export function failedIntentObservation(error: unknown): IntentObservation {
  return {
    checkedAt: new Date().toISOString(),
    backendOk: false,
    tx: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function utxoObservation(
  utxo: EsploraUtxo | undefined,
  tipHeight: number,
): ChainCoinObservation {
  return {
    checkedAt: new Date().toISOString(),
    backendOk: true,
    tx: utxo
      ? normalizedStatus(utxo.status, tipHeight)
      : { present: false, confirmed: false, confirmations: 0 },
    unspent: Boolean(utxo),
  };
}
