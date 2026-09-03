import { formatAmount } from "./shared.tsx";

Deno.test("amounts can be displayed in sats or BTC", () => {
  const cases = [
    { value: 3_370, unit: "sat" as const, expected: "3,370 sats" },
    { value: 3_370, unit: "btc" as const, expected: "0.00003370 BTC" },
    { value: 100_000_000, unit: "btc" as const, expected: "1.00000000 BTC" },
  ];

  for (const { value, unit, expected } of cases) {
    const actual = formatAmount(value, unit);
    if (actual !== expected) {
      throw new Error(`Expected ${expected}, got ${actual}`);
    }
  }
  if (formatAmount(3_370, "btc") !== "0.00003370 BTC") {
    throw new Error("BTC amount formatting is incorrect");
  }
});
