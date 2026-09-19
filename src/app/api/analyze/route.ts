import { analyze } from "@/lib/analyze";
import { loadPrecomputed } from "@/lib/precomputed";
import type { ProgressEvent } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; fresh?: boolean };
  const url = body.url?.trim();
  if (!url) return Response.json({ error: "url is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ProgressEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const cached = body.fresh ? null : loadPrecomputed(url);
        if (cached) {
          emit({ type: "status", message: "Loaded from cache", step: 4, total: 4 });
          emit({ type: "result", report: cached });
        } else {
          const report = await analyze(url, emit);
          emit({ type: "result", report });
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Analysis failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
