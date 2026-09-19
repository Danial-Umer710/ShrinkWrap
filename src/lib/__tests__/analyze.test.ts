import { describe, expect, it } from "vitest";
import { computeGrade, diffSnapshots, normalizePlan, summarizeVolatility } from "../analyze";
import type { Plan, PlanChange, Report, SnapshotExtraction } from "../types";

function plan(name: string, monthlyPrice: number | null, extra: Partial<Plan> = {}): Plan {
  return {
    name,
    monthlyPrice,
    priceLabel: monthlyPrice === 0 ? "Free" : monthlyPrice == null ? "Custom" : `$${monthlyPrice} /mo`,
    currency: "USD",
    perSeat: false,
    limits: [],
    ...extra,
  };
}

function snap(date: string, plans: Plan[]): SnapshotExtraction {
  const timestamp = date.replace(/-/g, "") + "000000";
  return { timestamp, date, archiveUrl: `https://web.archive.org/web/${timestamp}/x`, plans, ok: true };
}

describe("normalizePlan", () => {
  it("divides bundle prices per seat", () => {
    const p = normalizePlan(plan("Pro", 2000, { priceLabel: "$2,000 /mo per 10 seats" }));
    expect(p.monthlyPrice).toBe(200);
    expect(p.perSeat).toBe(true);
  });

  it("leaves single-seat prices alone and trims names", () => {
    const p = normalizePlan(plan("  Pro ", 20, { priceLabel: "$20 / user / month" }));
    expect(p.monthlyPrice).toBe(20);
    expect(p.name).toBe("Pro");
  });

  it("caps limits at six", () => {
    const p = normalizePlan(plan("Pro", 20, { limits: ["a", "b", "c", "d", "e", "f", "g"] }));
    expect(p.limits).toHaveLength(6);
  });
});

describe("diffSnapshots", () => {
  it("detects a price increase with percentage", () => {
    const { changes, biggestIncreasePct } = diffSnapshots([
      snap("2020-01-01", [plan("Pro", 8)]),
      snap("2022-01-01", [plan("Pro", 12)]),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("price_increase");
    expect(changes[0].detail).toContain("+50%");
    expect(biggestIncreasePct).toBe(50);
  });

  it("detects a price decrease without counting it as a hike", () => {
    const { changes, biggestIncreasePct } = diffSnapshots([
      snap("2020-01-01", [plan("Pro", 12)]),
      snap("2021-01-01", [plan("Pro", 8)]),
    ]);
    expect(changes[0].kind).toBe("price_decrease");
    expect(biggestIncreasePct).toBeNull();
  });

  it("treats a same-price rename as a rename, not a kill", () => {
    const { changes, planNames, timeline } = diffSnapshots([
      snap("2020-01-01", [plan("1GB Plan", 5)]),
      snap("2021-01-01", [plan("1GB Droplet", 5)]),
    ]);
    expect(changes.map((c) => c.kind)).toEqual(["plan_renamed"]);
    expect(planNames).toEqual(["1GB Droplet"]);
    expect(timeline[0]["1GB Droplet"]).toBe(5);
  });

  it("reports plans that disappear and plans that appear", () => {
    const { changes } = diffSnapshots([
      snap("2020-01-01", [plan("Starter", 5), plan("Pro", 20)]),
      snap("2021-01-01", [plan("Pro", 20), plan("Enterprise", null)]),
    ]);
    expect(changes.map((c) => c.kind).sort()).toEqual(["plan_added", "plan_removed"]);
  });

  it("flags a killed free tier only when no free plan remains today", () => {
    const killed = diffSnapshots([
      snap("2019-01-01", [plan("Free", 0), plan("Hobby", 7)]),
      snap("2021-01-01", [plan("Free", 0), plan("Hobby", 7)]),
      snap("2023-01-01", [plan("Basic", 5), plan("Hobby", 7)]),
    ]);
    expect(killed.freeTierKilled).toBe(true);
    const kill = killed.changes.find((c) => c.detail.startsWith("Free tier killed"));
    expect(kill?.date).toBe("2023-01-01");

    const gap = diffSnapshots([
      snap("2019-01-01", [plan("Free", 0), plan("Hobby", 7)]),
      snap("2021-01-01", [plan("Hobby", 7)]),
      snap("2023-01-01", [plan("Free", 0), plan("Hobby", 7)]),
    ]);
    expect(gap.freeTierKilled).toBe(false);
  });

  it("returns no changes for a stable vendor", () => {
    const { changes } = diffSnapshots([
      snap("2019-01-01", [plan("Free", 0), plan("Pro", 20)]),
      snap("2024-01-01", [plan("Free", 0), plan("Pro", 20)]),
    ]);
    expect(changes).toEqual([]);
  });
});

function volatility(over: Partial<Report["volatility"]>): Report["volatility"] {
  return {
    priceIncreases: 0,
    planRemovals: 0,
    limitTightenings: 0,
    yearsCovered: 5,
    biggestIncreasePct: null,
    freeTierKilled: false,
    ...over,
  };
}

function removals(n: number, date = "2021-01-01"): PlanChange[] {
  return Array.from({ length: n }, (_, i) => ({
    date,
    plan: `P${i}`,
    kind: "plan_removed" as const,
    detail: "gone",
  }));
}

describe("computeGrade", () => {
  it("gives A to a vendor with no changes", () => {
    expect(computeGrade(volatility({}), [])).toBe("A");
  });

  it("scales penalties by years covered", () => {
    expect(computeGrade(volatility({ priceIncreases: 2, yearsCovered: 5 }), [])).toBe("B");
    expect(computeGrade(volatility({ priceIncreases: 2, yearsCovered: 1 }), [])).toBe("F");
  });

  it("never grades a killed free tier better than D, and F with any hike", () => {
    expect(computeGrade(volatility({ freeTierKilled: true, yearsCovered: 10 }), [])).toBe("D");
    expect(computeGrade(volatility({ freeTierKilled: true, priceIncreases: 1, yearsCovered: 10 }), [])).toBe("F");
  });

  it("treats a same-day lineup overhaul as one event, not N kills", () => {
    const overhaul: PlanChange[] = [
      ...removals(4),
      { date: "2021-01-01", plan: "N1", kind: "plan_added", detail: "new" },
      { date: "2021-01-01", plan: "N2", kind: "plan_added", detail: "new" },
    ];
    const separate = removals(4).map((c, i) => ({ ...c, date: `202${i}-01-01` }));
    expect(computeGrade(volatility({ planRemovals: 4 }), overhaul)).toBe("B");
    expect(computeGrade(volatility({ planRemovals: 4 }), separate)).toBe("D");
  });
});

describe("summarizeVolatility", () => {
  it("counts change kinds and rounds years covered", () => {
    const good = [snap("2020-01-01", []), snap("2022-07-01", [])];
    const changes: PlanChange[] = [
      { date: "2021-01-01", plan: "Pro", kind: "price_increase", detail: "" },
      { date: "2021-01-01", plan: "Pro", kind: "limit_tightened", detail: "" },
      { date: "2022-01-01", plan: "Free", kind: "plan_removed", detail: "" },
    ];
    const v = summarizeVolatility(good, changes, 25, true);
    expect(v).toEqual({
      priceIncreases: 1,
      planRemovals: 1,
      limitTightenings: 1,
      yearsCovered: 2.5,
      biggestIncreasePct: 25,
      freeTierKilled: true,
    });
  });

  it("never reports less than half a year of coverage", () => {
    const v = summarizeVolatility([snap("2024-01-01", []), snap("2024-01-02", [])], [], null, false);
    expect(v.yearsCovered).toBe(0.5);
  });
});
