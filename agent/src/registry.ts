import "dotenv/config";
import { pathToFileURL } from "node:url";
import { decodePaymentResponseHeader } from "@x402/fetch";
import type { Address, Hex } from "viem";
import { issueReceipt } from "./receipt.js";
import { x402Fetch } from "./x402.js";

export type AnchorResult = {
  x402PaymentTx: Hex;
  receiptTx: Hex;
};

export async function anchorPaymentReceipt(
  endpoint: string,
  payee: Address,
  amount: bigint,
  memo: string,
): Promise<AnchorResult | null> {
  const response = await x402Fetch(endpoint);
  if (!response) return null;

  const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  if (!paymentResponseHeader) {
    console.warn("[warn] x402 response did not include PAYMENT-RESPONSE; skipping receipt anchor.");
    return null;
  }

  const settlement = decodePaymentResponseHeader(paymentResponseHeader);
  if (!settlement.transaction) {
    console.warn("[warn] x402 settlement did not include a transaction hash; skipping receipt anchor.", settlement);
    return null;
  }

  const receiptMemo = `${memo} | x402Tx=${settlement.transaction}`;
  const receiptTx = await issueReceipt(payee, amount, receiptMemo);
  if (!receiptTx) return null;

  console.log(`[registry] x402 payment tx: https://sepolia.basescan.org/tx/${settlement.transaction}`);
  console.log(`[registry] receipt tx: https://sepolia.basescan.org/tx/${receiptTx}`);

  return {
    x402PaymentTx: settlement.transaction as Hex,
    receiptTx,
  };
}

async function main(): Promise<void> {
  const [endpoint, payee, amount, ...memoParts] = process.argv.slice(2);
  const memo = memoParts.join(" ") || "ClipCordon x402 anchor";

  if (!endpoint || !payee || !amount) {
    console.warn(
      'Usage: node node_modules/tsx/dist/cli.mjs src/registry.ts <endpoint> <payee> <amountAtomicUsdc> "<memo>"',
    );
    return;
  }

  await anchorPaymentReceipt(endpoint, payee as Address, BigInt(amount), memo);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.warn("[warn] registry main failed; process will exit cleanly.", { error });
  });
}
