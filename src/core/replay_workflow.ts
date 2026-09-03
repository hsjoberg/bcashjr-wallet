import { deriveCoinPolicy } from "./coin_policy.ts";
import { selectCoins } from "./coin_selection.ts";
import type { EsploraClient } from "./esplora.ts";
import type { Bip86Keychain } from "./keys.ts";
import type { IntentEvent } from "./intent_state.ts";
import {
  assertReplayCandidatesMatchTransaction,
  parseReplayTransaction,
} from "./replay_transaction.ts";
import type {
  BroadcastResult,
  ChainId,
  ChainTip,
  PersistedCoin,
  ReplayPreview,
  TransactionIntent,
  WalletPublicState,
} from "./types.ts";
import { refreshSelectedUtxos, type WalletClients } from "./wallet_sync.ts";

const PREVIEW_LIFETIME_MS = 5 * 60 * 1000;

interface StoredReplayPreview {
  public: ReplayPreview;
  rawTx: string;
  authorizationOutpoints: string[];
}

export interface ReplayWorkflowContext {
  state(): WalletPublicState;
  requireKeychain(): Bip86Keychain;
  clients(): WalletClients;
  verifiedTip(chain: ChainId, client: EsploraClient): Promise<ChainTip>;
  refreshIntentStatuses(
    clients: WalletClients,
    tipHeights: Record<ChainId, number>,
    errors: string[],
    relevantOutpoints: Set<string>,
  ): Promise<void>;
  saveWorkingState(): Promise<void>;
  commit(mutator: (draft: WalletPublicState) => void): Promise<void>;
  storePreparedIntent(intent: TransactionIntent): Promise<void>;
  transitionIntent(intentId: string, event: IntentEvent): Promise<void>;
  broadcastIntent(intentId: string, client: EsploraClient): Promise<void>;
  rebroadcastProtectionChildren(parentIntentId: string): Promise<void>;
  now(): number;
}

/** Owns ephemeral funding-replay previews and their final validation. */
export class ReplayWorkflow {
  #previews = new Map<string, StoredReplayPreview>();

  constructor(private readonly context: ReplayWorkflowContext) {}

  clear(): void {
    this.#previews.clear();
  }

  purgeExpired(): void {
    const now = this.context.now();
    for (const [id, preview] of this.#previews) {
      if (now >= Date.parse(preview.public.expiresAt)) this.#previews.delete(id);
    }
  }

