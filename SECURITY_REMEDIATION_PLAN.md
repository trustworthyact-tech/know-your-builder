# Security Remediation Plan

Source: full-codebase security audit, 2026-07-23. Updated 2026-07-24 after removing the
contract-upload/extraction feature entirely (see "Resolved" below).

**How to use this file in a future session:** each open item has an `Activity ID`. Items in
the same *Wave* have no file overlap and no dependency on each other — hand a whole Wave to
the `Agent` tool as one message with multiple parallel `Agent` calls (subagent_type: `claude`
or `general-purpose` for edits, `Explore` for the audit/research-only activities). Items in a
later Wave depend on an earlier Wave's output and must not start until it lands. Activities
that share a file are marked "same file — do sequentially" and should go to one subagent, not
two, to avoid clobbering each other's edit. If dispatching truly in parallel (not just batched
in one message), consider `isolation: "worktree"` per agent so concurrent edits can't collide
on disk, then merge.

Current repo state: all fixes below are still **unstaged working-tree changes** as of this
plan (nothing from the audit has been committed yet) — check `git status` before resuming.

---

## Execution status (2026-07-24)

Waves A, B, and C are **landed and committed**:
- `f9cfff2` — Resolved section (contract-upload/extraction removal)
- `ff825d2` — Wave A
- `1fc272e` — Wave B
- `f530dc4` — Wave C

**B2 (Next.js major-version upgrade) was deliberately skipped this pass** — user decision,
since it's the plan's own flagged highest-risk item. A4's research is done and is worth reading
before picking it up: target `next@15.5.21` (not 16.x) — 16.x forces an unplanned `next-auth` v4
→ Auth.js v5 rewrite (peer-dep incompatibility) plus a `middleware.ts` → `proxy.ts` rename and
`serverRuntimeConfig` removal, none of which are in scope for "fix the CVEs." 15.5.21 carries
every relevant CVE fix without any of that. Biggest mechanical cost either way: this app's
`params`/`searchParams` are used unawaited throughout the App Router routes/pages and need the
Next 15 Async Request APIs migration (`await params`) — a codemod exists
(`npx @next/codemod@canary upgrade latest`) but the number of affected files (route handlers
first, they guard data) warrants manual review after running it. No Server Actions, no
`next/image` usage, no `rewrites()`/`redirects()` in this app, so those breaking-change surfaces
don't apply.

D1 (middleware manual verification) and D3 (rate-limit trip script) were **not executed** —
this environment has no local Redis/Docker (`web/lib/rateLimit.ts` needs Redis to function at
all), and `DATABASE_URL` in `.env` points at a live remote Supabase instance that a test run
shouldn't be pointed at without explicit sign-off. Whoever resumes this should run `web/`'s dev
server + `server/`'s + a local Redis and actually exercise: each `web/middleware.ts` matcher
route while logged out (expect redirect for pages / 401 for the API routes) and as the wrong
user where ownership applies; and script N+1 requests at one of the C1-C4 rate-limited endpoints
to confirm the N+1th 429s.

D4 (re-run `npm audit`) **was** run and confirms the remaining vulnerabilities are exactly the
ones deliberately deferred, not regressions: `web/` has 5 (1 low, 3 high, 1 critical), all
transitively from `next@14.2.35` and gone once B2 lands; root (Expo) has 12 (11 moderate, 1
high), all requiring `--force`/breaking changes in `@expo/*`/`ws` — a separate deliberate call,
not part of this plan; `server/` is clean (0 vulnerabilities).

---

## Resolved

| Original Finding | Resolution |
|---|---|
| #4 — `/api/extract` unauthenticated + unrate-limited paid Anthropic call | **Removed entirely.** Contract-upload-and-extract feature deleted (`web/lib/contractExtractor.ts`, `web/lib/r2.ts`, `web/app/api/extract/`, `web/app/api/upload/`, `ContractUpload.tsx`, `ExtractionConfirmCard.tsx`, `@anthropic-ai/sdk`/`@aws-sdk/*` deps). No longer applicable — there is no upload/extract surface left to secure. |
| #8 — `/api/upload` unauthenticated, MIME check trusted client `Content-Type` | **Removed** (same change as above). |
| #14 — `/api/extract` trusted client-supplied `r2Key` with no ownership check | **Removed** (same change as above). |

