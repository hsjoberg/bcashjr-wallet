import type { WalletSnapshot } from "../core/types.ts";
import { ReceiveQr } from "./ReceiveQr.tsx";
import { Spinner } from "./shared.tsx";

export function ReceivePanel(
  { snapshot, busy, onNewAddress, onContinueScan }: {
    snapshot: WalletSnapshot;
    busy: string;
    onNewAddress(): void;
    onContinueScan(): void;
  },
) {
  return (
    <section className="card receive-card receive-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">RECEIVE</div>
          <h2>One address, observed on both chains</h2>
        </div>
        {snapshot.recoveryScanComplete && (
          <button
            type="button"
            className="secondary compact"
            disabled={Boolean(busy) || !snapshot.canCreateReceiveAddress}
            title={!snapshot.canCreateReceiveAddress
              ? "Use or sync an issued address before creating another"
              : undefined}
            onClick={onNewAddress}
          >
            New address
          </button>
        )}
      </div>
      {snapshot.receiveAddress
        ? (
          <div className="receive-address-layout">
            <div className="receive-address-details">
              <div className="address-box">
                <code>{snapshot.receiveAddress.address}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(snapshot.receiveAddress!.address)}
                >
                  Copy
                </button>
              </div>
              <p className="microcopy">
                Path{" "}
                {snapshot.receiveAddress.path}. Deposits are expected to appear on both Bitcoin and
                BLAKE chain. If a funding transaction does not reach BLAKE chain, replay it from the
                Replay panel.
              </p>
              {!snapshot.canCreateReceiveAddress && (
                <p className="microcopy address-gap-message">
                  The configured address gap is full. Use or sync one of the issued addresses before
                  creating another.
                </p>
              )}
            </div>
            <ReceiveQr address={snapshot.receiveAddress.address} />
          </div>
        )
        : !snapshot.recoveryScanComplete
        ? (
          <div className="receive-recovery-state">
            <div>
              <strong>Finding your next unused address</strong>
              <p className="muted">
                Recovery is checking previous addresses on both chains before receiving is enabled.
              </p>
            </div>
            <button
              type="button"
              className="secondary compact"
              disabled={Boolean(busy)}
              onClick={onContinueScan}
            >
              {busy === "sync" && <Spinner />}Continue scan
            </button>
          </div>
        )
        : <p className="muted">Unlock to derive a receive address.</p>}
    </section>
  );
}
