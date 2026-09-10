# Runbook — Search Reliability (WS4.5)

For the two founders running this day-to-day, not for an engineer. Every section below is
literal, numbered steps — if a step doesn't work exactly as written, that's worth flagging
back rather than guessing past it, since the underlying tooling may have changed since this
was written (2026-09-10).

**What this covers today, and what it doesn't**: there is no dashboard yet (that's WS0.8,
still unbuilt — see `WS4_IMPLEMENTATION_PLAN.md`). What exists is a small, real, in-memory
health endpoint (WS4.1's stopgap) and whatever Railway itself already gives you. This
document is honest about that gap rather than describing tooling that isn't there.

---

## 1. Is the site actually working right now?

1. Open `https://<your production URL>/api/health` in a browser (ask whoever set up Railway
   for the exact URL if you don't have it handy — it's the Railway service's public domain
   plus `/api/health`).
2. You should see exactly this on the page: `{"status":"ok"}`
3. If you see anything else (a blank page, an error, the page won't load at all), the
   server itself is down — skip to **Section 5: The server won't respond at all**.
4. If step 2 looks right, the server is running. That does **not** mean every individual
   government register check is working — see Section 2 for that.

---

## 2. Is a specific check (scraper) currently broken?

This is the one thing we do have real visibility into — but it only covers the 16 checks
that have been given the "circuit breaker" treatment so far (see `mvpScope: true` entries in
`server/scrapers/manifest.js` if you want the exact list — as of this writing: ABR, ASIC
Connect, ASIC Disqualified Persons, ASIC Insolvency, ASIC Tax Debt, Federal Courts, NSW
Courts, ACT Courts, Payment Times, Modern Slavery, Fair Work Ombudsman, NSW Fair Trading, ACT
Licences, ACT Disciplinary, ASIC Director History, ASIC Enforceable Undertakings). The other
13 checks (QBCC, VIC, WA, SA, TAS, NT registers) aren't wired into this yet, so this tool
will always show them as `"no-data"` regardless of whether they're actually working.

**One-time setup** (only needed once, or after adding a new environment):

1. Open the Railway dashboard for this project and go to the server service's
   **Variables** tab.
2. Add a new variable: name it `ADMIN_HEALTH_KEY`, and for the value type any
   password-like string you make up yourself (e.g. `kyb-health-check-2026`) — write it down
   somewhere you'll remember, you'll need it every time you use this.
3. Save. Railway will automatically redeploy the service with the new variable — wait for
   that to finish (the dashboard shows a deploy in progress, then "Active" when done).

**Checking health** (every time you want to check):

1. You need a tool that can send a custom "header" with a web request — a plain browser
   address bar can't do this. The simplest free option: install **Postman** (postman.com) or
   use `curl` from a terminal if you're comfortable with one.
2. **Using curl** (Terminal app on Mac, or Command Prompt/PowerShell on Windows): type
   exactly this, swapping in your production URL and the password you set in step 2 above:
   ```
   curl -H "x-admin-key: kyb-health-check-2026" https://<your production URL>/api/admin/scraper-health
   ```
3. **Using Postman**: create a new GET request to `https://<your production URL>/api/admin/scraper-health`,
   go to the "Headers" tab, add a header named `x-admin-key` with your password as the
   value, then click Send.
4. You'll get back a list of 29 checks. For each one, look at its `"status"` field:
   - `"healthy"` — working normally, nothing to do.
   - `"degraded"` — some recent failures, but not tripped yet. Worth watching, not yet an
     emergency.
   - `"open"` — this check has tripped its circuit breaker. It is currently being skipped
     on every search and shown to users as "Temporarily unavailable." This is the one that
     means something is actually broken right now.
   - `"no-data"` — hasn't run since the server last restarted. Normal right after a
     restart or deploy; only a problem if it stays `"no-data"` after real search traffic
     has gone through.
5. If something shows `"open"`: that check's underlying government website has likely
   changed (the exact same pattern documented repeatedly in `CLAUDE.md` — a register
   changes its page layout or API, and the existing scraper code no longer understands it).
   This needs an actual code fix, not something to resolve from this runbook — bring the
   `"open"` key name (e.g. `"nswFairTrading"`) to whoever's doing the engineering work.

**Important**: this data resets to nothing every time the server restarts (it's kept in the
server's memory, not saved anywhere). It only tells you "what's happened since the last
restart," not a history. If you restart the server for any reason (see Section 3), every
check will briefly show `"no-data"` again until real searches start flowing through it.

---

## 3. Resetting a broken check (clearing an "open" circuit breaker)

There is currently no button or dedicated command for this — the only way to reset a
tripped circuit breaker today is to restart the whole server. This also means: restarting
clears **every** breaker at once, not just the one that's broken, and briefly loses the
health history described in Section 2.

1. From a terminal, with the Railway CLI installed and logged in
   (`npm install -g @railway/cli` then `railway login` if you haven't set this up before):
   ```
   cd server
   railway redeploy
   ```
2. This redeploys and restarts the currently-running version — it does **not** deploy new
   code, just restarts the existing service. Wait for the Railway dashboard to show the
   service as "Active" again (usually under a minute).
3. Alternative if you don't have the CLI set up: open the Railway dashboard → the server
   service → the **Deployments** tab → find the most recent (currently active) deployment
   → use its menu to restart it. (Railway's exact button wording here can change between
   dashboard versions — look for "Restart" or "Redeploy" on the active deployment if this
   doesn't match exactly what you see.)
4. A restart alone doesn't fix the underlying problem if the check keeps tripping again on
   its own — that means the government website really has changed and needs an actual code
   fix, not just a restart.

---

## 4. Forcing a fresh data pull (re-ingest) for the cached checks

Four checks work by downloading a government dataset periodically and searching a local
cached copy, rather than calling the live website on every search: **ASIC Disqualified
Persons**, **ASIC Enforceable Undertakings**, **ACT Licences & Disciplinary**, and
**VIC Building & Plumbing Commission**. There is currently no manual "refresh now" button
for these either.

1. Every one of these four automatically re-downloads on its own schedule (every 8–24 hours
   depending on the check — see `server/scrapers/*Refresh.js` if you want exact intervals)
   **and immediately once, every time the server starts up.**
2. So: if you need fresher data than the last scheduled refresh, restarting the server
   (Section 3's steps) also forces an immediate re-pull of all four datasets as a side
   effect, at the same time as it clears any tripped circuit breakers.
3. There's no way to refresh just one of the four without restarting the whole server.

---

## 5. The server won't respond at all

1. Check the Railway dashboard — does the service show as "Active," "Crashed," or
   "Building"? This tells you immediately whether it's a deploy problem (still building) or
   a crash (needs investigating).
2. If it shows "Crashed" or keeps restarting on its own: open the **Logs** tab in Railway
   (or `railway logs` from the CLI) and look at the last 50 or so lines before it stopped.
   `CLAUDE.md` has an extensive history of past incidents with their actual log signatures
   (search it for the exact error text you're seeing) — several past crashes turned out to
   be a specific, already-diagnosed bug class, not a new mystery each time.
3. If the logs don't obviously match anything already documented, this needs an actual
   engineering session — bring the log excerpt, not just "it's down."

---

## 6. Spotting drift before a user reports it

A GitHub Action (`.github/workflows/register-health-check.yml`) runs the full register test
suite automatically every day, plus whenever someone manually triggers it, against the real
government sites — independent of whether anyone has searched a real entity that day.

1. Go to `https://github.com/trustworthyact-tech/know-your-builder/actions` and click
   **Register Health Check** in the left sidebar.
2. Each row is one day's automated run. A red ✗ means at least one register test failed
   that day — click into it to see which one(s).
3. GitHub already emails whoever's watching the repo when a scheduled run fails — if that's
   not reaching the right inbox, check the repo's notification settings.
4. **Before treating a red run as a real break**: `CLAUDE.md` documents that a handful of
   specific tests (`act-licences`, `court-records`, `asic-insolvency` as of this writing)
   are known to fail sometimes on GitHub's own shared servers purely because those specific
   government sites are more aggressive about blocking GitHub's IP ranges than a normal
   connection — not because the code broke. To rule that out: click **Run workflow**
   (top-right of the Register Health Check page) to manually re-trigger it, and see if the
   same test fails again. If it passes on a re-run, it was noise, not a real break.

---

## What's genuinely missing (don't pretend these exist)

- **No visual dashboard.** Section 2's health check is raw JSON behind a password, not a
  page you can glance at. This is WS0.8 in the reliability plan, not built yet.
- **No persisted history.** Section 2 only ever shows "since the last restart" — there's no
  way to see "how often did this check fail last week."
- **No single-check manual refresh or reset.** Sections 3 and 4 both only have the
  "restart everything" lever — nothing more targeted exists yet.

---

*Reliability plan, activity 4.5. See `WS4_IMPLEMENTATION_PLAN.md` for the full plan and
`CLAUDE.md` for the detailed engineering history behind every check named above.*
