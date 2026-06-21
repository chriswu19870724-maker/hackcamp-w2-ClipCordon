import { withExternalCall } from "../../agent/src/external.js";

export type SupplierReputation = {
  supplierAgentId: string;
  score: number;
  validationHistory: string[];
  licenseTypes: string[];
};

export async function getSupplierReputation(supplierAgentId: string): Promise<SupplierReputation> {
  const reputation = await withExternalCall({
    label: "ERC-8004 reputation query",
    context: { supplierAgentId, endpoint: reputationEndpointPreview() },
    rateLimitKey: `erc8004:${supplierAgentId}`,
    fn: async () => {
      const endpoint = buildReputationUrl(supplierAgentId);
      if (!endpoint) {
        throw new Error("ERC8004_REPUTATION_URL is required for real ERC-8004 reputation queries.");
      }

      const response = await fetch(endpoint, {
        headers: buildHeaders(),
      });

      if (!response.ok) {
        throw new Error(`ERC-8004 reputation endpoint returned HTTP ${response.status}`);
      }

      return parseReputation(await response.json(), supplierAgentId);
    },
  });

  if (reputation) {
    console.log("[worker:erc8004] reputation external:", reputation);
    return reputation;
  }

  const conservative = {
    supplierAgentId,
    score: 0,
    validationHistory: ["erc8004-query-unavailable"],
    licenseTypes: [],
  };
  console.warn("[warn] ERC-8004 reputation unavailable; using conservative fallback.", conservative);
  return conservative;
}

function buildReputationUrl(supplierAgentId: string): string | null {
  const configured = process.env.ERC8004_REPUTATION_URL?.trim();
  if (!configured) return null;

  if (configured.includes("{supplierAgentId}")) {
    return configured.replaceAll("{supplierAgentId}", encodeURIComponent(supplierAgentId));
  }

  const url = new URL(configured);
  url.searchParams.set("supplierAgentId", supplierAgentId);
  return url.toString();
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  const apiKey = process.env.ERC8004_API_KEY?.trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return headers;
}

function parseReputation(value: unknown, fallbackSupplierAgentId: string): SupplierReputation {
  if (!value || typeof value !== "object") {
    throw new Error("ERC-8004 reputation response must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  const supplierAgentId = stringField(record, ["supplierAgentId", "agentId", "id"]) ?? fallbackSupplierAgentId;
  const score = numberField(record, ["score", "reputationScore", "erc8004Score"]);

  if (score === null) {
    throw new Error("ERC-8004 reputation response is missing score.");
  }

  return {
    supplierAgentId,
    score,
    validationHistory: stringArrayField(record, ["validationHistory", "validations", "history"]),
    licenseTypes: stringArrayField(record, ["licenseTypes", "licenses", "supportedLicenseTypes"]),
  };
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }

  return null;
}

function stringArrayField(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }

  return [];
}

function reputationEndpointPreview(): string {
  const configured = process.env.ERC8004_REPUTATION_URL?.trim();
  if (!configured) return "missing";
  return configured.replace(/\?.*$/, "?...");
}
