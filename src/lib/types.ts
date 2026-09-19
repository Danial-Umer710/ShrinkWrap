export type Plan = {
  name: string;
  monthlyPrice: number | null; // null = free/custom/unknown
  priceLabel: string; // e.g. "$20 / user / month", "Free", "Custom"
  currency: string;
  perSeat: boolean;
  limits: string[]; // key quotas/limits, short strings
};

export type SnapshotExtraction = {
  timestamp: string;
  date: string;
  archiveUrl: string;
  plans: Plan[];
  ok: boolean;
  error?: string;
};

export type PlanChange = {
  date: string;
  plan: string;
  kind: "price_increase" | "price_decrease" | "plan_removed" | "plan_added" | "limit_tightened" | "limit_loosened";
  detail: string;
};

export type Report = {
  url: string;
  vendor: string;
  generatedAt: string;
  snapshots: SnapshotExtraction[];
  timeline: {
    date: string;
    [planName: string]: number | string | null;
  }[];
  planNames: string[];
  changes: PlanChange[];
  grade: "A" | "B" | "C" | "D" | "F";
  volatility: {
    priceIncreases: number;
    planRemovals: number;
    limitTightenings: number;
    yearsCovered: number;
    biggestIncreasePct: number | null;
    freeTierKilled?: boolean;
  };
  verdict: string;
  headline: string;
};

export type ProgressEvent =
  | { type: "status"; message: string; step: number; total: number }
  | { type: "snapshot"; date: string; ok: boolean }
  | { type: "result"; report: Report }
  | { type: "error"; message: string };
