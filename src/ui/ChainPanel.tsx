import type { FormEvent } from "react";
import type { ChainId, TrackedOutput } from "../core/types.ts";
import { Amount } from "./Amount.tsx";
import { transactionPage } from "./explorer_url.ts";
import { Spinner, StateBadge } from "./shared.tsx";

function UtxoRow(
  { output, chain, backendApiUrl, selectable, selected, onToggle, hint }: {
    output: TrackedOutput;
    chain: ChainId;
    backendApiUrl: string;
    selectable: boolean;
    selected: boolean;
    onToggle(): void;
    hint?: string;
  },
) {
  const observation = output[chain];
  return (
    <div className={`utxo-row ${selectable ? "selectable" : ""}`}>
      <input
        type="checkbox"
        aria-label={`Select ${output.outpoint}`}
        disabled={!selectable}
        checked={selected}
        onChange={onToggle}
      />
      <div className="utxo-identity">
        <a
          className="tx-link"
          href={transactionPage(backendApiUrl, output.txid)}
          target="_blank"
          rel="noreferrer"
          title={`Open on the ${chain === "btc" ? "Bitcoin" : "BLAKE"} explorer`}
        >
          <code>{output.txid}</code>
        </a>
        <small>Output {output.vout} · {output.path}</small>
      </div>
      <div className="utxo-meta">
        <strong>
          <Amount value={output.value} />
        </strong>
        <small>{observation.tx?.confirmations ?? "—"} conf.</small>
      </div>
      <div className="utxo-state">
        <StateBadge state={output.splitState} />
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

interface ChainPanelProps {
  chain: ChainId;
  outputs: TrackedOutput[];
  selectable: Set<string>;
  selected: Set<string>;
  destination: string;
  feeRate: string;
  busy: string;
  backendApiUrl: string;
  walletAddress?: string;
  onToggle(outpoint: string): void;
  onSelectAll(outpoints: string[]): void;
  onDestination(value: string): void;
  onScanDestination(): void;
  onFeeRate(value: string): void;
  onReview(event: FormEvent): void;
}

export function ChainPanel(props: ChainPanelProps) {
  const {
    chain,
    outputs,
    selectable,
    selected,
    destination,
    feeRate,
    busy,
    backendApiUrl,
    walletAddress,
    onToggle,
    onSelectAll,
    onDestination,
    onScanDestination,
    onFeeRate,
    onReview,
  } = props;
  const isBtc = chain === "btc";
  const available = outputs.filter((output) => selectable.has(output.outpoint));
  const allSelected = available.length > 0 &&
    available.every((output) => selected.has(output.outpoint));
  const selectedValue = outputs.reduce(
    (sum, output) => sum + (selected.has(output.outpoint) ? output.value : 0),
    0,
  );
  const selectedSplitCount = isBtc
    ? 0
    : outputs.filter((output) =>
      selected.has(output.outpoint) && output.blake.unspent && output.btc.unspent
    ).length;

  return (
    <article className={`card chain-panel ${chain}-panel`}>
      <div className="chain-panel-header">
        <div>
          <h2>{isBtc ? "Bitcoin UTXOs" : "BLAKE UTXOs"}</h2>
          <p>
            {isBtc
              ? "Send BTC-only, split, or shared coins. A replayable selection requires an extra confirmation before signing."
              : "Split shared coins here first: select them and send to yourself or directly to another destination. SIGHASH_UNIFIED prevents the BLAKE spend from replaying on Bitcoin, leaving the BTC copies in place."}
          </p>
        </div>
      </div>
      <div className="utxo-toolbar">
        <span>{outputs.length} UTXO{outputs.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          className="text-button"
          disabled={available.length === 0}
          onClick={() => onSelectAll(allSelected ? [] : available.map((output) => output.outpoint))}
        >
          {allSelected ? "Clear" : "Select available"}
        </button>
      </div>
      <div className="utxo-list">
        {outputs.length === 0
          ? (
            <div className="panel-empty">
              <strong>No {isBtc ? "BTC" : "BLAKE"} UTXOs</strong>
              <span>Sync after receiving or splitting coins.</span>
            </div>
          )
          : outputs.map((output) => {
            const isSelectable = selectable.has(output.outpoint);
            const observation = output[chain];
            const shared = output.blake.unspent === true && output.btc.unspent === true;
            const hint = isBtc && output.splitState === "split-pending"
              ? isSelectable ? "Replay risk" : "BLAKE pending"
              : shared && isBtc && isSelectable
              ? "Replay risk"
              : shared && isBtc
              ? "Split on BLAKE first"
              : shared && isSelectable && observation.tx?.present && !observation.tx.confirmed
              ? "0-conf allowed"
              : shared && isSelectable
              ? "BTC remains"
              : shared
              ? "Waiting"
              : isSelectable && observation.tx?.present && !observation.tx.confirmed
              ? "0-conf allowed"
              : !isSelectable && output.splitState === "confirming"
              ? "Waiting"
              : undefined;
            return (
              <UtxoRow
                key={output.outpoint}
                output={output}
                chain={chain}
                backendApiUrl={backendApiUrl}
                selectable={isSelectable}
                selected={selected.has(output.outpoint)}
                onToggle={() => onToggle(output.outpoint)}
                hint={hint}
              />
            );
          })}
      </div>
      <div className="chain-compose">
        <div className="selection-line">
          <span>{selected.size} selected</span>
          <strong>
            <Amount value={selectedValue} />
          </strong>
        </div>
        <form onSubmit={onReview}>
          <div className="compose-field destination-field">
            <span className="field-label-line">
              <label htmlFor={`${chain}-destination`}>Destination address</label>
              <button
                type="button"
                className="field-action"
                disabled={!walletAddress}
                title="Use this wallet's current receive address"
                onClick={() => onDestination(walletAddress ?? "")}
              >
                Send to self
              </button>
            </span>
            <div className="destination-input-wrap">
              <input
                id={`${chain}-destination`}
                value={destination}
                onChange={(event) => onDestination(event.target.value)}
                placeholder="bc1p… or bc1q…"
                required
                spellCheck={false}
              />
              <button
                type="button"
                className="destination-scan-button"
                disabled={Boolean(busy)}
                aria-label="Scan destination QR"
                title="Scan destination QR"
                onClick={onScanDestination}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 6 9.7 4h4.6L16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Z" />
                  <circle cx="12" cy="12.5" r="3.5" />
                </svg>
              </button>
            </div>
          </div>
          <div className="compose-field fee-field">
            <span className="field-label-line">
              <label htmlFor={`${chain}-fee-rate`}>Fee rate</label>
              <span className="optional">sat/vB · optional</span>
            </span>
            <input
              id={`${chain}-fee-rate`}
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={feeRate}
              onChange={(event) => onFeeRate(event.target.value)}
              placeholder="Automatic"
            />
          </div>
          <button
            type="submit"
            className={`wide ${isBtc ? "btc-action" : "primary"}`}
            disabled={Boolean(busy) || selected.size === 0}
          >
            {busy === `${chain}-preview` && <Spinner />}
            Review {isBtc ? "BTC send" : selectedSplitCount > 0 ? "BLAKE split" : "BLAKE send"}
          </button>
        </form>
      </div>
    </article>
  );
}
