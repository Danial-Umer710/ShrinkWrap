import fs from "node:fs";
import path from "node:path";
import { diffSnapshots, finalizeReport, normalizePlan, recommendPlanning, summarizeHistory } from "../src/lib/analyze";
import { slugFor } from "../src/lib/precomputed";
import type { Report, SnapshotExtraction } from "../src/lib/types";

// Vendors move their pricing page (store.unity.com/compare-plans -> unity.com/pricing).
// Merge the archived snapshots of several report JSON files into one cached report.
// usage: npx tsx scripts/merge.mts <canonical-url> <report.json> [...more.json]
const [url, ...files] = process.argv.slice(2);
if (!url || files.length === 0) {
  console.error("usage: npx tsx scripts/merge.mts <canonical-url> <report.json> [...]");
  process.exit(1);
}

const byDate = new Map<string, SnapshotExtraction>();
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, "utf8")) as Report;
  for (const s of r.snapshots) {
    const snap = { ...s, plans: s.plans.map(normalizePlan) };
    const existing = byDate.get(s.date);
    if (!existing || (!existing.ok && snap.ok)) byDate.set(s.date, snap);
  }
}
const snapshots = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
const good = snapshots.filter((s) => s.ok);
console.log(`${good.length} usable snapshots ${good[0]?.date} → ${good[good.length - 1]?.date}`);

const diff = diffSnapshots(good);
const summary = await summarizeHistory(url, good, diff.changes);
const report = finalizeReport(url, snapshots, diff, summary);
report.recommendation = await recommendPlanning(report);

const out = path.join(process.cwd(), "src", "data", "precomputed", `${slugFor(url)}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`-> ${out}`);
console.log(`${report.vendor} grade ${report.grade}: ${report.headline}`);
console.log(report.volatility);
for (const c of report.changes) console.log(` - ${c.date} [${c.kind}] ${c.detail}`);
console.log(report.recommendation);
