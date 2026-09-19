# ShrinkWrap

**Know how a vendor treats its customers before you depend on it.**

Paste any SaaS pricing page. ShrinkWrap pulls five years of archived versions from the
Internet Archive's Wayback Machine, extracts every plan and price with Gemini, diffs them
across time, and shows you every price hike, killed plan and shrunken free tier — with a
link to the archived page that proves it.

Built with Devin at the Cognition × LaunchLoop Budapest hackathon.
Live: https://shrink-wrap-alpha.vercel.app

## Features

- **Stability grade (A–F)** with a price timeline per plan and every detected change linked to its archived page.
- **Planning & Defense** — when the next hike is likely, whether to lock in annual pricing now, and one architecture tip to avoid lock-in with that vendor.
- **Cached reports** for 9 vendors (`/r/<slug>`), a **leaderboard** (`/vendors`) and a **side-by-side compare** (`/compare?a=…&b=…`) that all work without an API key.
- No sign-in, mobile-friendly, works in a private window.

## How it works

1. **Wayback CDX** — list every archived capture of the pricing URL, pick ~8 spread across time.
2. **Extract** — strip each archived page to text, ask Gemini for structured `{plan, price, limits}` JSON.
3. **Diff** — match plans across snapshots; detect price changes, plan removals/additions,
   and limit tightenings.
   Plan renames ("Micro → Personal → Pro") are matched into one lineage, and bundle prices
   ("$2,000 per 10 seats") are normalized per seat so restructures don't look like hikes.
4. **Grade** — penalty points (hikes ×2, removals ×3, tightenings ×1.5, free tier killed +4, any
   +50% hike +2) per year covered: A none · B <1 · C <2 · D <3.5 · F otherwise. Killing the
   free tier caps the grade at D, F if paired with any hike.
5. **Verdict + planning** — a second Gemini pass writes the buyer verdict and the next-hike /
   contract / architecture advice.

Results stream to the browser as NDJSON so you can watch the snapshots come in.

Security: only public hostnames are accepted, archived-page redirects are followed only while
they stay on `web.archive.org`, and page bodies are capped at 2 MB. The Gemini key never
leaves the server.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Gemini key
npm run dev
```

Get a free Gemini key at https://aistudio.google.com/apikey. The cached demo vendors,
leaderboard and compare page work without a key; only live analysis of a new URL needs it.

```bash
npm test            # unit tests (diff engine, grading, URL validation)
npm run lint
npm run typecheck
```

CI runs lint, typecheck, tests and a production build on every push and PR.

## Precompute demo vendors

Live analysis takes 20–40s. Precomputed reports in `src/data/precomputed/` load instantly
and appear as "Try:" chips on the home page.

```bash
npx tsx --env-file=.env.local scripts/precompute.mts https://vercel.com/pricing https://www.heroku.com/pricing
```

## Deploy

Import the repo in Vercel and set `GEMINI_API_KEY` in Project → Settings → Environment Variables.