---

## Open items, in priority order

| # | Finding | Severity | Wave |
|---|---|---|---|
| 1 | `GET /api/reports/[searchId]` IDOR | CRITICAL | A |
| 2 | `/compare` page IDOR | HIGH | A |
| 3 | No `middleware.ts` — default-allow posture | HIGH | A → B → D |
| 4 | Express `/api/search` — wildcard CORS, no auth, no rate limit, raw error leaks | HIGH | A |
| 5 | `next@14.2.35` — SSRF + middleware auth-bypass CVEs | HIGH | A(research) → B(upgrade) → D(verify) |
| 6 | No rate limiting on auth endpoints (login/register/forgot-password/reset-password) | MEDIUM | B(helper) → C(apply) |
| 7 | No schema validation library anywhere | MEDIUM | B(install) → C(apply) |
| 8 | `watchlist` POST trusts client `lastSearchId`, no ownership check | MEDIUM | C (bundled with 7d, same file) |
| 9 | No fail-fast env-var validation | LOW | A |
| 10 | `.gitignore` gaps (`.env.production`, plain `.env` uncovered) | LOW | A |
| 11 | Transitive dependency vulnerabilities (`npm audit`) | LOW | A |
| 12 | `react-email` unused runtime dependency | INFO | A |

---

## Wave A — fully independent, dispatch together

No two activities in this wave touch the same file. Safe to run as one batch of parallel
`Agent` calls.

