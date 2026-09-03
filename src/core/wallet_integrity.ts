import type { Bip86Keychain } from "./keys.ts";
import type { PersistedCoin, WalletPublicState } from "./types.ts";
import { MAX_DERIVATION_INDEX } from "./wallet_sync.ts";

function pathCoordinates(path: string): { branch: 0 | 1; index: number } | null {
  const match = path.match(/^m\/86'\/0'\/0'\/([01])\/(\d+)$/u);
  if (!match) return null;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_DERIVATION_INDEX) return null;
  return { branch: Number(match[1]) as 0 | 1, index };
}

/** Re-derive secret-dependent metadata and discard corrupted public cache entries. */
export function reconcileDerivedPublicState(
  state: WalletPublicState,
  keychain: Bip86Keychain,
): boolean {
  if (
    !Number.isSafeInteger(state.nextReceiveIndex) || state.nextReceiveIndex < 0 ||
    state.nextReceiveIndex > MAX_DERIVATION_INDEX
  ) {
    throw new Error("Wallet receive index is malformed");
  }
  let changed = false;
  let needsRecovery = false;
  const addresses = new Map<string, WalletPublicState["addresses"][number]>();
  for (const stored of state.addresses as unknown[]) {
    if (
      !stored || typeof stored !== "object" ||
      ((stored as { branch?: unknown }).branch !== 0 &&
        (stored as { branch?: unknown }).branch !== 1) ||
      !Number.isSafeInteger((stored as { index?: unknown }).index) ||
      ((stored as { index: number }).index < 0) ||
      ((stored as { index: number }).index > MAX_DERIVATION_INDEX)
    ) {
      changed = true;
      needsRecovery = true;
      continue;
    }
    const candidate = stored as WalletPublicState["addresses"][number];
    const derived = keychain.derive(candidate.branch, candidate.index);
    const metadataMatches = candidate.address === derived.address &&
      candidate.scriptPubKey === derived.scriptPubKey && candidate.path === derived.path;
    if (!metadataMatches) {
      changed = true;
      needsRecovery = true;
    }
    const key = `${candidate.branch}:${candidate.index}`;
    const existing = addresses.get(key);
    if (existing) {
      changed = true;
      needsRecovery = true;
      existing.used ||= metadataMatches && candidate.used === true;
    } else {
      addresses.set(key, { ...derived, used: metadataMatches && candidate.used === true });
    }
  }
  const issuedCount =
    [...addresses.values()].filter((address) =>
      address.branch === 0 && address.index < state.nextReceiveIndex
    ).length;
  if (issuedCount !== state.nextReceiveIndex) {
    needsRecovery = true;
    changed = true;
  }
  if (state.nextReceiveIndex > 0) {
    const index = state.nextReceiveIndex - 1;
    if (!addresses.has(`0:${index}`)) {
      addresses.set(`0:${index}`, keychain.derive(0, index));
      changed = true;
    }
  }

  const validCoins: PersistedCoin[] = [];
  for (const coin of state.coins as unknown[]) {
    if (!coin || typeof coin !== "object") {
      changed = true;
      needsRecovery = true;
      continue;
    }
    const candidate = coin as PersistedCoin;
    const coordinates = pathCoordinates(candidate.path);
    if (!coordinates) {
      changed = true;
      needsRecovery = true;
      continue;
    }
    const derived = keychain.derive(coordinates.branch, coordinates.index);
    if (
      candidate.path !== derived.path || candidate.address !== derived.address ||
      candidate.scriptPubKey !== derived.scriptPubKey
    ) {
      changed = true;
      needsRecovery = true;
      continue;
    }
    validCoins.push(candidate);
  }
  if (validCoins.length !== state.coins.length) changed = true;
  if (!changed) return false;

  state.addresses = [...addresses.values()].sort((left, right) =>
    left.branch - right.branch || left.index - right.index
  );
  state.coins = validCoins;
  if (needsRecovery) {
    state.recoveryScanComplete = false;
    state.recoveryScan = { nextIndex: 0, trailingGap: 0 };
  }
  return true;
}

export function ensureInitialAddress(
  state: WalletPublicState,
  keychain: Bip86Keychain | null,
): boolean {
  if (!keychain || state.nextReceiveIndex > 0) return false;
  if (!state.addresses.some((address) => address.branch === 0 && address.index === 0)) {
    state.addresses.push(keychain.derive(0, 0));
  }
  state.nextReceiveIndex = 1;
  return true;
}

/** Count the issued receive addresses after the most recently used one. */
export function consecutiveUnusedReceiveAddresses(state: WalletPublicState): number {
  const issued = new Map(
    state.addresses
      .filter((address) => address.branch === 0 && address.index < state.nextReceiveIndex)
      .map((address) => [address.index, address]),
  );
  let count = 0;
  for (let index = state.nextReceiveIndex - 1; index >= 0; index--) {
    const address = issued.get(index);
    if (!address || address.used) break;
    count++;
  }
  return count;
}
