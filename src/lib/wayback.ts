export type Snapshot = {
  timestamp: string; // YYYYMMDDhhmmss
  date: string; // YYYY-MM-DD
  archiveUrl: string;
};

const CDX = "https://web.archive.org/cdx/search/cdx";
const UA = "ShrinkWrap/0.1 (+https://github.com/Danial-Umer710/ShrinkWrap)";

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  parsed.hash = "";
  parsed.search = "";
  let s = parsed.toString();
  if (s.endsWith("/") && parsed.pathname !== "/") s = s.slice(0, -1);
  return s;
}

export function toDate(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

export async function listSnapshots(url: string): Promise<Snapshot[]> {
  const target = url.replace(/^https?:\/\//, "");
  const params = new URLSearchParams({
    url: target,
    output: "json",
    fl: "timestamp,statuscode,mimetype",
    filter: "statuscode:200",
    collapse: "timestamp:6",
    limit: "1000",
  });
  let rows: string[][] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${CDX}?${params}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) throw new Error(`Wayback CDX error ${res.status}`);
      rows = (await res.json()) as string[][];
      break;
    } catch (err) {
      if (attempt === 1) throw new Error("The Wayback Machine is slow right now — please try again.");
      void err;
    }
  }
  if (rows.length === 0) return [];
  return rows
    .slice(1)
    .filter((r) => !r[2] || r[2].includes("html"))
    .map((r) => ({
      timestamp: r[0],
      date: toDate(r[0]),
      archiveUrl: `https://web.archive.org/web/${r[0]}/${url}`,
    }));
}

/** Pick up to `max` snapshots spread evenly across time; always keep first and last. */
export function pickSpread(snaps: Snapshot[], max = 8): Snapshot[] {
  if (snaps.length <= max) return snaps;
  const out: Snapshot[] = [];
  const step = (snaps.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(snaps[Math.round(i * step)]);
  }
  return Array.from(new Map(out.map((s) => [s.timestamp, s])).values());
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return s;
}

export async function fetchSnapshotText(
  url: string,
  timestamp: string,
  maxChars = 14000,
): Promise<string> {
  const raw = `https://web.archive.org/web/${timestamp}id_/${url}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(raw, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, br" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Snapshot fetch ${res.status}`);
    const html = await res.text();
    const text = htmlToText(html);
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }
  throw new Error("Wayback rate limited, try again");
}
