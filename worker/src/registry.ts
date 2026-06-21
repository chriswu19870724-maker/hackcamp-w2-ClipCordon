import { createHash } from "node:crypto";

export type AnchorRecord = {
  hash: string;
  content: string;
};

export async function anchor(content: string): Promise<AnchorRecord> {
  const hash = createHash("sha256").update(content).digest("hex");

  // TODO(D4): replace with a real on-chain registry write.
  console.log("[worker:registry] anchor placeholder:", { hash, content });

  return { hash, content };
}
