"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlanChange, Report } from "@/lib/types";

const COLORS = ["#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f472b6", "#facc15", "#60a5fa"];

const GRADE_STYLE: Record<Report["grade"], string> = {
  A: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  B: "bg-lime-500/15 text-lime-300 border-lime-500/40",
  C: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  D: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  F: "bg-red-500/15 text-red-300 border-red-500/40",
};

const GRADE_LABEL: Record<Report["grade"], string> = {
  A: "Rock solid",
  B: "Mostly stable",
  C: "Some creep",
  D: "Volatile",
  F: "Buyer beware",
};

const KIND_META: Record<PlanChange["kind"], { label: string; cls: string }> = {
  price_increase: { label: "Price up", cls: "bg-red-500/15 text-red-300" },
  price_decrease: { label: "Price down", cls: "bg-emerald-500/15 text-emerald-300" },
  plan_removed: { label: "Plan killed", cls: "bg-red-500/20 text-red-200" },
  plan_added: { label: "New plan", cls: "bg-sky-500/15 text-sky-300" },
  limit_tightened: { label: "Limit cut", cls: "bg-orange-500/15 text-orange-300" },
  limit_loosened: { label: "Limit raised", cls: "bg-emerald-500/15 text-emerald-300" },
};

const MAX_CHART_PLANS = 6;

function pickChartPlans(report: Report): string[] {
  const changed = new Set(
    report.changes.filter((c) => c.kind === "price_increase" || c.kind === "price_decrease").map((c) => c.plan),
  );
  return report.planNames
    .map((p) => {
      const points = report.timeline.filter((r) => typeof r[p] === "number").length;
      return { p, points, score: points + (changed.has(p) ? 10 : 0) };
    })
    .filter((x) => x.points > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHART_PLANS)
    .map((x) => x.p);
}

type DayGroup = { date: string; items: PlanChange[]; added: PlanChange[]; removed: PlanChange[] };

// Bulk add/remove on one date is a lineup overhaul; show it as one line instead of N.
function groupByDate(changes: PlanChange[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const c of changes) {
    const g = map.get(c.date) ?? { date: c.date, items: [], added: [], removed: [] };
    if (c.kind === "plan_added") g.added.push(c);
    else if (c.kind === "plan_removed" && !c.detail.startsWith("Free tier killed")) g.removed.push(c);
    else g.items.push(c);
    map.set(c.date, g);
  }
  return Array.from(map.values()).map((g) => {
    const overhaul = g.removed.length + g.added.length >= 5;
    if (!overhaul) return { ...g, items: [...g.items, ...g.removed, ...g.added], added: [], removed: [] };
    return g;
  });
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  );
}

export default function ReportView({ report }: { report: Report }) {
  const [showSources, setShowSources] = useState(false);
  const chartPlans = pickChartPlans(report);
  const bad = report.changes.filter((c) => ["price_increase", "plan_removed", "limit_tightened"].includes(c.kind));
  const groups = groupByDate(report.changes);
  const first = report.timeline[0]?.date;
  const last = report.timeline[report.timeline.length - 1]?.date;

  return (
    <section className="w-full max-w-4xl mx-auto mt-10 space-y-6" aria-live="polite">
      <header className="flex flex-col sm:flex-row sm:items-start gap-5">
        <div
          className={`shrink-0 w-24 h-24 rounded-2xl border flex flex-col items-center justify-center ${GRADE_STYLE[report.grade]}`}
          aria-label={`Pricing stability grade ${report.grade}`}
        >
          <span className="text-5xl font-bold leading-none">{report.grade}</span>
          <span className="text-[10px] uppercase tracking-wider mt-1 opacity-80">{GRADE_LABEL[report.grade]}</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm text-muted truncate">{report.url}</div>
          <h2 className="text-2xl sm:text-3xl font-semibold mt-1 leading-tight">{report.vendor}: {report.headline}</h2>
          <p className="text-muted mt-3 leading-relaxed">{report.verdict}</p>
          <div className="text-xs text-muted mt-3">
            Based on {report.timeline.length} archived pricing pages, {first} → {last}.
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="price increases" value={report.volatility.priceIncreases} />
        <Stat label="plans killed" value={report.volatility.planRemovals} />
        {report.volatility.freeTierKilled ? (
          <Stat label="free tier" value="Killed" />
        ) : (
          <Stat label="limits tightened" value={report.volatility.limitTightenings} />
        )}
        <Stat
          label="biggest single hike"
          value={report.volatility.biggestIncreasePct != null ? `+${report.volatility.biggestIncreasePct}%` : "—"}
        />
      </div>

      {chartPlans.length > 0 && (
        <div className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
          <h3 className="font-medium mb-4">Monthly price by plan</h3>
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.timeline} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 12 }} />
                <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 12, fontSize: 13 }}
                  labelStyle={{ color: "#a1a1aa" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chartPlans.map((p, i) => (
                  <Line
                    key={p}
                    type="stepAfter"
                    dataKey={p}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted mt-3">
            Prices in the page&apos;s currency. &quot;Custom&quot; / contact-sales plans are not charted.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
        <h3 className="font-medium mb-1">What changed</h3>
        <p className="text-xs text-muted mb-4">
          {bad.length} of {report.changes.length} changes went against the customer.
        </p>
        {report.changes.length === 0 ? (
          <p className="text-muted text-sm">No pricing or plan changes detected across the archived snapshots.</p>
        ) : (
          <ol className="relative border-l border-border ml-2 space-y-5">
            {groups.map((g) => (
              <li key={g.date} className="ml-5">
                <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-border ring-4 ring-background" />
                <div className="font-mono text-xs text-muted">{g.date}</div>
                <ul className="mt-1.5 space-y-2">
                  {g.items.map((c, i) => {
                    const meta = KIND_META[c.kind];
                    const isFreeKill = c.detail.startsWith("Free tier killed");
                    return (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>
                          {isFreeKill ? "Free tier killed" : meta.label}
                        </span>
                        <span className={isFreeKill ? "font-medium text-red-200" : ""}>{c.detail}</span>
                      </li>
                    );
                  })}
                  {g.removed.length + g.added.length > 0 && (
                    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/15 text-violet-300">
                        Lineup overhauled
                      </span>
                      <span className="text-muted">
                        {g.removed.length > 0 && (
                          <>
                            Dropped {g.removed.map((c) => c.plan).join(", ")}.
                          </>
                        )}{" "}
                        {g.added.length > 0 && <>Added {g.added.map((c) => c.plan).join(", ")}.</>}
                      </span>
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
        <button
          type="button"
          onClick={() => setShowSources((s) => !s)}
          className="w-full flex items-center justify-between text-left font-medium"
          aria-expanded={showSources}
        >
          <span>Sources: {report.snapshots.filter((s) => s.ok).length} archived snapshots</span>
          <span className="text-muted text-sm">{showSources ? "Hide" : "Show"}</span>
        </button>
        {showSources && (
          <div className="mt-4 space-y-4">
            {report.snapshots.map((s) => (
              <div key={s.timestamp} className="text-sm">
                <a
                  href={s.archiveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {s.date} ↗
                </a>
                {s.ok ? (
                  <ul className="mt-1 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-muted">
                    {s.plans.map((p) => (
                      <li key={p.name}>
                        <span className="text-foreground">{p.name}</span> — {p.priceLabel}
                        {p.limits.length > 0 && <span className="block text-xs opacity-80">{p.limits.join(" · ")}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-muted mt-1">Could not read this snapshot.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
