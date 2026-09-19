import Link from "next/link";
import type { Metadata } from "next";
import { listPrecomputed, loadPrecomputedBySlug } from "@/lib/precomputed";
import { GRADE_LABEL, GRADE_STYLE } from "@/lib/grades";
import type { Report } from "@/lib/types";

export const metadata: Metadata = {
  title: "Compare vendors — ShrinkWrap",
  description: "Side-by-side pricing stability of two SaaS vendors, from archived pricing pages.",
};

const DEFAULT_A = "vercel-com-pricing";
const DEFAULT_B = "netlify-com-pricing";
const GRADE_ORDER: Record<Report["grade"], number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

type Row = {
  label: string;
  value: (r: Report) => string;
  // lower is better; null = no winner
  score: ((r: Report) => number) | null;
};

const perYear = (n: number, r: Report) => n / Math.max(0.5, r.volatility.yearsCovered);

const ROWS: Row[] = [
  { label: "Stability grade", value: (r) => `${r.grade} · ${GRADE_LABEL[r.grade]}`, score: (r) => GRADE_ORDER[r.grade] },
  { label: "Price increases", value: (r) => String(r.volatility.priceIncreases), score: (r) => perYear(r.volatility.priceIncreases, r) },
  { label: "Biggest single hike", value: (r) => (r.volatility.biggestIncreasePct == null ? "—" : `+${r.volatility.biggestIncreasePct}%`), score: (r) => r.volatility.biggestIncreasePct ?? 0 },
  { label: "Plans killed", value: (r) => String(r.volatility.planRemovals), score: (r) => perYear(r.volatility.planRemovals, r) },
  { label: "Limits tightened", value: (r) => String(r.volatility.limitTightenings), score: (r) => perYear(r.volatility.limitTightenings, r) },
  { label: "Free tier", value: (r) => (r.volatility.freeTierKilled ? "Killed" : "Intact"), score: (r) => (r.volatility.freeTierKilled ? 1 : 0) },
  { label: "History covered", value: (r) => `${r.volatility.yearsCovered} yrs · ${r.snapshots.filter((s) => s.ok).length} snapshots`, score: null },
];

function winner(a: Report, b: Report): { safer: Report; other: Report; margin: number } | null {
  const sa = ROWS.reduce((n, row) => (row.score ? n + Number(row.score(a) < row.score(b)) : n), 0);
  const sb = ROWS.reduce((n, row) => (row.score ? n + Number(row.score(b) < row.score(a)) : n), 0);
  if (sa === sb) return null;
  return sa > sb ? { safer: a, other: b, margin: sa - sb } : { safer: b, other: a, margin: sb - sa };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const params = await searchParams;
  const all = listPrecomputed();
  const slugA = params.a ?? DEFAULT_A;
  const slugB = params.b ?? DEFAULT_B;
  const a = loadPrecomputedBySlug(slugA);
  const b = loadPrecomputedBySlug(slugB);
  const win = a && b ? winner(a, b) : null;

  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 text-sm text-muted">
          <Link href="/" className="hover:text-foreground transition">
            ← ShrinkWrap
          </Link>
          <Link href="/vendors" className="hover:text-foreground transition">
            Leaderboard
          </Link>
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight mt-4 leading-[1.05]">Compare two vendors</h1>
        <p className="text-muted mt-4 max-w-2xl leading-relaxed">
          Choosing between two tools? See which one has treated its customers better, from their archived pricing pages.
        </p>

        <form method="get" className="mt-8 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-3 items-center">
          <VendorSelect name="a" value={slugA} options={all} />
          <span className="text-center text-muted text-sm">vs</span>
          <VendorSelect name="b" value={slugB} options={all} />
          <button
            type="submit"
            className="rounded-xl bg-accent text-black font-medium px-5 py-3 hover:brightness-110 transition"
          >
            Compare
          </button>
        </form>

        {!a || !b ? (
          <p className="mt-8 text-muted">Pick two analyzed vendors above.</p>
        ) : (
          <>
            {win ? (
              <div className="mt-8 rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-6">
                <p className="text-lg sm:text-xl font-medium">
                  <span className="text-accent">{win.safer.vendor}</span> is the safer bet.{" "}
                  <span className="text-muted font-normal">
                    It beats {win.other.vendor} on {win.margin} of {ROWS.filter((r) => r.score).length} stability signals.
                  </span>
                </p>
              </div>
            ) : (
              <div className="mt-8 rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
                <p className="text-lg font-medium">Too close to call — their track records are equally stable.</p>
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-border bg-card/60 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr] sm:grid-cols-[1.2fr_1fr_1fr] border-b border-border">
                <div className="p-3 sm:p-4" />
                <VendorHead r={a} slug={slugA} />
                <VendorHead r={b} slug={slugB} />
              </div>
              {ROWS.map((row) => {
                const va = row.score ? row.score(a) : 0;
                const vb = row.score ? row.score(b) : 0;
                const aWins = !!row.score && va < vb;
                const bWins = !!row.score && vb < va;
                return (
                  <div
                    key={row.label}
                    className="grid grid-cols-[1fr_1fr_1fr] sm:grid-cols-[1.2fr_1fr_1fr] border-b border-border last:border-b-0 text-sm"
                  >
                    <div className="p-3 sm:p-4 text-muted">{row.label}</div>
                    <Cell text={row.value(a)} win={aWins} lose={bWins} />
                    <Cell text={row.value(b)} win={bWins} lose={aWins} />
                  </div>
                );
              })}
            </div>

            {(a.recommendation || b.recommendation) && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[a, b].map((r) =>
                  r.recommendation ? (
                    <div key={r.url} className="rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-5">
                      <h3 className="font-medium mb-3">{r.vendor}: planning &amp; defense</h3>
                      <dl className="space-y-3 text-sm">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-accent mb-1">Contract strategy</dt>
                          <dd className="leading-relaxed">{r.recommendation.contractStrategy}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-accent mb-1">Architecture defense</dt>
                          <dd className="leading-relaxed">{r.recommendation.architectureDefense}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function VendorSelect({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: ReturnType<typeof listPrecomputed>;
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      aria-label={name === "a" ? "First vendor" : "Second vendor"}
      className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-base focus:outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.vendor} · {o.grade}
        </option>
      ))}
    </select>
  );
}

function VendorHead({ r, slug }: { r: Report; slug: string }) {
  return (
    <Link href={`/r/${slug}`} className="p-3 sm:p-4 flex items-center gap-2 sm:gap-3 hover:bg-card transition min-w-0">
      <span
        className={`shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-lg border flex items-center justify-center text-lg sm:text-xl font-bold ${GRADE_STYLE[r.grade]}`}
      >
        {r.grade}
      </span>
      <span className="min-w-0">
        <span className="block font-medium truncate">{r.vendor}</span>
        <span className="hidden sm:block text-xs text-muted truncate">Full report →</span>
      </span>
    </Link>
  );
}

function Cell({ text, win, lose }: { text: string; win: boolean; lose: boolean }) {
  return (
    <div
      className={`p-3 sm:p-4 tabular-nums ${win ? "text-emerald-300 font-medium" : lose ? "text-red-300" : ""}`}
    >
      {text}
    </div>
  );
}
