# Comps

Comps benchmarks a public company against its peers over several years. You ask a question in plain English ("Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years"), and a ReAct agent pulls the numbers from SEC filings, does the math in a calculator tool, and answers with every figure cited to its filing. It's built for medium to long-term investors and in-house corporate analysts.

**Live demo:** https://comps-production-1543.up.railway.app

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS): UI, API routes, and the agent in one app
- **Supabase**: auth (email + password) and Postgres with row-level security
- **Anthropic Claude**: the agent's model (set by `LLM_MODEL`)
- **SEC EDGAR** and **Tavily**: financial data and news for the agent's tools
- **Stripe** (test mode): one-time Pro upgrade
- **Railway**: hosting (one service, `npm run build` then `npm start`)

## Local setup

Requires Node 22.

1. Clone the repo:
   ```bash
   git clone https://github.com/yashkhadilkar/comps.git
   cd comps
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the env template and fill in your keys. Teammates: ask Yash for the shared dev keys (sent privately, never in the group chat):
   ```bash
   cp .env.example .env.local
   ```
4. Run the database migration: open your Supabase project, go to **SQL Editor**, paste the contents of [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql), and run it. Skip this if you're using the shared team project, since it's already applied.
5. Start the dev server:
   ```bash
   npm run dev
   ```
   Then open http://localhost:3000.

## Environment variables

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, used by the browser and server as the logged-in user |
| `SUPABASE_SECRET_KEY` | Supabase secret key, server only. Bypasses row-level security for writes users can't do themselves (saving runs, upgrading to Pro) |
| `ANTHROPIC_API_KEY` | Anthropic API key for the agent |
| `LLM_MODEL` | Model the agent uses. `claude-haiku-5-5` for development, `claude-sonnet-5-5` for the demo |
| `TAVILY_API_KEY` | Tavily key for the news search tool |
| `SEC_USER_AGENT` | User-Agent for SEC EDGAR requests. SEC requires a name and email |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) for creating Checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Verifies that webhook calls really come from Stripe |
| `NEXT_PUBLIC_APP_URL` | Public base URL of the app, used for Stripe success/cancel redirects |

## Comparability Audit

`/audit` (sidebar: "Comparability Audit") checks whether two companies' reported figures are genuinely comparable for a fiscal year: revenue, operating income, operating margin and net income. For each metric it checks fiscal year-end alignment, currency, XBRL definition and evidence, and returns one of `COMPARABLE`, `ADJUSTED`, `PARTIALLY_COMPARABLE`, `NOT_COMPARABLE` or `INSUFFICIENT_EVIDENCE`, with 10-K links, formulas, caveats, a review checklist and a Markdown export. All figures come from SEC XBRL via `get_financials`; margins go through the calculate engine and are re-verified. One bounded model call may add explanatory notes, which are dropped if they contain any figure not in the audit.

Limitations: an evidence-backed comparability review, not a statutory audit. Annual 10-K US GAAP facts in USD only (no FX conversion, non-GAAP, segments or IFRS filers); periods are matched to the nearest fiscal year-end, not recalendarized; companies that do not report an operating income line (Nike) get `INSUFFICIENT_EVIDENCE` rather than an estimate. Audits do not count against research questions; they are limited to 10 per user per hour (in memory, per server process).

Research answers that compare two or more companies also show a **Comparability review** above the answer: the same deterministic audit (no model call) for the most recent fiscal year the answer shows, with cautions, SEC links, the metrics not audited, and a link to the full audit. It is saved with the run and reappears when the thread is reopened; older runs show no review.

Tests: `NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-audit.ts`, `npx tsx scripts/try-research-audit.ts` (offline) and `NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/try-audit-live.ts NKE LULU 2024` (real SEC data and model).

## Team

| Step | Owner |
|---|---|
| Step 1: Foundation (Next.js, Supabase auth, database, placeholder API, base UI) | Yash |
| Step 2: The ReAct agent and its 4 tools (`lib/agent/`) | Pranav |
| Step 3: Stripe Pro upgrade and usage limits (`lib/usage.ts`, `lib/stripe.ts`, checkout and webhook routes) | Hans and Pranav |
| Steps 4 and 5: Frontend polish, QA, write-up, and slides | Forum and Reyn |

Stub files with a comment describing what each one should do are in `lib/agent/`, `lib/usage.ts`, `lib/stripe.ts`, `app/api/checkout/`, and `app/api/stripe/webhook/`.

## Docs

- [Product requirements (docs/PRD.md)](docs/PRD.md)
- [Architecture (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md)