import { fromHex, toHex } from "./bytes.ts";
import {
  decodeUnifiedTransaction,
  type UnifiedScriptType,
  unifiedSignatureHash,
} from "./unified_sighash.ts";

type VectorRow = [
  scriptCode: string,
  rawTx: string,
  inputIndex: number,
  hashType: number,
  scriptType: UnifiedScriptType,
  spentOutputs: Array<[number, string]>,
  expected: string,
];

Deno.test("SIGHASH_UNIFIED matches every pinned upstream vector", async () => {
  const fixtureUrl = new URL("../../testdata/unified_sighash.json", import.meta.url);
  const rows = JSON.parse(await Deno.readTextFile(fixtureUrl)) as [string[], ...VectorRow[]];
  if (rows.length < 140) throw new Error("The consensus vector fixture is unexpectedly incomplete");

  for (let index = 1; index < rows.length; index++) {
    const [scriptCode, rawTx, inputIndex, hashType, scriptType, spentRows, expected] =
      rows[index] as VectorRow;
    const digest = unifiedSignatureHash(
      decodeUnifiedTransaction(rawTx),
      inputIndex,
      hashType,
      spentRows.map(([amount, script]) => ({ amount: BigInt(amount), script: fromHex(script) })),
      {
        scriptCode: fromHex(scriptCode),
        scriptType,
        leafScript: scriptType === 3 ? fromHex(scriptCode) : undefined,
      },
    );
    if (!digest) throw new Error(`Vector ${index} was rejected`);
    const actual = toHex(digest);
    if (actual !== expected) {
      throw new Error(`Vector ${index}: got ${actual}, expected ${expected}`);
    }
  }
});
