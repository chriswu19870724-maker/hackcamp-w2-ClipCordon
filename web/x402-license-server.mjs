import { readFileSync } from "node:fs";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";

loadEnvFile(new URL("../agent/.env", import.meta.url));

const PORT = Number(process.env.X402_LICENSE_PORT || 3000);
const NETWORK = process.env.X402_NETWORK || "eip155:84532";
const PRICE = process.env.X402_LICENSE_PRICE || "$0.001";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

const payTo = resolvePayTo();
if (!payTo) {
  throw new Error("X402_PAY_TO, PAYMENT_RECEIPT_PAYEE, or WALLET_PRIVATE_KEY/EVM_PRIVATE_KEY is required.");
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /api/x402/license": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          payTo,
          price: PRICE,
        },
        description: "ClipCordon replacement BGM/SFX/caption template commercial-use license",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/api/x402/license", (_req, res) => {
  res.json({
    ok: true,
    licenseReceiptHash: `license-${Date.now()}`,
    assetFileHash: "asset-bgm-cross-platform-demo",
    licenseScope: ["TikTok", "Reels", "Shorts", "commercial-use"],
    supplierAgentId: "agent-bgm-cross-platform-01",
    issuedAt: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "clipcordon-x402-license", payTo, network: NETWORK, price: PRICE });
});

app.listen(PORT, () => {
  console.log(`[x402-license] listening on http://localhost:${PORT}/api/x402/license`);
  console.log("[x402-license] config:", { payTo, network: NETWORK, price: PRICE, facilitator: FACILITATOR_URL });
});

function resolvePayTo() {
  for (const value of [process.env.X402_PAY_TO, process.env.PAYMENT_RECEIPT_PAYEE, process.env.DECISION_RECEIPT_PAYEE]) {
    const address = normalizeAddress(value);
    if (address) return address;
  }

  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY) ?? normalizePrivateKey(process.env.EVM_PRIVATE_KEY);
  if (!privateKey) return null;
  return privateKeyToAccount(privateKey).address;
}

function loadEnvFile(url) {
  try {
    const contents = readFileSync(url, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn("[x402-license] failed to load ../agent/.env; relying on process env.", { error });
  }
}

function normalizeAddress(value) {
  const address = value?.trim().replace(/^['"]|['"]$/g, "");
  if (!address) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return null;
}

function normalizePrivateKey(value) {
  const key = value?.trim().replace(/^['"]|['"]$/g, "");
  if (!key) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(key)) return key;
  if (/^[0-9a-fA-F]{64}$/.test(key)) return `0x${key}`;
  return null;
}
