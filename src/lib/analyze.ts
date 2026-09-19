import { geminiJson } from "./gemini";
import type { Plan, PlanChange, ProgressEvent, Recommendation, Report, SnapshotExtraction } from "./types";
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

const recommendationSchema = {
  type: "OBJECT",
  properties: {
    nextHikePrediction: { type: "STRING" },
    contractStrategy: { type: "STRING" },
    architectureDefense: { type: "STRING" },
  },
  required: ["nextHikePrediction", "contractStrategy", "architectureDefense"],
};

// Second pass over the finished report: turns the price history into buyer guidance.
export async function recommendPlanning(report: Report): Promise<Recommendation> {
  const hikes = report.changes.filter((c) => c.kind === "price_increase");
  const today = new Date().toISOString().slice(0, 10);
  return geminiJson<Recommendation>(
    `You are a pragmatic procurement + engineering advisor. Today is ${today}.

Vendor: ${report.vendor} (${report.url})
Archived pricing observed from ${report.snapshots[0]?.date} to ${report.snapshots[report.snapshots.length - 1]?.date} (${report.volatility.yearsCovered} years).
Stability grade: ${report.grade}. Price increases: ${report.volatility.priceIncreases}. Plans removed: ${report.volatility.planRemovals}. Limits tightened: ${report.volatility.limitTightenings}. Free tier killed: ${report.volatility.freeTierKilled ? "yes" : "no"}.

Price increases with dates:
${hikes.map((c) => `- ${c.date} ${c.detail}`).join("\n") || "- none observed"}

All detected changes:
${report.changes.map((c) => `- ${c.date} ${c.detail}`).join("\n") || "- none"}

Monthly price per plan over time (JSON):
${JSON.stringify(report.timeline)}

Answer with three short, concrete points (each 1-2 sentences, max 200 chars, no markdown):
1. nextHikePrediction: based on the frequency and spacing of past increases, when is the next price jump likely? Give a rough window (e.g. "likely within 12-18 months, around mid-2027") and the reasoning in a few words. If no increases were ever observed, say a hike is not indicated by history but note any other risk (plan removals, limit cuts).
2. contractStrategy: should a buyer lock into an annual contract now to freeze the current price, or stay month-to-month? Decide, and justify from the history.
3. architectureDefense: ONE sentence of specific engineering advice to avoid technical lock-in with THIS vendor's product category (e.g. wrap the SDK behind an interface, keep deploy config portable, avoid proprietary features), so the team can switch if prices exceed budget.`,
    recommendationSchema,
    "smart",
  );
}

const CONCURRENCY = Number(process.env.SNAPSHOT_CONCURRENCY || 3);

