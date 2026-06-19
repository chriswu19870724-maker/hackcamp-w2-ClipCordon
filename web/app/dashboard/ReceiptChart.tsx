"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartReceipt = {
  id: string;
  amountUsd: number;
};

export function ReceiptChart({ receipts }: { receipts: ChartReceipt[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-64 rounded-2xl border border-white/10 bg-slate-950/60 p-4" />;
  }

  return (
    <div className="h-64 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={receipts}>
          <XAxis dataKey="id" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip
            cursor={{ fill: "rgba(14, 165, 233, 0.12)" }}
            contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
          />
          <Bar dataKey="amountUsd" fill="#67e8f9" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
