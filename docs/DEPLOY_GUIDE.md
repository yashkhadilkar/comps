# DEPLOY_GUIDE.md: deploying Comps to Railway

Runbook for moving the work on `pranav-dev` to `main` and shipping it to the live Railway app.
Deployment owner: **Yash**. Last audited against the repository on **2026-10-21** at `pranav-dev` commit `aca579d`.

This guide sits below `CLAUDE.md`, `docs/SPEC.md` and `supabase/migrations/`. If it disagrees with them, they win.

**Live app:** https://comps-production-1543.up.railway.app (**Requires confirmation from Yash** that this is still the service's domain)
**Repo:** https://github.com/yashkhadilkar/comps
**Production branch:** `main`. Merging to `main` deploys to production.

Labels used below:
- **[repo]**: established by a file in this repository.
- **[dashboard]**: must be set by hand in Railway, Supabase or Stripe. The repo cannot enforce it.
- **Requires confirmation from Yash**: cannot be determined from the repository. Check it and don't assume.

---

## 0. Before you start

### 0.1 What is shipping

`origin/main` is still at Step 1 (`718807c` "README: live URL, clone URL, team steps"): auth, schema, a placeholder agent route and stubs. `pranav-dev` is **46 commits ahead and 0 behind** `origin/main`, so the merge has no conflicts. It adds:

- The ReAct research agent over SEC EDGAR XBRL with four tools, server-verified citations and a calculator for all arithmetic (`lib/agent/`).
- NDJSON streaming of the trace and of the answer as it is written (`app/api/agent/route.ts`, `lib/agent/runStream.ts`).
- Usage limits (Free: 3 successful questions in total, Pro: 25 per UTC day; `lib/plans.ts`, `lib/usage.ts`) and a one-time Stripe **test-mode** Pro upgrade (`lib/billing.ts`, `app/api/checkout`, `app/api/stripe/webhook`).
- Threads, research history and follow-up questions (`lib/threads.ts`, `lib/history.ts`, `/history`). These need **migration 002**.
- The standalone Comparability Audit (`/audit`, `app/api/audit/route.ts`, `lib/audit/`).
- The automatic **Comparability review** panel on answers that compare 2+ companies. It is stored inside `runs.trace` (jsonb), so it needs no schema change beyond 002.
- The Warm Neutral light theme with Geist Sans, and the Next.js dev indicator turned off (`devIndicators: false` in `next.config.ts`).

Check the numbers again before acting, because the branches may have moved:

```bash
git fetch origin
git rev-list --left-right --count origin/main...origin/pranav-dev   # expect "0 N". A non-zero left number means main moved: see 2.5
```

### 0.2 The order matters

```
A. Local readiness (validation on pranav-dev)                       you, locally
B. Supabase: migration 002 applied to the PRODUCTION project        MUST happen before step D
C. Railway variables complete (and Supabase Auth URLs, section 6)   Railway / Supabase dashboards
D. PR pranav-dev -> main reviewed and merged                        this triggers the deploy
E. Stripe test-mode webhook endpoint for the Railway URL            Stripe dashboard
F. Production smoke tests                                           curl + logged-in browser
G. Record the handoff                                               docs/BIG_AUDIT.md
```

**Why B must come before D:** the new `/api/agent` writes `runs.thread_id` and reads `threads`. Without them, saving runs fails. Saving is best-effort, so the user still gets an answer, but **no `runs` row is written**. Usage is counted from `runs` rows with `status = 'success'`, so Free users would never hit the limit. History, the sidebar and follow-ups would also break. Nothing fails visibly, so it must be prevented, not fixed afterward.

---

## 1. Architecture (verified)

**One Railway service.** The UI, API routes and agent all run in one Next.js 16 app. There is no separate backend, worker or agent service, and there is no service-to-service networking.

```
Browser ──HTTPS──> Railway edge ──> Next.js (next start, 0.0.0.0:$PORT)
                                       ├─ Supabase (Auth + Postgres)   external, HTTPS
                                       ├─ Anthropic API                external
                                       ├─ SEC EDGAR (data.sec.gov, www.sec.gov)
                                       ├─ Tavily (news search)
                                       └─ Stripe (test mode)  <── webhook POST /api/stripe/webhook
```

