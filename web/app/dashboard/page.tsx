import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { ReceiptChart, type ChartReceipt } from "./ReceiptChart";

type DashboardReceipt = ChartReceipt & {
  action: string;
  reason: string;
  payer: string;
  txHash: string;
  source: "placeholder" | "chain";
};

const placeholderReceipts: DashboardReceipt[] = [
  {
    id: "demo-001",
    action: "pay",
    reason: "Placeholder decision: pay once for protected premium content access.",
    amountUsd: 0.01,
    payer: "0x0000000000000000000000000000000000000000",
    txHash: "pending-remix-deploy",
    source: "placeholder",
  },
];

async function withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      console.warn(`[warn] ${label} failed on attempt ${attempt}:`, error);
    }
  }

  console.warn(`[warn] ${label} failed after retry; using placeholder dashboard data.`);
  return null;
}

async function fetchChainReceipts(): Promise<DashboardReceipt[]> {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const receiptAddress = process.env.NEXT_PUBLIC_PAYMENT_RECEIPT_ADDRESS as Address | undefined;

  if (!rpcUrl || !receiptAddress) return [];

  const logs = await withOneRetry("receipt getLogs RPC call", async () => {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

    return client.getLogs({
      address: receiptAddress,
      event: parseAbiItem(
        "event ReceiptIssued(address indexed payer, address indexed payee, uint256 amount, string memo, uint256 timestamp)",
      ),
      fromBlock: "earliest",
      toBlock: "latest",
    });
  });

  if (!logs) return [];

  return logs.map((log, index) => ({
    id: log.transactionHash.slice(0, 10) ?? `chain-${index + 1}`,
    action: "receipt",
    reason: log.args.memo ?? "No memo emitted.",
    amountUsd: Number(log.args.amount ?? BigInt(0)) / 1_000_000,
    payer: log.args.payer ?? "unknown",
    txHash: log.transactionHash,
    source: "chain" as const,
  }));
}

export default async function DashboardPage() {
  const chainReceipts = await fetchChainReceipts();
  const receipts = chainReceipts.length > 0 ? chainReceipts : placeholderReceipts;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-12">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">Dashboard</p>
          <h1 className="mt-3 text-4xl font-bold text-white">Payment Receipts</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            D1 shows one placeholder decision. After the Remix deployment, configure RPC and receipt address env vars to read on-chain events directly with viem.
          </p>
        </div>
        <div className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300">
          Data source: {receipts[0]?.source ?? "placeholder"}
        </div>
      </div>

      <ReceiptChart receipts={receipts} />

      <section className="mt-8 grid gap-4">
        {receipts.map((receipt) => (
          <article key={receipt.id} className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="font-semibold text-white">{receipt.id}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">{receipt.reason}</p>
              </div>
              <span className="rounded-full bg-cyan-300 px-3 py-1 text-sm font-semibold text-slate-950">
                {receipt.action} ${receipt.amountUsd.toFixed(2)}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm text-slate-400 md:grid-cols-2">
              <div>
                <dt className="text-slate-500">Payer</dt>
                <dd className="break-all">{receipt.payer}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Transaction</dt>
                <dd className="break-all">{receipt.txHash}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </main>
  );
}
