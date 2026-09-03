import type { ReactNode } from "react";
import type { WalletSnapshot } from "../core/types.ts";
import { Amount } from "./Amount.tsx";

function BalanceCard(
  { label, value, detail, accent }: {
    label: string;
    value: number;
    detail: ReactNode;
    accent: string;
  },
) {
  return (
    <article className={`balance-card ${accent}`}>
      <div className="balance-heading">
        <span className="chain-dot" />
        {label}
      </div>
      <strong>
        <Amount value={value} />
      </strong>
      <span className="balance-detail">{detail}</span>
    </article>
  );
}

function SighashUnifiedHelp() {
  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label="Explain SIGHASH_UNIFIED"
        aria-describedby="sighash-unified-tooltip"
      >
        ?
      </button>
      <span id="sighash-unified-tooltip" className="info-tooltip-content" role="tooltip">
        SIGHASH_UNIFIED is the BLAKE chain&apos;s replay-protection signature flag. It makes the
        spend valid on the BLAKE chain but not replayable on Bitcoin. 0x21 means SIGHASH_ALL
        combined with SIGHASH_UNIFIED.
      </span>
    </span>
  );
}

export function BalanceSummary({ snapshot }: { snapshot: WalletSnapshot }) {
  return (
    <section className="balance-grid">
      <BalanceCard
        label="BTC BALANCE"
        value={snapshot.balances.btc}
        detail={
          <>
            <Amount value={snapshot.balances.spendableBtc} /> selectable for BTC sends
          </>
        }
        accent="btc"
      />
      <BalanceCard
        label="BLAKE BALANCE"
        value={snapshot.balances.blake}
        detail={
          <>
            <Amount value={snapshot.balances.spendableBlake} /> selectable with{" "}
            SIGHASH_UNIFIED (0x21)
            <SighashUnifiedHelp />
          </>
        }
        accent="blake"
      />
      <BalanceCard
        label="SHARED TO SPLIT"
        value={snapshot.balances.shared}
        detail={`${snapshot.splittableOutpoints.length} UTXO${
          snapshot.splittableOutpoints.length === 1 ? "" : "s"
        } ready`}
        accent="ready"
      />
    </section>
  );
}