| Setting | Value | Source |
|---|---|---|
| Services | 1 (this repo, root directory `/`) | [repo] no monorepo, single `package.json` |
| Database | Supabase (hosted Postgres + Auth). **No Railway database service and no MongoDB.** | [repo] `lib/supabase/`, `supabase/migrations/` |
| Builder | Railway default Node detection | [repo] there is no `railway.json`, `railway.toml`, `nixpacks.toml`, Dockerfile or Procfile |
| Node | `22.x` | [repo] `package.json` `engines` |
| Install | `npm ci` (lockfile present) | [repo] `package-lock.json` |
| Build command | `npm run build` (runs `next build`) | [repo] `package.json` |
| Start command | `npm start` (runs `next start`) | [repo] `package.json` |
| Port | `next start` binds `0.0.0.0` and reads `PORT`, which Railway injects. **Do not set `PORT` yourself.** | [repo] Next CLI defaults |
| Branch | `main` auto-deploys | [dashboard] **Requires confirmation from Yash**: Service, Settings, Source shows the branch |
| Health check | None configured. Recommended path: `/login` (public, returns 200; `/` redirects logged-out users with a 307) | [dashboard] optional |
| Domain / HTTPS | Railway-generated `*.up.railway.app` domain. Railway terminates TLS at its edge; the app has no HTTPS config of its own | [dashboard] |
| Replicas | Keep at **1**. The SEC cache and the audit rate limit (10 per user per hour) live in process memory | [repo] `lib/agent/sec.ts`, `lib/audit/handler.ts` |
| App sleeping / serverless | Should be **off** for the demo, otherwise the first request after idle is slow and the SEC cache is cold | [dashboard] **Requires confirmation from Yash** |

### Streaming and long requests

