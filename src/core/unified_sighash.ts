import { RawTx } from "@scure/btc-signer";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, fromHex, i64le, reverseBytes, u32le, utf8, varBytes } from "./bytes.ts";

export const SIGHASH_ALL = 0x01;
export const SIGHASH_NONE = 0x02;
export const SIGHASH_SINGLE = 0x03;
export const SIGHASH_UNIFIED = 0x20;
export const SIGHASH_ANYONECANPAY = 0x80;
export const SIGHASH_ALL_UNIFIED = SIGHASH_ALL | SIGHASH_UNIFIED;

export const UNIFIED_SCRIPT_TYPE_BASE = 0;
export const UNIFIED_SCRIPT_TYPE_WITNESS_V0 = 1;
export const UNIFIED_SCRIPT_TYPE_TAPROOT = 2;
export const UNIFIED_SCRIPT_TYPE_TAPSCRIPT = 3;

export type UnifiedScriptType = 0 | 1 | 2 | 3;

export interface UnifiedTxInput {
  /** Transaction id in conventional display byte order. */
  txid: Uint8Array;
  index: number;
  sequence: number;
}

export interface UnifiedTxOutput {
  amount: bigint;
  script: Uint8Array;
}

export interface UnifiedTransaction {
  version: number;
  lockTime: number;
  inputs: UnifiedTxInput[];
  outputs: UnifiedTxOutput[];
}

export interface UnifiedSighashOptions {
  scriptCode?: Uint8Array;
  scriptType: UnifiedScriptType;
  annex?: Uint8Array;
  leafScript?: Uint8Array;
  leafVersion?: number;
  codeSeparatorPosition?: number;
}

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8(tag));
  return sha256(concatBytes(tagHash, tagHash, message));
}

function serializeOutpoint(input: UnifiedTxInput): Uint8Array {
  if (input.txid.length !== 32) throw new Error("Transaction id must contain 32 bytes");
  return concatBytes(reverseBytes(input.txid), u32le(input.index));
}

function serializeOutput(output: UnifiedTxOutput): Uint8Array {
  return concatBytes(i64le(output.amount), varBytes(output.script));
}

/** Decode a Bitcoin wire transaction into the small structure used by the signer. */
export function decodeUnifiedTransaction(rawTx: string | Uint8Array): UnifiedTransaction {
  const decoded = RawTx.decode(typeof rawTx === "string" ? fromHex(rawTx) : rawTx) as {
    version: number;
    lockTime: number;
    inputs: Array<{ txid: Uint8Array; index: number; sequence: number }>;
    outputs: Array<{ amount: bigint; script: Uint8Array }>;
  };
  return {
    version: decoded.version,
    lockTime: decoded.lockTime,
    inputs: decoded.inputs.map((input) => ({
      txid: input.txid,
      index: input.index,
      sequence: input.sequence,
    })),
    outputs: decoded.outputs.map((output) => ({
      amount: output.amount,
      script: output.script,
    })),
  };
}

/**
 * Consensus implementation pinned to privkeyio/bitcoin commit
 * 54d757f269d21e784c771497e0a26b35ab7d0c5a.
 *
 * Returns null for combinations that the proposed consensus rules reject.
 */
export function unifiedSignatureHash(
  tx: UnifiedTransaction,
  inputIndex: number,
  hashType: number,
  spentOutputs: UnifiedTxOutput[],
  options: UnifiedSighashOptions,
): Uint8Array | null {
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex >= tx.inputs.length) {
    return null;
  }
  if (spentOutputs.length !== tx.inputs.length) return null;
  if (!Number.isInteger(hashType) || hashType < 0 || hashType > 0xff) return null;
  if ((hashType & SIGHASH_UNIFIED) === 0) return null;

  const outputType = hashType & 0x1f;
  const anyoneCanPay = (hashType & SIGHASH_ANYONECANPAY) !== 0;
  const taproot = options.scriptType === UNIFIED_SCRIPT_TYPE_TAPROOT ||
    options.scriptType === UNIFIED_SCRIPT_TYPE_TAPSCRIPT;

  if (taproot) {
    const allowedMask = 0x1f | SIGHASH_ANYONECANPAY | SIGHASH_UNIFIED;
    if ((hashType & ~allowedMask) !== 0) return null;
    if (![SIGHASH_ALL, SIGHASH_NONE, SIGHASH_SINGLE].includes(outputType)) return null;
  }

  const message: Uint8Array[] = [
    Uint8Array.of(0, hashType),
    u32le(tx.version >>> 0),
    u32le(tx.lockTime),
    Uint8Array.of(0), // Reserved high byte of the proposed five-byte locktime.
  ];

  if (!anyoneCanPay) {
    message.push(sha256(concatBytes(...tx.inputs.map(serializeOutpoint))));
    message.push(sha256(concatBytes(...spentOutputs.map((output) => i64le(output.amount)))));
    message.push(sha256(concatBytes(...spentOutputs.map((output) => varBytes(output.script)))));
    message.push(sha256(concatBytes(...tx.inputs.map((input) => u32le(input.sequence)))));
  }

  if (outputType !== SIGHASH_NONE && outputType !== SIGHASH_SINGLE) {
    message.push(sha256(concatBytes(...tx.outputs.map(serializeOutput))));
  }

  message.push(Uint8Array.of(options.scriptType));

  if (anyoneCanPay) {
    message.push(serializeOutpoint(tx.inputs[inputIndex]));
    message.push(serializeOutput(spentOutputs[inputIndex]));
    message.push(u32le(tx.inputs[inputIndex].sequence));
  } else {
    message.push(u32le(inputIndex));
  }

  if (!taproot) {
    message.push(varBytes(options.scriptCode ?? new Uint8Array()));
  } else {
    message.push(Uint8Array.of(options.annex ? 1 : 0));
    if (options.annex) message.push(sha256(varBytes(options.annex)));
  }

  if (outputType === SIGHASH_SINGLE) {
    if (inputIndex >= tx.outputs.length) return null;
    message.push(sha256(serializeOutput(tx.outputs[inputIndex])));
  }

  if (options.scriptType === UNIFIED_SCRIPT_TYPE_TAPSCRIPT) {
    const leafVersion = options.leafVersion ?? 0xc0;
    if (!Number.isInteger(leafVersion) || leafVersion < 0 || leafVersion > 0xff) return null;
    const leafScript = options.leafScript ?? options.scriptCode;
    if (!leafScript) return null;
    message.push(
      taggedHash("TapLeaf", concatBytes(Uint8Array.of(leafVersion), varBytes(leafScript))),
    );
    message.push(Uint8Array.of(0));
    message.push(u32le(options.codeSeparatorPosition ?? 0xffff_ffff));
  }

  return taggedHash("UnifiedSighash", concatBytes(...message));
}
