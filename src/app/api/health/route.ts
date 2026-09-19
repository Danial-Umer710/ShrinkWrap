export const dynamic = "force-dynamic";

// Deployment sanity check: reports whether the Gemini key is configured, never its value.
export async function GET() {
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  return Response.json({
    ok: key.length > 0,
    geminiKeyLength: key.length,
    geminiEnvNames: Object.keys(process.env).filter((k) => /gemini/i.test(k)),
    region: process.env.VERCEL_REGION ?? null,
    env: process.env.VERCEL_ENV ?? null,
  });
}
