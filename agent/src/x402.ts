import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment as wrapFetchWithPaymentSdk, x402Client } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/core/types";
import { baseSepolia } from "viem/chains";
import { createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentDecision } from "./llm.js";
import { httpStatusError, withExternalCall } from "./external.js";

export type X402PaymentResult = {
  status: "mocked";
  paymentId: string;
  decision: PaymentDecision;
};

const BASE_SEPOLIA_NETWORK = "eip155:84532";
const MAX_TOTAL_BUDGET = parseUnits("1.0", 6);
const MAX_PER_CALL = parseUnits("0.05", 6);
const DAILY_BUDGET = parseUnits("0.2", 6);
const BUDGET_FILE_URL = new URL("../.x402-budget.json", import.meta.url);

type PaymentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedFetchWithPayment: PaymentFetch | null = null;
let pendingPaymentAmount: bigint | null = null;

export async function x402Fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = input instanceof Request ? input.url : input.toString();

  return withExternalCall({
    label: "x402 paid fetch",
    context: { url, network: BASE_SEPOLIA_NETWORK, maxPaymentAtomicUnits: MAX_PER_CALL.toString() },
    rateLimitKey: `x402:${url}`,
    fn: async () => {
      pendingPaymentAmount = null;
      const response = await getFetchWithPayment()(input, init);
      if (response.status === 429) {
        throw httpStatusError("x402 endpoint returned HTTP 429", response.status);
      }
      recordPaymentIfSettled(response);
      return response;
    },
  });
}

export async function payWithX402(decision: PaymentDecision): Promise<X402PaymentResult | null> {
  return withExternalCall({
    label: "x402 payment",
    context: { action: decision.action, amountUsd: decision.amountUsd },
    fn: async () => {
      // TODO(D2-D3): replace this placeholder with a real x402 payment flow.
      const result: X402PaymentResult = {
        status: "mocked",
        paymentId: `mock-x402-${Date.now()}`,
        decision,
      };

      console.log("[x402] placeholder payment result:", result);
      return result;
    },
  });
}

function getFetchWithPayment(): PaymentFetch {
  if (cachedFetchWithPayment) return cachedFetchWithPayment;

  const privateKey = resolvePrivateKey();
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY or WALLET_PRIVATE_KEY is required for x402 paid fetch.");
  }

  const account = privateKeyToAccount(privateKey);
  const rpcUrl = process.env.EVM_RPC_URL || "https://sepolia.base.org";
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const client = new x402Client();
  client.registerPolicy((_version, requirements) => filterByBudget(requirements));

  registerExactEvmScheme(client, {
    signer: {
      address: account.address,
      signTypedData: (message) => walletClient.signTypedData(message),
    },
    networks: [BASE_SEPOLIA_NETWORK],
    schemeOptions: {
      [baseSepolia.id]: { rpcUrl },
    },
  });

  cachedFetchWithPayment = wrapFetchWithPayment(fetch, client, MAX_PER_CALL);
  return cachedFetchWithPayment;
}

function filterByBudget(requirements: PaymentRequirements[]): PaymentRequirements[] {
  const allowed = requirements.filter((requirement) => {
    const amount = BigInt(requirement.amount);
    const budget = readBudget();
    const day = currentBudgetDay();
    const dailySpent = BigInt(budget.daily[day] ?? "0");
    const totalSpent = BigInt(budget.totalSpent ?? "0");

    if (amount > MAX_PER_CALL) {
      console.warn("[warn] x402 payment blocked: per-call budget exceeded; ask user before paying.", {
        amount: amount.toString(),
        maxPerCall: MAX_PER_CALL.toString(),
        network: requirement.network,
      });
      return false;
    }

    if (dailySpent + amount > DAILY_BUDGET) {
      console.warn("[warn] x402 payment blocked: daily budget exceeded; ask user before paying.", {
        amount: amount.toString(),
        dailySpent: dailySpent.toString(),
        dailyBudget: DAILY_BUDGET.toString(),
        day,
        network: requirement.network,
      });
      return false;
    }

    if (totalSpent + amount > MAX_TOTAL_BUDGET) {
      console.warn("[warn] x402 payment blocked: Week 2 total budget exceeded; ask user before paying.", {
        amount: amount.toString(),
        totalSpent: totalSpent.toString(),
        maxTotalBudget: MAX_TOTAL_BUDGET.toString(),
        network: requirement.network,
      });
      return false;
    }

    pendingPaymentAmount = amount;
    return true;
  });

  if (requirements.length > 0 && allowed.length === 0) {
    throw new Error("x402 payment would exceed budget; explicit user confirmation is required before paying.");
  }

  return allowed;
}

