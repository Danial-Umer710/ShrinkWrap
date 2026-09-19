# ShrinkWrap

**Know how a vendor treats its customers before you depend on it.**

Paste any SaaS pricing page. ShrinkWrap pulls five years of archived versions from the
Internet Archive's Wayback Machine, extracts every plan and price with Gemini, diffs them
across time, and shows you every price hike, killed plan and shrunken free tier — with a
link to the archived page that proves it.

Built with Devin at the Cognition × LaunchLoop Budapest hackathon.

## How it works

1. **Wayback CDX** — list every archived capture of the pricing URL, pick ~8 spread across time.
2. **Extract** — strip each archived page to text, ask Gemini for structured `{plan, price, limits}` JSON.
3. **Diff** — match plans across snapshots; detect price changes, plan removals/additions,
   and limit tightenings.
4. **Grade** — a simple A–F pricing-stability grade from the count and size of customer-hostile changes.
5. **Verdict** — a short plain-English summary a buyer would want to read.

Results stream to the browser as NDJSON so you can watch the snapshots come in.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Gemini key
npm run dev
```

Get a free Gemini key at https://aistudio.google.com/apikey.

## Precompute demo vendors

Live analysis takes 20–40s. Precomputed reports in `src/data/precomputed/` load instantly
and appear as "Try:" chips on the home page.

```bash
npx tsx --env-file=.env.local scripts/precompute.mts https://vercel.com/pricing https://www.heroku.com/pricing
```

## Deploy

Import the repo in Vercel and set `GEMINI_API_KEY` in Project → Settings → Environment Variables.
