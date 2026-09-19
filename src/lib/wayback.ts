export type Snapshot = {
  timestamp: string; // YYYYMMDDhhmmss
  date: string; // YYYY-MM-DD
  archiveUrl: string;
};

const CDX = "https://web.archive.org/cdx/search/cdx";
const ARCHIVE_HOST = "web.archive.org";
const UA = "ShrinkWrap/0.1 (+https://github.com/Danial-Umer710/ShrinkWrap)";
const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

/** Only public, named hosts are analyzable: no IP literals, localhost or internal TLDs. */
export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  if (h === "localhost" || /\.(localhost|local|internal|localdomain|home|lan|arpa)$/.test(h)) {
    return false;
  }
  return h.includes(".");
}

export function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol) || !isPublicHostname(parsed.hostname)) {
    throw new Error("Please enter a public https:// pricing page URL.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  let s = parsed.toString();
  if (s.endsWith("/") && parsed.pathname !== "/") s = s.slice(0, -1);
  return s;
}

export function toDate(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

async function cdx(extra: Record<string, string>, timeoutMs: number): Promise<string[][]> {
  const params = new URLSearchParams({
    output: "json",
    fl: "timestamp,statuscode,mimetype",
    filter: "statuscode:200",
    ...extra,
  });
  const res = await fetch(`${CDX}?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Wayback CDX error ${res.status}`);
  const rows = (await res.json()) as string[][];
  return rows.slice(1);
}

// Heavily-archived URLs make the collapsed full-history query crawl (it scans every
// capture), so fall back to one cheap `limit=1` query per year.
async function perYearFallback(target: string): Promise<string[][]> {
  const now = new Date().getFullYear();
  const years = Array.from({ length: now - 2008 + 1 }, (_, i) => String(now - i));
  const out: string[][] = [];
  let next = 0;
  const worker = async () => {
    while (next < years.length) {
      const y = years[next++];
      try {
        out.push(...(await cdx({ url: target, from: y, to: y, limit: "1" }, 15000)));
      } catch {
        // skip a year rather than fail the whole lookup
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

export async function listSnapshots(url: string): Promise<Snapshot[]> {
  const target = url.replace(/^https?:\/\//, "");
  let rows: string[][] = [];
  try {
    rows = await cdx({ url: target, collapse: "timestamp:6", limit: "1000" }, 20000);
  } catch {
    rows = await perYearFallback(target);
    if (rows.length === 0) throw new Error("The Wayback Machine is slow right now — please try again.");
  }
  return rows
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

function isArchiveReplayUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "https:" && p.hostname === ARCHIVE_HOST && p.pathname.startsWith("/web/");
  } catch {
    return false;
  }
}

/**
 * Fetch from the archive, following redirects only while they stay on web.archive.org
 * replay URLs (archived pages can carry their original Location headers verbatim).
 */
async function fetchArchive(start: string): Promise<Response> {
  let target = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isArchiveReplayUrl(target)) throw new Error("Archived page redirected off the archive");
    const res = await fetch(target, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, br" },
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    target = new URL(location, target).toString();
  }
  throw new Error("Too many redirects");
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Archived page too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchSnapshotText(
  url: string,
  timestamp: string,
  maxChars = 14000,
): Promise<string> {
  const raw = `https://${ARCHIVE_HOST}/web/${timestamp}id_/${url}`;
  let lastErr = "Wayback rate limited, try again";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    let res: Response;
    try {
      res = await fetchArchive(raw);
    } catch (err) {
      // Wayback resets connections when it throttles; report the socket error and retry.
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      lastErr = `Wayback fetch failed${code ? ` (${code})` : ""}: ${cause instanceof Error ? cause.message : String(err)}`;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = `Wayback returned ${res.status}`;
      continue;
    }
    if (!res.ok) throw new Error(`Snapshot fetch ${res.status}`);
    const html = await readCapped(res, MAX_HTML_BYTES);
    const text = htmlToText(html);
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }
  throw new Error(lastErr);
}