  async preview(txid: string): Promise<ReplayPreview> {
    this.purgeExpired();
    this.context.requireKeychain();
    if (!/^[0-9a-f]{64}$/u.test(txid)) throw new Error("Invalid transaction id");
    const state = this.context.state();
    assertRecoveryComplete(state);
    const replayCandidates = state.coins.filter((coin) =>
      coin.txid === txid && deriveCoinPolicy(
        coin,
        Boolean(state.sharedProvenance[coin.outpoint]),
        state.intents,
        state.settings,
      ).replayCandidate
    );
    assertReplayable(state, replayCandidates);
    const clients = this.context.clients();
    const [blakeTip, rawTx] = await Promise.all([
      this.context.verifiedTip("blake", clients.blake),
      clients.btc.transactionHex(txid),
    ]);
    state.tips.blake = blakeTip;
    const blakeStatus = await clients.blake.transactionStatus(txid);
    const parsed = parseReplayTransaction(state, rawTx, txid);
    assertReplayCandidatesMatchTransaction(replayCandidates, parsed.walletOutputs);
    if (blakeStatus) {
      await this.context.commit((draft) => {
        const observedAt = new Date().toISOString();
        for (const output of parsed.walletOutputs) {
          draft.sharedProvenance[output.outpoint] ??= { firstObservedAt: observedAt };
        }
      });
      throw new Error("This funding transaction already exists on BLAKE and cannot be replayed");
    }
    const { walletOutputs, inputOutpoints: _inputOutpoints, ...details } = parsed;
    const created = this.context.now();
    const publicPreview: ReplayPreview = {
      id: crypto.randomUUID(),
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + PREVIEW_LIFETIME_MS).toISOString(),
      txid,
      walletOutpoints: walletOutputs.map((output) => output.outpoint),
      walletValue: walletOutputs.reduce((sum, output) => sum + output.value, 0),
      ...details,
    };
    this.#previews.set(publicPreview.id, {
      public: publicPreview,
      rawTx,
      authorizationOutpoints: replayCandidates.map((output) => output.outpoint),
    });
    return structuredClone(publicPreview);
  }

  cancel(previewId: string): void {
    this.#previews.delete(previewId);
  }

  async confirm(previewId: string): Promise<BroadcastResult> {
    const stored = this.#previews.get(previewId);
    this.#previews.delete(previewId);
    if (!stored) throw new Error("Replay preview is missing or was already used");
    if (this.context.now() >= Date.parse(stored.public.expiresAt)) {
      throw new Error("Replay preview expired");
    }
    this.context.requireKeychain();
    let state = this.context.state();
    assertRecoveryComplete(state);
    const clients = this.context.clients();
    const [blakeTip, btcTip] = await Promise.all([
      this.context.verifiedTip("blake", clients.blake),
      this.context.verifiedTip("btc", clients.btc),
    ]);
    state.tips.blake = blakeTip;
    state.tips.btc = btcTip;
    let replayCandidates = selectCoins(state, stored.authorizationOutpoints);
    const previewTransaction = parseReplayTransaction(state, stored.rawTx, stored.public.txid);
    const inputOutpoints = new Set(previewTransaction.inputOutpoints);
    const knownWalletInputs = state.coins.filter((coin) => inputOutpoints.has(coin.outpoint));
    const outputsToRefresh = new Map(
      [...replayCandidates, ...knownWalletInputs].map((coin) => [coin.outpoint, coin]),
    );
    await refreshSelectedUtxos(
      state,
      [...outputsToRefresh.values()],
      clients,
      blakeTip.height,
      btcTip.height,
    );
    const validationErrors: string[] = [];
    await this.context.refreshIntentStatuses(
      clients,
      { blake: blakeTip.height, btc: btcTip.height },
      validationErrors,
      inputOutpoints,
    );
    await this.context.saveWorkingState();
    state = this.context.state();
    if (validationErrors.length > 0) {
      throw new Error(
        `Replay safety state could not be verified: ${validationErrors.join("; ")}`,
      );
    }
    replayCandidates = selectCoins(state, stored.authorizationOutpoints);
    assertReplayable(state, replayCandidates);
    const blakeStatus = await clients.blake.transactionStatus(stored.public.txid);
    const parsed = parseReplayTransaction(state, stored.rawTx, stored.public.txid);
    assertReplayCandidatesMatchTransaction(replayCandidates, parsed.walletOutputs);
    const walletOutpoints = parsed.walletOutputs.map((output) => output.outpoint);
    const walletInputOutpoints = parsed.inputOutpoints.filter((outpoint) =>
      state.coins.some((coin) =>
        coin.outpoint === outpoint && coin.blake.backendOk && coin.blake.unspent === true
      )
    );
    const walletValue = parsed.walletOutputs.reduce((sum, output) => sum + output.value, 0);
    if (blakeStatus) {
      await this.context.commit((draft) => {
        const observedAt = new Date().toISOString();
        for (const outpoint of walletOutpoints) {
          draft.sharedProvenance[outpoint] ??= { firstObservedAt: observedAt };
        }
      });
      throw new Error("This funding transaction appeared on BLAKE; sync before trying again");
    }
    if (
      JSON.stringify(walletOutpoints) !== JSON.stringify(stored.public.walletOutpoints) ||
      walletValue !== stored.public.walletValue || parsed.inputCount !== stored.public.inputCount ||
      parsed.outputCount !== stored.public.outputCount ||
      parsed.totalOutputValue !== stored.public.totalOutputValue ||
      parsed.version !== stored.public.version || parsed.lockTime !== stored.public.lockTime
    ) {
      throw new Error(
        "Wallet outputs in this funding transaction changed; review the replay again",
      );
    }
    const createdAt = new Date().toISOString();
    const intent: TransactionIntent = {
      id: crypto.randomUUID(),
      kind: "blake-replay",
      chain: "blake",
      txid: stored.public.txid,
      rawTx: stored.rawTx,
      createdAt,
      phase: "prepared",
      walletInputOutpoints,
      walletOutpoints,
    };
    await this.context.storePreparedIntent(intent);
    await this.context.transitionIntent(intent.id, { type: "broadcast-started", at: createdAt });
    await this.context.broadcastIntent(intent.id, clients.blake);
    await this.context.rebroadcastProtectionChildren(intent.id);
    return {
      txid: stored.public.txid,
      rawTx: stored.rawTx,
      chain: "blake",
      action: "replay",
    };
  }
}

function assertRecoveryComplete(state: WalletPublicState): void {
  if (!state.recoveryScanComplete) {
    throw new Error("Finish wallet recovery before replaying a funding transaction");
  }
}

function assertReplayable(state: WalletPublicState, outputs: PersistedCoin[]): void {
  if (outputs.length === 0) throw new Error("No BTC-only wallet output is available to replay");
  for (const output of outputs) {
    if (
      !deriveCoinPolicy(
        output,
        Boolean(state.sharedProvenance[output.outpoint]),
        state.intents,
        state.settings,
      ).replayCandidate
    ) {
      throw new Error(`Output ${output.outpoint} is not a fresh BTC-only replay candidate`);
    }
  }
}
