import {
  browserListenPort,
  capabilityMatches,
  createRpcCapability,
  resolveUiResource,
  shouldUseUiIndexFallback,
} from "./server_security.ts";

Deno.test("static UI paths reject Windows encoded-separator traversal", () => {
  const root = new URL("file:///C:/wallet/dist/ui/");
  const asset = resolveUiResource(root, "/assets/app.js");
  if (asset?.href !== "file:///C:/wallet/dist/ui/assets/app.js") {
    throw new Error(`Unexpected safe asset path ${asset?.href}`);
  }
  for (
    const attack of [
      "/..%5c..%5cwallet.json",
      "/..%2f..%2fwallet.json",
      "/../wallet.json",
      "/%2e%2e/wallet.json",
      "/assets\\..\\wallet.json",
    ]
  ) {
    if (resolveUiResource(root, attack)) throw new Error(`Traversal was accepted: ${attack}`);
  }
});

Deno.test("loopback RPC capabilities are random and compared exactly", () => {
  const first = createRpcCapability();
  const second = createRpcCapability();
  if (first === second || first.length < 40) throw new Error("RPC capability lacks entropy");
  if (!capabilityMatches(first, first)) throw new Error("Matching capability was rejected");
  if (capabilityMatches(second, first) || capabilityMatches(null, first)) {
    throw new Error("Wrong RPC capability was accepted");
  }
});

Deno.test("browser mode defaults to an ephemeral port and validates PORT overrides", () => {
  if (browserListenPort(undefined) !== 0) {
    throw new Error("Browser mode did not request an OS-assigned port");
  }
  if (browserListenPort("8787") !== 8787) throw new Error("Valid PORT was not preserved");
  for (const invalid of ["", "0", "1.5", "65536", "not-a-port"]) {
    try {
      browserListenPort(invalid);
      throw new Error(`Invalid PORT was accepted: ${invalid}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid PORT was accepted")) {
        throw error;
      }
    }
  }
});

Deno.test("only extensionless UI routes use the index fallback", () => {
  if (!shouldUseUiIndexFallback("/wallet") || !shouldUseUiIndexFallback("/settings/account")) {
    throw new Error("An application route would not use the UI index fallback");
  }
  for (const asset of ["/favicon.ico", "/assets/missing.js", "/missing.css"]) {
    if (shouldUseUiIndexFallback(asset)) {
      throw new Error(`Missing asset would incorrectly use index.html: ${asset}`);
    }
  }
});
