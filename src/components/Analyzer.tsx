"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import ReportView from "./ReportView";
import type { ProgressEvent, Report } from "@/lib/types";

type Example = { slug: string; url: string; vendor: string; grade: string; headline: string };

type Progress = { message: string; step: number; total: number; snapshots: { date: string; ok: boolean }[] };

export default function Analyzer({ examples }: { examples: Example[] }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(target: string) {
    if (!target.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    setReport(null);
    setProgress({ message: "Starting…", step: 0, total: 4, snapshots: [] });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as ProgressEvent;
          if (ev.type === "status") setProgress((p) => ({ ...(p ?? { snapshots: [] }), message: ev.message, step: ev.step, total: ev.total }));
          if (ev.type === "snapshot") setProgress((p) => p && { ...p, snapshots: [...p.snapshots, { date: ev.date, ok: ev.ok }].sort((a, b) => a.date.localeCompare(b.date)) });
          if (ev.type === "result") setReport(ev.report);
          if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(url);
  }

  function permalinkFor(r: Report): string | undefined {
    const slug = examples.find((ex) => ex.url === r.url)?.slug;
    return slug ? `/r/${slug}` : undefined;
  }

  return (
    <div className="mt-8">
      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
        <label htmlFor="url" className="sr-only">
          Pricing page URL
        </label>
        <input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="vercel.com/pricing"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-xl border border-border bg-card px-4 py-3.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 placeholder:text-muted/60"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="rounded-xl bg-accent text-black font-medium px-6 py-3.5 disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.99] transition"
        >
          {loading ? "Digging…" : "Check pricing history"}
        </button>
      </form>

      {examples.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted">Try:</span>
          {examples.map((ex) => (
            <button
              key={ex.url}
              type="button"
              disabled={loading}
              onClick={() => {
                setUrl(ex.url.replace(/^https?:\/\/(www\.)?/, ""));
                run(ex.url);
              }}
              className="text-xs rounded-full border border-border bg-card/60 px-3 py-1.5 hover:border-accent/60 transition disabled:opacity-50"
            >
              {ex.vendor} <span className="text-muted">· {ex.grade}</span>
            </button>
          ))}
          <Link href="/vendors" className="text-xs text-accent hover:underline ml-1">
            Full leaderboard →
          </Link>
        </div>
      )}

      {loading && progress && (
        <div className="mt-8 rounded-2xl border border-border bg-card/60 p-5" role="status">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <span className="text-sm">{progress.message}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${Math.max(8, (progress.step / progress.total) * 100)}%` }}
            />
          </div>
          {progress.snapshots.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {progress.snapshots.map((s) => (
                <span
                  key={s.date}
                  className={`font-mono text-[11px] px-2 py-1 rounded-md ${s.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300 line-through"}`}
                >
                  {s.date}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted mt-4">
            Fetching archived pages from the Wayback Machine — usually 20–40 seconds.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      {report && <ReportView report={report} permalink={permalinkFor(report)} />}
    </div>
  );
}
