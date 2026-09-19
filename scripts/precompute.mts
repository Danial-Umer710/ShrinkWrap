import fs from "node:fs";
import path from "node:path";
import { analyze } from "../src/lib/analyze";
import { slugFor } from "../src/lib/precomputed";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: npx tsx scripts/precompute.ts <pricing-url> [...]");
  process.exit(1);
}
const dir = path.join(process.cwd(), "src", "data", "precomputed");
fs.mkdirSync(dir, { recursive: true });

for (const url of urls) {
  console.log(`\n== ${url}`);
  try {
    const report = await analyze(url, (e) => {
      if (e.type === "status") console.log(`  [${e.step}/${e.total}] ${e.message}`);
      if (e.type === "snapshot") console.log(`  snapshot ${e.date} ${e.ok ? "ok" : "FAILED"}`);
    }, Number(process.env.MAX_SNAPSHOTS || 8));
    const file = path.join(dir, `${slugFor(url)}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`  -> ${file}`);
    console.log(`  ${report.vendor} grade ${report.grade}: ${report.headline}`);
    for (const c of report.changes) console.log(`   - ${c.date} [${c.kind}] ${c.detail}`);
    for (const s of report.snapshots) if (!s.ok) console.log(`   ! ${s.date} failed: ${s.error}`);
  } catch (err) {
    console.error("  FAILED:", err instanceof Error ? err.message : err);
  }
}
