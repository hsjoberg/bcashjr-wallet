import { failedObservation, utxoObservation } from "./chain_observations.ts";
import type { EsploraAddress, EsploraClient, EsploraUtxo } from "./esplora.ts";
import type { Bip86Keychain } from "./keys.ts";
import { intentNeedsReconciliation, intentOutpoints } from "./intent_state.ts";
import type { ChainId, PersistedCoin, WalletAddress, WalletPublicState } from "./types.ts";

const RECOVERY_ADDRESSES_PER_SYNC = 25;
export const MAX_DERIVATION_INDEX = 0x7fff_ffff;

export type WalletClients = { blake: EsploraClient; btc: EsploraClient };

interface DiscoveredOutput {
  address: WalletAddress;
  blake?: EsploraUtxo;
  btc?: EsploraUtxo;
}

export interface AddressScanResult {
  complete: boolean;
  authoritative: boolean;
  outputs: Map<string, DiscoveredOutput>;
}

function hasActivity(info: EsploraAddress): boolean {
  return info.chain_stats.tx_count + info.mempool_stats.tx_count > 0;
}

export function settledErrorReason(result: PromiseSettledResult<unknown>): string {
  if (result.status === "fulfilled") return "unknown error";
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

function addUtxos(
  outputs: Map<string, DiscoveredOutput>,
  address: WalletAddress,
  chain: ChainId,
  utxos: EsploraUtxo[],
  errors: string[],
): boolean {
  if (!Array.isArray(utxos)) {
    errors.push(`${chain.toUpperCase()} returned a malformed UTXO list`);
    return false;
  }
  for (const utxo of utxos) {
    if (
      !utxo || !/^[0-9a-f]{64}$/u.test(utxo.txid) ||
      !Number.isSafeInteger(utxo.vout) || utxo.vout < 0 ||
      !Number.isSafeInteger(utxo.value) || utxo.value < 0 ||
      typeof utxo.status?.confirmed !== "boolean"
    ) {
      errors.push(`${chain.toUpperCase()} returned a malformed UTXO`);
      return false;
    }
    if (utxo.value === 0) continue;
    const outpoint = `${utxo.txid}:${utxo.vout}`;
    const existing = outputs.get(outpoint);
    const other = existing?.blake ?? existing?.btc;
    if (
      existing &&
      (existing.address.scriptPubKey !== address.scriptPubKey || other?.value !== utxo.value)
    ) {
      errors.push(`Backend mismatch for ${outpoint}`);
      return false;
    }
    const discovered = existing ?? { address };
    discovered[chain] = utxo;
    outputs.set(outpoint, discovered);
  }
  return true;
}

export async function scanRecoveryAddresses(
  state: WalletPublicState,
  keychain: Bip86Keychain | null,
  clients: WalletClients,
  errors: string[],
): Promise<AddressScanResult> {
  const savedProgress = state.recoveryScan;
  let index = savedProgress?.nextIndex ?? 0;
  let gap = savedProgress?.trailingGap ?? 0;
  let complete = false;
  const scanGap = state.settings.scanGap;
  const outputs = new Map<string, DiscoveredOutput>();
  let scanned = 0;
  while (index <= MAX_DERIVATION_INDEX && scanned < RECOVERY_ADDRESSES_PER_SYNC) {
    let address = state.addresses.find((candidate) =>
      candidate.branch === 0 && candidate.index === index
    );
    if (!address) {
      if (!keychain) break;
      address = keychain.derive(0, index);
      state.addresses.push(address);
    }
    const [blakeInfo, btcInfo] = await Promise.allSettled([
      clients.blake.address(address.address),
      clients.btc.address(address.address),
    ]);
    if (blakeInfo.status === "rejected" || btcInfo.status === "rejected") {
      if (blakeInfo.status === "rejected") {
        errors.push(`BLAKE address ${index}: ${settledErrorReason(blakeInfo)}`);
      }
      if (btcInfo.status === "rejected") {
        errors.push(`BTC address ${index}: ${settledErrorReason(btcInfo)}`);
      }
      break;
    }
    const blakeUsed = hasActivity(blakeInfo.value);
    const btcUsed = hasActivity(btcInfo.value);
    address.used = blakeUsed || btcUsed;
    if (address.used) gap = 0;
    else gap++;

    const utxoResults = await Promise.allSettled([
      blakeUsed ? clients.blake.addressUtxos(address.address) : Promise.resolve([]),
      btcUsed ? clients.btc.addressUtxos(address.address) : Promise.resolve([]),
    ]);
    if (utxoResults[0].status === "rejected" || utxoResults[1].status === "rejected") {
      if (utxoResults[0].status === "rejected") {
        errors.push(`BLAKE UTXOs ${index}: ${settledErrorReason(utxoResults[0])}`);
      }
      if (utxoResults[1].status === "rejected") {
        errors.push(`BTC UTXOs ${index}: ${settledErrorReason(utxoResults[1])}`);
      }
      break;
    }
    if (
      !addUtxos(outputs, address, "blake", utxoResults[0].value, errors) ||
      !addUtxos(outputs, address, "btc", utxoResults[1].value, errors)
    ) {
      state.recoveryScan = { nextIndex: index, trailingGap: gap };
      return { complete: false, authoritative: false, outputs };
    }

    if (gap >= scanGap && index >= state.nextReceiveIndex - 1) {
      complete = true;
      break;
    }
    index++;
    scanned++;
  }
  if (complete) {
    // Keep a terminal resume point until the caller has rechecked all previously used addresses.
    state.recoveryScan = { nextIndex: index, trailingGap: Math.max(0, gap - 1) };
  } else {
    if (index > MAX_DERIVATION_INDEX) {
      errors.push("Address recovery reached the BIP32 derivation limit");
    }
    state.recoveryScan = { nextIndex: index, trailingGap: gap };
  }
  return { complete, authoritative: false, outputs };
}

export async function scanCurrentUtxos(
  state: WalletPublicState,
  clients: WalletClients,
  errors: string[],
): Promise<AddressScanResult> {
  const outputs = new Map<string, DiscoveredOutput>();
  const addresses = state.addresses
    // Recovery derives a trailing unused lookahead window. Keep every one of those
    // addresses under observation so a delayed invoice remains discoverable.
    .filter((address) => address.branch === 0)
    .sort((left, right) => left.index - right.index);
  if (addresses.length === 0) {
    errors.push("No issued receive address is available");
    return { complete: false, authoritative: false, outputs };
  }
  for (const address of addresses) {
    const results = await Promise.allSettled([
      clients.blake.addressUtxos(address.address),
      clients.btc.addressUtxos(address.address),
    ]);
    if (results[0].status === "rejected" || results[1].status === "rejected") {
      if (results[0].status === "rejected") {
        errors.push(`BLAKE UTXOs ${address.index}: ${settledErrorReason(results[0])}`);
      }
      if (results[1].status === "rejected") {
        errors.push(`BTC UTXOs ${address.index}: ${settledErrorReason(results[1])}`);
      }
      return { complete: false, authoritative: false, outputs };
    }
    address.used ||= results[0].value.length > 0 || results[1].value.length > 0;
    if (
      !addUtxos(outputs, address, "blake", results[0].value, errors) ||
      !addUtxos(outputs, address, "btc", results[1].value, errors)
    ) {
      return { complete: false, authoritative: false, outputs };
    }
  }
  return { complete: true, authoritative: true, outputs };
}

export function installDiscoveredOutputs(
  state: WalletPublicState,
  scan: AddressScanResult,
  blakeTipHeight: number,
  btcTipHeight: number,
): void {
  const previous = new Map(state.coins.map((coin) => [coin.outpoint, coin]));
  const governed = new Set(
    state.intents
      .filter(intentNeedsReconciliation)
      .flatMap(intentOutpoints),
  );
  const current: PersistedCoin[] = [];
  for (const [outpoint, discovered] of scan.outputs) {
    const { address, blake, btc } = discovered;
    const utxo = blake ?? btc;
    if (!utxo) continue;
    const known = previous.get(outpoint);
    const unknown = failedObservation(new Error("Awaiting dual-chain observation"));
    if (
      known &&
      (known.value !== utxo.value || known.address !== address.address ||
        known.scriptPubKey !== address.scriptPubKey || known.path !== address.path)
    ) {
      throw new Error(`Backend identity changed for ${outpoint}`);
    }
    const coin: PersistedCoin = {
      ...(known ?? {
        outpoint,
        txid: utxo.txid,
        vout: utxo.vout,
        blake: structuredClone(unknown),
        btc: structuredClone(unknown),
      }),
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      address: address.address,
      scriptPubKey: address.scriptPubKey,
      path: address.path,
      blake: blake
        ? utxoObservation(blake, blakeTipHeight)
        : !scan.authoritative
        ? structuredClone(known?.blake ?? unknown)
        : utxoObservation(undefined, blakeTipHeight),
      btc: btc
        ? utxoObservation(btc, btcTipHeight)
        : !scan.authoritative
        ? structuredClone(known?.btc ?? unknown)
        : utxoObservation(undefined, btcTipHeight),
    };
    const previouslySeenOnBlake = known?.blake.backendOk === true &&
      known.blake.tx?.present === true;
    const previouslySeenOnBtc = known?.btc.backendOk === true && known.btc.tx?.present === true;
    if ((Boolean(blake) || previouslySeenOnBlake) && (Boolean(btc) || previouslySeenOnBtc)) {
      state.sharedProvenance[outpoint] ??= {
        firstObservedAt: new Date().toISOString(),
      };
    }
    current.push(coin);
    previous.delete(outpoint);
  }
  if (!scan.authoritative) {
    // A partial backend response must never be interpreted as proof that an old coin vanished.
    current.push(...previous.values());
  } else {
    for (const coin of previous.values()) {
      if (!state.sharedProvenance[coin.outpoint] && !governed.has(coin.outpoint)) continue;
      // Retain identity and fresh absence observations. Provenance and intent history are
      // separate, monotonic safety facts.
      current.push({
        ...coin,
        blake: utxoObservation(undefined, blakeTipHeight),
        btc: utxoObservation(undefined, btcTipHeight),
      });
    }
  }
  state.coins = current.sort((left, right) => left.outpoint.localeCompare(right.outpoint));
}

export function advanceReceiveAddressPastUsed(
  state: WalletPublicState,
  keychain: Bip86Keychain | null,
): void {
  if (!keychain) return;
  const highestUsed = state.addresses.reduce(
    (highest, address) =>
      address.branch === 0 && address.used ? Math.max(highest, address.index) : highest,
    -1,
  );
  if (highestUsed < state.nextReceiveIndex - 1) return;
  const freshIndex = highestUsed + 1;
  if (!state.addresses.some((address) => address.branch === 0 && address.index === freshIndex)) {
    state.addresses.push(keychain.derive(0, freshIndex));
  }
  state.nextReceiveIndex = freshIndex + 1;
}

function nextUnusedReceiveAddressIndex(state: WalletPublicState): number {
  let index = state.nextReceiveIndex;
  while (
    index < MAX_DERIVATION_INDEX &&
    state.addresses.some((address) =>
      address.branch === 0 && address.index === index && address.used
    )
  ) index++;
  return index;
}

export function canIssueNextReceiveAddress(state: WalletPublicState): boolean {
  const index = nextUnusedReceiveAddressIndex(state);
  if (index >= MAX_DERIVATION_INDEX) return false;
  const highestUsedBefore = state.addresses.reduce(
    (highest, address) =>
      address.branch === 0 && address.used && address.index < index
        ? Math.max(highest, address.index)
        : highest,
    -1,
  );
  return index - highestUsedBefore <= state.settings.scanGap;
}

/** Issue the first cached or newly derived receive address that has no known history. */
export function issueNextUnusedReceiveAddress(
  state: WalletPublicState,
  keychain: Bip86Keychain,
): void {
  const index = nextUnusedReceiveAddressIndex(state);
  if (index >= MAX_DERIVATION_INDEX) {
    throw new Error("Wallet reached the BIP32 receive-address limit");
  }
  if (!state.addresses.some((address) => address.branch === 0 && address.index === index)) {
    state.addresses.push(keychain.derive(0, index));
  }
  state.nextReceiveIndex = index + 1;
}

export function advanceReceiveAddressAfterConfirmedDeposit(
  state: WalletPublicState,
  keychain: Bip86Keychain | null,
): void {
  if (!keychain || state.nextReceiveIndex === 0) return;
  const currentIndex = state.nextReceiveIndex - 1;
  const current = state.addresses.find((address) =>
    address.branch === 0 && address.index === currentIndex
  );
  if (!current) return;
  const confirmedDeposit = state.coins.some((coin) =>
    coin.address === current.address &&
    [coin.btc, coin.blake].some((observation) =>
      observation.backendOk && observation.unspent === true &&
      observation.tx?.present === true && observation.tx.confirmed
    )
  ) || state.intents.some((intent) =>
    intent.kind !== "blake-replay" && intent.phase === "confirmed" &&
    intent.inputOutpoints.some((outpoint) =>
      state.coins.some((coin) =>
        coin.outpoint === outpoint && coin.address === current.address
      )
    )
  );
  if (!confirmedDeposit) return;
  issueNextUnusedReceiveAddress(state, keychain);
}

function validatedUtxoMap(chain: ChainId, utxos: EsploraUtxo[]): Map<string, EsploraUtxo> {
  if (!Array.isArray(utxos)) {
    throw new Error(`${chain.toUpperCase()} returned a malformed UTXO list`);
  }
  const result = new Map<string, EsploraUtxo>();
  for (const utxo of utxos) {
    if (
      !utxo || !/^[0-9a-f]{64}$/u.test(utxo.txid) ||
      !Number.isSafeInteger(utxo.vout) || utxo.vout < 0 || utxo.vout > 0xffff_ffff ||
      !Number.isSafeInteger(utxo.value) || utxo.value < 0 ||
      typeof utxo.status?.confirmed !== "boolean" ||
      (utxo.status.confirmed &&
        (!Number.isSafeInteger(utxo.status.block_height) ||
          (utxo.status.block_height as number) < 0))
    ) {
      throw new Error(`${chain.toUpperCase()} returned a malformed UTXO`);
    }
    if (utxo.value === 0) continue;
    const outpoint = `${utxo.txid}:${utxo.vout}`;
    if (result.has(outpoint)) {
      throw new Error(`${chain.toUpperCase()} returned a duplicate UTXO`);
    }
    result.set(outpoint, utxo);
  }
  return result;
}

export async function refreshSelectedUtxos(
  state: WalletPublicState,
  outputs: PersistedCoin[],
  clients: WalletClients,
  blakeTipHeight: number,
  btcTipHeight: number,
): Promise<void> {
  const byAddress = new Map<string, PersistedCoin[]>();
  for (const output of outputs) {
    const group = byAddress.get(output.address) ?? [];
    group.push(output);
    byAddress.set(output.address, group);
  }
  for (const [address, group] of byAddress) {
    const [blakeUtxos, btcUtxos] = await Promise.all([
      clients.blake.addressUtxos(address),
      clients.btc.addressUtxos(address),
    ]);
    const blakeByOutpoint = validatedUtxoMap("blake", blakeUtxos);
    const btcByOutpoint = validatedUtxoMap("btc", btcUtxos);
    for (const output of group) {
      const blake = blakeByOutpoint.get(output.outpoint);
      const btc = btcByOutpoint.get(output.outpoint);
      if ((blake && blake.value !== output.value) || (btc && btc.value !== output.value)) {
        throw new Error(`Backend value changed for ${output.outpoint}`);
      }
      output.blake = utxoObservation(blake, blakeTipHeight);
      output.btc = utxoObservation(btc, btcTipHeight);
      if (blake && btc) {
        state.sharedProvenance[output.outpoint] ??= {
          firstObservedAt: new Date().toISOString(),
        };
      }
    }
  }
}

export async function refreshFundingProvenance(
  state: WalletPublicState,
  coins: PersistedCoin[],
  blake: EsploraClient,
): Promise<void> {
  const unknownByTxid = new Map<string, PersistedCoin[]>();
  for (const coin of coins) {
    if (state.sharedProvenance[coin.outpoint]) continue;
    const group = unknownByTxid.get(coin.txid) ?? [];
    group.push(coin);
    unknownByTxid.set(coin.txid, group);
  }
  const statuses = await Promise.all(
    [...unknownByTxid].map(async ([txid, outputs]) => ({
      outputs,
      status: await blake.transactionStatus(txid),
    })),
  );
  const observedAt = new Date().toISOString();
  for (const { outputs, status } of statuses) {
    if (!status) continue;
    for (const output of outputs) {
      state.sharedProvenance[output.outpoint] ??= { firstObservedAt: observedAt };
    }
  }
}
