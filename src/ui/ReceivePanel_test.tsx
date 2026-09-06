import { renderToStaticMarkup } from "react-dom/server";
import { emptyPublicState } from "../core/types.ts";
import { buildWalletSnapshot } from "../core/wallet_snapshot.ts";
import { ReceivePanel } from "./ReceivePanel.tsx";

const BIP86_ADDRESS = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

Deno.test("receive panel keeps the full address and labels its compact copy button", () => {
  const state = emptyPublicState();
  state.recoveryScanComplete = true;
  state.nextReceiveIndex = 1;
  state.addresses = [{
    address: BIP86_ADDRESS,
    scriptPubKey: "5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c",
    path: "m/86'/0'/0'/0/0",
    branch: 0,
    index: 0,
    used: false,
  }];
  const markup = renderToStaticMarkup(
    <ReceivePanel
      snapshot={buildWalletSnapshot(state, "unlocked")}
      busy=""
      onNewAddress={() => {}}
      onContinueScan={() => {}}
    />,
  );
  if (
    !markup.includes(`<code title="${BIP86_ADDRESS}">${BIP86_ADDRESS}</code>`)
  ) {
    throw new Error("Receive address must remain complete in its text and tooltip");
  }
  if (
    !markup.includes('aria-label="Copy receive address"') ||
    !markup.includes('title="Copy receive address"') ||
    !markup.includes('<svg viewBox="0 0 24 24" aria-hidden="true">')
  ) {
    throw new Error("The icon-only copy button needs an accessible name and tooltip");
  }
});
