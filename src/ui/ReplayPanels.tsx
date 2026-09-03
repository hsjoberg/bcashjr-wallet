import type { TrackedOutput, WalletSnapshot } from "../core/types.ts";
import { Amount } from "./Amount.tsx";
import { transactionPage } from "./explorer_url.ts";
import { Spinner } from "./shared.tsx";

export function ReplayPanel(
  { groups, busy, btcApiUrl, onInspect }: {
    groups: Array<{ txid: string; outputs: TrackedOutput[] }>;
    busy: string;
    btcApiUrl: string;
    onInspect(txid: string): void;
  },
) {
  return (
    <article className="card replay-panel">
      <div className="replay-panel-header">
        <div>
          <h2>Replay a BTC transaction to BLAKE</h2>
          <p>
            Use this when a Bitcoin transaction paying this wallet never appeared on the BLAKE
            chain. The wallet rebroadcasts the original signed BTC transaction unchanged, creating
            the matching BLAKE outputs if the network accepts it.
          </p>
        </div>
        <small>{groups.length} candidate{groups.length === 1 ? "" : "s"}</small>
      </div>
      <div className="replay-list">
        {groups.length === 0
          ? (
            <div className="panel-empty">
              <strong>No BTC transactions available to replay</strong>
              <span>BTC-only funding transactions will appear here.</span>
            </div>
          )
          : groups.map(({ txid, outputs: walletOutputs }) => (
            <div className="replay-row" key={txid}>
              <div>
                <a
                  className="tx-link"
                  href={transactionPage(btcApiUrl, txid)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open on the Bitcoin explorer"
                >
                  <code>{txid}</code>
                </a>
                <small>
                  {walletOutputs.length} wallet output{walletOutputs.length === 1 ? "" : "s"} ·{" "}
                  <Amount value={walletOutputs.reduce((sum, output) => sum + output.value, 0)} />
                </small>
              </div>
              <button
                type="button"
                className="secondary compact"
                disabled={Boolean(busy)}
                onClick={() => onInspect(txid)}
              >
                {busy === `replay-${txid}` && <Spinner />}Inspect replay
              </button>
            </div>
          ))}
      </div>
    </article>
  );
}

export function TransactionRecovery(
  { intents, busy, btcApiUrl, blakeApiUrl, onRebroadcast, onAbandon }: {
    intents: WalletSnapshot["intents"];
    busy: string;
    btcApiUrl: string;
    blakeApiUrl: string;
    onRebroadcast(intentId: string): void;
    onAbandon(intentId: string): void;
  },
) {
  return (
    <section className="card transaction-recovery">
      <div className="section-heading">
        <div>
          <div className="eyebrow">TRANSACTION RECOVERY</div>
          <h2>Signed transaction needs attention</h2>
          <p className="muted">
            Rebroadcast the exact signed transaction, or abandon it only after the wallet verifies
            that the transaction is absent and its original wallet outputs are restored.
          </p>
        </div>
      </div>
      {intents.map((intent) => (
        <div className="replay-row" key={intent.id}>
          <div>
            <a
              className="tx-link"
              href={transactionPage(
                intent.chain === "btc" ? btcApiUrl : blakeApiUrl,
                intent.txid,
              )}
              target="_blank"
              rel="noreferrer"
            >
              <code>{intent.txid}</code>
            </a>
            <small>
              {intent.action === "split"
                ? "BLAKE split"
                : intent.action === "replay"
                ? "BLAKE funding replay"
                : `${intent.chain.toUpperCase()} send`} · {intent.phase} · {intent.outpoints.length}
              {" "}
              output{intent.outpoints.length === 1 ? "" : "s"}
              {intent.lastError ? ` · ${intent.lastError}` : ""}
              {intent.blockedBy.length > 0
                ? intent.kind === "btc-spend"
                  ? " · waiting for confirmed BLAKE split protection"
                  : ` · waiting for ${intent.blockedBy.length} parent replay`
                : ""}
            </small>
          </div>
          <div className="transaction-recovery-actions">
            <button
              type="button"
              className="secondary compact"
              disabled={Boolean(busy) || !intent.canRebroadcast}
              onClick={() => onRebroadcast(intent.id)}
            >
              {busy === `rebroadcast-${intent.id}` && <Spinner />}Rebroadcast
            </button>
            <button
              type="button"
              className="text-button"
              disabled={Boolean(busy) || !intent.canAbandon}
              onClick={() => onAbandon(intent.id)}
            >
              Abandon intent
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
