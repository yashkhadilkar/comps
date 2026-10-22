# Step 3 execution plan — usage limits + Stripe Pro upgrade

Owner: Hans + Pranav. Executor may be Claude Code.  
Goal: finish the complete free → limit → checkout → verified webhook → Pro → ask-again journey without regressing Step 2.

This plan assumes Step 2 is implemented as recorded in `BIG_AUDIT.md`.

## 0. Preflight

Before code:

1. Read:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `docs/SPEC.md` sections 2, 3, 7, 8, 10, 12
   - `docs/ARCHITECTURE.md`
   - `docs/BIG_AUDIT.md`
   - this file
   - Stripe SDK docs installed in the repo / current framework route docs as needed
2. Run:
   - `git status --short`
   - `git branch --show-current`
   - `npm run lint`
   - `npm run build`
3. Close or explicitly record any remaining Step 2 browser/Sonnet blockers before touching payment code.
4. Confirm env variable names exist in `.env.example`:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_APP_URL`
5. Do not print their values.

## Files expected to change

Primary:
- `lib/usage.ts`
- `lib/stripe.ts`
- `app/api/agent/route.ts`
- `app/api/checkout/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/pricing/page.tsx` and/or the existing pricing components
- `components/ask-form.tsx` or the smallest existing UI surface needed for a 402 upgrade state
- `.env.example`
- `docs/BIG_AUDIT.md`

Potential:
- a small shared usage response type/helper
- package dependencies / lockfile for Stripe

Avoid changing Step 2 agent internals unless a failing regression test proves a real integration bug.

---

## Component 1 — usage contract (`lib/usage.ts`)

### Requirements
Implement:
- PLAN-001 through PLAN-005
- AUTH-002

### Return type

Use a typed result shaped approximately as:

```ts
type UsageResult = {
  allowed: boolean;
  plan: "free" | "pro";
  used: number;
  limit: number;
  remaining: number;
  code: "FREE_LIMIT_REACHED" | "DAILY_LIMIT_REACHED" | null;
  message: string | null;
  resetAt: string | null;
};
```

### Rules

Free:
- count `runs` where `user_id = userId` and `status = "success"`
- limit = 3
- no time filter
- allowed when used < 3

Pro:
- count `success` runs since current UTC day start
- limit = 25
- allowed when used < 25
- `resetAt` = next `00:00:00Z`

Clamp `remaining` at 0.

Do not:
- count failed/non-answer rows
- trust a plan value supplied by the browser
- add a new mutable quota counter

### Tests

Create a focused script or test harness that can test the calculation/query logic without spending LLM calls.

Cases:
1. free / 0 successes → allowed, 3 remaining
2. free / 2 successes → allowed, 1 remaining
3. free / 3 successes → denied, `FREE_LIMIT_REACHED`
4. failures mixed in → failures do not increment used
5. Pro / 24 successes today → allowed
6. Pro / 25 successes today → denied, `DAILY_LIMIT_REACHED`
7. Pro rows yesterday → not counted today
8. reset time is next UTC midnight

After component:
- lint
- build
- update BIG_AUDIT
- commit

---

## Component 2 — wire usage into `/api/agent`

### Requirements
- AUTH-002
- PLAN-004
- no regression to STREAM-001 through STREAM-004

At the existing Step 3 TODO:
1. authenticate user
2. validate input
3. call `checkUsage(user.id)`
4. if denied, return a normal JSON 402 **before** creating the stream
5. otherwise begin the existing NDJSON flow unchanged

Response body:

```json
{
  "error": "You've used all 3 free questions. Upgrade to Pro to keep going.",
  "code": "FREE_LIMIT_REACHED",
  "usage": {
    "plan": "free",
    "used": 3,
    "limit": 3,
    "remaining": 0,
    "resetAt": null
  }
}
```

For Pro daily limit, include `resetAt`.

### Regression checks
- logged-out call still returns 401
- invalid question still returns the existing validation response
- allowed user still gets NDJSON, not JSON
- Step 2 answer/trace persistence unchanged

---

## Component 3 — Stripe client (`lib/stripe.ts`)

### Requirements
- PAY-001

Install Stripe SDK if not already installed.

Create one server-side Stripe client from `STRIPE_SECRET_KEY`.

Rules:
- server-only usage
- fail with a clear configuration error when missing
- never log secret key
- use the current SDK API, not remembered training-data syntax

If Next.js/Stripe behavior is version-sensitive, read installed package types/docs before coding.

---

## Component 4 — checkout route

### Requirements
- PAY-002 through PAY-005

`POST /api/checkout`:

1. require logged-in user
2. read authoritative current profile plan
3. if already Pro, return a clean non-checkout response (recommended HTTP 409 with code `ALREADY_PRO`)
4. create one-time Stripe Checkout session for **$19**
5. include authenticated Supabase user id in Stripe metadata
6. use `NEXT_PUBLIC_APP_URL` for success/cancel redirects
7. return the hosted Checkout URL (or session URL) to the browser

Recommended metadata:
```ts
metadata: {
  supabase_user_id: user.id,
  product: "comps_pro"
}
```

Do not:
- accept a target user id from the browser
- flip `profiles.plan` here
- consider the checkout creation itself a successful purchase

### Tests
- logged out → denied
- free logged-in user → receives test checkout URL
- metadata contains server-known user id
- already Pro → no second checkout

---

## Component 5 — verified webhook

### Requirements
- PAY-006
- PAY-007
- SEC-003

`POST /api/stripe/webhook`:

1. read raw body
2. read Stripe signature header
3. verify with `STRIPE_WEBHOOK_SECRET`
4. reject invalid signature before any DB write
5. on `checkout.session.completed`:
   - verify expected payment/checkout state
   - read `supabase_user_id` from metadata
   - update that profile to:
     - `plan = "pro"`
     - `pro_since = existing value ?? now` (or use one consistent idempotent policy)
6. repeated delivery remains safe
7. unrelated event types return success/no-op

Use the Supabase admin client server-side.

Do not trust:
- query params from the success page
- browser plan state
- unsigned JSON claiming a payment happened

### Tests
- invalid signature → no update
- completed test event → profile becomes Pro
- replay same event → still Pro, no duplicate/corrupt state
- unrelated event → no plan update
- missing/invalid metadata → log explicit error, no arbitrary update

---

## Component 6 — pricing and upgrade UX

### Requirements
- UI-005
- PAY-004
- PAY-008

Pricing page states:
- Free → $19 one-time upgrade CTA
- Pro → "You're on Pro", no buy button
- cancelled return → clear neutral state, still Free
- returning from success → tolerate webhook lag; show "confirming upgrade" and refetch authoritative plan rather than self-upgrading

Checkout button:
1. POST `/api/checkout`
2. handle response
3. redirect to Stripe-hosted URL

Disable button while creating session to avoid accidental duplicate sessions.

---

## Component 7 — ask-form limit UX

When `/api/agent` returns 402 JSON:

`FREE_LIMIT_REACHED`:
- render upgrade CTA
- link/button to pricing
- do not display generic red "server error"

`DAILY_LIMIT_REACHED`:
- render friendly daily-limit message
- show reset time from server
- no upgrade CTA if already Pro

The streaming parser must remain unchanged for successful 2xx NDJSON responses.

---

## Component 8 — live Stripe test

Do this only after local/build checks are green and required keys are configured in Railway.

Live path:
1. use a Free test user
2. reach free limit
3. see upgrade UI
4. start Checkout
5. use Stripe test card `4242 4242 4242 4242`
6. return to app
7. wait/refetch until profile is Pro
8. ask another question successfully
9. verify run persisted
10. cancel a separate checkout and verify no plan change
11. replay/test webhook delivery and confirm idempotence

Record exact result in `BIG_AUDIT.md`.

---

## Component 9 — Step 3 regression/eval gate

Run:
- `npm run lint`
- `npm run build`
- existing Step 2 tool/agent tests
- usage tests
- API auth/limit tests
- Stripe route tests possible locally
- live test-mode checkout
- primary Sonnet demo question after upgrade

No merge/deploy without user approval.

### Step 3 handoff checklist

- [ ] Free user can ask up to 3 successful questions.
- [ ] Non-answer/failed rows do not consume usage.
- [ ] 4th free attempt returns an upgrade state before model spend.
- [ ] Pro user gets 25 successful questions per UTC day.
- [ ] Pro daily-limit response includes reset time.
- [ ] Checkout is server-authenticated and uses server-known user metadata.
- [ ] Invalid webhook signature cannot change plan.
- [ ] Completed Stripe test checkout flips plan to Pro.
- [ ] Replayed webhook is harmless.
- [ ] Cancelled checkout leaves user Free and usable.
- [ ] Already-Pro user does not get another buy button.
- [ ] Step 2 benchmark and edge cases still pass.
- [ ] `BIG_AUDIT.md` is updated.
