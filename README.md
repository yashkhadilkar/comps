# Comps

Comps benchmarks a public company against its peers over several years. You ask a question in plain English ("Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years"). A ReAct agent pulls the numbers from SEC filings, does all the math in a calculator tool, and answers with every figure cited to its filing. It's built for medium to long-term investors and in-house corporate analysts.

**Live demo:** https://comps-production-1543.up.railway.app

## What it does

- **Cited research answers.** The agent looks up tickers, fetches multi-year XBRL financials from SEC EDGAR, computes margins and growth through a `calculate` tool, and returns a structured answer: prose, tables, sources and suggested follow-ups. Every figure maps to a retrieved citation. Unknown citation keys are dropped on the server.
- **Streaming.** `/api/agent` streams NDJSON. The trace of tool calls appears live, then the answer prose, table rows, sources and follow-ups stream in as they are written.
- **"Why?" questions.** Driver questions ("Why did Nike's margin fall?") use SEC data first, plus a news search tool (Tavily) whose text is treated as untrusted data.
- **Threads and history.** Each question starts a thread, and follow-ups continue it with bounded context from earlier turns. `/history` lists past threads, and reopening one restores every turn.
- **Financial Comparison Integrity.** An answer that compares two or more companies gets a deterministic review (no model call) for the newest fiscal year every company reports, shown below the completed answer. Each metric is rated **Reliable to compare**, **Compare with caution** or **Insufficient evidence** (internally `READY` / `REVIEW` / `BLOCKED`) from explicit checks: source evidence, currency, fiscal period alignment and length, XBRL concept, formula, revision signals from earlier filings and, for multi-year answers, each company's own annual series (gaps, fiscal year-end transitions, 53-week years, concept changes). Metrics with the same verdict are grouped, each finding is stated once with a next step and SEC links, and multi-year findings are kept separate from the audited year. The review is saved with the run and links to the full audit.
- **Comparability Audit (`/audit`).** A standalone two-company check for revenue, operating income, operating margin and net income. Each metric gets one of `COMPARABLE`, `ADJUSTED`, `PARTIALLY_COMPARABLE`, `NOT_COMPARABLE` or `INSUFFICIENT_EVIDENCE`, plus a separate readiness (same three labels) with check-by-check findings, source basis (reported, derived, unavailable), coverage limits and a next step, with 10-K links, formulas, caveats, a review checklist and a Markdown export.
- **Plans and usage.** Free: 3 successful questions in total. Pro: 25 per UTC day. A one-time $19 Pro upgrade runs through Stripe Checkout in **test mode** only.
- **Guardrails.** At most 6 agent iterations (8 for "why" questions), a 90-second deadline, tool timeouts with one retry, and no invented metrics or years. Buy/sell/hold calls and price predictions are declined.

## Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS 4): UI, API routes and the agent in one app. Request interception lives in `proxy.ts` (Next 16's replacement for `middleware.ts`).
- **Supabase**: auth (email + password) and Postgres with row-level security.
- **Anthropic Claude** via `@anthropic-ai/sdk`: the agent's model, set by `LLM_MODEL` (default `claude-haiku-5-5`).
- **SEC EDGAR** (XBRL company facts) and **Tavily** (news): data for the agent's tools.
- **Stripe** (test mode): the Pro upgrade, granted only by a verified webhook.
- **Railway**: hosting, as one service (`npm run build`, then `npm start`). `main` auto-deploys.
- UI: Warm Neutral light theme, Geist Sans and Geist Mono via `next/font`.

## How a question flows

```
Browser ── POST /api/agent ──> auth (Supabase session) -> validate -> thread ownership -> usage check (402 if over limit)
                                └─> runAgent (lib/agent/loop.ts): model <-> tools, up to 6 iterations / 90 s
                                      tools: lookup_ticker, get_financials (SEC), calculate, search_news (Tavily), final_answer
                                └─> server-side citation verification
                                └─> integrity review for 2+ companies (lib/audit/research.ts + integrity.ts, 6 s bound, no model)
                                └─> save run to Supabase `runs` (best-effort), touch thread
        <── NDJSON stream: step / answer_delta / answer_extras / audit / final / error events
```

The Pro upgrade: `/pricing` calls `POST /api/checkout`, which creates a Stripe Checkout session. Stripe then calls `POST /api/stripe/webhook`, where the signature is verified and `profiles.plan` is set to `pro`. The checkout route itself never grants Pro.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DESIGN.md](docs/DESIGN.md).

