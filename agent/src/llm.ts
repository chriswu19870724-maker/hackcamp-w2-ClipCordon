import "dotenv/config";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { withExternalCall } from "./external.js";
import { issueReceipt } from "./receipt.js";

export type PaymentSignal = {
  id: string;
  source: string;
  summary: string;
  suggestedAmountUsd: number;
};

export type PaymentDecision = {
  action: "pay" | "skip";
  reason: string;
  amountUsd: number;
};

export type DecisionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type DecisionHandler = (
  args: Record<string, unknown>,
  context: {
    scenario: string;
    currentData: Record<string, unknown>;
    recentHistory: unknown[];
    budgetOrStatus: Record<string, unknown>;
  },
) => Promise<unknown>;

export type DecideInput = {
  scenario: string;
  currentData: Record<string, unknown>;
  recentHistory: unknown[];
  budgetOrStatus: Record<string, unknown>;
  systemPrompt: string;
  tools: DecisionTool[];
  handlers: Record<string, DecisionHandler>;
};

export type DecideResult = {
  scenario: string;
  action: string;
  args: Record<string, unknown>;
  result: unknown | null;
  receiptId: string | null;
  txHash: string | null;
  elapsedMs: number;
  noop: boolean;
  reason: string;
};

const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com";
const apiKey = process.env.LLM_API_KEY || "";
const model = process.env.LLM_MODEL || "deepseek-chat";

const client = new OpenAI({ apiKey: apiKey || "missing-key", baseURL });

export async function decide(input: DecideInput): Promise<DecideResult> {
  const startedAt = Date.now();
  let action = "noop";
  let args: Record<string, unknown> = {};
  let result: unknown | null = null;
  let reason = "LLM returned no tool call.";

  try {
    if (!apiKey) {
      throw new Error("LLM_API_KEY is not set.");
    }

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: buildUserPrompt(input) },
      ],
      tools: input.tools,
      tool_choice: "auto",
    });

    const toolCall = completion.choices[0]?.message.tool_calls?.[0];
    if (toolCall?.type === "function") {
      action = toolCall.function.name;
      args = parseToolArguments(toolCall.function.arguments);
      reason = getReason(args) || `Selected tool ${action}.`;

      const handler = input.handlers[action];
      if (!handler) {
        reason = `No handler registered for tool ${action}.`;
      } else {
        result = await handler(args, {
          scenario: input.scenario,
          currentData: input.currentData,
          recentHistory: input.recentHistory,
          budgetOrStatus: input.budgetOrStatus,
        });
      }
    }
  } catch (error) {
    console.warn("[warn] LLM decision failed; using noop.", {
      scenario: input.scenario,
      model,
      baseURL,
      error,
    });
    action = "noop";
    args = {};
    result = null;
    reason = "LLM call failed.";
  }

  const receiptId = await issueDecisionReceipt(input.scenario, action, reason);
  const txHash = extractTxHash(result) ?? extractTxHash(receiptId);
  const elapsedMs = Date.now() - startedAt;

  console.log("[decision]", {
    scenario: input.scenario,
    action,
    elapsedMs,
    argsSummary: summarizeArgs(args),
    txHash,
  });

  return {
    scenario: input.scenario,
    action,
    args,
    result,
    receiptId,
    txHash,
    elapsedMs,
    noop: action === "noop",
    reason,
  };
}

