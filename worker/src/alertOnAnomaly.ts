import { decide, type DecideResult } from "../../agent/src/llm.js";
import { payForService } from "../../agent/src/x402.js";
import { purchaseReplacementLicense } from "./agentkit.js";
import { sendTGAlert } from "./notify.js";
import { anchor } from "./registry.js";
import { getSupplierReputation } from "./reputation.js";

const SYSTEM_PROMPT = `You are an AI agent managing cross-platform copyright licenses for a UGC agency.
Your goal: secure valid commercial rights for video clips, and dynamically negotiate or purchase missing licenses via x402.
Guidelines:
If a clip's material is restricted to a single platform and the supplier refuses cross-platform licensing, decline it.
If the creator's ERC-8004 reputation score is > 90, negotiate a free license or a rebate (negative fee) instead of paying.
If the required x402 license fee exceeds the current wallet balance, decline the purchase.
Otherwise, approve the clip, execute the payment, and generate the on-chain manifest.
Be strict with copyright compliance. Declining is fine, the user can manually replace the restricted materials later.`;

export type AlertOnAnomalyInput = {
  clipId: string;
  tokenId: string;
  currentPrice: number;
  pricesLastHour: number[];
  lastAlertedAt: string | null;
  supplierAgentId: string;
  assetType: "bgm" | "sfx" | "caption_template";
  requiredLicenseScope: string[];
  materialLicense: {
    sourcePlatform: string;
    currentScope: string[];
    supplierRefusesCrossPlatform: boolean;
  };
  walletBalanceUsd: number;
  x402LicenseFeeUsd: number;
  x402ServiceEndpoint?: string;
};