async function extractPlans(text: string, date: string): Promise<Plan[]> {
  const prompt = `You are extracting pricing plans from the text of a SaaS pricing page archived on ${date}.

Rules:
- List the main subscription tiers a customer chooses between (typically 2-6, e.g. "Free", "Hobby", "Pro", "Team", "Enterprise"). Use the plan's displayed name.
- Do NOT list add-ons, support packages, compute/instance sizes, database sizes, or per-resource line items as plans. If the page only sells resources (e.g. dyno sizes), pick the 4-6 most prominent ones.
- Maximum 8 plans.
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
  return out.plans.slice(0, 8).map(normalizePlan);
}

// "$2,000 /mo per 10 seats" is a bundle: compare it per seat so a minimum-seat change isn't a 900% hike.
export function normalizePlan(p: Plan): Plan {
  const bundle = /per\s+(\d+)\s+(seats?|users?|members?)/i.exec(p.priceLabel)?.[1];
  const n = bundle ? Number(bundle) : 1;
  return {
    ...p,
    name: p.name.trim(),
    monthlyPrice: p.monthlyPrice != null && n > 1 ? p.monthlyPrice / n : p.monthlyPrice,
    perSeat: p.perSeat || n > 1,
    limits: (p.limits ?? []).slice(0, 6),
  };
}

function canon(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isFree(p: Plan): boolean {
  return p.monthlyPrice === 0 || /^free$/i.test(p.priceLabel.trim());
}

const GENERIC_TOKENS = new Set(["plan", "tier", "edition", "package", "the", "and", "for", "per", "month", "user"]);

function distinctiveTokens(name: string): Set<string> {
  return new Set(canon(name).split(" ").filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t)));
}

// "1GB Plan" -> "1GB Droplet", "Hobby" -> "Hobby (Free)": same price and a shared
// distinctive word means a rename, not a kill + launch.
function looksRenamed(a: Plan, b: Plan): boolean {
  if (isFree(a) !== isFree(b)) return false;
  const samePrice = a.monthlyPrice != null && a.monthlyPrice === b.monthlyPrice;
  const ta = distinctiveTokens(a.name);
  const tb = distinctiveTokens(b.name);
  const sharedToken = [...ta].some((t) => tb.has(t));
  if (samePrice) return sharedToken || a.perSeat === b.perSeat;
  return sharedToken && ta.size <= 2 && tb.size <= 2;
}

// A date where many plans vanish and many appear is a lineup overhaul, not N separate kills.
function removalPenalty(changes: PlanChange[]): number {
  const byDate = new Map<string, { removed: number; added: number }>();
  for (const c of changes) {
    const d = byDate.get(c.date) ?? { removed: 0, added: 0 };
    if (c.kind === "plan_removed") d.removed++;
    if (c.kind === "plan_added") d.added++;
    byDate.set(c.date, d);
  }
  let penalty = 0;
  for (const d of byDate.values()) {
    penalty += d.removed >= 3 && d.added >= 2 ? 1.5 : d.removed;
  }
  return penalty;
}

export function computeGrade(v: Report["volatility"], changes: PlanChange[]): Report["grade"] {
  const score =
    v.priceIncreases * 2 +
    removalPenalty(changes) * 3 +
    v.limitTightenings * 1.5 +
    (v.freeTierKilled ? 4 : 0) +
    (v.biggestIncreasePct && v.biggestIncreasePct >= 50 ? 2 : 0);
  const perYear = score / Math.max(1, v.yearsCovered);
  let grade: Report["grade"] = "F";
  if (perYear === 0) grade = "A";
  else if (perYear < 1) grade = "B";
  else if (perYear < 2) grade = "C";
  else if (perYear < 3.5) grade = "D";
  // Killing the free tier strands everyone who built on it: never better than D,
  // and F when paired with any hike or tightening.
  if (v.freeTierKilled) {
    grade = v.priceIncreases + v.limitTightenings > 0 || grade === "F" ? "F" : "D";
  }
  return grade;
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
    const firstErr = snapshots.find((s) => s.error)?.error;
    const why = firstErr ? ` (${firstErr.split("\n")[0].slice(0, 160)})` : "";
    throw new Error(`Could not read enough archived pricing pages for this URL${why}. Try again or use a different pricing URL.`);
  }

  emit({ type: "status", message: "Comparing prices across time…", step: 3, total: 4 });
  const diff = diffSnapshots(good);
  const { changes } = diff;

  emit({ type: "status", message: "Writing the verdict…", step: 4, total: 4 });
  const summary = await summarizeHistory(url, good, changes);

  const report = finalizeReport(url, snapshots, diff, summary);
  try {
    report.recommendation = await recommendPlanning(report);
  } catch {
    // Planning advice is a bonus; never fail the report over it.
  }
  return report;
}

export type Summary = { vendor: string; headline: string; verdict: string; limitChanges: PlanChange[] };

export async function summarizeHistory(url: string, good: SnapshotExtraction[], changes: PlanChange[]): Promise<Summary> {
  const compact = good.map((s) => ({
    date: s.date,
    plans: s.plans.map((p) => ({ name: p.name, price: p.priceLabel, limits: p.limits })),
  }));
  return geminiJson<Summary>(
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
}

export function summarizeVolatility(
  good: SnapshotExtraction[],
  allChanges: PlanChange[],
  biggestIncreasePct: number | null,
  freeTierKilled: boolean,
): Report["volatility"] {
  const years = Math.max(
    0.5,
    (new Date(good[good.length - 1].date).getTime() - new Date(good[0].date).getTime()) / (365.25 * 24 * 3600 * 1000),
  );
  return {
    priceIncreases: allChanges.filter((c) => c.kind === "price_increase").length,
    planRemovals: allChanges.filter((c) => c.kind === "plan_removed").length,
    limitTightenings: allChanges.filter((c) => c.kind === "limit_tightened").length,
    yearsCovered: Math.round(years * 10) / 10,
    biggestIncreasePct,
    freeTierKilled,
  };
}

export type Diff = {
  changes: PlanChange[];
  timeline: Report["timeline"];
  planNames: string[];
  biggestIncreasePct: number | null;
  freeTierKilled: boolean;
};

export function diffSnapshots(good: SnapshotExtraction[]): Diff {
  // Canonical plan names: keep first-seen display name per canonical key.
  const display = new Map<string, string>();
  for (const s of good) for (const p of s.plans) if (!display.has(canon(p.name))) display.set(canon(p.name), p.name);

  // Rename chains (Micro -> Personal -> Pro) are charted as one series under the latest name.
  const lineage = new Map<string, { keys: Set<string>; label: string }>();

  const changes: PlanChange[] = [];
  let biggestIncreasePct: number | null = null;
  let freeTierKilled = false;
  // Only call it "killed" if no free plan exists today; a free plan missing from one
  // archived page but back later is an extraction gap, not a policy change.
  // The kill is the step after the LAST snapshot that still had a free plan.
  const lastFreeIdx = good.map((s) => s.plans.some(isFree)).lastIndexOf(true);
  const freeGoneToday = lastFreeIdx !== good.length - 1;
  for (let i = 1; i < good.length; i++) {
    const prev = new Map(good[i - 1].plans.map((p) => [canon(p.name), p]));
    const cur = new Map(good[i].plans.map((p) => [canon(p.name), p]));
    const curHasFree = !(freeGoneToday && i - 1 === lastFreeIdx);
    // Pair vanished plans with newly-appeared ones that look like the same plan renamed.
    const renamed = new Map<string, string>();
    const claimed = new Set<string>();
    for (const [k, p] of prev) {
      if (cur.has(k)) continue;
      for (const [ck, c] of cur) {
        if (prev.has(ck) || claimed.has(ck) || !looksRenamed(p, c)) continue;
        renamed.set(k, ck);
        claimed.add(ck);
        break;
      }
    }
    for (const [k, p] of prev) {
      const rk = renamed.get(k);
      const c = cur.get(k) ?? (rk ? cur.get(rk) : undefined);
      const name = display.get(k)!;
      if (rk && c) {
        const line = lineage.get(k) ?? { keys: new Set([k]), label: name };
        line.keys.add(rk);
        line.label = c.name;
        lineage.set(k, line);
        lineage.set(rk, line);
        if (canon(c.name) !== canon(name)) changes.push({ date: good[i].date, plan: name, kind: "plan_renamed", detail: `${name} renamed to ${c.name}` });
      }
      if (!c) {
        if (isFree(p) && !curHasFree) {
          freeTierKilled = true;
          changes.push({
            date: good[i].date,
            plan: name,
            kind: "plan_removed",
            detail: `Free tier killed: ${name} plan disappeared and no free plan remains`,
          });
        } else {
          changes.push({ date: good[i].date, plan: name, kind: "plan_removed", detail: `${name} plan (${p.priceLabel}) disappeared` });
        }
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
      if (!prev.has(k) && !claimed.has(k)) {
        const name = display.get(k)!;
        changes.push({ date: good[i].date, plan: name, kind: "plan_added", detail: `New ${name} plan at ${c.priceLabel}` });
      }
    }
  }

  // Built after the diff so renamed plans share one series.
  for (const line of lineage.values()) for (const k of line.keys) display.set(k, line.label);
  for (const c of changes) c.plan = display.get(canon(c.plan)) ?? c.plan;
  const timeline = good.map((s) => {
    const row: Report["timeline"][number] = { date: s.date };
    for (const p of s.plans) row[display.get(canon(p.name))!] = p.monthlyPrice;
    return row;
  });
  const planNames = Array.from(new Set(display.values()));

  return { changes, timeline, planNames, biggestIncreasePct, freeTierKilled };
}

export function finalizeReport(
  url: string,
  snapshots: SnapshotExtraction[],
  diff: Diff,
  summary: Summary,
): Report {
  const good = snapshots.filter((s) => s.ok);
  const allChanges = [...diff.changes, ...summary.limitChanges].sort((a, b) => a.date.localeCompare(b.date));
  const volatility = summarizeVolatility(good, allChanges, diff.biggestIncreasePct, diff.freeTierKilled);

  return {
    url,
    vendor: summary.vendor,
    generatedAt: new Date().toISOString(),
    snapshots,
    timeline: diff.timeline,
    planNames: diff.planNames,
    changes: allChanges,
    grade: computeGrade(volatility, allChanges),
    volatility,
    verdict: summary.verdict,
    headline: summary.headline,
  };
}
