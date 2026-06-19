import "dotenv/config";
import { createServer, type Server } from "node:http";
import { decidePayment, type PaymentSignal } from "./llm.js";
import { sendTGAlert } from "./notify.js";
import { issueReceipt } from "./receipt.js";
import { payWithX402 } from "./x402.js";

async function withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      console.warn(`[warn] ${label} failed on attempt ${attempt}:`, error);
    }
  }

  console.warn(`[warn] ${label} failed after retry; skipping this round.`);
  return null;
}

function startPaidMockServer(): Promise<Server> {
  const port = Number(process.env.PAID_MOCK_PORT || 8787);

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/paid-mock") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          provider: "paid-mock",
          amountUsd: 0.01,
          receiptId: "mock-paid-receipt-001",
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`[paid-mock] listening on http://127.0.0.1:${port}/paid-mock`);
      resolve(server);
    });
  });
}

async function fetchPaidMock(): Promise<unknown | null> {
  const url = process.env.PAID_MOCK_URL || "http://127.0.0.1:8787/paid-mock";

  return withOneRetry("paid mock HTTP call", async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`paid mock returned ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  });
}

async function runOnce(): Promise<void> {
  const signal: PaymentSignal = {
    id: "signal-001",
    source: "local-demo",
    summary: "Pay once for protected premium content access.",
    suggestedAmountUsd: 0.01,
  };

  console.log("[agent] signal:", signal);

  const decision = await decidePayment(signal);
  if (!decision) return;
  console.log("[agent] LLM decision:", decision.reason);

  const paidMock = await fetchPaidMock();
  if (!paidMock) return;
  console.log("[agent] /paid-mock response:", paidMock);

  const payment = await payWithX402(decision);
  const receiptId = await issueReceipt({ decision, paymentId: payment.paymentId });
  await sendTGAlert(`Decision ${decision.action}: ${decision.reason}. Receipt: ${receiptId ?? "skipped"}`);
}

async function main(): Promise<void> {
  let server: Server | null = null;

  try {
    server = await startPaidMockServer();
    await runOnce();
  } catch (error) {
    console.warn("[warn] agent round failed; process will exit cleanly:", error);
  } finally {
    server?.close();
  }
}

void main();
