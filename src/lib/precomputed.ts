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

export function listPrecomputed(): { url: string; vendor: string; grade: string; headline: string }[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Report)
      .map((r) => ({ url: r.url, vendor: r.vendor, grade: r.grade, headline: r.headline }));
  } catch {
    return [];
  }
}