## Repo structure

```
app/
  page.tsx                  research workspace (home)
  history/, history/[id]/   thread list and a saved thread
  audit/                    Comparability Audit page
  pricing/                  plans, upgrade, checkout return states
  login/, signup/, auth/confirm/   Supabase auth pages and email-confirm handler
  api/agent/                streaming research endpoint (NDJSON)
  api/audit/                comparability audit endpoint (JSON)
  api/checkout/             creates a Stripe Checkout session
  api/stripe/webhook/       verified Stripe webhook -> Pro
components/
  research/                 composer, answer tables, citations, sources, follow-ups, turn result (answer, then integrity panel)
  audit/                    audit workspace
  history/, billing/, layout/ (sidebar, top bar), ui/ (icons)
  ask-form.tsx, answer-view.tsx, agent-trace.tsx, auth-form.tsx
lib/
  agent/                    loop, prompt, streaming, SEC client + cache, clarification, tools/
  audit/                    retrieve, engine, integrity checks + readiness reducer, research-answer review, model notes,
                            Markdown report and display labels, handler
  supabase/                 browser, server, proxy and admin (secret key, server-only) clients
  usage.ts, plans.ts        usage limits (counted from successful runs)
  stripe.ts, billing.ts     Stripe client (test keys only), checkout and webhook logic
  threads.ts, history.ts    threads, follow-up context, history queries
supabase/migrations/        001_init.sql, 002_add_threads.sql (applied by hand in the SQL editor)
scripts/                    try-*.ts test and smoke scripts, check-env.ts
eval/                       expectations.json, cases.json, README.md (gates)
docs/                       PRD, SPEC, ARCHITECTURE, DESIGN, BIG_AUDIT, step plans, DEPLOY_GUIDE
proxy.ts                    session refresh and redirect to /login for protected pages
```

## Local setup

Requires **Node 22** (see `engines` in `package.json`).

1. Clone and install:
   ```bash
   git clone https://github.com/yashkhadilkar/comps.git
   cd comps
   npm install
   ```
2. Copy the env template and fill in your keys. Teammates: ask Yash for the shared dev keys (sent privately, never in the group chat). Never commit `.env.local`.
   ```bash
   cp .env.example .env.local
   ```
3. Database: in your Supabase project, open **SQL Editor** and run [`001_init.sql`](supabase/migrations/001_init.sql), then [`002_add_threads.sql`](supabase/migrations/002_add_threads.sql), in that order. If you're using the shared team project, check whether they're already applied (see [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md) section 5.3). Never edit an applied migration; add a new numbered file instead.
4. Supabase Auth, URL Configuration: add `http://localhost:3000/auth/confirm` to the Redirect URLs if email confirmation is on.
5. Start the dev server and open http://localhost:3000:
   ```bash
   npm run dev
   ```

### Testing payments locally (Stripe test mode)

The Stripe CLI must use the **same Stripe account** as `STRIPE_SECRET_KEY` in `.env.local`:

