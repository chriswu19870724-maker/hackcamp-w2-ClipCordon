import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">AI x Web3 Payments</p>
      <section className="rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur">
        <h1 className="text-4xl font-bold tracking-tight text-white md:text-6xl">ClipCordon</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
          An AI payment guard that turns market or content signals into explainable payment decisions, then leaves a receipt trail on-chain.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ["1. Signal", "The local agent receives one mock signal for a protected resource."],
            ["2. Decision", "An OpenAI-compatible LLM decides whether to pay and explains why."],
            ["3. Receipt", "Later milestones write PaymentReceipt events that the dashboard can read directly."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <h2 className="font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </div>
          ))}
        </div>

        <Link
          href="/dashboard"
          className="mt-10 inline-flex rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200"
        >
          Enter Dashboard
        </Link>
      </section>
    </main>
  );
}
