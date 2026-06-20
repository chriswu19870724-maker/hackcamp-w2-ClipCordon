import "dotenv/config";
import { pathToFileURL } from "node:url";
import { baseSepolia } from "viem/chains";
import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentDecision } from "./llm.js";
import { withExternalCall } from "./external.js";

export type ReceiptInput = {
  decision: PaymentDecision;
  paymentId: string;
};

const receiptAbi = parseAbi(["function issueReceipt(address payee, uint256 amount, string memo)"]);

export async function issueReceipt(payee: Address, amount: bigint, memo: string): Promise<Hex | null>;
export async function issueReceipt(input: ReceiptInput): Promise<string | null>;
export async function issueReceipt(
  payeeOrInput: Address | ReceiptInput,
  amount?: bigint,
  memo?: string,
): Promise<Hex | string | null> {
  if (typeof payeeOrInput !== "string") {
    return withExternalCall({
      label: "receipt RPC call",
      context: { paymentId: payeeOrInput.paymentId, action: payeeOrInput.decision.action },
      rateLimitKey: "public-rpc",
      fn: async () => {
        console.warn("[warn] receipt placeholder path used; call issueReceipt(payee, amount, memo) for on-chain receipt.");
        return `mock-receipt-${Date.now()}`;
      },
    });
  }

  if (amount === undefined || memo === undefined) {
    console.warn("[warn] issueReceipt requires payee, amount, and memo.");
    return null;
  }

  const payee = payeeOrInput;

  return withExternalCall({
    label: "receipt RPC call",
    context: { payee, amount: amount.toString(), contract: process.env.PAYMENT_RECEIPT_ADDRESS ?? "missing" },
    rateLimitKey: "public-rpc",
    fn: async () => {
      const walletClient = createReceiptWalletClient();
      const hash = await walletClient.writeContract({
        address: getReceiptContractAddress(),
        abi: receiptAbi,
        functionName: "issueReceipt",
        args: [payee, amount, memo],
      });

      console.log(`[receipt] tx: https://sepolia.basescan.org/tx/${hash}`);
      return hash;
    },
  });
}

function createReceiptWalletClient() {
  const privateKey = resolvePrivateKey();
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY or WALLET_PRIVATE_KEY must be a 32-byte hex private key.");
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC;
  if (!rpcUrl) {
    throw new Error("BASE_SEPOLIA_RPC is required.");
  }

  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
}

function getReceiptContractAddress(): Address {
  const address = process.env.PAYMENT_RECEIPT_ADDRESS;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
    throw new Error("PAYMENT_RECEIPT_ADDRESS must be a valid EVM address.");
  }

  return address.trim() as Address;
}

function resolvePrivateKey(): Hex | null {
  for (const value of [process.env.EVM_PRIVATE_KEY, process.env.WALLET_PRIVATE_KEY]) {
    const key = normalizePrivateKey(value);
    if (key) return key;
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

async function main(): Promise<void> {
  const [payee, amount, ...memoParts] = process.argv.slice(2);
  const memo = memoParts.join(" ") || "ClipCordon test receipt";

  if (!payee || !amount) {
    console.warn('Usage: node node_modules/tsx/dist/cli.mjs src/receipt.ts <payee> <amountAtomicUsdc> "<memo>"');
    return;
  }

  await issueReceipt(payee as Address, BigInt(amount), memo);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.warn("[warn] receipt main failed; process will exit cleanly.", { error });
  });
}
