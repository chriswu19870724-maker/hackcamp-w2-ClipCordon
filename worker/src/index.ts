import { alertOnAnomaly } from "./alertOnAnomaly.js";

const TOKEN_ID = "clip-license-token-001";
const SIMULATED_PRICES = [100, 101, 100.5, 101.2, 100.9, 132, 131.5, 102, 101.8, 102.2];
const CLIP_CONTEXT = {
  clipId: "running-shoe-clip-002",
  supplierAgentId: "agent-bgm-cross-platform-01",
  assetType: "bgm" as const,
  requiredLicenseScope: ["TikTok", "Reels", "Shorts", "commercial-use"],
  materialLicense: {
    sourcePlatform: "licensed-bgm-library",
    currentScope: ["TikTok", "Reels", "Shorts", "commercial-use"],
    supplierRefusesCrossPlatform: false,
  },
  walletBalanceUsd: 0.2,
  x402LicenseFeeUsd: 0.03,
  x402ServiceEndpoint: process.env.X402_ENDPOINT,
};

function clipContextForRound(round: number): typeof CLIP_CONTEXT {
  if (round === 2) {
    return {
      ...CLIP_CONTEXT,
      materialLicense: {
        sourcePlatform: "TikTok",
        currentScope: ["TikTok"],
        supplierRefusesCrossPlatform: false,
      },
      walletBalanceUsd: 0.2,
      x402LicenseFeeUsd: 0.03,
    };
  }

  if (round === 3) {
    return {
      ...CLIP_CONTEXT,
      materialLicense: {
        sourcePlatform: "TikTok",
        currentScope: ["TikTok"],
        supplierRefusesCrossPlatform: true,
      },
      walletBalanceUsd: 0.2,
      x402LicenseFeeUsd: 0.03,
    };
  }

  return CLIP_CONTEXT;
}

async function fetchPrice(round: number): Promise<number> {
  const price = SIMULATED_PRICES[round];
  if (price === undefined) throw new Error(`missing simulated price for round ${round + 1}`);
  console.log("[worker:poll]", { round: round + 1, tokenId: TOKEN_ID, price });
  return price;
}

async function main(): Promise<void> {
  const pricesLastHour: number[] = [];
  let lastAlertedAt: string | null = null;

  for (let round = 0; round < SIMULATED_PRICES.length; round += 1) {
    try {
      const currentPrice = await fetchPrice(round);
      pricesLastHour.push(currentPrice);

      const decision = await alertOnAnomaly({
        ...clipContextForRound(round),
        tokenId: TOKEN_ID,
        currentPrice,
        pricesLastHour: [...pricesLastHour],
        lastAlertedAt,
      });

      if (decision.action === "trigger_alert") {
        lastAlertedAt = new Date().toISOString();
      }
    } catch (error) {
      console.warn("[warn] worker polling round failed; continuing.", { round: round + 1, error });
    }
  }
}

void main().catch((error) => {
  console.warn("[warn] worker startup failed; process will exit cleanly.", { error });
});
