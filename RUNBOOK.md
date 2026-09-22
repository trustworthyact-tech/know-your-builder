# Runbook — Search Reliability (WS4.5)

For the two founders running this day-to-day, not for an engineer. Every section below is
literal, numbered steps — if a step doesn't work exactly as written, that's worth flagging
back rather than guessing past it, since the underlying tooling may have changed since this
was written (2026-09-10).

**What this covers today, and what it doesn't**: there is now a real dashboard page (WS0.8,
built 2026-09-11 — see `WS4_IMPLEMENTATION_PLAN.md`) with a 7-day success-rate history, on
top of the in-memory health endpoint (WS4.1's stopgap) and whatever Railway itself already
gives you. This document is still honest about what's left missing rather than describing
tooling that isn't there — see "What's genuinely missing" at the end of this document.

---

## 0. Launch scope — which checks actually run right now

Know Your Builder's initial release only runs national registers plus NSW and ACT courts and
licensing — 16 checks in total. The other 13 (QLD/VIC/WA/SA/TAS/NT court and licence
registers, and QBCC) have real, working code behind them — nothing was deleted — but the
server is currently configured to skip them entirely: they are never called, and a report
for a builder based outside NSW/ACT will not show a licence or court section for their own
state. See `CLAUDE.md`'s "Launch scope" section for the technical detail and how to bring a
state back into scope.

This matters for the rest of this runbook: Section 2's dashboard and Section 6's daily test
suite both still exercise (or reference) the other 13 checks even though they're not part of
the live product right now — that's deliberate (it means drift is caught early, before
re-enabling a state), not a sign something is broken.

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

This is the one thing we do have real visibility into — and it happens to line up exactly
with what's actually running right now (see Section 0): the 16 checks that have been given
the "circuit breaker" treatment (see `mvpScope: true` entries in `server/scrapers/manifest.js`
if you want the exact list — as of this writing: ABR, ASIC Connect, ASIC Disqualified
Persons, ASIC Insolvency, ASIC Tax Debt, Federal Courts, NSW Courts, ACT Courts, Payment
Times, Modern Slavery, Fair Work Ombudsman, NSW Fair Trading, ACT Licences, ACT Disciplinary,
ASIC Director History, ASIC Enforceable Undertakings) are also the only 16 currently in
launch scope. The other 13 checks (QBCC, VIC, WA, SA, TAS, NT registers) are not run at all
for a live search right now, so this tool will always show them as `"no-data"` — that's
expected, not a sign anything's broken.

**One-time setup** (only needed once, or after adding a new environment):

1. Open the Railway dashboard for this project and go to the server service's
   **Variables** tab.
2. Add a new variable: name it `ADMIN_HEALTH_KEY`, and for the value type any
   password-like string you make up yourself (e.g. `kyb-health-check-2026`) — write it down
   somewhere you'll remember, you'll need it every time you use this.
3. Save. Railway will automatically redeploy the service with the new variable — wait for
   that to finish (the dashboard shows a deploy in progress, then "Active" when done).

**Checking health — using the dashboard page** (the normal way to do this):

1. In any browser, go to `https://<your production URL>/admin/scraper-health`.
2. The first time, it asks for an "Admin key" — type in the password you set in step 2
   above, then click **View dashboard**. It remembers this for the rest of your browser
   session (until you close the tab), so you won't be asked again until you come back later.
3. You'll see a table, one row per check, already sorted so the worst problems are at the
   top. For each row, the coloured badge on the left tells you the current state:
   - **healthy** — working normally, nothing to do.
   - **degraded** — some recent failures, but not tripped yet. Worth watching, not yet an
     emergency.
   - **open** — this check has tripped its circuit breaker. It is currently being skipped
     on every search and shown to users as "Temporarily unavailable." This is the one that
     means something is actually broken right now.
   - **no-data** — hasn't run since the server last restarted. Normal right after a
     restart or deploy; only a problem if it stays `no-data` after real search traffic has
     gone through.
4. The "7-day success rate" column is a history that survives server restarts (unlike the
   badge itself, see the note below) — a check that's currently `healthy` but has a low
   7-day rate has been intermittently failing recently even though it looks fine right now.
5. Click **Refresh** (top of the page) to pull the latest numbers without reloading the
   whole page.
6. If something shows **open**: that check's underlying government website has likely
   changed (the exact same pattern documented repeatedly in `CLAUDE.md` — a register
   changes its page layout or API, and the existing scraper code no longer understands it).
   This needs an actual code fix, not something to resolve from this runbook — bring the
   key name shown in that row (e.g. `nswFairTrading`) to whoever's doing the engineering work.

**Checking health — using curl or Postman instead** (a scriptable alternative to the page,
same data): send a GET request to
`https://<your production URL>/api/admin/scraper-health/full` with a header named
`x-admin-key` set to your password — e.g. from a terminal:
```
curl -H "x-admin-key: kyb-health-check-2026" https://<your production URL>/api/admin/scraper-health/full
```
This returns the same rows as the page, as raw JSON (`status`, `successRate7d`,
`attempts7d`, `historyAvailable`, timestamps, per key) — useful for scripting, not needed for
day-to-day checking now that the page exists.

**Important**: the current-status badge (`healthy`/`degraded`/`open`/`no-data`) resets to
nothing every time the server restarts (it's kept in the server's memory, not saved
anywhere) — right after a restart, every row briefly shows `no-data` again until real
searches start flowing through it. The **7-day success rate column does not reset** — it's
read from a database table that survives restarts, so it's the one place you can actually see
"how often has this been failing lately," independent of whether the server happened to
restart recently.

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
5. **This suite tests all 29 checks, including the 13 outside launch scope** (see Section 0)
   — that's intentional, so a QLD/VIC/WA/SA/TAS/NT register drifting while it's out of scope
   still gets caught before it's ever brought back. A red run on one of those 13 is not
   urgent the way a red run on one of the 16 live checks is — no user-facing report is
   affected today — but it's still worth a look before re-enabling that state.

---

## What's genuinely missing (don't pretend these exist)

- **7-day success rate only covers the 16 `mvpScope: true` checks** — the same list named in
  Section 2, and (as of the launch-scope change — see Section 0) the same 16 that are
  actually invoked at all. The other 13 (QBCC, VIC, WA, SA, TAS, NT registers) don't log
  history and will always show "no history yet" on the dashboard, but that's expected now —
  they're not being run, not silently failing to report.
- **History only exists from 2026-09-11 onward** — the dashboard can't tell you anything
  about a check's behaviour before this was built, only what's happened since.
- **No single-check manual refresh or reset.** Sections 3 and 4 both only have the
  "restart everything" lever — nothing more targeted exists yet.
- **No auto-refresh on the dashboard page** — it only updates when you click **Refresh** or
  reload the page. Fine for an occasional glance; not something to leave open and watch
  live during an active incident.

---

*Reliability plan, activity 4.5. See `WS4_IMPLEMENTATION_PLAN.md` for the full plan and
`CLAUDE.md` for the detailed engineering history behind every check named above.*
