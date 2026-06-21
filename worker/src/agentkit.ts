import { payWithX402 } from "../../agent/src/x402.js";
import { getSupplierReputation } from "./reputation.js";

export type ReplacementLicensePurchaseInput = {
  clipId: string;
  tokenId: string;
  supplierAgentId: string;
  assetType: "bgm" | "sfx" | "caption_template";
  sourcePlatform: string;
  currentLicenseScope: string[];
  licenseScope: string[];
  feeUsd: number;
  walletBalanceUsd: number;
  reason: string;
};

export async function purchaseReplacementLicense(input: ReplacementLicensePurchaseInput) {
  const reputation = await getSupplierReputation(input.supplierAgentId);
  const effectiveFeeUsd = reputation.score > 90 ? Math.min(input.feeUsd, 0) : input.feeUsd;

  if (effectiveFeeUsd > input.walletBalanceUsd) {
    console.log("[worker:agentkit] purchase declined: insufficient wallet balance", {
      clipId: input.clipId,
      supplierAgentId: input.supplierAgentId,
      effectiveFeeUsd,
      walletBalanceUsd: input.walletBalanceUsd,
    });
    return {
      purchased: false,
      reason: "x402 license fee exceeds wallet balance.",
      reputation,
      effectiveFeeUsd,
    };
  }

  // TODO(D4): replace placeholder with AgentKit onchain execution.
  console.log("[worker:agentkit] AgentKit x402 purchase placeholder:", {
    clipId: input.clipId,
    tokenId: input.tokenId,
    supplierAgentId: input.supplierAgentId,
    assetType: input.assetType,
    sourcePlatform: input.sourcePlatform,
    currentLicenseScope: input.currentLicenseScope,
    licenseScope: input.licenseScope,
    requestedFeeUsd: input.feeUsd,
    effectiveFeeUsd,
    reputationScore: reputation.score,
  });

  const payment = await payWithX402({
    action: "pay",
    reason: input.reason,
    amountUsd: effectiveFeeUsd,
  });

  return {
    purchased: Boolean(payment),
    payment,
    reputation,
    effectiveFeeUsd,
    licenseReceiptHash: `mock-license-${input.clipId}-${Date.now()}`,
    sourcePlatform: input.sourcePlatform,
    previousLicenseScope: input.currentLicenseScope,
    licenseScope: input.licenseScope,
  };
}
