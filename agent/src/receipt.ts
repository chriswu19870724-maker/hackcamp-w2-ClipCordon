import type { PaymentDecision } from "./llm.js";

export type ReceiptInput = {
  decision: PaymentDecision;
  paymentId: string;
};

export async function issueReceipt(input: ReceiptInput): Promise<string | null> {
  // TODO(D2): use viem walletClient.writeContract against PaymentReceipt.issueReceipt.
  console.log("[receipt] placeholder on-chain receipt:", input);
  return `mock-receipt-${Date.now()}`;
}