export async function decidePayment(signal: PaymentSignal): Promise<PaymentDecision | null> {
  const decision = await withExternalCall({
    label: "LLM decision",
    context: { signalId: signal.id, source: signal.source, model, baseURL },
    fn: () =>
      decide({
        scenario: "payment_guard",
        currentData: { signal },
        recentHistory: [],
        budgetOrStatus: { suggestedAmountUsd: signal.suggestedAmountUsd },
        systemPrompt: [
          "You are ClipCordon, an AI payment guard.",
          "Decide whether a small payment should proceed.",
          "Use exactly one tool when action is needed.",
        ].join(" "),
        tools: [
          {
            type: "function",
            function: {
              name: "pay",
              description: "Approve the payment.",
              parameters: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                  amountUsd: { type: "number" },
                },
                required: ["reason", "amountUsd"],
                additionalProperties: false,
              },
            },
          },
          {
            type: "function",
            function: {
              name: "skip",
              description: "Decline the payment.",
              parameters: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                },
                required: ["reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        handlers: {
          pay: async (args) => ({
            action: "pay" as const,
            reason: stringArg(args.reason, "Payment approved."),
            amountUsd: numberArg(args.amountUsd, signal.suggestedAmountUsd),
          }),
          skip: async (args) => ({
            action: "skip" as const,
            reason: stringArg(args.reason, "Payment skipped."),
            amountUsd: 0,
          }),
        },
      }),
  });

  if (!decision) return null;
  if (isPaymentDecision(decision.result)) return decision.result;
  return { action: "skip", reason: decision.reason, amountUsd: 0 };
}

function buildUserPrompt(input: DecideInput): string {
  return [
    `Scenario:\n${input.scenario}`,
    `Current data:\n${JSON.stringify(input.currentData, null, 2)}`,
    `Recent history:\n${JSON.stringify(input.recentHistory, null, 2)}`,
    `Budget or status:\n${JSON.stringify(input.budgetOrStatus, null, 2)}`,
  ].join("\n\n");
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

async function issueDecisionReceipt(scenario: string, action: string, reason: string): Promise<string | null> {
  const memo = `${action}|${shortReason(reason)}`;

  try {
    return await issueReceipt({
      decision: { action, reason },
      paymentId: `${scenario}-${Date.now()}`,
      memo,
    });
  } catch (error) {
    console.warn("[warn] decision receipt failed; continuing.", { scenario, action, error });
    return null;
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  if (!text) return "{}";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function shortReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 80) || "no reason";
}

function getReason(args: Record<string, unknown>): string | null {
  return typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : null;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function extractTxHash(value: unknown): string | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of ["txHash", "transactionHash", "hash"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]{64}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isPaymentDecision(value: unknown): value is PaymentDecision {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.action === "pay" || record.action === "skip") &&
    typeof record.reason === "string" &&
    typeof record.amountUsd === "number"
  );
}

async function testDecide(): Promise<void> {
  const result = await decide({
    scenario: "hardcoded_clip_decision_test",
    currentData: {
      clipId: "clip-001",
      title: "Premium on-chain demo clip",
      priceUsd: 0.01,
      riskScore: 0.12,
    },
    recentHistory: [
      { action: "pay", amountUsd: 0.01, reason: "Trusted source." },
      { action: "decline", amountUsd: 0.05, reason: "Exceeded per-clip limit." },
    ],
    budgetOrStatus: {
      remainingBudgetUsd: 1.25,
      maxPerClipUsd: 0.02,
      walletStatus: "ready",
    },
    systemPrompt: [
      "You are ClipCordon deciding whether to buy protected content.",
      "Call approve_access for cheap, low-risk clips within budget.",
      "Call decline for suspicious or over-budget clips.",
    ].join(" "),
    tools: [
      {
        type: "function",
        function: {
          name: "approve_access",
          description: "Approve a content access payment.",
          parameters: {
            type: "object",
            properties: {
              amountUsd: { type: "number" },
              reason: { type: "string" },
            },
            required: ["amountUsd", "reason"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "decline",
          description: "Decline the content access payment.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" },
            },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    handlers: {
      approve_access: async (args) => ({
        ok: true,
        amountUsd: numberArg(args.amountUsd, 0),
        reason: stringArg(args.reason, "Approved."),
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
      decline: async (args) => ({
        ok: true,
        reason: stringArg(args.reason, "Declined."),
      }),
    },
  });

  console.log("[decision:test-result]", result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void testDecide().catch((error) => {
    console.warn("[warn] decide test failed; process will exit cleanly.", { error });
  });
}
