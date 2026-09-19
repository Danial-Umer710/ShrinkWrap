# ShrinkWrap — a credit score for SaaS vendors

**Live:** https://shrink-wrap-alpha.vercel.app · No sign-in · Built with Devin at the Cognition × LaunchLoop Budapest hackathon

## The Problem

Heroku killed its free tier. Unity flipped its pricing model overnight. Half the tools you depend on have quietly raised the Pro plan year after year — and you only find out when the invoice changes. You can check a vendor's uptime history and funding history, but not the one thing that decides your bill: how they've treated customers on price. ShrinkWrap makes that visible *before* you build on them.

## Core Features

Paste any pricing-page URL. ShrinkWrap pulls 5+ years of snapshots from the Internet Archive, extracts every plan, price and limit with Gemini, and diffs them across time (rename-aware, per-seat normalized). You get:

- **Stability grade A–F** for the vendor.
- **Price timeline** per plan.
- **Every hike / killed plan / tightened limit**, each with a link to the archived page as proof.
- **Plain-English verdict.**
- **"Planning & Defense" card** — when the next hike is likely, whether to lock in an annual contract now, and one architecture tip to avoid lock-in with that vendor.
- **Vendor leaderboard** (`/vendors`), **shareable report links** (`/r/<slug>`) and a **Compare page** (`/compare?a=…&b=…`) — *"Vercel is the safer bet — beats Heroku on 4 of 6 signals."*
- **No sign-in, mobile-friendly.** 9 vendors are cached for an instant demo; any new URL is analyzed live in about a minute.

## Technical Execution (Devin)

Essentially the whole build:

- Proposed the idea and scaffolded the Next.js app.
- Built the Wayback pipeline, Gemini extraction, cross-snapshot diffing and grading model.
- Built the charts and UI, leaderboard, permalinks and Compare page.
- Precomputed the cached vendor reports and wrote `AGENTS.md`.
- Deployed to Vercel — moving the region to Frankfurt when Wayback blocked US IPs.
- Verified the live site with Computer Use.
- Ran a deep security scan that found a real **SSRF** (archived pages could redirect the server to internal hosts) plus DoS and info-disclosure issues, and **fixed the high-severity ones**.
- Shipped a **test suite + GitHub Actions CI** as a reviewed PR — all before submission.

## Product Steering (Human)

- Chose and steered the idea.
- Set up GitHub, Vercel and Gemini.
- Tested every iteration on a phone.
- Specified the Planning & Defense feature and the pre-seeded demo buttons.
- Set priorities, and approved the security fixes and the PR.

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
