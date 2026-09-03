import { useState } from "react";
import type { ReplayPreview, SpendPreview } from "../core/types.ts";
import { Amount } from "./Amount.tsx";
import { Spinner } from "./shared.tsx";

export function SpendPreviewModal(
  { preview, busy, onCancel, onConfirm }: {
    preview: SpendPreview;
    busy: boolean;
    onCancel(): void;
    onConfirm(acceptHighFee: boolean, acceptReplayRisk: boolean): void;
  },
) {
  const [highFeeAccepted, setHighFeeAccepted] = useState(false);
  const [replayRiskAccepted, setReplayRiskAccepted] = useState(false);
  const sharedCoinReplayRisk = preview.risks.some((risk) => risk.kind === "shared-coin-replay");
  const possibleFundingReplayRisk = preview.risks.some((risk) =>
    risk.kind === "possible-funding-replay"
  );
  const replayRisk = sharedCoinReplayRisk || possibleFundingReplayRisk;
  const hasConfirmedSplitProtection = preview.replayProtectionSplitIntentIds.length > 0;
  const replayRiskExplanation = sharedCoinReplayRisk && possibleFundingReplayRisk
    ? "Some selected coins lack a confirmed split, while other coins exist only on Bitcoin right now. Absence on BTC-BLAKE does not prove a funding transaction is invalid there. If the required coins exist there now or can be created by replaying their funding transactions, this Bitcoin transaction can also be replayed."
    : possibleFundingReplayRisk
    ? "At least one selected coin exists only on Bitcoin right now. Its funding transaction may be invalid on BTC-BLAKE, or it may simply not have been replayed there yet. If that funding transaction can be replayed, this Bitcoin transaction can be replayed after it."
    : "At least one selected coin lacks a confirmed split from its BTC-BLAKE copy, so this Bitcoin transaction may also be valid there.";
  const isSplit = preview.splitInputCount > 0;
  const isBtc = preview.chain === "btc";
  const title = isSplit
    ? `Split ${preview.splitInputCount} shared UTXO${
      preview.splitInputCount === 1 ? "" : "s"
    } on BLAKE?`
    : `Broadcast ${isBtc ? "BTC" : "BLAKE"} transaction?`;
  return (
    <div className="modal-backdrop">
      <section className="modal preview-modal" role="dialog" aria-modal="true">
        <div className="eyebrow">FINAL REVIEW · {preview.chain.toUpperCase()}</div>
        <h2>{title}</h2>
        <p className="muted">
          {isSplit
            ? "All selected inputs use SIGHASH_UNIFIED (0x21). The shared inputs move only on BLAKE; their BTC outpoints remain untouched."
            : isBtc
            ? replayRisk
              ? "No selected coin guarantees that this Bitcoin transaction is protected from replay on BTC-BLAKE."
              : hasConfirmedSplitProtection
              ? "A confirmed split coin makes this complete Bitcoin transaction invalid on BTC-BLAKE."
              : "The selected outputs were freshly verified absent on BTC-BLAKE before this standard Bitcoin spend was prepared."
            : "This unified transaction is broadcast only to the configured BLAKE backend."}
        </p>
        {replayRisk && (
          <div className="high-fee-confirmation replay-warning">
            <strong>Possible BTC-BLAKE replay</strong>
            <span>
              {replayRiskExplanation}{" "}
              Anyone who sees a valid transaction may broadcast it there, sending available
              fork-side coins to the same destination. Replay and split a coin first, or include an
              already split coin, to guarantee replay protection.
            </span>
            <label className="check-row">
              <input
                type="checkbox"
                checked={replayRiskAccepted}
                disabled={busy}
                onChange={(event) => setReplayRiskAccepted(event.target.checked)}
              />
              <span>
                I understand this Bitcoin transaction may be replayable on BTC-BLAKE and send
                fork-side coins to this destination.
              </span>
            </label>
          </div>
        )}
        <dl>
          <div>
            <dt>Inputs</dt>
            <dd>{preview.outpoints.length}</dd>
          </div>
          {isSplit && (
            <div>
              <dt>Shared inputs split</dt>
              <dd>{preview.splitInputCount}</dd>
            </div>
          )}
          <div>
            <dt>Input value</dt>
            <dd>
              <Amount value={preview.inputValue} />
            </dd>
          </div>
          <div>
            <dt>Network fee</dt>
            <dd>
              <Amount value={preview.fee} /> · {preview.feeRate} sat/vB
            </dd>
          </div>
          <div>
            <dt>Destination receives</dt>
            <dd>
              <Amount value={preview.outputValue} />
            </dd>
          </div>
          <div>
            <dt>Virtual size</dt>
            <dd>{preview.vsize} vB</dd>
          </div>
          <div>
            <dt>Locktime / sighash</dt>
            <dd>{preview.lockTime} / 0x{preview.sighashType.toString(16).padStart(2, "0")}</dd>
          </div>
        </dl>
        <div className="destination-review">
          <span>DESTINATION</span>
          <code>{preview.destination}</code>
        </div>
        {preview.highFee && (
          <div className="high-fee-confirmation replay-warning">
            <strong>High fee</strong>
            <span>
              <Amount value={preview.fee} /> is{" "}
              {Math.round(preview.fee / preview.inputValue * 100)}% of the selected value.
            </span>
            <label className="check-row">
              <input
                type="checkbox"
                checked={highFeeAccepted}
                disabled={busy}
                onChange={(event) => setHighFeeAccepted(event.target.checked)}
              />
              <span>I understand and want to broadcast.</span>
            </label>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || (preview.highFee && !highFeeAccepted) ||
              (replayRisk && !replayRiskAccepted)}
            onClick={() => onConfirm(highFeeAccepted, replayRiskAccepted)}
          >
            {busy && <Spinner />}Sign & broadcast
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReplayPreviewModal(
  { preview, busy, onCancel, onConfirm }: {
    preview: ReplayPreview;
    busy: boolean;
    onCancel(): void;
    onConfirm(): void;
  },
) {
  return (
    <div className="modal-backdrop">
      <section className="modal preview-modal replay-modal" role="dialog" aria-modal="true">
        <div className="eyebrow">WHOLE TRANSACTION REPLAY</div>
        <h2>Replay this BTC funding transaction to BLAKE?</h2>
        <div className="replay-warning">
          This broadcasts the complete, already-signed BTC transaction—not just your wallet output.
          Every input and every output will be replayed if the BTC-BLAKE fork accepts it.
        </div>
        <dl>
          <div>
            <dt>Inputs in transaction</dt>
            <dd>{preview.inputCount}</dd>
          </div>
          <div>
            <dt>All transaction outputs</dt>
            <dd>{preview.outputCount}</dd>
          </div>
          <div>
            <dt>Total output value</dt>
            <dd>
              <Amount value={preview.totalOutputValue} />
            </dd>
          </div>
          <div>
            <dt>Your outputs</dt>
            <dd>{preview.walletOutpoints.length}</dd>
          </div>
          <div>
            <dt>Your output value</dt>
            <dd>
              <Amount value={preview.walletValue} />
            </dd>
          </div>
          <div>
            <dt>Version / locktime</dt>
            <dd>{preview.version} / {preview.lockTime}</dd>
          </div>
        </dl>
        <div className="destination-review">
          <span>BTC TRANSACTION ID</span>
          <code>{preview.txid}</code>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
            {busy && <Spinner />}Replay whole transaction
          </button>
        </div>
      </section>
    </div>
  );
}
