import Link from "next/link";
import type { Metadata } from "next";
import { listPrecomputed } from "@/lib/precomputed";
import { GRADE_LABEL, GRADE_STYLE } from "@/lib/grades";

export const metadata: Metadata = {
  title: "Pricing stability leaderboard — ShrinkWrap",
  description: "Which SaaS vendors raise prices, kill plans and shrink free tiers — ranked from most to least stable.",
};

export default function VendorsPage() {
  const vendors = listPrecomputed();
  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="text-sm text-muted hover:text-foreground transition">
          ← ShrinkWrap
        </Link>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight mt-4 leading-[1.05]">
          Pricing stability leaderboard
        </h1>
        <p className="text-muted mt-4 max-w-2xl leading-relaxed">
          Every vendor we have analyzed, ranked from the most to the least predictable. Grades are computed from
          archived pricing pages — click through for the receipts.
        </p>

        <ol className="mt-8 space-y-3">
          {vendors.map((v, i) => (
            <li key={v.slug}>
              <Link
                href={`/r/${v.slug}`}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-4 hover:border-accent/60 transition"
              >
                <span className="w-6 text-sm text-muted tabular-nums">{i + 1}</span>
                <span
                  className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center text-2xl font-bold ${GRADE_STYLE[v.grade]}`}
                  aria-label={`Grade ${v.grade}, ${GRADE_LABEL[v.grade]}`}
                >
                  {v.grade}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{v.vendor}</span>
                  <span className="block text-sm text-muted truncate">{v.headline}</span>
                  <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span>{v.volatility.priceIncreases} hikes</span>
                    <span>{v.volatility.planRemovals} plans killed</span>
                    {v.volatility.freeTierKilled ? (
                      <span className="text-red-300">free tier killed</span>
                    ) : (
                      <span>{v.volatility.limitTightenings} limits cut</span>
                    )}
                    <span className="hidden sm:inline">
                      {v.span.from.slice(0, 4)}–{v.span.to.slice(0, 4)}
                    </span>
                  </span>
                </span>
                <span className="text-muted" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="text-sm text-muted mt-10">
          Not here?{" "}
          <Link href="/" className="text-accent hover:underline">
            Analyze any pricing page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
