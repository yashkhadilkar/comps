# DESIGN.md — Comps

This is the implementation design, not a restatement of the PRD. It answers the questions a coding agent or new teammate needs before changing the system.

## Components

### 1. Browser / Next.js pages
Runs in the user's browser. Owns presentation and browser interaction: login/signup UI, ask form, streaming trace display, final answer rendering, pricing/upgrade UI, and plan/usage display.

It does **not** own financial truth, plan truth, payment truth, or privileged database writes.

### 2. Next.js API routes
Runs server-side in the same Railway service.

Important routes:
- `/api/agent` — auth/validation/usage gate, then streams the agent run and persists it
- `/api/checkout` — creates a Stripe Checkout session for the authenticated user
- `/api/stripe/webhook` — verifies Stripe and updates the user's plan

These routes are trust boundaries. The browser may request actions, but the server decides what is allowed.

### 3. Agent loop (`lib/agent/`)
Runs server-side inside the Next.js service. Owns the model conversation, bounded ReAct loop, tool selection/execution, trace production, structured termination, and error-to-agent behavior.

The loop does **not** directly render UI or mutate a user's plan.

### 4. Agent tools
Server-side functions with narrow jobs:
- `lookup_ticker` — identify SEC company/CIK/ticker
- `get_financials` — retrieve normalized annual SEC facts
- `calculate` — arithmetic only
- `search_news` — optional external context
- `final_answer` — typed termination contract, not a research source

### 5. Citation registry
Ephemeral per-run state. It maps only retrieved citation keys to server-known source metadata. It exists so a model cannot create a source by inventing a URL/key.

### 6. Supabase
Authoritative state for:
- authenticated identity
- profile plan
- Pro start timestamp
- persisted run history used for usage counting

RLS protects user-scoped reads. The secret/admin client is server-only.

### 7. Stripe
Authoritative payment event source for the one-time Pro test purchase. Checkout redirect is UX; the verified webhook is entitlement authority.

### 8. SEC EDGAR
Authoritative source for the core financial figures and company identity in the current product scope.

### 9. Tavily
Non-authoritative explanatory/news context. It may fail without making SEC-based fundamental analysis impossible.

### 10. Railway
One deployment boundary containing pages, API routes, and agent code. It supplies environment variables and the public URL.

## Responsibilities

### Browser
May:
- collect user input
- display progress and results
- start checkout

May not:
- decide usage eligibility
- set `plan`
- hold privileged keys
- manufacture citation URLs
- perform core financial calculations

### `/api/agent`
Only this entry path should:
- authenticate the ask
- validate the question
- check usage before model spend
- start the stream
- persist the resulting run

It should not reimplement agent reasoning; that belongs in `lib/agent/`.

### Agent loop
Only the loop decides which research tool to call next. Tools themselves do not recursively decide the research strategy.

The loop is responsible for termination, iteration/deadline boundaries, and presenting tool errors back to the model.

### Tools
Each tool is deterministic/narrow relative to the model:
- ticker tool identifies
- financial tool retrieves/normalizes
- calculator computes
- news searches
- final-answer tool structures output

No tool should silently "help" by doing another tool's job.

### Supabase admin client
Used only where server authority is needed, such as run persistence or plan update. Ordinary browser clients must not gain the same privilege.

### Stripe webhook
Only the verified webhook grants the Pro entitlement. The success page may poll/refetch profile state; it never flips plan itself.

## Communication

### Browser → Next.js
Normal HTTPS/fetch.

For `/api/agent`, the response is NDJSON over a streaming `ReadableStream`. NDJSON is used because the browser needs ordered typed events during a long-running request without adding a second realtime service.

Pre-stream failures use normal JSON + HTTP status.

### Agent loop → Claude
Anthropic Messages API with tools. The conversation history contains tool uses/results. Stable prompt/tool definitions are kept cache-friendly.

Provider failure returns an explicit failed result; it is not converted to an empty success.

### Agent loop → tools
In-process function calls. Independent tool calls may run in parallel. The executor owns timeout/retry behavior so individual tools do not each reinvent loop resilience.

### Tools → SEC/Tavily
Outbound HTTPS with timeouts.
- SEC requests include the required User-Agent.
- Tavily results are wrapped as untrusted content.

### Server → Supabase
Server-side client for authoritative writes; user-scoped client/session for identity and ordinary access.

If run persistence fails after a valid answer has been produced, the answer is still sent. The logging failure is operational, not a reason to erase useful work from the user.

### Server → Stripe
Checkout route creates a server-side session. Stripe later calls the webhook independently. This means the browser can close after payment and the entitlement can still be processed.

## State

