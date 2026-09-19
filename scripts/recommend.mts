import fs from "node:fs";
import path from "node:path";
import { recommendPlanning } from "../src/lib/analyze";
import type { Report } from "../src/lib/types";

// Backfills the Planning & Defense recommendation on cached reports.
// usage: npx tsx scripts/recommend.mts [--force] [slug ...]
const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));
const dir = path.join(process.cwd(), "src", "data", "precomputed");

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const slug = f.replace(/\.json$/, "");
  if (only.length && !only.includes(slug)) continue;
  const file = path.join(dir, f);
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as Report;
  if (r.recommendation && !force) {
    console.log(`${slug}: already has recommendation`);
    continue;
  }
  try {
    r.recommendation = await recommendPlanning(r);
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
    console.log(`${slug}:`);
    console.log(`  next hike: ${r.recommendation.nextHikePrediction}`);
    console.log(`  contract:  ${r.recommendation.contractStrategy}`);
    console.log(`  defense:   ${r.recommendation.architectureDefense}`);
  } catch (err) {
    console.error(`${slug}: FAILED`, err instanceof Error ? err.message : err);
  }
}
