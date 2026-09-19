import { geminiJson } from "./gemini";
import type { Plan, PlanChange, ProgressEvent, Report, SnapshotExtraction } from "./types";
import { fetchSnapshotText, listSnapshots, normalizeUrl, pickSpread } from "./wayback";

const planSchema = {
  type: "OBJECT",
  properties: {
    isPricingPage: { type: "BOOLEAN" },
    plans: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          monthlyPrice: { type: "NUMBER", nullable: true },
          priceLabel: { type: "STRING" },
          currency: { type: "STRING" },
          perSeat: { type: "BOOLEAN" },
          limits: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["name", "monthlyPrice", "priceLabel", "currency", "perSeat", "limits"],
      },
    },
  },
  required: ["isPricingPage", "plans"],
};

const summarySchema = {
  type: "OBJECT",
  properties: {
    vendor: { type: "STRING" },
    headline: { type: "STRING" },
    verdict: { type: "STRING" },
    limitChanges: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          plan: { type: "STRING" },
          kind: { type: "STRING", enum: ["limit_tightened", "limit_loosened"] },
          detail: { type: "STRING" },
        },
        required: ["date", "plan", "kind", "detail"],
      },
    },
  },
  required: ["vendor", "headline", "verdict", "limitChanges"],
};

const CONCURRENCY = Number(process.env.SNAPSHOT_CONCURRENCY || 3);

async function extractPlans(text: string, date: string): Promise<Plan[]> {
  const prompt = `You are extracting pricing plans from the text of a SaaS pricing page archived on ${date}.

Rules:
- List every plan/tier shown. Use the plan's displayed name (e.g. "Free", "Hobby", "Pro", "Team", "Enterprise").
- monthlyPrice: the numeric price per month in the page's currency. If the page shows an annual-billing monthly-equivalent and a monthly price, prefer the MONTHLY billing price. If price is $0 use 0. If "Custom", "Contact sales", or not shown, use null.
- priceLabel: short human label exactly as a user would read it, e.g. "$20 / user / month", "Free", "Custom".
- perSeat: true if priced per user/seat/member.
- limits: 3-6 short strings for the most important quotas/limits/entitlements of that plan (bandwidth, seats, requests, storage, projects, retention, key features). Keep each under 60 chars.
- isPricingPage: false if the text is clearly not a pricing page (error page, login, unrelated).

PAGE TEXT:
"""
${text}
"""`;
  const out = await geminiJson<{ isPricingPage: boolean; plans: Plan[] }>(prompt, planSchema);
  if (!out.isPricingPage) return [];
  return out.plans.map((p) => ({
    ...p,
    name: p.name.trim(),
    limits: (p.limits ?? []).slice(0, 6),
  }));
}

