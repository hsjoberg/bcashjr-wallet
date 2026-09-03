import { Transaction } from "@scure/btc-signer";
import { fromHex, toHex } from "./bytes.ts";
import type { PersistedCoin, ReplayPreview, WalletPublicState } from "./types.ts";

export type ReplayWalletOutput = Pick<
  PersistedCoin,
  "outpoint" | "txid" | "vout" | "value" | "address" | "scriptPubKey" | "path"
>;

export interface ParsedReplayTransaction extends
  Pick<
    ReplayPreview,
    "inputCount" | "outputCount" | "totalOutputValue" | "version" | "lockTime"
  > {
  inputOutpoints: string[];
  walletOutputs: ReplayWalletOutput[];
}

/** Decode a funding transaction and identify every output owned by this wallet. */
export function parseReplayTransaction(
  state: WalletPublicState,
  rawTx: string,
  expectedTxid: string,
): ParsedReplayTransaction {
  let transaction: Transaction;
  try {
    transaction = Transaction.fromRaw(fromHex(rawTx), {
      allowUnknownVersion: true,
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
  } catch {
    throw new Error("BTC backend returned a transaction that cannot be decoded");
  }
  if (transaction.id !== expectedTxid) {
    throw new Error(
      `BTC backend returned transaction ${transaction.id}, expected ${expectedTxid}`,
    );
  }
  if (transaction.inputsLength === 0 || transaction.outputsLength === 0) {
    throw new Error("An empty transaction cannot be replayed");
  }
  const firstInput = transaction.getInput(0);
  const firstTxid = typeof firstInput.txid === "string"
    ? firstInput.txid
    : firstInput.txid
    ? toHex(firstInput.txid)
    : "";
  if (/^0{64}$/u.test(firstTxid) && firstInput.index === 0xffff_ffff) {
    throw new Error("Coinbase transactions cannot be replayed through the mempool");
  }
  const inputOutpoints = Array.from({ length: transaction.inputsLength }, (_, index) => {
    const input = transaction.getInput(index);
    const txid = typeof input.txid === "string" ? input.txid : input.txid ? toHex(input.txid) : "";
    if (!/^[0-9a-f]{64}$/u.test(txid) || !Number.isSafeInteger(input.index)) {
      throw new Error("BTC backend returned a transaction with a malformed input");
    }
    return `${txid}:${input.index}`;
  });
  const addressesByScript = new Map<
    string,
    Pick<ReplayWalletOutput, "address" | "scriptPubKey" | "path">
  >(state.addresses.map((address) => [address.scriptPubKey, address]));
  for (const coin of state.coins) {
    addressesByScript.set(coin.scriptPubKey, coin);
  }
  const walletOutputs: ReplayWalletOutput[] = [];
  for (let vout = 0; vout < transaction.outputsLength; vout++) {
    const transactionOutput = transaction.getOutput(vout);
    if (!transactionOutput.script || transactionOutput.amount === undefined) continue;
    const scriptPubKey = toHex(transactionOutput.script);
    const address = addressesByScript.get(scriptPubKey);
    if (!address) continue;
    if (
      transactionOutput.amount < 0n || transactionOutput.amount > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error(`Wallet output ${expectedTxid}:${vout} has an invalid value`);
    }
    walletOutputs.push({
      outpoint: `${expectedTxid}:${vout}`,
      txid: expectedTxid,
      vout,
      value: Number(transactionOutput.amount),
      address: address.address,
      scriptPubKey,
      path: address.path,
    });
  }
  const totalOutputValue = Array.from(
    { length: transaction.outputsLength },
    (_, index) => transaction.getOutput(index).amount ?? 0n,
  ).reduce((sum, value) => sum + value, 0n);
  if (totalOutputValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Funding transaction output value is too large to display safely");
  }
  return {
    inputCount: transaction.inputsLength,
    outputCount: transaction.outputsLength,
    totalOutputValue: Number(totalOutputValue),
    version: transaction.version,
    lockTime: transaction.lockTime,
    inputOutpoints,
    walletOutputs,
  };
}

export function assertReplayCandidatesMatchTransaction(
  candidates: PersistedCoin[],
  transactionOutputs: ReplayWalletOutput[],
): void {
  for (const candidate of candidates) {
    const transactionOutput = transactionOutputs.find((output) =>
      output.outpoint === candidate.outpoint
    );
    if (
      !transactionOutput || transactionOutput.value !== candidate.value ||
      transactionOutput.address !== candidate.address ||
      transactionOutput.scriptPubKey !== candidate.scriptPubKey ||
      transactionOutput.path !== candidate.path
    ) {
      throw new Error(`Funding transaction does not match wallet output ${candidate.outpoint}`);
    }
  }
}
