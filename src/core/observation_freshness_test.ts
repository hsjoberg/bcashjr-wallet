import { OBSERVATION_FRESHNESS_MS, observationsAreStale } from "./observation_freshness.ts";

Deno.test("observation freshness requires an unspent output and expires after five minutes", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const fresh = new Date(now - OBSERVATION_FRESHNESS_MS).toISOString();
  const stale = new Date(now - OBSERVATION_FRESHNESS_MS - 1).toISOString();

  if (observationsAreStale(undefined, false, now)) {
    throw new Error("An empty wallet was marked stale");
  }
  if (!observationsAreStale(undefined, true, now)) {
    throw new Error("An unspent wallet without a successful sync was treated as fresh");
  }
  if (observationsAreStale(fresh, true, now)) {
    throw new Error("The exact freshness boundary was treated as stale");
  }
  if (!observationsAreStale(stale, true, now)) {
    throw new Error("An expired observation was treated as fresh");
  }
});
