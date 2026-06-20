import "dotenv/config";
import OpenAI from "openai";
import { withExternalCall } from "./external.js";

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

const baseURL = process.env.LLM_BASE_URL || "https://api.deepseek.com";
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const model = process.env.LLM_MODEL || "deepseek-chat";

const client = new OpenAI({ apiKey: apiKey || "missing-key", baseURL });

export async function decidePayment(signal: PaymentSignal): Promise<PaymentDecision | null> {
  if (!apiKey) {
    console.warn("[warn] LLM_API_KEY is not set; using a local placeholder decision.");
    return {
      action: "pay",
      reason: `Placeholder LLM decision for ${signal.summary}`,
      amountUsd: signal.suggestedAmountUsd,
    };
  }

  return withExternalCall({
    label: "LLM decision",
    context: { signalId: signal.id, source: signal.source, model, baseURL },
    fn: async () => {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are ClipCordon, an AI payment guard.",
              "Decide whether a small payment should proceed.",
              'Reply ONLY with a JSON object (no markdown fences) matching this shape:',
              '{"action":"pay"|"skip","reason":"<one sentence>","amountUsd":<number>}',
            ].join(" "),
          },
          {
            role: "user",
            content: `Signal: ${JSON.stringify(signal)}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message.content?.trim() ?? "";

      // Strip optional markdown fences the model might still add.
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

      try {
        const parsed = JSON.parse(jsonText) as PaymentDecision;
        if (!parsed.action || !parsed.reason) throw new Error("missing fields");
        return parsed;
      } catch (error) {
        console.warn("[warn] LLM response parse failed; using skip decision.", {
          signalId: signal.id,
          raw,
          error,
        });
        return { action: "skip", reason: raw || "LLM returned unparseable response.", amountUsd: 0 };
      }
    },
  });
}
