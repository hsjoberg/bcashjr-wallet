import type { ChainId, WalletSnapshot } from "../core/types.ts";
import { transactionPage } from "./explorer_url.ts";

export interface BroadcastNotice {
  label: string;
  txid: string;
  chain: ChainId;
}

function NoticeClose({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      className="notice-close"
      type="button"
      aria-label={label}
      title="Dismiss"
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

export function DashboardNotices(
  {
    snapshot,
    dismissedWarnings,
    error,
    success,
    onDismissWarning,
    onDismissError,
    onDismissSuccess,
  }: {
    snapshot: WalletSnapshot;
    dismissedWarnings: Set<string>;
    error: string;
    success: BroadcastNotice | null;
    onDismissWarning(warning: string): void;
    onDismissError(): void;
    onDismissSuccess(): void;
  },
) {
  return (
    <>
      {snapshot.warnings
        .filter((warning) => !dismissedWarnings.has(warning))
        .map((warning) => {
          const stale = warning.startsWith("Chain observations are stale");
          return (
            <div
              className={`warning-banner ${stale ? "stale-warning" : ""}`}
              key={warning}
            >
              <span>!</span>
              {warning}
              {!stale && (
                <NoticeClose
                  label="Dismiss warning"
                  onClick={() => onDismissWarning(warning)}
                />
              )}
            </div>
          );
        })}
      {error && (
        <div className="error-box global-error">
          {error}
          <NoticeClose label="Dismiss error" onClick={onDismissError} />
        </div>
      )}
      {success && (
        <div className="success-box">
          <span>{success.label}</span>
          <a
            className="tx-link success-tx-link"
            href={transactionPage(
              success.chain === "btc" ? snapshot.settings.btcApiUrl : snapshot.settings.blakeApiUrl,
              success.txid,
            )}
            target="_blank"
            rel="noreferrer"
            title={`Open ${success.txid} on the ${
              success.chain === "btc" ? "Bitcoin" : "BLAKE"
            } explorer`}
          >
            <code>{success.txid}</code>
          </a>
          <NoticeClose label="Dismiss broadcast notice" onClick={onDismissSuccess} />
        </div>
      )}
    </>
  );
}
