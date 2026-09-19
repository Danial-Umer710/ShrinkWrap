# ShrinkWrap — agent notes

Next.js 16 (App Router) + TypeScript + Tailwind. Deployed on Vercel (functions in `fra1`;
archive.org refuses connections from the default `iad1` egress).

## Commands

- `npm run dev` / `npm run build` / `npm run lint` — run lint and build before every push.
- `npx tsx --env-file=.env.local scripts/precompute.mts <pricing-url...>` — generate a cached
  report into `src/data/precomputed/`. Run vendors one at a time: Wayback throttles parallel
  fetches and the free Gemini tier has a low requests-per-minute limit shared with the live site.
- `npx tsx scripts/regrade.mts` — re-derive grades for cached reports after changing
  `computeGrade`; no network calls.

## Architecture

- `src/lib/wayback.ts` — CDX snapshot listing (per-year fallback when the full query is slow),
  archived-page fetch, HTML→text.
- `src/lib/gemini.ts` — structured-JSON Gemini calls; defaults to the lite model.
- `src/lib/analyze.ts` — pipeline: snapshots → plan extraction → cross-snapshot diff → grade
  → verdict. Grading rules live in `computeGrade`; free-tier removal caps the grade at D/F.
- `src/app/api/analyze/route.ts` — NDJSON streaming endpoint; serves cached reports unless
  `fresh: true`.
- `src/app/r/[slug]` and `src/app/vendors` are statically generated from the cached reports.

## Conventions

- `GEMINI_API_KEY` is server-only; never import `gemini.ts` or `precomputed.ts` from client code.
- Keep `Report` JSON backward compatible — new volatility fields must be optional so existing
  cached reports still load.
- Comments explain non-obvious constraints (rate limits, provider quirks), not the diff.
