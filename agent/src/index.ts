import "dotenv/config";
import { createServer, type Server } from "node:http";
import { decidePayment, type PaymentSignal } from "./llm.js";
import { sendTGAlert } from "./notify.js";
import { issueReceipt } from "./receipt.js";
import { payWithX402 } from "./x402.js";
import { httpStatusError, sleep, withExternalCall } from "./external.js";

const MIN_POLL_INTERVAL_MS = 60_000;
const configuredPollIntervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS || MIN_POLL_INTERVAL_MS);
const pollIntervalMs = Math.max(MIN_POLL_INTERVAL_MS, configuredPollIntervalMs);

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

  return withExternalCall({
    label: "paid mock HTTP call",
    context: { url },
    fn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw httpStatusError(`paid mock returned ${response.status}`, response.status);
      }

      return response.json() as Promise<unknown>;
    },
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
  if (!payment) return;

  const receiptId = await issueReceipt({ decision, paymentId: payment.paymentId });
  if (!receiptId) return;

  await sendTGAlert(`Decision ${decision.action}: ${decision.reason}. Receipt: ${receiptId}`);
}

async function main(): Promise<void> {
  let server: Server | null = null;

  try {
    server = await startPaidMockServer();
    console.log(`[agent] poll interval: ${pollIntervalMs}ms`);

    while (true) {
      try {
        await runOnce();
      } catch (error) {
        console.warn("[warn] agent round failed unexpectedly; next round will continue.", { error });
      }

      await sleep(pollIntervalMs);
    }
  } catch (error) {
    console.warn("[warn] agent startup failed; process will exit cleanly.", { error });
  } finally {
    server?.close();
  }
}

void main();