### Authoritative
- Supabase Auth user id
- `profiles.plan`
- `profiles.pro_since`
- `runs` rows
- Stripe's signed completed checkout event as the payment trigger
- SEC returned filing facts for financial source data

### Ephemeral per request
- agent conversation
- trace before persistence
- citation registry
- tool call results

### Cache
- SEC ticker list cache
- SEC company facts cache

The cache is disposable. A Railway restart may lose it without losing product state.

### Usage consistency
Usage is derived from successful rows already present in `runs`.

This intentionally favors simplicity over strict concurrent reservation. Two simultaneous requests near the limit could both start before either run is persisted. For this capstone, document that race as production hardening rather than introducing a new quota subsystem days before demo.

### Payment consistency
The browser may return from Stripe before Supabase has been updated by the webhook. The UI should tolerate a short "confirming upgrade" state and refetch authoritative profile state rather than treating the redirect as proof.

## Trade-offs

### Threads vs runs (Threads / Continuation)
`threads` groups `runs`; `runs` keeps `user_id`, `status` and all usage semantics, so quotas are unchanged. `runs.thread_id` is nullable (older deployed code and the migration transition) and has no cascade so deleting a thread can never erase usage history. Writes use the admin client, which bypasses RLS, so ownership is enforced in `lib/threads.ts` with explicit `user_id` filters; the FK alone does not stop a cross-user association. Prior context is built deterministically (no summarizer model), capped at 3 runs, and passed inside the first user message so the system prompt stays constant for caching; it is declared non-evidence.

### 1. One Railway service instead of split frontend/agent services
Chosen for:
- one deploy
- one env-var boundary
- no CORS between the UI and agent
- easier capstone operations

Given up:
- independent scaling
- stronger process isolation
- dedicated worker lifecycle for long agent runs

This is reasonable for a class demo where simplicity and reliability dominate scale.

### 2. ReAct loop instead of a fixed pipeline
Chosen because questions need different sequences of lookup, retrieval, calculation, and optional context.

Given up:
- perfectly predictable latency/cost
- fixed deterministic step ordering

The bounds (iteration limit, deadline, tool contracts) are what make this acceptable.

### 3. SEC structured facts instead of PDF/10-K RAG
Chosen for:
- numeric reliability
- easier multi-year normalization
- direct filing citations
- less context cost

Given up:
- qualitative disclosure analysis
- broad footnote/narrative coverage
- non-US-company breadth

### 4. Server-verified citation registry instead of trusting model URLs
Chosen because citation fabrication is unacceptable in a financial product.

Given up:
- some flexibility in ad hoc sourcing

This is a deliberate reliability constraint.

### 5. Count usage from `runs` instead of a mutable counter
Chosen because there is one source of truth and failed runs naturally do not count.

Given up:
- strict concurrency control at the quota boundary
- cheap constant-time counter reads at very high volume

### 6. One-time Pro upgrade instead of subscriptions
Chosen for demo simplicity and a complete payment lifecycle in limited time.

Given up:
- realistic recurring SaaS economics
- renewal/cancellation lifecycle

### 7. Visible model-generated trace
Chosen because the assignment wants the ReAct process visible and it makes the agent design demonstrable.

Given up:
- a simpler consumer UX
- the ability to hide every intermediate model/tool step

The trace shown should remain concise and product-oriented rather than becoming a dump of provider internals.

### 8. Two-stage diagnostics inside the same loop instead of a "driver analysis" tool

"Why did X change?" is answered in two stages by prompt rules, not code: first quantify the movement from SEC facts (`get_financials`, `calculate`), then search for context aimed at the years and metric just found.

- Why conditional: a search per question would add cost and latency and let irrelevant commentary into plain figure comparisons. Search runs only for diagnostic intent or an explicit request for news.
- Why numbers first: searching first anchors the answer on whatever commentary is available. Fixing the period first makes the query specific and the explanation checkable against the data.
- Facts versus context: filing figures keep the verified filing citations; articles can only support reported drivers via `news-N`. Inference from the data is labelled as inference.
- One mechanical change: `search_news` accepts a year window because Tavily's default last-12-months filter cannot reach a past decline.

Given up: the ordering and the causal-language rules are model behavior, verified by `scripts/try-driver.ts` on Haiku, not enforced by code. Sonnet verification is still needed for the demo model.

Update (driver loop): the ceiling is 8 iterations for why/driver questions and 6 for the rest, chosen by a small wording check rather than an LLM classifier (cheap, deterministic, testable; a false positive only raises a ceiling, the model still decides whether to search). The 8 is insurance, not the plan: batching calculations, grouping years into material phases and issuing the phase searches in parallel keep the normal run at about 5 steps, and the deadline is not raised. The cost is a longer worst case on driver questions (bounded by the same 90 s soft deadline).
