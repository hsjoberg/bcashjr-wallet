import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STALE_OBSERVATIONS_WARNING } from "../core/observation_freshness.ts";
import { emptyPublicState } from "../core/types.ts";
import { buildWalletSnapshot } from "../core/wallet_snapshot.ts";
import { Dashboard } from "./Dashboard.tsx";
import { DashboardNotices } from "./DashboardNotices.tsx";

function noticeProps(): ComponentProps<typeof DashboardNotices> {
  const state = emptyPublicState();
  state.recoveryScanComplete = true;
  return {
    snapshot: buildWalletSnapshot(state, "unlocked"),
    dismissedWarnings: new Set(),
    error: "",
    success: null,
    onDismissWarning: () => {},
    onDismissError: () => {},
    onDismissSuccess: () => {},
  };
}

Deno.test("empty or dismissed notifications leave no floating stack", () => {
  const props = noticeProps();
  if (renderToStaticMarkup(<DashboardNotices {...props} />) !== "") {
    throw new Error("Empty notifications rendered a layout element");
  }
  props.snapshot.warnings = ["Backend unavailable"];
  props.dismissedWarnings.add("Backend unavailable");
  if (renderToStaticMarkup(<DashboardNotices {...props} />) !== "") {
    throw new Error("Dismissed warnings left an empty floating stack");
  }
});

Deno.test("floating notifications prioritize action results and retain close buttons and links", () => {
  const props = noticeProps();
  const txid = "ab".repeat(32);
  props.error = "Backend returned <invalid data>";
  props.success = { label: "BTC broadcast", chain: "btc", txid };
  props.snapshot.warnings = ["Recovery scan is in progress."];
  const markup = renderToStaticMarkup(<DashboardNotices {...props} />);
  if (
    !markup.startsWith('<aside class="dashboard-notices" aria-label="Wallet notifications">') ||
    !markup.includes('role="alert"') || !markup.includes('role="status"') ||
    !markup.includes("Backend returned &lt;invalid data&gt;") ||
    !markup.includes(`href="https://mempool.space/tx/${txid}"`)
  ) throw new Error("Floating notifications lost their content or accessibility metadata");
  for (const label of ["Dismiss error", "Dismiss broadcast notice", "Dismiss warning"]) {
    if (!markup.includes(`aria-label="${label}"`)) {
      throw new Error(`Missing notification control: ${label}`);
    }
  }
  if (
    markup.indexOf("global-error") > markup.indexOf("success-box") ||
    markup.indexOf("success-box") > markup.indexOf("warning-banner")
  ) throw new Error("Persistent warnings hide action results at the top of a long stack");
});

Deno.test("stale observations remain visible without a dismiss button", () => {
  const props = noticeProps();
  props.snapshot.lastSyncAt = new Date(0).toISOString();
  props.snapshot.outputs = [{
    outpoint: `${"11".repeat(32)}:0`,
    txid: "11".repeat(32),
    vout: 0,
    value: 10_000,
    address: "bc1ptest",
    scriptPubKey: `5120${"22".repeat(32)}`,
    path: "m/86'/0'/0'/0/0",
    wasShared: false,
    splitState: "btc-only",
    btc: {
      checkedAt: props.snapshot.lastSyncAt,
      backendOk: true,
      tx: { present: true, confirmed: true, confirmations: 1 },
      unspent: true,
    },
    blake: {
      checkedAt: props.snapshot.lastSyncAt,
      backendOk: true,
      tx: { present: false, confirmed: false, confirmations: 0 },
      unspent: false,
    },
  }];
  props.dismissedWarnings.add(STALE_OBSERVATIONS_WARNING);
  const markup = renderToStaticMarkup(<DashboardNotices {...props} />);
  if (!markup.includes(STALE_OBSERVATIONS_WARNING) || markup.includes("notice-close")) {
    throw new Error("The persistent stale warning was hidden or made dismissible");
  }
});

Deno.test("the floating notification stack is outside the wallet workspace", () => {
  const { snapshot } = noticeProps();
  snapshot.warnings = ["Backend unavailable"];
  const markup = renderToStaticMarkup(<Dashboard snapshot={snapshot} setSnapshot={() => {}} />);
  const mainEnd = markup.indexOf("</main>");
  const stack = markup.indexOf('<aside class="dashboard-notices"');
  if (mainEnd < 0 || stack < mainEnd) {
    throw new Error("Notification stack must be outside the scrollable wallet workspace");
  }
});