**A1. Fix reports IDOR** *(Finding #1, CRITICAL, ~15 min)*
File: `web/app/api/reports/[searchId]/route.ts`
Add `getServerSession(authOptions)` and change `findUnique({ where: { id } })` to
`findFirst({ where: { id, OR: [{ userId: session?.user?.id ?? '__none__' }, { userId: null }] } })`,
404 if not found. Confirm with product whether guest (`userId: null`) reports should stay
openly readable by id — if not, drop that `OR` branch.

**A2. Fix compare-page IDOR** *(Finding #2, HIGH, ~10 min)*
File: `web/app/compare/page.tsx`
Same ownership filter as A1 applied to the `prisma.search.findMany({ where: { id: { in: ids } } })` call.

**A3. Audit routes for middleware coverage** *(Finding #3 — research half, ~20 min, Explore agent)*
Read-only. Produce a table of every path under `web/app/api/**` and the user-facing pages
(`/account`, `/report/[searchId]`, `/compare`, etc.) classified as:
  - *unconditional* — always requires the same signed-in user (candidate for middleware matcher)
  - *conditional* — owner-or-guest, or token-gated (must stay as an in-route check — e.g.
    `/api/reports/[searchId]` after A1, `/compare` after A2, `/api/share/[token]`)
  - *intentionally public* — register, login, forgot/reset-password, webhook
Output feeds B1.

**A4. Research next.js upgrade path** *(Finding #5 — research half, ~20-30 min, Explore/WebFetch agent)*
Read-only. Determine: latest patched 14.2.x point release (if any) vs. required 15.x/16.x major
bump; changelog entries touching middleware, Server Actions, rewrites, and image optimization
(the areas the CVEs and this app's usage overlap); a list of breaking changes relevant to this
app's `next.config.mjs`, `web/middleware.ts` (once A3/B1 exist), and App Router usage. Output
feeds B2.

**A5. Harden Express server** *(Finding #4 + the `server/index.js` error-leak items, HIGH+LOW, ~40 min)*
File: `server/index.js` only — combine into one activity since it's one file:
  - `app.use(cors())` → `app.use(cors({ origin: process.env.WEB_APP_ORIGIN }))`
  - Add a rate limiter in front of `/api/search` (e.g. `express-rate-limit`, Redis-backed store
    if a Redis client is added to `server/`, otherwise document the in-memory-limiter caveat —
    this process is not currently horizontally scaled, so in-memory is an acceptable interim
    tradeoff, but say so in a comment)
  - Replace `res.json({ error: err.message })` at lines ~53, 64, 276 with generic messages;
    keep `console.error(err)` server-side

**A6. Env-var startup validation** *(Finding #9, LOW, ~45 min total, two independent sub-files)*
  - A6a — `web/lib/env.ts`: new Zod-validated env schema covering `DATABASE_URL`,
    `NEXTAUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
    `REDIS_URL`, `GOOGLE_CLIENT_ID`/`SECRET` — import it once at the top of a shared server
    entrypoint so a missing var throws at boot, not on first lazy use. (R2/Anthropic vars are
    gone now — no longer part of this schema.)
  - A6b — `server/index.js`: add a startup check for `CAPTCHA_API_KEY`/`SCRAPERAPI_KEY` that
    logs a clear fatal error and exits if unset, instead of failing deep inside a scraper call.
  These are two different files in two different apps — parallel-safe.

**A7. `.gitignore` coverage** *(Finding #10, LOW, ~5 min)*
Add a catch-all `.env*` (with `!.env.local.example` exception) to root `.gitignore`,
`web/.gitignore`, and `server/.gitignore`. Trivial — one activity, not worth splitting further.

**A8. `npm audit fix`** *(Finding #11, LOW, ~15 min, three independent projects)*
  - A8a — root (Expo app): `npm audit fix`
  - A8b — `web/`: `npm audit fix` **only** (do not let it touch `next` — that's Finding #5/A4/B2,
    a deliberate major-version decision, not an auto-fix)
  - A8c — `server/`: `npm audit fix`
  Three separate lockfiles/node_modules trees — parallel-safe.

**A9. Remove unused `react-email` dependency** *(Finding #12, INFO, ~2 min)*
File: `web/package.json` — move to `devDependencies` or delete; confirmed zero runtime imports.

---

## Wave B — depends on Wave A output, mostly single-threaded

**B1. Write `web/middleware.ts`** *(Finding #3, depends on A3)*
Build the matcher from A3's "unconditional" list. Example shape:
```ts
export { default } from 'next-auth/middleware';
export const config = { matcher: [/* from A3 */] };
```

**B2. Perform the next.js upgrade** *(Finding #5, depends on A4)*
Single-threaded — touches too many files/behaviors to parallelize safely. Use A4's findings to
pick the target version, bump `web/package.json`, run `npm install`, fix breakages.

**B3. Build shared rate-limit helper** *(prerequisite for Finding #6)*
New file `web/lib/rateLimit.ts` — Redis-backed (reuse the existing `ioredis` connection
pattern from `web/lib/redis.ts`, per this repo's own convention that in-memory limiters are
wrong for anything that might scale to multiple instances). Expose one function, e.g.
`checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>`.

**B4. Install `zod`** *(prerequisite for Finding #7)*
`cd web && npm install zod`. One-line prerequisite for all of Wave C's validation work.

---

## Wave C — parallel again, once B3/B4 land

**C1–C4. Apply rate limiting to auth endpoints** *(Finding #6, depends on B3, ~15-20 min each)*
Four different files — parallel-safe:
  - C1 — `web/lib/auth.ts` `authorize()` (credentials login)
  - C2 — `web/app/api/auth/register/route.ts`
  - C3 — `web/app/api/auth/forgot-password/route.ts`
  - C4 — `web/app/api/auth/reset-password/route.ts`

**C5–C13. Apply Zod schemas** *(Finding #7, depends on B4, ~15-20 min each)*
Each is an independent route file/group — parallel-safe:
  - C5 — `web/app/api/alerts/**`
  - C6 — `web/app/api/monitoring/route.ts`
  - C7 — `web/app/api/timeline/route.ts` + `web/app/api/timeline/[searchId]/route.ts`
  - C8 — `web/app/api/watchlist/route.ts` — **also fold in Finding #8 here** (add
    `findFirst({ id: lastSearchId, userId: session.user.id })` ownership check before persisting
    `lastSearchId` on POST) since it's the same file as the schema work
  - C9 — `web/app/api/reports/save/route.ts` (validate `findings`/`persona`/`projectStage`/`projectState` shape)
  - C10 — `web/app/api/payments/create-intent/route.ts`
  - C11 — `web/app/api/share/route.ts`
  - C12 — `web/app/api/auth/register/route.ts` + `forgot-password` + `reset-password` (schema
    only — if C2-C4 already touched these files for rate limiting, assign the same subagent
    both tasks per file to avoid a merge conflict)
  - C13 — `server/index.js` request validation (`companyName`, `abn`, `directors`) — separate
    codebase from C5-C12, but **same file as A5** — if A5 hasn't landed yet, do sequentially
    after it, not in parallel with it

---

## Wave D — verification, after everything above lands

- Re-run `npx tsc --noEmit` (root, `web/`) and `npm run build` in `web/`
- D1 — manually verify B1's middleware: hit each matched route logged-out (expect redirect/401)
  and logged-in as the wrong user where applicable
- D2 — manually verify B2's next.js upgrade: exercise middleware-protected routes, any Server
  Actions, and image/rewrite-heavy pages for regressions
- D3 — verify rate limits actually trip (script N+1 requests against one C1-C4 endpoint, confirm
  the N+1th is rejected)
- D4 — re-run `npm audit` in all three projects and confirm the addressed advisories are gone

---

## Notes for whoever resumes this

- Nothing here has been committed. Decide whether to land Wave A as one commit (it's cleanly
  independent, low-risk fixes) versus per-activity commits before starting Wave B, which
  touches shared/prerequisite files.
- B2 (next.js upgrade) is the single biggest risk/effort item in this plan — consider doing it
  in its own branch with its own review, separate from the rest.
- Finding severities and file:line references are from the 2026-07-23 audit; re-grep before
  trusting a specific line number, since Wave A/earlier work will have shifted some of them.

---

## Potential gaps found during execution (2026-07-24)

Surfaced while doing A3's route audit and Wave D verification — none were in-scope for this
pass, flagging for a future session:

- **`web/app/api/events/route.ts`** — the analytics-beacon endpoint is intentionally public (no
  session), but has zero abuse controls: no payload-size cap on `properties`, no rate limit.
  Low severity (it's a client telemetry sink, not a data-mutating endpoint) but cheap to fix —
  worth folding into a future rate-limiting pass alongside C1-C4, or at least adding a body-size
  guard.
- **`web/app/report/[searchId]/page.tsx` and `web/app/report/share/[token]/page.tsx`** —
  neither page has its own server-side auth check; both are pass-throughs to client components
  that call the real API routes, which is fine functionally (the API route enforces
  authorization) but means **these are not safe candidates for a blanket middleware
  "must be logged in" matcher entry**, even though `/report/*` looks like an obvious pattern —
  doing so would break guest report viewing and public share links. `web/middleware.ts`
  correctly omits them; if anyone edits the matcher later, don't add `/report/:path*`.
- **`web/app/api/report/[searchId]/pdf/route.ts`** — forwards the caller's raw session cookie
  (`__Secure-next-auth.session-token` / `next-auth.session-token`) into a headless Puppeteer
  browser context to render the authenticated page as a PDF. Not flagged as a confirmed bug —
  `browser.close()` is already in a `finally` — but it's a more sensitive code path than a
  typical route handler (the session token transits through a real browser cookie jar) and is
  worth a second look by whoever owns that route next.
- **Root `tsconfig.json`** (`extends: expo/tsconfig.base`, no `exclude`) has always swept
  `web/**` into the mobile app's `npx tsc --noEmit` (confirmed via `git log` — unchanged since
  the initial commit, not introduced by this plan), producing a wall of spurious
  `Cannot find module '@/...'` errors since the mobile project doesn't have `web/`'s path
  aliases configured. Not a security item, but it means the "mobile" typecheck command in
  CLAUDE.md is currently unusable as a real signal; worth adding `"exclude": ["web"]` at some
  point.
- **`web/app/report/[searchId]/ReportContent.tsx:316`** — `qbcc?.enforcementResults` references
  a property that doesn't exist on the `SearchResult` type (compile error), currently blocking
  `npm run build` in `web/`. This is in unrelated, already-in-progress uncommitted work (the
  QBCC decision-PDF-proxy feature, not part of this security plan) that predates this session —
  left untouched since it wasn't this plan's file to fix, but it's a real build blocker right
  now and should be resolved (likely either populate `enforcementResults` on `SearchResult` in
  `web/src/types/index.ts`, or the reference is a leftover typo for `adjudicationResults` —
  needs whoever owns that feature to confirm which).