function recordPaymentIfSettled(response: Response): void {
  const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  if (!response.ok || !paymentResponseHeader || !pendingPaymentAmount) return;

  const budget = readBudget();
  const day = currentBudgetDay();
  const dailySpent = BigInt(budget.daily[day] ?? "0") + pendingPaymentAmount;
  const totalSpent = BigInt(budget.totalSpent ?? "0") + pendingPaymentAmount;

  budget.totalSpent = totalSpent.toString();
  budget.daily[day] = dailySpent.toString();
  budget.payments.push({
    at: new Date().toISOString(),
    amount: pendingPaymentAmount.toString(),
    network: BASE_SEPOLIA_NETWORK,
  });

  writeBudget(budget);
  pendingPaymentAmount = null;
}

type BudgetState = {
  totalSpent: string;
  daily: Record<string, string>;
  payments: Array<{
    at: string;
    amount: string;
    network: string;
  }>;
};

function readBudget(): BudgetState {
  if (!existsSync(BUDGET_FILE_URL)) {
    return { totalSpent: "0", daily: {}, payments: [] };
  }

  try {
    return JSON.parse(readFileSync(BUDGET_FILE_URL, "utf8")) as BudgetState;
  } catch (error) {
    console.warn("[warn] Failed to read x402 budget file; refusing payment until fixed.", { error });
    throw new Error("Cannot verify x402 budget before payment.");
  }
}

function writeBudget(budget: BudgetState): void {
  writeFileSync(BUDGET_FILE_URL, `${JSON.stringify(budget, null, 2)}\n`);
}

function currentBudgetDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolvePrivateKey(): Hex | null {
  const candidates = [
    ["EVM_PRIVATE_KEY", process.env.EVM_PRIVATE_KEY],
    ["WALLET_PRIVATE_KEY", process.env.WALLET_PRIVATE_KEY],
  ] as const;

  for (const [name, value] of candidates) {
    const key = normalizePrivateKey(value);
    if (key) return key;
    if (value?.trim()) {
      console.warn(`[warn] ${name} is set but is not a 32-byte hex private key; trying next key source.`);
    }
  }

  return null;
}

function normalizePrivateKey(value: string | undefined): Hex | null {
  const key = value?.trim().replace(/^['"]|['"]$/g, "");
  if (!key) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(key)) return key as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(key)) return `0x${key}` as Hex;
  return null;
}

function wrapFetchWithPayment(fetchFn: typeof fetch, client: x402Client, maxValue: bigint): PaymentFetch {
  client.registerPolicy((_version, requirements) => requirements.filter((requirement) => BigInt(requirement.amount) <= maxValue));
  return wrapFetchWithPaymentSdk(fetchFn, client);
}

async function main(): Promise<void> {
  const endpoint = process.argv[2] || process.env.X402_TEST_ENDPOINT_URL || process.env.X402_ENDPOINT;
  if (!endpoint) {
    console.warn("[warn] Missing test endpoint URL. Pass it as argv[2] or set X402_TEST_ENDPOINT_URL.");
    return;
  }

  const response = await x402Fetch(endpoint);
  if (!response) return;

  const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE") ?? response.headers.get("X-PAYMENT-RESPONSE");
  const body = await response.text();

  console.log("[x402] response status:", response.status);
  console.log("[x402] response body:", body);

  if (paymentResponseHeader) {
    const settlement = decodePaymentResponseHeader(paymentResponseHeader);
    console.log("[x402] settlement:", settlement);
    if (settlement.transaction) {
      console.log(`[x402] tx: https://sepolia.basescan.org/tx/${settlement.transaction}`);
    }
  } else {
    console.warn("[warn] No PAYMENT-RESPONSE header found on response.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.warn("[warn] x402 main failed; process will exit cleanly.", { error });
  });
}
