import type { PaymentDecision } from "./llm.js";

export type X402PaymentResult = {
  status: "mocked";
  paymentId: string;
  decision: PaymentDecision;
};

export async function payWithX402(decision: PaymentDecision): Promise<X402PaymentResult> {
  // TODO(D2-D3): replace this placeholder with a real x402 payment flow.
  const result: X402PaymentResult = {
    status: "mocked",
    paymentId: `mock-x402-${Date.now()}`,
    decision,
  };

  console.log("[x402] placeholder payment result:", result);
  return result;
}