export async function alertOnAnomaly(input: AlertOnAnomalyInput): Promise<DecideResult> {
  return decide({
    scenario: "alertOnAnomaly",
    currentData: {
      clipId: input.clipId,
      tokenId: input.tokenId,
      currentPrice: input.currentPrice,
      lastPrice: input.pricesLastHour.at(-2) ?? input.currentPrice,
      supplierAgentId: input.supplierAgentId,
      assetType: input.assetType,
      requiredLicenseScope: input.requiredLicenseScope,
      materialLicense: input.materialLicense,
      complianceSignals: buildComplianceSignals(input),
      anomalySignals: buildAnomalySignals(input.pricesLastHour, input.currentPrice, input.lastAlertedAt),
    },
    recentHistory: input.pricesLastHour,
    budgetOrStatus: {
      lastAlertedAt: input.lastAlertedAt,
      walletBalanceUsd: input.walletBalanceUsd,
      x402LicenseFeeUsd: input.x402LicenseFeeUsd,
      x402ServiceEndpoint: input.x402ServiceEndpoint ?? process.env.X402_ENDPOINT ?? "missing",
      duplicateAlertPolicy: "Prefer record_only if a similar alert fired recently.",
    },
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      {
        type: "function",
        function: {
          name: "pay_for_service",
          description:
            "Execute a real x402 paid service call to buy or negotiate the missing cross-platform license. MUST use this when complianceSignals.recommendedTool is pay_for_service; this handler is the only tool that actually pays the service.",
          parameters: {
            type: "object",
            properties: {
              endpoint: { type: "string" },
              reason: { type: "string" },
              amountUsd: { type: "number" },
              supplierAgentId: { type: "string" },
              licenseScope: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["reason", "amountUsd", "supplierAgentId", "licenseScope"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "decline",
          description:
            "Decline the license purchase when the material is restricted, the supplier refuses cross-platform licensing, or x402 fee exceeds wallet balance. Use this when complianceSignals.recommendedTool is decline.",
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
      {
        type: "function",
        function: {
          name: "trigger_alert",
          description:
            "Trigger only for a sharp price anomaly or clear high-risk state. Avoid duplicate alerts when lastAlertedAt is recent.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" },
              urgency: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["reason", "urgency"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "record_only",
          description:
            "Record normal price movement or duplicate/non-urgent anomaly without notifying the user. Do not use this when complianceSignals.recommendedTool is pay_for_service or decline.",
          parameters: {
            type: "object",
            properties: {
              note: { type: "string" },
            },
            required: ["note"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "check_erc8004_reputation",
          description:
            "Query ERC-8004 supplier agent reputation, validation history, and supported license types for standalone reputation audits. Do not use this instead of pay_for_service when complianceSignals.recommendedTool is pay_for_service.",
          parameters: {
            type: "object",
            properties: {
              supplierAgentId: { type: "string" },
            },
            required: ["supplierAgentId"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "purchase_replacement_license",
          description:
            "Use AgentKit/x402 to purchase or negotiate replacement BGM, SFX, or caption template commercial-use rights for the required cross-platform scope.",
          parameters: {
            type: "object",
            properties: {
              clipId: { type: "string" },
              tokenId: { type: "string" },
              supplierAgentId: { type: "string" },
              assetType: { type: "string", enum: ["bgm", "sfx", "caption_template"] },
              sourcePlatform: { type: "string" },
              currentLicenseScope: {
                type: "array",
                items: { type: "string" },
              },
              licenseScope: {
                type: "array",
                items: { type: "string" },
              },
              feeUsd: { type: "number" },
              reason: { type: "string" },
            },
            required: [
              "clipId",
              "tokenId",
              "supplierAgentId",
              "assetType",
              "sourcePlatform",
              "currentLicenseScope",
              "licenseScope",
              "feeUsd",
              "reason",
            ],
            additionalProperties: false,
          },
        },
      },
    ],
    handlers: {
      pay_for_service: async (args) => {
        const endpoint = stringArg(args.endpoint, input.x402ServiceEndpoint ?? process.env.X402_ENDPOINT ?? "");
        const reason = stringArg(args.reason, "Buy missing cross-platform license via x402.");
        const amountUsd = numberArg(args.amountUsd, input.x402LicenseFeeUsd);

        if (amountUsd > input.walletBalanceUsd) {
          console.log("[worker:pay_for_service] declined before x402: insufficient wallet balance", {
            amountUsd,
            walletBalanceUsd: input.walletBalanceUsd,
          });
          return { paid: false, reason: "x402 license fee exceeds wallet balance.", transactionHash: null };
        }

        const payment = await payForService(endpoint, reason);
        return {
          paid: Boolean(payment),
          payment,
          transactionHash: payment?.transactionHash ?? null,
          supplierAgentId: stringArg(args.supplierAgentId, input.supplierAgentId),
          licenseScope: stringArrayArg(args.licenseScope, input.requiredLicenseScope),
        };
      },
      decline: async (args) => {
        const reason = stringArg(args.reason, "Declined for copyright compliance.");
        console.log("[worker:decline]", {
          tokenId: input.tokenId,
          clipId: input.clipId,
          reason,
        });
        return { declined: true, reason };
      },
      check_erc8004_reputation: async (args) => {
        const supplierAgentId = stringArg(args.supplierAgentId, input.supplierAgentId);
        return getSupplierReputation(supplierAgentId);
      },
      purchase_replacement_license: async (args) => {
        return purchaseReplacementLicense({
          clipId: stringArg(args.clipId, input.clipId),
          tokenId: stringArg(args.tokenId, input.tokenId),
          supplierAgentId: stringArg(args.supplierAgentId, input.supplierAgentId),
          assetType: assetTypeArg(args.assetType, input.assetType),
          sourcePlatform: stringArg(args.sourcePlatform, input.materialLicense.sourcePlatform),
          currentLicenseScope: stringArrayArg(args.currentLicenseScope, input.materialLicense.currentScope),
          licenseScope: stringArrayArg(args.licenseScope, input.requiredLicenseScope),
          feeUsd: numberArg(args.feeUsd, input.x402LicenseFeeUsd),
          walletBalanceUsd: input.walletBalanceUsd,
          reason: stringArg(args.reason, "Purchase replacement commercial-use license."),
        });
      },
      trigger_alert: async (args) => {
        const reason = stringArg(args.reason, "Price anomaly detected.");
        const urgency = urgencyArg(args.urgency);
        const message = `[${urgency}] ${input.tokenId}: ${reason} currentPrice=${input.currentPrice}`;

        await sendTGAlert(message);

        try {
          const anchored = await anchor(message);
          return { alerted: true, urgency, reason, anchorHash: anchored.hash };
        } catch (error) {
          console.warn("[warn] alert anchor failed; polling will continue.", { tokenId: input.tokenId, error });
          return { alerted: true, urgency, reason, anchorHash: null };
        }
      },
      record_only: async (args) => {
        const note = stringArg(args.note, "No alert-worthy anomaly.");
        console.log("[worker:record_only]", {
          tokenId: input.tokenId,
          currentPrice: input.currentPrice,
          note,
        });
        return { recorded: true, note };
      },
    },
  });
}

function buildAnomalySignals(pricesLastHour: number[], currentPrice: number, lastAlertedAt: string | null) {
  const previousPrice = pricesLastHour.at(-2) ?? currentPrice;
  const oneStepChangePct = previousPrice === 0 ? 0 : ((currentPrice - previousPrice) / previousPrice) * 100;
  const mean = pricesLastHour.reduce((sum, price) => sum + price, 0) / Math.max(pricesLastHour.length, 1);
  const deviationFromMeanPct = mean === 0 ? 0 : ((currentPrice - mean) / mean) * 100;

  return {
    previousPrice,
    oneStepChangePct: Number(oneStepChangePct.toFixed(2)),
    meanPriceLastHour: Number(mean.toFixed(4)),
    deviationFromMeanPct: Number(deviationFromMeanPct.toFixed(2)),
    suggestedPolicy:
      Math.abs(oneStepChangePct) >= 20 || Math.abs(deviationFromMeanPct) >= 25 ? "trigger_alert" : "record_only",
    lastAlertedAt,
  };
}

function buildComplianceSignals(input: AlertOnAnomalyInput) {
  const missingScope = input.requiredLicenseScope.filter((scope) => !input.materialLicense.currentScope.includes(scope));
  const licenseMissing = missingScope.length > 0;
  const feeExceedsWallet = input.x402LicenseFeeUsd > input.walletBalanceUsd;
  let recommendedTool: "pay_for_service" | "decline" | "record_only" = "record_only";
  let reason = "Current license scope satisfies the required publishing scope.";

  if (licenseMissing && input.materialLicense.supplierRefusesCrossPlatform) {
    recommendedTool = "decline";
    reason = "Cross-platform license is missing and supplier refuses cross-platform licensing.";
  } else if (licenseMissing && feeExceedsWallet) {
    recommendedTool = "decline";
    reason = "Cross-platform license is missing, but required x402 fee exceeds wallet balance.";
  } else if (licenseMissing) {
    recommendedTool = "pay_for_service";
    reason = "Cross-platform license is missing, supplier can license it, and wallet balance covers the x402 fee.";
  }

  return {
    licenseMissing,
    missingScope,
    feeExceedsWallet,
    recommendedTool,
    reason,
  };
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function urgencyArg(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function assetTypeArg(value: unknown, fallback: AlertOnAnomalyInput["assetType"]): AlertOnAnomalyInput["assetType"] {
  return value === "bgm" || value === "sfx" || value === "caption_template" ? value : fallback;
}

function stringArrayArg(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : fallback;
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