function canon(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function computeGrade(v: Report["volatility"]): Report["grade"] {
  const score =
    v.priceIncreases * 2 +
    v.planRemovals * 3 +
    v.limitTightenings * 1.5 +
    (v.biggestIncreasePct && v.biggestIncreasePct >= 50 ? 2 : 0);
  const perYear = score / Math.max(1, v.yearsCovered);
  if (perYear === 0) return "A";
  if (perYear < 1) return "B";
  if (perYear < 2) return "C";
  if (perYear < 3.5) return "D";
  return "F";
}

export async function analyze(
  inputUrl: string,
  emit: (e: ProgressEvent) => void,
  maxSnapshots = 8,
): Promise<Report> {
  const url = normalizeUrl(inputUrl);
  emit({ type: "status", message: "Searching the Wayback Machine…", step: 1, total: 4 });
  const all = await listSnapshots(url);
  if (all.length === 0) throw new Error("No archived snapshots found for that URL. Try the vendor's /pricing page.");
  const chosen = pickSpread(all, maxSnapshots);

  emit({
    type: "status",
    message: `Found ${all.length} snapshots since ${all[0].date}. Reading ${chosen.length} of them…`,
    step: 2,
    total: 4,
  });

  const snapshots: SnapshotExtraction[] = new Array(chosen.length);
  let next = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const i = next++;
      const s = chosen[i];
      try {
        const text = await fetchSnapshotText(url, s.timestamp);
        const plans = await extractPlans(text, s.date);
        emit({ type: "snapshot", date: s.date, ok: plans.length > 0 });
        snapshots[i] = { ...s, plans, ok: plans.length > 0 };
      } catch (err) {
        emit({ type: "snapshot", date: s.date, ok: false });
        snapshots[i] = { ...s, plans: [], ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, worker));

  const good = snapshots.filter((s) => s.ok);
  if (good.length < 2) {
    throw new Error("Could not read enough archived pricing pages for this URL. Try a different pricing URL.");
  }

  emit({ type: "status", message: "Comparing prices across time…", step: 3, total: 4 });

  // Canonical plan names: keep first-seen display name per canonical key.
  const display = new Map<string, string>();
  for (const s of good) for (const p of s.plans) if (!display.has(canon(p.name))) display.set(canon(p.name), p.name);

  const timeline = good.map((s) => {
    const row: Report["timeline"][number] = { date: s.date };
    for (const p of s.plans) row[display.get(canon(p.name))!] = p.monthlyPrice;
    return row;
  });

  const changes: PlanChange[] = [];
  let biggestIncreasePct: number | null = null;
  for (let i = 1; i < good.length; i++) {
    const prev = new Map(good[i - 1].plans.map((p) => [canon(p.name), p]));
    const cur = new Map(good[i].plans.map((p) => [canon(p.name), p]));
    for (const [k, p] of prev) {
      const c = cur.get(k);
      const name = display.get(k)!;
      if (!c) {
        changes.push({ date: good[i].date, plan: name, kind: "plan_removed", detail: `${name} plan (${p.priceLabel}) disappeared` });
        continue;
      }
      if (p.monthlyPrice != null && c.monthlyPrice != null && p.monthlyPrice !== c.monthlyPrice) {
        const pct = p.monthlyPrice > 0 ? Math.round(((c.monthlyPrice - p.monthlyPrice) / p.monthlyPrice) * 100) : null;
        const up = c.monthlyPrice > p.monthlyPrice;
        if (up && pct != null) biggestIncreasePct = Math.max(biggestIncreasePct ?? 0, pct);
        changes.push({
          date: good[i].date,
          plan: name,
          kind: up ? "price_increase" : "price_decrease",
          detail: `${name}: ${p.priceLabel} → ${c.priceLabel}${pct != null ? ` (${up ? "+" : ""}${pct}%)` : ""}`,
        });
      }
    }
    for (const [k, c] of cur) {
      if (!prev.has(k)) {
        const name = display.get(k)!;
        changes.push({ date: good[i].date, plan: name, kind: "plan_added", detail: `New ${name} plan at ${c.priceLabel}` });
      }
    }
  }

  emit({ type: "status", message: "Writing the verdict…", step: 4, total: 4 });

  const compact = good.map((s) => ({
    date: s.date,
    plans: s.plans.map((p) => ({ name: p.name, price: p.priceLabel, limits: p.limits })),
  }));
  const summary = await geminiJson<{
    vendor: string;
    headline: string;
    verdict: string;
    limitChanges: PlanChange[];
  }>(
    `You are a skeptical analyst reviewing how a SaaS vendor's pricing changed over time, based on archived pricing pages.

URL: ${url}
Detected price/plan changes (already computed, do not repeat them as limit changes):
${changes.map((c) => `- ${c.date} ${c.detail}`).join("\n") || "- none"}

Archived plans by date (JSON):
${JSON.stringify(compact)}

Tasks:
1. vendor: the product/company name (short).
2. limitChanges: compare consecutive snapshots for the SAME plan and list meaningful changes to limits/entitlements — e.g. free tier bandwidth cut, seats reduced, feature moved to a higher tier ("limit_tightened"), or limits increased ("limit_loosened"). Only include changes you can actually see in the data. Ignore wording changes. detail must be one concrete sentence under 120 chars, e.g. "Free tier bandwidth cut from 100 GB to 50 GB". Use the plan's display name and the later snapshot's date.
3. headline: one punchy sentence (max 90 chars) summarizing the vendor's pricing behavior, e.g. "Raised Pro prices twice and shrank the free tier in 3 years."
4. verdict: 2-3 plain-English sentences a buyer would want to read before committing. Be concrete with numbers and dates. If pricing was stable, say so plainly.`,
    summarySchema,
    "smart",
  );

  const allChanges = [...changes, ...summary.limitChanges].sort((a, b) => a.date.localeCompare(b.date));
  const years = Math.max(
    0.5,
    (new Date(good[good.length - 1].date).getTime() - new Date(good[0].date).getTime()) / (365.25 * 24 * 3600 * 1000),
  );
  const volatility = {
    priceIncreases: allChanges.filter((c) => c.kind === "price_increase").length,
    planRemovals: allChanges.filter((c) => c.kind === "plan_removed").length,
    limitTightenings: allChanges.filter((c) => c.kind === "limit_tightened").length,
    yearsCovered: Math.round(years * 10) / 10,
    biggestIncreasePct,
  };

  return {
    url,
    vendor: summary.vendor,
    generatedAt: new Date().toISOString(),
    snapshots,
    timeline,
    planNames: Array.from(display.values()),
    changes: allChanges,
    grade: computeGrade(volatility),
    volatility,
    verdict: summary.verdict,
    headline: summary.headline,
  };
}
