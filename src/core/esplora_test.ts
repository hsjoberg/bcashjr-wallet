import { EsploraClient, EsploraError, type FetchLike } from "./esplora.ts";

Deno.test("Esplora requires HTTPS except on explicit loopback hosts", () => {
  for (
    const url of [
      "http://localhost:3000/api",
      "http://127.0.0.1:3000/api",
      "http://[::1]:3000/api",
      "https://example.com/api",
    ]
  ) {
    new EsploraClient(url);
  }
  for (const url of ["http://example.com/api", "http://192.168.1.10/api"]) {
    let message = "";
    try {
      new EsploraClient(url);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("only on localhost")) {
      throw new Error(`Plaintext remote backend was accepted: ${url}`);
    }
  }
});

Deno.test("Esplora appends endpoints to base paths", async () => {
  let requested = "";
  const client = new EsploraClient("https://example.invalid/api/", (input) => {
    requested = String(input);
    return Promise.resolve(new Response("961650"));
  });
  await client.tipHeight();
  const url = new URL(requested);
  if (url.pathname !== "/api/blocks/tip/height" || url.search !== "") {
    throw new Error(`Custom backend path was not preserved correctly: ${requested}`);
  }
});

Deno.test("Esplora rejects credentials, query parameters, and fragments", () => {
  for (
    const url of [
      "https://user:password@example.invalid/api",
      "https://example.invalid/api?token=secret",
      "https://example.invalid/api#unexpected",
    ]
  ) {
    let rejected = false;
    try {
      new EsploraClient(url);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Public backend URL accepted private components: ${url}`);
  }
});

Deno.test("Esplora never retries a rate-limit response", async () => {
  let requests = 0;
  const fetcher: FetchLike = () => {
    requests++;
    return Promise.resolve(
      new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );
  };
  const client = new EsploraClient("https://example.invalid/api", fetcher);

  let error: unknown;
  try {
    await client.addressUtxos("bc1ptest");
  } catch (caught) {
    error = caught;
  }

  if (!(error instanceof EsploraError) || error.status !== 429) {
    throw new Error("Expected an Esplora 429 error");
  }
  if (!error.message.includes("retry after 60")) {
    throw new Error("Retry-After was not included in the error");
  }
  if (requests !== 1) throw new Error(`Expected one request after HTTP 429, got ${requests}`);
});

Deno.test("Esplora does not retry a server failure automatically", async () => {
  let requests = 0;
  const fetcher: FetchLike = () => {
    requests++;
    return Promise.resolve(new Response("temporary failure", { status: 500 }));
  };
  const client = new EsploraClient("https://example.invalid/api", fetcher);

  let error: unknown;
  try {
    await client.addressUtxos("bc1ptest");
  } catch (caught) {
    error = caught;
  }

  if (!(error instanceof EsploraError) || error.status !== 500) {
    throw new Error("Expected an Esplora 500 error");
  }
  if (requests !== 1) throw new Error(`Expected one request after HTTP 500, got ${requests}`);
});

Deno.test("Esplora validates a fee estimate with one backend request", async () => {
  let requests = 0;
  const client = new EsploraClient("https://example.invalid/api", () => {
    requests++;
    return Promise.resolve(Response.json({
      fastestFee: 8.1,
      halfHourFee: 6,
      hourFee: 4,
      economyFee: 2,
      minimumFee: 1,
    }));
  });
  const fees = await client.recommendedFees();
  if (fees.fastestFee !== 8.1 || requests !== 1) {
    throw new Error(`Unexpected fee estimate or request count: ${fees.fastestFee}, ${requests}`);
  }

  const malformed = new EsploraClient(
    "https://example.invalid/api",
    () => Promise.resolve(Response.json({ fastestFee: "8.1" })),
  );
  let message = "";
  try {
    await malformed.recommendedFees();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes("malformed fee estimate")) {
    throw new Error(`Malformed fee estimate was accepted: ${message}`);
  }
});

Deno.test("Esplora rejects malformed UTXO arrays and entries", async () => {
  for (const value of [{}, [null], [{ txid: "not-a-txid", vout: 0 }]]) {
    const client = new EsploraClient(
      "https://example.invalid/api",
      () => Promise.resolve(Response.json(value)),
    );
    let message = "";
    try {
      await client.addressUtxos("bc1ptest");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("malformed UTXO list")) {
      throw new Error(`Malformed UTXO response was accepted: ${JSON.stringify(value)}`);
    }
  }
});

Deno.test("Esplora ignores valid zero-valued UTXOs without hiding positive coins", async () => {
  const positiveTxid = "44".repeat(32);
  const client = new EsploraClient(
    "https://example.invalid/api",
    () =>
      Promise.resolve(Response.json([
        { txid: "33".repeat(32), vout: 0, value: 0, status: { confirmed: false } },
        { txid: positiveTxid, vout: 1, value: 2_500, status: { confirmed: false } },
      ])),
  );

  const utxos = await client.addressUtxos("bc1ptest");
  if (utxos.length !== 1 || utxos[0].txid !== positiveTxid || utxos[0].value !== 2_500) {
    throw new Error("Zero-valued output handling discarded or retained the wrong coin");
  }
});

Deno.test("Esplora transaction status treats one 404 as absence", async () => {
  let requests = 0;
  const fetcher: FetchLike = () => {
    requests++;
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const client = new EsploraClient("https://example.invalid/api", fetcher);
  const status = await client.transactionStatus("11".repeat(32));

  if (status !== null) throw new Error("A missing transaction should return null");
  if (requests !== 1) throw new Error(`Expected one status request, got ${requests}`);
});

Deno.test("Esplora validates every transaction-status field", async () => {
  for (
    const value of [
      { confirmed: true },
      { confirmed: false, block_height: -1 },
      { confirmed: false, block_hash: 123 },
      { confirmed: false, block_hash: "zz".repeat(32) },
      { confirmed: false, block_time: 1.5 },
    ]
  ) {
    const client = new EsploraClient(
      "https://example.invalid/api",
      () => Promise.resolve(Response.json(value)),
    );
    let message = "";
    try {
      await client.transactionStatus("12".repeat(32));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message.includes("malformed transaction status")) {
      throw new Error(`Malformed transaction status was accepted: ${JSON.stringify(value)}`);
    }
  }

  const valid = {
    confirmed: true,
    block_height: 961_649,
    block_hash: "13".repeat(32),
    block_time: 1_700_000_000,
  };
  const client = new EsploraClient(
    "https://example.invalid/api",
    () => Promise.resolve(Response.json(valid)),
  );
  if (JSON.stringify(await client.transactionStatus("14".repeat(32))) !== JSON.stringify(valid)) {
    throw new Error("A complete transaction status was rejected or altered");
  }
});

Deno.test("Esplora validates transaction hex without retrying", async () => {
  let requests = 0;
  const fetcher: FetchLike = () => {
    requests++;
    return Promise.resolve(new Response("not transaction hex"));
  };
  const client = new EsploraClient("https://example.invalid/api", fetcher);

  let error: unknown;
  try {
    await client.transactionHex("22".repeat(32));
  } catch (caught) {
    error = caught;
  }

  if (!(error instanceof EsploraError) || !error.message.includes("malformed")) {
    throw new Error("Malformed transaction hex should be rejected");
  }
  if (requests !== 1) throw new Error(`Expected one transaction request, got ${requests}`);
});

Deno.test("Esplora rejects malformed address statistics", async () => {
  const client = new EsploraClient(
    "https://example.invalid/api",
    () =>
      Promise.resolve(Response.json({
        address: "bc1ptest",
        chain_stats: {},
        mempool_stats: { tx_count: "0" },
      })),
  );
  let message = "";
  try {
    await client.address("bc1ptest");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes("malformed address statistics")) {
    throw new Error(`Malformed statistics were not rejected: ${message}`);
  }
});

Deno.test("Esplora rejects statistics for a different address", async () => {
  const stats = {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  };
  const client = new EsploraClient(
    "https://example.invalid/api",
    () =>
      Promise.resolve(Response.json({
        address: "bc1pwrong",
        chain_stats: stats,
        mempool_stats: stats,
      })),
  );
  let message = "";
  try {
    await client.address("bc1pexpected");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes("different address")) {
    throw new Error(`Mismatched address statistics were accepted: ${message}`);
  }
});

Deno.test("Esplora stops streaming when the response cap is exceeded", async () => {
  let chunks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new EsploraClient(
    "https://example.invalid/api",
    () => Promise.resolve(new Response(stream)),
  );
  let message = "";
  try {
    await client.tipHeight();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  await Promise.resolve();
  if (!message.includes("response is too large")) {
    throw new Error(`Oversized streamed response was accepted: ${message}`);
  }
  // Response streams may keep one pull queued ahead of the reader.
  if (!cancelled || chunks > 66) {
    throw new Error(`Stream was not cancelled at the response cap (${chunks} chunks)`);
  }
});

Deno.test("Esplora timeout includes a stalled successful response body", async () => {
  const fetcher: FetchLike = (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  const client = new EsploraClient("https://example.invalid/api", fetcher, 20);
  const started = Date.now();
  let message = "";
  try {
    await client.tipHeight();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes("timed out") && !message.includes("Abort")) {
    throw new Error(`Stalled response did not time out: ${message}`);
  }
  if (Date.now() - started > 1_000) throw new Error("Body timeout took too long");
});
