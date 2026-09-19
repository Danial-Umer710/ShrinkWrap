import fs from "node:fs";
import path from "node:path";
import type { Report } from "./types";
import { normalizeUrl } from "./wayback";

const dir = path.join(process.cwd(), "src", "data", "precomputed");

export function slugFor(url: string): string {
  return normalizeUrl(url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

export function loadPrecomputed(url: string): Report | null {
  try {
    const file = path.join(dir, `${slugFor(url)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Report;
  } catch {
    return null;
  }
}

export type PrecomputedSummary = {
  slug: string;
  url: string;
  vendor: string;
  grade: Report["grade"];
  headline: string;
  volatility: Report["volatility"];
  span: { from: string; to: string };
};

const GRADE_ORDER: Record<Report["grade"], number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

export function loadPrecomputedBySlug(slug: string): Report | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const file = path.join(dir, `${slug}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Report;
  } catch {
    return null;
  }
}

export function listPrecomputed(): PrecomputedSummary[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Report;
        return {
          slug: f.replace(/\.json$/, ""),
          url: r.url,
          vendor: r.vendor,
          grade: r.grade,
          headline: r.headline,
          volatility: r.volatility,
          span: { from: r.timeline[0]?.date ?? "", to: r.timeline[r.timeline.length - 1]?.date ?? "" },
        };
      })
      .sort((a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || a.vendor.localeCompare(b.vendor));
  } catch {
    return [];
  }
}
