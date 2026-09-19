// Re-derive grades for cached reports after grading-rule changes (no network calls).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeGrade } from "../src/lib/analyze";
import type { Report } from "../src/lib/types";

const dir = join(process.cwd(), "src/data/precomputed");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const p = join(dir, f);
  const r = JSON.parse(readFileSync(p, "utf8")) as Report;
  const last = [...r.snapshots].reverse().find((s) => s.ok);
  const freeToday = last?.plans.some((pl) => pl.monthlyPrice === 0 || /^free$/i.test(pl.priceLabel.trim())) ?? false;
  const volatility = { ...r.volatility, freeTierKilled: Boolean(r.volatility.freeTierKilled) && !freeToday };
  const grade = computeGrade(volatility, r.changes);
  if (grade !== r.grade || volatility.freeTierKilled !== r.volatility.freeTierKilled) {
    console.log(`${f}: ${r.grade} -> ${grade}`);
    writeFileSync(p, JSON.stringify({ ...r, volatility, grade }, null, 2));
  }
}
