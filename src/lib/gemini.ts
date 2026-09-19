const FAST_MODEL = process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";
const SMART_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function geminiJson<T>(
  prompt: string,
  schema: object,
  tier: "fast" | "smart" = "fast",
): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = tier === "fast" ? FAST_MODEL : SMART_MODEL;

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(endpoint(model), {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = (await res.text()).slice(0, 200);
      await new Promise((r) => setTimeout(r, 2500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text) as T;
  }
  throw new Error(`Gemini rate limited (${model}): ${lastErr}`);
}
