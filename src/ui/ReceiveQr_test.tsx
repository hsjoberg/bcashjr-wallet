import { renderToStaticMarkup } from "react-dom/server";
import { ReceiveQr } from "./ReceiveQr.tsx";
import { createReceiveQr } from "./receive_qr.ts";

const BIP86_ADDRESS = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

Deno.test("rendered receive QR has a four-module quiet zone", () => {
  const encoded = createReceiveQr(BIP86_ADDRESS);
  const dimension = encoded.size + 8;
  const markup = renderToStaticMarkup(<ReceiveQr address={BIP86_ADDRESS} />);

  if (!markup.includes(`viewBox="0 0 ${dimension} ${dimension}"`)) {
    throw new Error("Receive QR does not reserve four modules on every side");
  }
  if (!markup.includes('d="M4 4h1v1h-1z')) {
    throw new Error("Receive QR modules do not begin after a four-module quiet zone");
  }
});
