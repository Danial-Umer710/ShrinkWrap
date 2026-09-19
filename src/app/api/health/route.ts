export const dynamic = "force-dynamic";

// Deployment sanity check: reports whether the Gemini key is configured, never its value.
export async function GET() {
  const configured = (process.env.GEMINI_API_KEY?.trim() ?? "").length > 0;
  return Response.json({ ok: configured });
}