- `/api/agent` streams NDJSON (`Content-Type: application/x-ndjson`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`). A run normally takes 30 to 60 seconds. The agent loop enforces its own limits: a 90-second soft deadline, a 115-second hard limit, at most 6 iterations (8 for "why" questions), and a 6-second bound for the comparability review.
- `export const maxDuration = 120` (agent) and `60` (audit) are only platform hints. **Railway does not enforce them.** The app's own timers do.
- Railway's edge has a maximum HTTP request duration (15 minutes according to Railway's networking-limits docs at the time of writing). That is well above these runs, so nothing needs configuring. If streams cut off at a fixed time, check that page: https://docs.railway.com/reference/public-networking
- A green health check only proves the server answers. It does not prove the database, the model, SEC or streaming work. Section 9 covers those.

---

## 2. Git: moving `pranav-dev` to `main`

Use a pull request. Never force-push, never `reset --hard`, and never rewrite `main`.

### 2.1 Check your local state

```bash
git branch --show-current          # note it
git status --short                 # must be empty; commit or stash your own work first (git stash push -m "pre-deploy")
git fetch origin
```

Never commit these, even if they appear: `.env.local` (ignored by `.env*`) and `supabase/*-backup-*.csv` (ignored, contain real user emails). Check:

```bash
git ls-files | grep -E '^\.env'    # must print only .env.example
git ls-files | grep -E 'backup.*\.csv'   # must print nothing
```

### 2.2 Inspect what will merge

```bash
git rev-list --left-right --count origin/main...origin/pranav-dev
git log --oneline origin/main..origin/pranav-dev
git diff --stat origin/main...origin/pranav-dev | tail -5
git diff --name-only origin/main...origin/pranav-dev | grep -E 'migrations|package|next.config|proxy|\.env'
```

Expected sensitive files: `supabase/migrations/002_add_threads.sql` (section 5), `package.json` / `package-lock.json`, `next.config.ts`, `.env.example`.

Secret scan of the diff:

```bash
git diff origin/main...origin/pranav-dev | grep -nE "sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|sb_secret_|sk-ant-|tvly-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}" || echo "no secrets found"
```

### 2.3 Pre-merge validation (run on a clean checkout of `pranav-dev`)

```bash
git switch pranav-dev && git pull --ff-only origin pranav-dev
node -v                 # should be v22.x to match Railway
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

Offline regression suites (no keys or network needed; these were all passing on 2026-10-21):

```bash
npx tsx scripts/try-history.ts
npx tsx scripts/try-stream.ts
npx tsx scripts/try-streaming.ts
npx tsx scripts/try-research-audit.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-usage.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-stripe.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-threads.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/try-audit.ts
```

`try-stripe` and `try-threads` fail with a `server-only` error if you leave out `NODE_OPTIONS=--conditions=react-server`. That is how the suite is invoked, not a product bug.

Optional, with real keys in `.env.local`: `npx tsx --env-file=.env.local scripts/check-env.ts` prints set/MISSING per variable and never prints values.

If anything fails, stop. Don't merge around a red check.

### 2.4 Open and merge the pull request

**Before merging, confirm sections 5 (migration 002) and 4 (Railway variables) are done.** Merging deploys.

```bash
gh pr create --base main --head pranav-dev --title "Ship Steps 2-3, threads, comparability audit, Warm Neutral UI" --body "See docs/DEPLOY_GUIDE.md section 0.1"
```

Or on GitHub: Pull requests, New, base `main`, compare `pranav-dev`.

Review the "Files changed" tab, then merge with **Create a merge commit**. That keeps the `pranav-dev` SHAs, and the merge can be reverted as a single commit (section 11). If GitHub shows conflicts, `main` moved: see 2.5.

### 2.5 If `main` moved and there are conflicts

Resolve them on `pranav-dev`, never on `main`:

```bash
git switch pranav-dev
git merge origin/main              # resolve conflicts in the editor, then:
git add <resolved files> && git commit
npm ci && npm run lint && npx tsc --noEmit && npm run build   # re-run 2.3
git push origin pranav-dev         # updates the PR
```

Never resolve by deleting a whole side. If a conflict touches `supabase/migrations/`, `lib/usage.ts` or `lib/agent/`, ask Pranav.

### 2.6 Verify `main` after the merge

```bash
git fetch origin
git log --oneline -3 origin/main                      # top commit: the merge of pranav-dev
git diff origin/pranav-dev origin/main --stat         # expect no output (identical trees)
git rev-parse --short origin/main                     # the SHA Railway should deploy
```

Then in Railway, Service, **Deployments**: the newest deployment must show this commit SHA and the `main` branch.

Afterward, bring `pranav-dev` up to date so the branches don't drift:

```bash
git switch pranav-dev && git merge --ff-only origin/main && git push origin pranav-dev
```

---

## 3. Railway configuration

Railway dashboard: Project, **comps** service.

1. **Settings, Source**: repo `yashkhadilkar/comps`, branch `main`, root directory empty or `/`. Auto-deploy on.
2. **Settings, Build**: leave the default builder. Leave the build command empty (Railway runs `npm run build`) or set it to `npm run build`. Node comes from `engines` (`22.x`).
3. **Settings, Deploy**: leave the start command empty (Railway runs `npm start`) or set it to `npm start`. Health check path (optional): `/login`. Replicas: 1. Serverless / app sleeping: off.
4. **Settings, Networking**: one public domain (generated or custom). No private networking is needed. With a custom domain, `NEXT_PUBLIC_APP_URL`, the Supabase Auth URLs (section 6) and the Stripe webhook URL (section 8) must all use that domain.
5. **Variables**: section 4.

Railway docs: https://docs.railway.com/guides/builds, https://docs.railway.com/guides/healthchecks, https://docs.railway.com/guides/public-networking

---

## 4. Environment variables

**Where they live.** Locally, values go in `.env.local`. It is ignored by git, never committed, and is **not** the production source of truth. In production, set every value in Railway, Service, **Variables**. Copy names from `.env.example`. Never paste values into chat, issues, PRs or docs.

**Build vs runtime.** Next inlines every `process.env.NEXT_PUBLIC_*` reference into **both** the browser and server bundles during `next build`. Those three variables must therefore exist **before** the build, and changing one requires a **redeploy (rebuild)**, not a restart. All other variables are read at request time, but Railway redeploys on any variable change anyway.

### 4.1 Inventory (every `process.env` reference in `app/`, `lib/`, `components/`, `proxy.ts`)

| Variable | Required? | Read in | Purpose | Production value source | Secret? | When |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | `lib/supabase/{client,server,proxy,admin}.ts` | Supabase project URL for auth, RLS queries and admin writes | Supabase, Project Settings, API, of the **production** project | No (public) | Build + runtime |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Required** | `lib/supabase/{client,server,proxy}.ts` | Acts as the logged-in user under RLS | Supabase, Project Settings, API Keys, publishable key | No (designed for the browser) | Build + runtime |
| `SUPABASE_SECRET_KEY` | **Required** | `lib/supabase/admin.ts` | Bypasses RLS to save runs, set Pro from the webhook, read usage | Supabase, API Keys, secret key | **Yes**. Server only, never `NEXT_PUBLIC_` | Runtime |
| `ANTHROPIC_API_KEY` | **Required** | read implicitly by `@anthropic-ai/sdk` (`lib/agent/loop.ts`, `lib/audit/interpret.ts`); checked in `app/api/audit/route.ts` | Agent model calls; the optional explanatory note on `/audit` | Anthropic Console, API keys. Use a key with a spend limit | **Yes** | Runtime |
| `LLM_MODEL` | Optional (defaults to `claude-haiku-5-5`) | `lib/agent/loop.ts`, `lib/audit/interpret.ts` | Model id for the agent and audit notes | `claude-sonnet-5-5` for the demo per `.env.example`. **Requires confirmation from Yash/Pranav**: most behavior was verified on Haiku | No | Runtime |
| `SEC_USER_AGENT` | **Required** | `lib/agent/sec.ts` | User-Agent on every SEC EDGAR request. Missing means every financial lookup fails; a bad value gets a 403 from SEC | `Your Name your.email@domain`, a real contact (SEC fair-access policy) | No, but it's a personal email | Runtime |
| `TAVILY_API_KEY` | Required for news / "why" questions | `lib/agent/tools/searchNews.ts` | News search tool. If unset, the tool returns "News search is not configured" and SEC-only questions still work | Tavily dashboard | **Yes** | Runtime |
| `STRIPE_SECRET_KEY` | Required for upgrades | `lib/stripe.ts` | Creates Checkout sessions and verifies webhooks. **Must start with `sk_test_`**: the code refuses live keys (PAY-001) | Stripe dashboard in **Test mode**, Developers, API keys | **Yes** | Runtime |
| `STRIPE_WEBHOOK_SECRET` | Required for upgrades | `app/api/stripe/webhook/route.ts` | Verifies webhook signatures. Unset makes the webhook return 500 | The signing secret of the **dashboard endpoint** in section 8. The local `stripe listen` secret will **not** work | **Yes** | Runtime |
| `NEXT_PUBLIC_APP_URL` | Required for upgrades | `lib/stripe.ts` (`getAppUrl`) | Base of the Stripe `success_url` / `cancel_url` (`/pricing?checkout=...`). A trailing slash is stripped | `https://<railway-domain>`, **never localhost** | No | **Build** + runtime |
| `UNLIMITED_USER_EMAILS` | **Dev/test only. Leave unset in production** | `lib/usage.ts` | Comma-separated emails exempt from usage limits | Not set | n/a | Runtime |
| `AGENT_STREAMING` | Optional kill switch. Leave unset | `lib/agent/loop.ts` | `off` disables progressive answer streaming (the trace still streams) | Not set | No | Runtime |
| `NODE_ENV` | Set by Next | `lib/agent/loop.ts` | `next build`/`next start` set `production`, which turns off token-usage logging | **Don't set** | No | n/a |
| `PORT` | Set by Railway | Next CLI | Listen port | **Don't set** | No | n/a |

Script-only variables (`scripts/`, never read by the app): `BASE` (`try-history-live.mjs`, `try-threads-live.mjs`) and `NO_AI` (`try-audit-live.ts`). Don't set them on Railway.

**`.env.example` check:** it lists all 11 app variables above, through `UNLIMITED_USER_EMAILS`. It leaves out only the optional `AGENT_STREAMING`, which is fine. There are no outdated entries.

**Browser exposure:** only the three `NEXT_PUBLIC_*` variables reach the browser, and none of them is a secret. `lib/supabase/admin.ts` and `lib/stripe.ts` import `server-only`, so importing them from client code fails the build. Never rename a secret to `NEXT_PUBLIC_*`.

### 4.2 Redacted template for Railway (Variables, Raw Editor)

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<prod-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase publishable key>
SUPABASE_SECRET_KEY=<supabase secret key>
ANTHROPIC_API_KEY=<anthropic key>
LLM_MODEL=claude-sonnet-5-5
SEC_USER_AGENT=<Full Name> <contact@email>
TAVILY_API_KEY=<tavily key>
STRIPE_SECRET_KEY=sk_test_<...>
STRIPE_WEBHOOK_SECRET=whsec_<from the dashboard endpoint>
NEXT_PUBLIC_APP_URL=https://<railway-domain>
# UNLIMITED_USER_EMAILS  -> do not set in production
```

To list the names set on Railway without printing values (Railway CLI, logged in): `railway variables --kv | cut -d= -f1`.

---

## 5. Supabase (database)

**This app uses Supabase Postgres, not MongoDB.** Nothing in the repo uses MongoDB or Atlas, so Atlas network access, TLS strings and collections don't apply. The client connects over HTTPS with `@supabase/supabase-js` using the URL and keys above. There is no connection string, no IP allowlist and no Railway networking to set up.

### 5.1 Schema

| Migration | Creates | Applied to production? |
|---|---|---|
| `001_init.sql` | `profiles` (plan, pro_since), `runs` (question, answer, trace jsonb, status, latency), RLS, signup trigger that creates a profile | Yes (Step 1, per README) |
| `002_add_threads.sql` | `threads` table and index, nullable `runs.thread_id`, backfill of one thread per existing run, RLS | **Requires confirmation from Yash** |

There is no migration runner. Migrations are applied by pasting them into the Supabase SQL Editor. There are no indexes or seed steps beyond what the migrations create. Comparability reviews are stored in `runs.trace.audit`, and standalone `/audit` results are not stored at all, so there is **no migration after 002**.

### 5.2 Which project is production?

The README describes a single "shared team project" used for both development and the live app. **Requires confirmation from Yash:**
- Does Railway's `NEXT_PUBLIC_SUPABASE_URL` point at the same project the team develops against? If so, test accounts, test runs and `scripts/try-*-live.mjs` temp users all land in production data. For the capstone that may be acceptable, but it is a deliberate choice, not a safe default.
- If you create a separate production project: run `001_init.sql`, then `002_add_threads.sql`, set its Auth URLs (section 6), and use its URL and keys in Railway. Existing dev accounts won't exist there.

### 5.3 Check whether 002 is applied (read-only)

In the SQL Editor of the project Railway uses:

```sql
select
  to_regclass('public.threads') is not null as threads_table,
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'runs' and column_name = 'thread_id') as runs_thread_id;
```

If both are `true`, skip 5.4.

### 5.4 Apply 002

1. Back up first: Table Editor, export `profiles` and `runs` to CSV. Keep the files **outside the repo**, or under `supabase/` where `*-backup-*.csv` is git-ignored. They contain user emails.
2. Make sure the SQL Editor is open on the project whose URL matches Railway's `NEXT_PUBLIC_SUPABASE_URL`.
3. Paste all of `supabase/migrations/002_add_threads.sql` and run it. It runs in one transaction, is safe to re-run, and briefly locks `runs`. It rolls back by itself if run counts change or any run is left without a thread.
4. Re-run the 5.3 query. Both values must be `true`.
5. Never edit an applied migration. Schema changes go in a new `003_*.sql` (`CLAUDE.md` section 4).

The currently deployed Step 1 code keeps working against the migrated schema because `thread_id` is nullable. Applying 002 before the merge is therefore safe.

### 5.5 Failure behavior

- Missing `NEXT_PUBLIC_SUPABASE_*`: the build may succeed, but every page request fails in `proxy.ts`. Look for Supabase errors in the runtime logs.
- Missing `SUPABASE_SECRET_KEY`, or the database unreachable during the usage check: `/api/agent` returns **500 before any model spend**. It fails closed and never lets an unmetered run through.
- Database failure when saving a finished run: the user still gets the answer, and the log shows `[api/agent]` save errors. That run won't appear in History and won't count toward usage.

### 5.6 Verify persistence

After one browser research run (section 9), in the SQL Editor:

```sql
select r.created_at, r.status, r.thread_id is not null as has_thread, (r.trace ? 'audit') as has_review
from public.runs r order by r.created_at desc limit 5;
```

The newest row must show `has_thread = true`, and `has_review = true` for a multi-company question.

---

## 6. Authentication (Supabase Auth, email + password)

How it works [repo]:
- `components/auth-form.tsx` calls `signInWithPassword` and `signUp`, with `emailRedirectTo: ${window.location.origin}/auth/confirm`.
- `app/auth/confirm/route.ts` accepts both the PKCE `code` and `token_hash` flows, then redirects to `/`. On failure it goes to `/login?error=confirm`.
- `proxy.ts` (Next 16's replacement for middleware) uses `lib/supabase/proxy.ts` to refresh the session cookie on every request. It redirects logged-out users to `/login`; public paths are `/login`, `/signup`, `/pricing` and `/auth/*`. API routes return their own JSON 401s.
- Cookies come from `@supabase/ssr` with its default options. There is no custom cookie domain, CORS or allowed-origins setting in the repo. Everything is same-origin.

Moving from localhost to Railway, in the Supabase dashboard [dashboard], Authentication, **URL Configuration** of the production project:

1. **Site URL**: `https://<railway-domain>`. If it still says `http://localhost:3000`, confirmation emails send users to localhost.
2. **Redirect URLs**: add `https://<railway-domain>/auth/confirm`, or `https://<railway-domain>/**`. Keep the localhost entries if the same project is used for development. If the origin passed in `emailRedirectTo` isn't allowlisted, Supabase falls back to the Site URL.
3. **Requires confirmation from Yash**: is "Confirm email" enabled (Authentication, Providers/Sign In, Email)? If so, signup on Railway depends on steps 1 and 2 and on Supabase's email sending limits.

Supabase docs: https://supabase.com/docs/guides/auth/redirect-urls

There is no `AUTH_SECRET` or `NEXTAUTH_*` variable. Session security comes entirely from Supabase.

---

## 7. LLM and SEC integrations

Preserve the existing behavior. Don't change the model, prompts or tools as part of deploying.

| Integration | Used by | What to check in production |
|---|---|---|
| Anthropic (`@anthropic-ai/sdk`) | Agent loop (60 s per model call, 1 SDK retry); `/audit` explanatory note (one bounded call). The comparability review inside research answers makes **no** model call | `ANTHROPIC_API_KEY` is valid, has credit and a spend limit; `LLM_MODEL` is a valid model id. A bad key shows as an error event in the stream and `[api/agent]` lines in the logs |
| SEC EDGAR (`data.sec.gov` companyfacts, `www.sec.gov` ticker list) | `lookup_ticker`, `get_financials`, the comparability audit | `SEC_USER_AGENT` = name + email. SEC allows about 10 requests/s per client; a few companies per question stays well under that. Responses are cached **in memory** (TTL, bounded), so the cache empties on every deploy or restart and the first question after a deploy is slower |
| Tavily | `search_news` | `TAVILY_API_KEY` is valid. News text is wrapped as untrusted data |
| Comparability audit | `lib/audit/` | Needs only SEC data, plus Anthropic for the optional `/audit` note. Rate limit: 10 audits per user per hour, in memory per process |

Railway needs outbound HTTPS to all of these. It has that by default, and nothing in the repo needs a proxy or allowlist.

---

## 8. Billing (Stripe, test mode only)

Repo evidence: `lib/stripe.ts` throws unless `STRIPE_SECRET_KEY` starts with `sk_test_` (PAY-001). It is a one-time $19 "Pro" Checkout. Pro is granted **only** by a verified webhook (`checkout.session.completed` or `checkout.session.async_payment_succeeded`, handled in `lib/billing.ts`). Repeated webhooks are idempotent. **Live payments are out of scope. Don't switch to live keys**; the code refuses them anyway.

Production webhook [dashboard], Stripe in **Test mode**:

1. Developers, Webhooks, **Add endpoint**: `https://<railway-domain>/api/stripe/webhook`.
2. Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
3. Copy the endpoint's signing secret (`whsec_...`) into Railway as `STRIPE_WEBHOOK_SECRET`. Railway redeploys.
4. The endpoint must belong to the same Stripe account as the `sk_test_` key.

Without this endpoint, test payments succeed in Stripe but the plan **never** flips to Pro (seen locally on 2026-10-21, BIG_AUDIT A13). If a payment happened before the endpoint existed, resend its event from Stripe, Events. That is safe because the handler is idempotent.

Usage limits (`lib/plans.ts`): Free = 3 successful questions in total, Pro = 25 per UTC day. Only `status = 'success'` runs count. Clarifications, declines, errors and `/audit` runs don't.

Stripe docs: https://docs.stripe.com/webhooks

---

## 9. Deploy and verify

### Phase A: Local readiness
1. Section 2.1 and 2.3 pass on `pranav-dev`.

### Phase B: Merge preparation
2. Section 2.2 reviewed, and secret scan clean.
3. Section 5.3 shows 002 applied (or you applied it with 5.4).

### Phase C: Railway configuration
4. Section 3 settings checked.
5. Section 4 variables set. All `NEXT_PUBLIC_*` must exist **before** the merge triggers the build.
6. Section 6 Supabase Auth URLs set.

### Phase D: Deploy
7. Merge the PR (2.4). Railway starts a deployment from `main`.
8. **Build logs**: `npm ci`, then `next build` ending with the route table (`/`, `/api/agent`, `/api/audit`, `/api/checkout`, `/api/stripe/webhook`, `/audit`, `/auth/confirm`, `/history`, `/history/[id]`, `/login`, `/pricing`, `/signup`). `next/font/google` downloads Geist at build time, so the build needs outbound network access, which Railway has.
9. **Runtime logs**: `next start` prints `Ready`. There should be no errors at startup.
10. Confirm the deployment's commit SHA equals `git rev-parse --short origin/main` (2.6).
11. Create the Stripe endpoint (section 8) and let Railway redeploy with `STRIPE_WEBHOOK_SECRET`.

### Phase E: Production smoke tests

**Automated (curl, no login):**

```bash
URL=https://<railway-domain>
curl -s -o /dev/null -w "login %{http_code}\n"   $URL/login                       # 200
curl -s -o /dev/null -w "signup %{http_code}\n"  $URL/signup                      # 200
curl -s -o /dev/null -w "pricing %{http_code}\n" $URL/pricing                     # 200
curl -s -o /dev/null -w "home %{http_code}\n"    $URL/                            # 307 -> /login
curl -s -o /dev/null -w "agent %{http_code}\n"   -X POST $URL/api/agent -H 'content-type: application/json' -d '{}'   # 401
curl -s -o /dev/null -w "audit %{http_code}\n"   -X POST $URL/api/audit -H 'content-type: application/json' -d '{}'   # 401
curl -s -o /dev/null -w "checkout %{http_code}\n" -X POST $URL/api/checkout       # 401
curl -s -o /dev/null -w "webhook %{http_code}\n" -X POST $URL/api/stripe/webhook -d '{}'                                # 400 (no signature)
curl -s -o /dev/null -w "webhook-bad %{http_code}\n" -X POST $URL/api/stripe/webhook -H "stripe-signature: t=1,v1=bad" -d '{}'   # 400
```

A 500 from the webhook means `STRIPE_WEBHOOK_SECRET` is unset. A 500 or a redirect loop on `/login` points to the Supabase variables.

**Browser (logged in).** Use a **new test account**, not a teammate's real one. Use a browser with DevTools open (Console and Network tabs). Use these prompts. The first four are the app's built-in example questions in `components/ask-form.tsx`:

| # | Prompt | Expected |
|---|---|---|
| P1 | `Compare Nike and Under Armour's revenue, operating income and net income` | Streams the trace, then a cited table. **Comparability cautions** panel above the answer (Nike reports no operating income line, so expect at least one caution). "View detailed audit" links to `/audit?a=NKE&b=UAA&period=...` |
| P2 | `Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years` | 3-company table, margins computed by the calculator, each figure cited, comparability panel shown |
| P3 | `How has Deckers' revenue and operating income grown since 2020?` | Single company: **no** comparability panel |
| P4 | A follow-up in the same thread, e.g. `What about net income?` after P1 | Stays in the same thread, and earlier turns remain visible |
| P5 | `Should I buy Nike stock?` | Declined (no buy/sell calls), and doesn't count as usage |
| P6 | `Compare XYZQ and Nike revenue` | Clear "unknown company" handling, no invented figures |

That is 4+ successful questions, so with a single Free account you will hit the 3-question limit partway through. That doubles as the limit test (checklist below). Then upgrade and continue.

Checklist:

- [ ] `/login` renders the Warm Neutral light theme (warm off-white background, no dark theme) in Geist Sans (DevTools, Elements, computed `font-family` resolves to Geist)
- [ ] No Next.js dev indicator in the bottom-left corner
- [ ] Sign up works. If email confirmation is on, the link lands on `<railway-domain>/auth/confirm` and logs you in (not localhost)
- [ ] Log out and log back in works, and protected pages redirect to `/login` when logged out
- [ ] P1: trace steps appear live, answer prose streams in, and the run finishes in under ~60 s (note the time and `LLM_MODEL`)
- [ ] Citations: every figure links to an SEC filing, and the sources list renders
- [ ] Comparison tables render without horizontal page scroll (check at phone width too)
- [ ] P1/P2 show the comparability panel; P3 does not
- [ ] Panel states seen where applicable: "Comparability cautions" (with issues), "Comparability review" (clean), "Comparability review unavailable" (SEC timeout; the answer is still shown)
- [ ] "View detailed audit" opens `/audit` with both tickers and the period filled in, and the audit runs
- [ ] `/audit` directly: e.g. NKE vs LULU 2024 returns statuses, 10-K links and a Markdown export
- [ ] Reload the page: the thread and its comparability panel come back. `/history` lists it, and opening it from History works
- [ ] P4 follow-up continues the thread. Old threads from before the deploy still open (those runs show no review, as designed)
- [ ] The 4th successful question on Free is refused with the upgrade panel (HTTP 402 in the Network tab). **If it is not refused, stop**: run saving or migration 002 is broken (section 5.6)
- [ ] Upgrade: card `4242 4242 4242 4242`, any future date, any CVC. You return to `/pricing?checkout=success`, "Confirming your upgrade" changes to "Upgrade complete" within ~30 s, and the badge shows Pro after a reload
- [ ] Cancelling checkout leaves the plan Free, and the page says checkout was cancelled
- [ ] Section 5.6 query shows the new rows with `has_thread` and `has_review`
- [ ] No red errors in the browser console. Railway runtime logs show no unexpected `[api/agent]`, `[api/audit]`, `[stripe/webhook]` or `[auth/confirm]` errors

### Phase F: Handoff

Record in `docs/BIG_AUDIT.md` (a new audit-log entry, committed on `pranav-dev` and merged later through another PR):
- the deployed commit SHA and Railway deployment id, and the service URL
- whether 002 was already applied or applied now (date, by whom), and which Supabase project is production
- which checklist items passed, which failed, and which were **NOT RUN**
- which A13 pending items are now closed
- outstanding issues, and who owns Railway, Supabase, Stripe, Anthropic and Tavily access from now on

---

## 10. Troubleshooting

| Symptom | Likely cause | Verify | Fix |
|---|---|---|---|
| Build fails at install | Node version mismatch, lockfile out of sync | Build log `node -v`; `npm ci` locally on Node 22 | Fix on `pranav-dev`, open a new PR |
| Build fails at type check / compile | Code error not caught locally | Run `npm run build` locally on the merged SHA | Fix on `pranav-dev`; roll back meanwhile (section 11) |
| Build fails fetching fonts | Build has no network access to Google Fonts | Build log mentions `next/font` | Redeploy. If it keeps failing, **Requires confirmation from Yash** (Railway build network) |
| Deploy "succeeds" but the URL shows Railway's "Application failed to respond" | Wrong start command, or `PORT` overridden | Runtime log shows `Ready on ...:<port>` | Clear the custom start command and remove any `PORT` variable |
| Every page errors or loops to `/login` | `NEXT_PUBLIC_SUPABASE_*` missing or wrong at build time | Runtime logs; Variables tab | Fix the variables, then **redeploy** (rebuild) |
| Signup confirmation link opens localhost or fails | Supabase Site URL / Redirect URLs not updated | Look at the link in the email | Section 6 |
| Logged in but `/api/agent` returns 500 immediately | `SUPABASE_SECRET_KEY` missing, or Supabase unreachable | Logs show `[api/agent]` with a Supabase error | Set the key; check the Supabase project status |
| Answers work but History is empty and limits never trigger | Migration 002 not applied; runs fail to save | Section 5.3 and 5.6 queries; `[api/agent]` save errors | Apply 002 (5.4). Runs from before the fix are not recoverable |
| Every question errors with SEC 403 / "SEC_USER_AGENT is not set" | `SEC_USER_AGENT` missing or not `Name email` | Trace shows a tool error | Set it correctly |
| Model errors (401/404/overloaded) | Bad `ANTHROPIC_API_KEY`, invalid `LLM_MODEL`, no credit | Error event in the stream; Anthropic Console usage | Fix the key or model; remove `LLM_MODEL` to fall back to the default |
| News / "why" questions say news is unavailable | `TAVILY_API_KEY` missing or invalid | Trace `search_news` step | Set the key |
| Stream stalls, then the whole answer arrives at once | A proxy or extension is buffering | Network tab: response arrives in one chunk | The route already sends `no-transform` and `X-Accel-Buffering: no`. Try another network or browser. `AGENT_STREAMING=off` is a last-resort fallback for answer text only |
| Stream ends with an error near 90 to 115 s | Agent deadline hit (by design) | Trace length; latency | Expected for very broad questions; ask a narrower one |
| No comparability panel on a multi-company answer | Answer didn't validate as a 2+ company comparison, or the review hit its 6 s bound and returned "unavailable" | `runs.trace.audit` for that run; logs show `[api/agent] audit failed` | The answer is unaffected. Retry; check SEC reachability |
| `/audit` returns 429 | 10 audits per user per hour reached (resets on restart) | Response `code: AUDIT_RATE_LIMIT` | Wait, or use another test user |
| Payment succeeds but the plan stays Free | Webhook endpoint missing, wrong URL, or wrong secret | Stripe, Webhooks, endpoint deliveries: 400 = wrong secret, 500 = env/DB, none = wrong URL or events | Section 8; resend the event |
| Checkout redirects to localhost | `NEXT_PUBLIC_APP_URL` wrong at build time | Look at the redirect URL | Fix it and **redeploy** |
| Works locally, fails on Railway | Local `.env.local` has a variable Railway lacks; different Supabase project; Node 26 locally vs 22 | `railway variables --kv \| cut -d= -f1` vs `.env.example`; `check-env.ts` | Align the variables and Node version |

---

## 11. Rollback

**Application rollback (preferred, no git changes):** Railway, Service, **Deployments**. Find the last deployment that worked (note its SHA beforehand, in Phase F of the previous deploy), open its menu and choose **Redeploy**/**Rollback**. That restores the old image with its build-time variables. Then re-run the curl checks and a login. Railway docs: https://docs.railway.com/guides/deployments

**Git rollback (only if `main` itself must stop containing the change):** open a PR that reverts the merge commit. Never reset or force-push `main`.

```bash
git switch -c revert-deploy origin/main
git revert -m 1 <merge-commit-sha>
git push origin revert-deploy      # then open a PR into main; merging it deploys the revert
```

To re-ship later, revert the revert. A plain re-merge of `pranav-dev` won't bring the changes back.

**Database limits:** migration 002 is additive (a new table plus a nullable column), so old code runs fine against it. **Do not drop `threads` or `runs.thread_id` during a rollback.** Rows written by the new code stay valid, and the old Step 1 code ignores them.

**Variables:** this release adds variables but renames none, so the old build tolerates the new ones. If you changed a `NEXT_PUBLIC_*` value, remember that a rollback deploys the old image with the old inlined value.

**Communicate:** tell the team which SHA is live, why you rolled back, and what is broken. Then investigate on `pranav-dev` locally (or in a separate Railway environment if one exists: **Requires confirmation from Yash**), not on production.

---

## 12. Security and hygiene

- Production secrets live only in Railway Variables. Never in git, chat, screenshots, PR text or logs. `.env*` is git-ignored except `.env.example`. Keep it that way.
- Only the three `NEXT_PUBLIC_*` variables may reach the browser, and none of them may hold a secret. `SUPABASE_SECRET_KEY` bypasses all RLS: treat it like a database root password.
- Restrict access to Railway, Supabase, Stripe, Anthropic and Tavily to the people who need it. Put a spend limit on the Anthropic key.
- Keep Stripe in test mode (enforced in code). Don't create live keys for this project.
- Don't set `UNLIMITED_USER_EMAILS` in production.
- Supabase backup CSVs contain user emails. Keep them out of the repo (they are git-ignored under `supabase/`) and delete them when you're done.
- Keep production and development data separate where you can (section 5.2). Don't run `scripts/try-*-live.*` against production.
- The app logs error messages, not secrets or request bodies. Don't add logging of keys or tokens while debugging.

---

## 13. Known gotchas

- **Merge = deploy.** Never push directly to `main`.
- **Migration before code** (0.2). In the wrong order, usage limits are silently disabled.
- **`NEXT_PUBLIC_*` are build-time**, on the server too. Fix them, then rebuild.
- **The webhook secret depends on the source:** the `stripe listen` secret is local only; Railway needs the dashboard endpoint secret.
- **In-memory state** (SEC cache, audit rate limit) resets on every deploy or restart and isn't shared across replicas.
- **`maxDuration` is only a hint** on Railway. The agent enforces its own 90 s / 115 s limits.
- **Duplicate checkouts:** two open checkout sessions can both be paid before the first webhook arrives (BIG_AUDIT A7). Harmless in test mode.
- **Local Node may differ:** `engines` says 22.x; validate on Node 22 before merging.
