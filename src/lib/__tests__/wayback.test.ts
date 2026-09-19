import { describe, expect, it } from "vitest";
import { htmlToText, isPublicHostname, normalizeUrl, pickSpread, toDate, type Snapshot } from "../wayback";

describe("normalizeUrl", () => {
  it("adds https, strips query/hash/trailing slash and credentials", () => {
    expect(normalizeUrl("vercel.com/pricing/?utm=x#plans")).toBe("https://vercel.com/pricing");
    expect(normalizeUrl("https://user:pw@heroku.com/pricing")).toBe("https://heroku.com/pricing");
    expect(normalizeUrl("https://notion.so/")).toBe("https://notion.so/");
  });

  it.each([
    "http://127.0.0.1/admin",
    "localhost:3000",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.0.0.5/",
    "http://api.internal/pricing",
    "http://intranet/",
    "ftp://example.com/pricing",
  ])("rejects non-public target %s", (input) => {
    expect(() => normalizeUrl(input)).toThrow(/public https/);
  });
});

describe("isPublicHostname", () => {
  it("accepts ordinary domains and rejects IPs and local names", () => {
    expect(isPublicHostname("www.figma.com")).toBe(true);
    expect(isPublicHostname("Example.COM.")).toBe(true);
    expect(isPublicHostname("192.168.1.1")).toBe(false);
    expect(isPublicHostname("box.local")).toBe(false);
    expect(isPublicHostname("")).toBe(false);
  });
});

describe("toDate", () => {
  it("formats a Wayback timestamp", () => {
    expect(toDate("20220731123456")).toBe("2022-07-31");
  });
});

describe("pickSpread", () => {
  const snaps: Snapshot[] = Array.from({ length: 20 }, (_, i) => {
    const ts = `20${String(i).padStart(2, "0")}0101000000`;
    return { timestamp: ts, date: toDate(ts), archiveUrl: "" };
  });

  it("keeps everything when under the cap", () => {
    expect(pickSpread(snaps.slice(0, 5), 8)).toHaveLength(5);
  });

  it("spreads evenly and always keeps first and last", () => {
    const picked = pickSpread(snaps, 8);
    expect(picked).toHaveLength(8);
    expect(picked[0]).toBe(snaps[0]);
    expect(picked[picked.length - 1]).toBe(snaps[snaps.length - 1]);
  });
});

describe("htmlToText", () => {
  it("drops scripts, styles and tags and decodes entities", () => {
    const html = `<html><head><title>x</title><style>.a{}</style></head>
      <body><script>alert(1)</script><h1>Pricing</h1><p>Pro &amp; Team &#8212; $20&nbsp;/mo</p><!-- c --></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("<");
    expect(text).toContain("Pricing\nPro & Team — $20 /mo");
  });
});
