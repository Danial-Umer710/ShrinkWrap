// Re-runs the offline part of the pipeline (diff + grade) over cached reports after a
// rule change. Keeps Gemini's vendor/headline/verdict/limit changes; no network calls.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffSnapshots, finalizeReport } from "../src/lib/analyze";
import type { Report } from "../src/lib/types";

const dir = join(process.cwd(), "src/data/precomputed");
const write = process.argv.includes("--write");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const p = join(dir, f);
  const r = JSON.parse(readFileSync(p, "utf8")) as Report;
  const good = r.snapshots.filter((s) => s.ok);
  const diff = diffSnapshots(good);
  const next = finalizeReport(r.url, r.snapshots, diff, {
    vendor: r.vendor,
    headline: r.headline,
    verdict: r.verdict,
    limitChanges: r.changes.filter((c) => c.kind === "limit_tightened" || c.kind === "limit_loosened"),
  });
  const v0 = r.volatility;
  const v1 = next.volatility;
  const renames = next.changes.filter((c) => c.kind === "plan_renamed").length;
  console.log(
    `${f}: ${r.grade} -> ${next.grade}  hikes ${v0.priceIncreases}->${v1.priceIncreases}  killed ${v0.planRemovals}->${v1.planRemovals}  renames ${renames}`,
  );
  if (write) writeFileSync(p, JSON.stringify({ ...next, generatedAt: r.generatedAt }, null, 2));
}