```bash
brew install stripe/stripe-cli/stripe
STRIPE_KEY=$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2-)
stripe listen --api-key "$STRIPE_KEY" --print-secret          # put this whsec_... in .env.local as STRIPE_WEBHOOK_SECRET
stripe listen --api-key "$STRIPE_KEY" \
  --events checkout.session.completed,checkout.session.async_payment_succeeded \
  --forward-to localhost:3000/api/stripe/webhook               # leave running
```

Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` and restart `npm run dev`. Then use a fresh account, reach the Free limit, upgrade on `/pricing` with card `4242 4242 4242 4242` (any future date, any CVC), and confirm the badge shows Pro.

## Environment variables

Locally these go in `.env.local`. In production they go in Railway, under the service's **Variables**. The full production table is in [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md) section 4.

| Variable | Required | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (inlined at build time) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key, used by the browser and server as the logged-in user |
| `SUPABASE_SECRET_KEY` | Yes | Server only. Bypasses row-level security for writes users can't do themselves (saving runs, upgrading to Pro) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for the agent and the audit page's notes |
| `LLM_MODEL` | No | Model id. Defaults to `claude-haiku-5-5`, the model most behavior was verified on. `claude-sonnet-5-5` also works |
| `SEC_USER_AGENT` | Yes | User-Agent for SEC EDGAR. SEC requires a name and email (`Name email@domain`) |
| `TAVILY_API_KEY` | For news | News search tool. Without it, SEC-only questions still work |
| `STRIPE_SECRET_KEY` | For upgrades | Stripe **test** key. The code refuses anything not starting with `sk_test_` |
| `STRIPE_WEBHOOK_SECRET` | For upgrades | Verifies webhook signatures. The `stripe listen` secret locally, the dashboard endpoint secret on Railway |
| `NEXT_PUBLIC_APP_URL` | For upgrades | Public base URL for the Stripe success/cancel redirects (inlined at build time) |
| `UNLIMITED_USER_EMAILS` | Dev only | Comma-separated test accounts exempt from limits. Never set it in production |

Check which are set without printing values: `npx tsx --env-file=.env.local scripts/check-env.ts`.

## Testing

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Offline suites (no keys or network):

```bash
npx tsx scripts/try-history.ts
npx tsx scripts/try-stream.ts
npx tsx scripts/try-streaming.ts
npx tsx scripts/try-research-audit.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-usage.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-stripe.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-threads.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-audit.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-integrity.ts
npx tsx scripts/try-integrity-render.tsx
```

Live checks (real keys, network and model spend):

```bash
npx tsx --env-file=.env.local scripts/try-agent.ts "Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years"
npx tsx --env-file=.env.local scripts/try-edge.ts
NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/try-audit-live.ts NKE LULU 2024
```

The full gate order and what "done" means are in [eval/README.md](eval/README.md). Build status, test history and open risks are in [docs/BIG_AUDIT.md](docs/BIG_AUDIT.md).

## Deployment

`main` auto-deploys to Railway, so **merging to `main` is a production deploy**. Work happens on feature branches (currently `pranav-dev`) and reaches `main` through a reviewed pull request. Before merging, migration 002 must be applied to the production Supabase project, the Railway variables must be set, and the Stripe test-mode webhook endpoint must exist. The step-by-step runbook, smoke tests, troubleshooting and rollback are in [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md).

## Known limitations

- Comparability results are an evidence-backed review, not a statutory audit. They cover annual 10-K US GAAP facts in USD only (no FX conversion, non-GAAP, segments or IFRS filers). Periods are matched to the nearest fiscal year-end, not recalendarized. Companies with no operating income fact in SEC Company Facts (for example Nike) get `INSUFFICIENT_EVIDENCE` rather than an estimate. Readiness covers only the listed checks: "Reliable to compare" does not mean accounting policies are equivalent (never assessed), revision signals cover only the audited year under the same XBRL concept and do not establish why a value changed, and the research answer text is not rewritten by the review (it streams first; the panel below it says which comparisons are supported).
- The SEC data cache and the audit rate limit (10 per user per hour) are in memory, so they reset on every deploy or restart and aren't shared across replicas.
- Research answers don't count clarifications, declines or errors as usage. Audits never count against research questions.

## Docs

Read in this order when changing code (see [CLAUDE.md](CLAUDE.md)):

- [CLAUDE.md](CLAUDE.md): implementation contract and authority order
- [Product requirements (docs/PRD.md)](docs/PRD.md)
- [Behavioral spec (docs/SPEC.md)](docs/SPEC.md)
- [Architecture (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md)
- [Design (docs/DESIGN.md)](docs/DESIGN.md)
- [Build status and audit log (docs/BIG_AUDIT.md)](docs/BIG_AUDIT.md)
- [Deployment runbook (docs/DEPLOY_GUIDE.md)](docs/DEPLOY_GUIDE.md)
- Step plans: [step2](docs/step2-plan.md), [step3](docs/step3-plan.md), [step4](docs/step4-plan.md), [step5](docs/step5-plan.md)
- Feature plans: [threads](docs/THREADS_CONTINUATION_PLAN.md), [research history](docs/RESEARCH_HISTORY_PLAN.md), [driver analysis](docs/ANALYST_DRIVER_ANALYSIS_PLAN.md), [comparability audit sprint](docs/COMPS_AUDIT_SPRINT.md), [comparison integrity V2](docs/COMPS_COMPARISON_INTEGRITY_V2.md)
- [Agent notes (docs/agent-notes.md)](docs/agent-notes.md), [eval gates (eval/README.md)](eval/README.md)
