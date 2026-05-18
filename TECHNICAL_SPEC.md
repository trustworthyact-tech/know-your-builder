# Know Your Builder — Technical Specification

**Version:** 1.0  
**Date:** 2026-05-18  
**Status:** Draft  
**References:** SPEC.md v1.5, CLAUDE.md

---

## 1. Current State

The prototype is an Expo / React Native app (`know-your-builder/`) backed by a standalone Express server (`server/`). It demonstrates the core streaming search experience but has no persistence, no user accounts, no email, and no payments.

| Layer | Current | Target |
|---|---|---|
| Frontend | Expo / React Native (web via Expo) | Next.js 14 (App Router) |
| Backend scraping | Express + NDJSON streaming | Retained as-is, extended |
| Database | None | PostgreSQL via Prisma |
| Auth | None | NextAuth.js (credentials + Google OAuth) |
| Email | None | Resend |
| Payments | None | Stripe |
| File storage | None | Cloudflare R2 (S3-compatible) |
| AI | None | Anthropic Claude API (contract extraction only) |
| Background jobs | None | BullMQ + Redis |

---

## 2. System Architecture

### 2.1 High-level diagram

```
Browser / Mobile browser
        │
        ▼
┌──────────────────────────────────┐
│  Next.js 14 (App Router)         │
│  • Pages + React Server Components│
│  • /api routes (auth, users,     │
│    payments, monitoring, email)  │
│  • NextAuth.js sessions          │
└──────────┬───────────────────────┘
           │  fetch / SSE
           ▼
┌──────────────────────────────────┐
│  Express Scraping Service :3001  │
│  • POST /api/search  (NDJSON)    │
│  • POST /api/extract (contract)  │
│  • GET  /api/health              │
└──────────┬───────────────────────┘
           │
    ┌──────┴───────┐
    ▼              ▼
Scrapers        Claude API
(parallel)      (contract extraction only)

PostgreSQL ◄── Prisma ◄── Both services (Next.js writes user/report data;
                          Express writes nothing — it returns data only)

Redis ◄── BullMQ ◄── Next.js API (enqueue monitoring jobs, email sequences)
```

### 2.2 Frontend: Migrate from Expo to Next.js

**Why Next.js:**
- SPEC §17 requires web-first responsive layout (375px–1440px), no mobile app
- Proper URL routing needed for shareable links (`/report/:token`), account dashboard, deep-link email CTAs
- SSR for report pages (SEO; lenders and solicitors will share report URLs)
- Next.js API routes consolidate auth, payments, and user management cleanly
- NextAuth.js is the industry-standard auth layer for Next.js

**Migration approach:** Create a new Next.js app at `web/` alongside the existing `know-your-builder/` (Expo) directory. Port screens as pages. Expo directory can be removed once Next.js reaches parity.

### 2.3 Backend: Express Scraping Service (retained)

The Express server at `server/` is kept intact. It owns the scraping + streaming responsibility. It does **not** write to the database — it returns structured JSON. The Next.js layer is responsible for persisting report results after the stream completes.

The Express server gains one new endpoint:
- `POST /api/extract` — contract document extraction via Claude API

### 2.4 Service layout

```
/
├── web/                   # Next.js 14 app (new)
│   ├── app/               # App Router pages
│   ├── components/
│   ├── lib/
│   │   ├── auth.ts        # NextAuth config
│   │   ├── db.ts          # Prisma client singleton
│   │   ├── stripe.ts
│   │   └── resend.ts
│   ├── prisma/
│   │   └── schema.prisma
│   └── .env.local
├── server/                # Express scraping service (existing, extended)
│   ├── index.js
│   └── scrapers/
├── know-your-builder/     # Expo (kept until Next.js reaches parity, then removed)
└── TECHNICAL_SPEC.md
```

---

## 3. Data Model

### 3.1 Prisma schema (`web/prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ─── Enums ────────────────────────────────────────────────────────────────────

enum Persona {
  HOMEOWNER
  SUBCONTRACTOR
  DEVELOPER
  LENDER
}

enum AlertType {
  LICENCE_CHANGE
  INSOLVENCY_EVENT
  COURT_DECISION
  ATO_DEBT_FLAG
  QBCC_ADJUDICATION
  FWO_ENFORCEMENT
}

enum PaymentType {
  RECHECK_SINGLE
  RECHECK_5PACK
  DEEP_CHECK_SINGLE
  DEEP_CHECK_5PACK
  MONITORING_MONTHLY
}

// ─── Users ────────────────────────────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  passwordHash  String?
  googleId      String?   @unique
  persona       Persona?
  state         String?   // AU state/territory code: QLD | NSW | VIC | WA | SA | TAS | NT | ACT
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Relations
  accounts      Account[]           // NextAuth
  sessions      Session[]           // NextAuth
  searches      Search[]
  watchlist     WatchlistItem[]
  timelines     ProjectTimeline[]
  monitoring    MonitoringSubscription[]
  alerts        Alert[]
  packBalance   PackBalance?
  payments      Payment[]
  emailSequences EmailSequenceState[]

  @@index([email])
}

// NextAuth adapter tables
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ─── Searches & Reports ───────────────────────────────────────────────────────

model Search {
  id           String    @id @default(cuid())
  userId       String?
  user         User?     @relation(fields: [userId], references: [id])

  // Entity identifiers
  entityAbn    String?
  entityName   String

  // Context captured at search time
  persona      Persona?
  projectType  String?   // new_build | renovation | commercial | subdivision | other
  projectStage String?   // not_signed | about_to_sign | contracted | underway
  projectState String?

  // Report data (written once stream completes)
  reportJson   Json?     // full structured { key: SearchResult } map
  riskSummary  String?   // Claude-generated markdown commentary
  isDeepCheck  Boolean   @default(false)

  // Contract upload path
  contractExtracted Json? // extracted fields from contract upload

  createdAt    DateTime  @default(now())

  // Relations
  shareableLink ShareableLink?
  timeline      ProjectTimeline?
  watchedBy     WatchlistItem[]

  @@index([entityAbn])
  @@index([userId])
  @@index([createdAt])
}

model ShareableLink {
  id        String   @id @default(cuid())
  searchId  String   @unique
  search    Search   @relation(fields: [searchId], references: [id])
  token     String   @unique @default(cuid())
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([token])
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

model WatchlistItem {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  entityAbn    String
  entityName   String
  lastSearchId String?
  lastSearch   Search?  @relation(fields: [lastSearchId], references: [id])
  createdAt    DateTime @default(now())

  @@unique([userId, entityAbn])
}

// ─── Project Timeline ─────────────────────────────────────────────────────────

model ProjectTimeline {
  id                 String    @id @default(cuid())
  userId             String
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  searchId           String    @unique
  search             Search    @relation(fields: [searchId], references: [id])
  projectValue       String?   // under_100k | 100k_500k | 500k_2m | 2m_plus
  projectState       String?
  contractSignedDate DateTime?
  startDate          DateTime?
  completionDate     DateTime?
  paymentSchedule    Json?     // [{ label: string, date: DateTime, amountCents: number }]
  financeArranged    Boolean?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

model MonitoringSubscription {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  entityAbn      String
  entityName     String
  active         Boolean  @default(true)
  stripeSubId    String?  @unique
  nextDailyCheck DateTime
  nextWeeklyCheck DateTime
  nextMonthlyCheck DateTime
  createdAt      DateTime @default(now())

  @@unique([userId, entityAbn])
}

model Alert {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  entityAbn   String
  entityName  String
  alertType   AlertType
  description String
  read        Boolean   @default(false)
  createdAt   DateTime  @default(now())

  @@index([userId, read])
}

// ─── Payments & Entitlements ──────────────────────────────────────────────────

model PackBalance {
  id         String   @id @default(cuid())
  userId     String   @unique
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  freeChecks Int      @default(0)
  deepChecks Int      @default(0)
  updatedAt  DateTime @updatedAt
}

model Payment {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id])
  stripePaymentId String      @unique
  amountCents     Int
  paymentType     PaymentType
  metadata        Json?       // e.g. { entityAbn, searchId }
  createdAt       DateTime    @default(now())
}

// ─── Email Sequences ──────────────────────────────────────────────────────────

model EmailSequenceState {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  searchId    String?
  sequenceKey String   // BEFORE_SIGN | DURING_BUILD | SUBCONTRACTOR | FINDINGS | CLEAN | RECHECK_30D | RECHECK_90D | PAYMENT_DUE
  step        Int      @default(0)
  nextSendAt  DateTime
  completed   Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([nextSendAt, completed])
}
```

---

## 4. API Contracts

### 4.1 Auth (NextAuth.js)

NextAuth.js handles session management. Config lives at `web/lib/auth.ts`.

**Providers:**
- `CredentialsProvider` — email + bcrypt-hashed password
- `GoogleProvider` — Google OAuth 2.0

**Adapter:** `@auth/prisma-adapter` (writes User, Account, Session, VerificationToken tables)

**Session strategy:** JWT (stateless; avoids DB hit on every request)

**Custom endpoints exposed by NextAuth:**
```
GET/POST /api/auth/[...nextauth]   — NextAuth handler (login, logout, OAuth callback)
```

**Additional auth routes (Next.js API routes):**
```
POST /api/auth/register            — new email/password account
  Body: { email, password, name? }
  Creates User + sends verification email via Resend
  Returns: { success: true }

POST /api/auth/forgot-password     — sends reset link
POST /api/auth/reset-password      — sets new password from token
```

---

### 4.2 Search API (Express, extended)

**Existing (unchanged shape):**
```
POST /api/search
Content-Type: application/json

Body:
{
  "name"?: string,
  "abn"?: string,
  "licenceNumber"?: string,
  "persona"?: Persona,
  "isDeepCheck"?: boolean    // new — triggers ASIC extract + AFSA NPII when true
}

Response: NDJSON stream
Content-Type: application/x-ndjson

Each line: SearchResult JSON
{
  "key": string,
  "source": string,
  "jurisdiction": string,
  "category": string,
  "results": ResultItem[],
  "searchUrl": string,
  "summary": string,
  "status": "found" | "not_found" | "unavailable",
  "riskLevel": "clear" | "findings" | "significant" | "unavailable"  // new
}

Terminal line (new — signals stream end):
{ "key": "__done__", "searchId": string }
```

**New endpoint — disambiguation:**
```
POST /api/search/disambiguate
Body: { "name": string }

Response:
{
  "matches": [
    {
      "entityName": string,
      "abn": string,
      "acn": string?,
      "state": string,
      "entityType": string,
      "registrationDate": string,
      "status": string
    }
  ]
}
```
Calls ABR name search and returns up to 10 matches for the disambiguation card.

**New endpoint — contract extraction:**
```
POST /api/extract
Content-Type: multipart/form-data

Body: { file: File }

Response:
{
  "extracted": {
    "builderName": string?,
    "abn": string?,
    "acn": string?,
    "licenceNumber": string?,
    "registeredAddress": string?,
    "projectAddress": string?,
    "projectState": string?,
    "worksDescription": string?,
    "contractPrice": number?,
    "commencementDate": string?,    // ISO date
    "completionDate": string?,
    "principalName": string?,
    "paymentSchedule": { label: string, dueDate: string, amount: number }[]?
  },
  "confidence": "high" | "medium" | "low",
  "warnings": string[]   // e.g. ["Image quality may reduce accuracy"]
}
```

---

### 4.3 User API (Next.js API routes)

```
GET  /api/user/profile
     Returns current user profile (persona, state, packBalance)

PATCH /api/user/profile
     Body: { persona?, state?, name? }
     Updates profile fields

GET  /api/user/searches
     Returns paginated list of past searches
     Query: ?page=1&limit=20
     Returns: { searches: SearchSummary[], total: number }

GET  /api/user/searches/:id
     Returns full report for a saved search (if owned by user)

POST /api/user/project-context
     Body: { searchId, projectValue?, startDate?, financeArranged?, contractSigned? }
     Saves post-report "About your project" panel data
```

---

### 4.4 Watchlist API

```
GET    /api/watchlist
       Returns all watchlist items with lastSearch summary

POST   /api/watchlist
       Body: { entityAbn, entityName }
       Adds to watchlist

DELETE /api/watchlist/:entityAbn
       Removes from watchlist
```

---

### 4.5 Project Timeline API

```
GET    /api/timeline/:searchId
       Returns project timeline for a search

POST   /api/timeline
       Body: { searchId, contractSignedDate?, startDate?, completionDate?, paymentSchedule?, projectValue?, projectState? }
       Creates or replaces timeline

PATCH  /api/timeline/:searchId
       Partial update
```

---

### 4.6 Payments API (Stripe)

```
POST /api/payments/create-intent
     Body: { paymentType: PaymentType, entityAbn?: string, searchId?: string }
     Creates a Stripe PaymentIntent
     Returns: { clientSecret: string, amountCents: number }

POST /api/payments/webhook
     Stripe webhook receiver (signature verified)
     On payment_intent.succeeded:
       - Records Payment row
       - Credits PackBalance if pack purchase
       - Activates MonitoringSubscription if monitoring purchase

GET  /api/payments/pack-balance
     Returns current { freeChecks, deepChecks }
```

**Prices (Stripe product IDs configured in env):**
| paymentType | Amount |
|---|---|
| RECHECK_SINGLE | $3.00 |
| RECHECK_5PACK | $12.00 |
| DEEP_CHECK_SINGLE | $15.00 (first search) / $18.00 (re-check) |
| DEEP_CHECK_5PACK | $49.00 |
| MONITORING_MONTHLY | $9.00/month |

---

### 4.7 Monitoring API

```
GET    /api/monitoring
       Returns active MonitoringSubscription list

POST   /api/monitoring
       Body: { entityAbn, entityName }
       Requires MONITORING_MONTHLY payment; creates subscription + Stripe subscription
       Enqueues first monitoring jobs in BullMQ

DELETE /api/monitoring/:entityAbn
       Cancels Stripe subscription; sets active = false

GET    /api/alerts
       Returns unread alerts for current user
       Query: ?read=false

PATCH  /api/alerts/:id
       Body: { read: true }
```

---

### 4.8 Sharing & PDF API

```
POST /api/share
     Body: { searchId }
     Creates ShareableLink (30-day expiry)
     Returns: { token, url, expiresAt }

GET  /api/share/:token
     Returns report JSON (no auth required)
     404 if expired

GET  /api/report/:searchId/pdf
     Streams PDF (generated server-side with Puppeteer)
     Auth required (own reports only) or valid share token via query param
```

---

### 4.9 Report Persistence (Next.js, called by frontend)

The browser frontend calls this after the NDJSON stream from the Express server completes:

```
POST /api/reports/save
     Body: {
       entityName: string,
       entityAbn?: string,
       persona: Persona,
       projectType?: string,
       projectStage?: string,
       projectState?: string,
       findings: { [key: string]: SearchResult },
       isDeepCheck: boolean
     }
     - Persists Search row + reportJson
     - Runs deterministic risk grouping (server-side, synchronous — see §7.2)
     - Enqueues email sequence job in BullMQ
     - Returns: { searchId: string }
```

---

## 5. Frontend Pages & Flows

### 5.1 Page map (`web/app/`)

```
/                           → Home (search bar hero)
/search                     → Searching screen (live NDJSON updates)
/report/[searchId]          → Report screen (own report, auth optional)
/report/share/[token]       → Report screen (shared, no auth)
/compare                    → Builder comparison (up to 3 side-by-side)
/account                    → Account dashboard (auth required)
/account/settings           → Profile, persona, state
/account/watchlist          → Watchlist
/account/reports            → Saved reports
/account/alerts             → Alert history
/account/monitoring         → Active monitoring subscriptions
/account/billing            → Pack balance, payment history
/auth/login                 → Login (email/password + Google)
/auth/register              → Register
/auth/forgot-password
/auth/reset-password
/auth/verify-email
```

### 5.2 Persona selection

**When shown:** First use (no persona in session/profile); step immediately after search input before email gate.

**UI:** Four icon cards in a row (responsive: 2-column on mobile). One tap selects + advances. Cannot be skipped.

```
"What best describes you?"

[ 🏠 Homeowner ]  [ 🔨 Subcontractor ]
[ 🏗️ Developer ]  [ 🏦 Lender ]
```

**State management:** Stored in localStorage for anonymous users; persisted to `User.persona` on account creation or login.

### 5.3 Email capture gate

**Trigger:** After persona selection, before search runs.

**First-time user layout:**
```
────────────────────────────────────────
Run your free builder check

Email                [___________________]
Send my report to:

State  [▾ Select state]    Project type  [▾ Select type]

         [ Run search → ]

Free, instant, no credit card.
Privacy policy · Unsubscribe any time
────────────────────────────────────────
```

Optional deep check add-on shown below CTA for first-time searches:
```
+ Include deep check ($15) — adds full director history + director personal insolvency
```

**Returning user (session exists):** Email gate is skipped; search runs immediately. Re-check fee prompt shown if entity was previously searched.

### 5.4 Contract upload flow

Entry point: "Upload your contract" button on HomeScreen.

**Step 1 — Upload:**
```
Drag and drop your building contract

Accepted: PDF · DOCX · JPG · PNG  (max 20MB)

[ Choose file ]  or drag here

"We extract key details to run your search.
 The document itself is not stored."
```

**Step 2 — Extracting (spinner, max 15s):**
```
Reading your contract…  ⟳
```

**Step 3 — Confirmation card (editable fields):**
```
Builder / contractor
[________________] (pre-filled from extraction)

ABN / ACN
[________________]

Licence number
[________________]

Project value          State
[▾ Select]             [▾ Select]

[ Not right? Edit above ]

                 [ Confirm and search → ]
```

After confirm → persona selection → email gate → search.

**Optional clause opt-in (below confirm button):**
```
☐ Help improve Australian contract standards — allow anonymised clause
  data from this contract to be used for benchmarking research.
  No identifying information is retained. Learn more.
```

### 5.5 Disambiguation flow

**Trigger:** Name search returns ≥2 ABR matches.

**UI:** Modal or interstitial card replacing the search input. Rendered before search runs.

```
We found multiple matching entities — which one are you checking?

┌──────────────────────────────────────────────────────┐
│ ACME CONSTRUCTIONS PTY LTD                           │
│ ABN 12 345 678 901  ·  QLD  ·  Pty Ltd               │
│ Registered: 15 Mar 2018  ·  Status: Active           │
│                             [ This one → ]           │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ ACME CONSTRUCTIONS (NSW) PTY LTD                     │
│ ABN 98 765 432 100  ·  NSW  ·  Pty Ltd               │
│ Registered: 02 Jun 2015  ·  Status: Active           │
│                             [ This one → ]           │
└──────────────────────────────────────────────────────┘

Not listed here? [ Refine search ]
```

### 5.6 Searching screen

One row per data source. States: `Searching…` → `Found` / `Not found` / `Unavailable`.

Each row shows source name, jurisdiction, status icon, and a brief count when found (e.g. "3 results").

Section progress groups rows by report section:
```
Identity & Corporate Structure
  ✓ Australian Business Register      Found
  ⟳ ASIC company search              Searching…

Licences & Registrations
  ✓ QBCC Licence Register            Found — 1 licence
  — NSW Fair Trading                 Check required (link)

Financial Risk Signals
  ✓ ASIC insolvency notices          No events found
  ⟳ ATO tax debt disclosures         Searching…
...
```

### 5.7 Report screen

**Layout (desktop):**
```
┌──────────────────────────────────────────┐
│ STICKY TABLE OF CONTENTS                 │
│ Risk Summary · 8.1 Identity · 8.2 Licences · 8.3 Financial │
│ 8.4 Payment · 8.5 Courts · 8.6 Manual Review              │
└──────────────────────────────────────────┘

[Risk Summary panel — anchored at top, renders after all sections]

[8.1 Identity & Corporate Structure]
  Risk badge: ● Findings — see below
  Entity card | Directors | Disqualified flag | ...

[8.2 Licences & Registrations]
  Risk badge: ✓ Clear
  ...

... (sections 8.3–8.6)

[About your project panel — optional, post-report]

[What to do next — 2–3 persona-tailored recommendations]
```

**Mobile:** Sections collapse to header + badge; expand on tap.

**Risk badges (icon + label, never colour alone):**
- `✓ Clear` — green
- `⚠ Findings — see detail` — amber
- `✗ Significant finding` — red
- `— Unavailable` — grey (with direct link)

**Recommendations:** Visually distinct (different background, labelled "Suggested next step"). One per section at most, never mid-section.

### 5.8 Account dashboard (`/account`)

Tabs: Saved Reports | Watchlist | Monitoring | Alerts | Billing

**Saved Reports:** Table of past searches. Staleness badge if >30 days. Re-check button (fee disclosed). Share + PDF buttons.

**Watchlist:** Builder cards with last-checked date and summary. Re-check button.

**Monitoring:** Active subscriptions with next-check date. Cancel button.

**Alerts:** Unread / read list. Each alert shows what changed + link to re-run.

**Billing:** Pack balance (free checks + deep checks). Payment history.

---

## 6. New Scrapers Required

All scrapers follow the standard return shape:  
`{ source, jurisdiction, category, results[], searchUrl, summary, riskLevel }`

New field: `riskLevel: "clear" | "findings" | "significant" | "unavailable"` — set by each scraper, used to populate the report badge without re-processing client-side.

### 6.1 ASIC Free Company Search

**File:** `server/scrapers/asic.js`  
**Source:** `https://connectonline.asic.gov.au` — free company search  
**Returns:** Company status, current directors (name + appointment date), registered office, share capital, number of registered charges  
**Method:** HTML scrape of ASIC Connect search results  
**Risk signals:** Status ≠ Registered; charge count > 0

### 6.2 ASIC Disqualified Directors Register

**File:** `server/scrapers/asicDisqualified.js`  
**Source:** `https://connectonline.asic.gov.au/RegistrySearch/faces/landing/byName.jspx` filtered to Disqualified Persons  
**Method:** Called once per director name found in ASIC free search  
**Returns:** Match or no-match per director  
**Risk signals:** Any match is a **critical** finding

### 6.3 ASIC Insolvency Notices

**File:** `server/scrapers/asicInsolvency.js`  
**Source:** ASIC Published Notices (`https://asic.gov.au/online-services/published-notices/`)  
**Method:** HTML scrape with entity name/ABN filter  
**Returns:** External administration notices, winding-up applications, liquidation appointments  
**Risk signals:** Any active notice is **critical**

### 6.4 ATO Tax Debt Disclosure

**File:** `server/scrapers/atoDebt.js`  
**Source:** ASIC Published Notices (ATO publishes via ASIC when debt > $100k, 90+ days overdue)  
**Method:** Filter ASIC notices for ATO disclosure category  
**Returns:** Disclosed debt amount and date  
**Risk signals:** Any disclosed ATO debt is **high**

### 6.5 Fair Work Ombudsman Compliance Register

**File:** `server/scrapers/fwo.js`  
**Source:** `https://www.fairwork.gov.au/about-us/compliance-and-enforcement/compliance-partnerships/proactive-compliance-deeds`  
**Method:** HTML scrape of FWO enforcement outcomes register  
**Returns:** Named enforcement orders and undertakings  
**Risk signals:** Any outcome is a **significant** finding

### 6.6 VIC Building and Plumbing Commission Disciplinary Register

**File:** `server/scrapers/vicBpc.js`  
**Source:** `https://www.vba.vic.gov.au/practitioners/find-a-practitioner` (disciplinary register tab)  
**Method:** HTML scrape  
**Returns:** Enforcement actions since 2018 — conditions, suspensions, cancellations  
**Risk signals:** Any action within 5 years is **significant**

### 6.7 WA Building and Energy Enforcement Actions

**File:** `server/scrapers/waBuildingEnergy.js`  
**Source:** `https://www.building.wa.gov.au/enforcement/disciplinary-actions`  
**Method:** HTML scrape of media releases (retained 6 years)  
**Returns:** Named enforcement outcomes  
**Risk signals:** Any outcome within 6 years is **significant**

### 6.8 ASIC Company Extract (Deep Check)

**File:** `server/scrapers/asicExtract.js`  
**Trigger:** `isDeepCheck: true` only  
**Source:** ASIC Data API (paid, $19 per extract)  
**Returns:** Full historical director list with appointment/resignation dates; complete charges register  
**Risk signals:** Director resigned from 2+ subsequently deregistered companies (phoenixing signal)

### 6.9 AFSA National Personal Insolvency Index (Deep Check)

**File:** `server/scrapers/afsaNpii.js`  
**Trigger:** `isDeepCheck: true` only; called once per current director  
**Source:** AFSA NPII API (paid, ~$3–5 per search)  
**Returns:** Personal bankruptcy, debt agreements, PIAs per director  
**Risk signals:** Any result for a current director is a **high** finding

---

## 7. Claude API Integration

### 7.1 Contract Extraction (`POST /api/extract`)

**Model:** `claude-opus-4-7` (most capable for document understanding)  
**Input:** Base64-encoded document or extracted text (via PDF.js or pdf-parse)  
**Prompt pattern:**

```
You are extracting structured data from an Australian building contract.
Return a JSON object with these fields (null if not found):
{
  builderName, abn, acn, licenceNumber, registeredAddress,
  projectAddress, projectState, worksDescription, contractPrice,
  commencementDate, completionDate, principalName,
  paymentSchedule: [{ label, dueDate, amount }]
}
Return only valid JSON. No commentary.
```

**Response handling:** Parse JSON; validate ABN format (11-digit check); set `confidence` based on how many key fields were extracted.

**Timeout:** 15 seconds. On timeout: return empty extraction with `confidence: "low"` and warning.

**Prompt caching:** Enable `cache_control` on the system prompt (static, >1024 tokens) to reduce latency on repeated calls.

### 7.2 Deterministic Risk Grouping (Risk Summary)

The Risk Summary is produced by a deterministic rule engine — not an LLM. This guarantees that identical findings always produce identical output, that every claim in the summary is directly traceable to a specific scraper result, and that the prescribed descriptions remain under editorial control.

**Module:** `web/lib/riskGrouper.ts`  
**Called by:** `POST /api/reports/save` (synchronous, after stream completes)  
**Input:** `{ [key: string]: SearchResult }` — the full findings map  
**Output:** `RiskGroupResult[]` — stored in `Search.riskSummary` as JSON

#### Risk groups

Five groups cover the full spectrum of construction due diligence risk. Each has a fixed `id`, `label`, and `description` — the description is prescribed static copy, never generated.

---

**`INSOLVENCY`** — Insolvency & Financial Distress

> *These results suggest the builder may be under financial stress or at risk of insolvency. A builder that enters administration mid-project typically leaves clients with unfinished work, progress payments lost, and a lengthy process to access home warranty cover. This risk is relevant regardless of project stage.*

Triggered by any of:
- `asicInsolvency` — any result (`riskLevel: "significant"`)
- `atoDebt` — any disclosed ATO debt (`riskLevel: "significant"`)
- `asicExtract` (deep check) — 2 or more related entities deregistered in the past 5 years (`riskLevel: "findings"`)
- `afsaNpii` (deep check) — personal insolvency for any current director (`riskLevel: "findings"`)
- `abn` — entity registered less than 2 years ago AND at least one other group is triggered (contextual modifier, not a standalone trigger)

Severity: `"significant"` if any active insolvency notice or ATO debt; `"findings"` otherwise.

---

**`PAYMENT`** — Late Payment & Subcontractor Disputes

> *These results indicate the builder has a history of late or disputed payments to subcontractors, suppliers, or workers. For homeowners, unpaid subcontractors can lodge charges directly against the property. For subcontractors and suppliers, these are direct indicators of payment risk on this engagement.*

Triggered by any of:
- `qbcc` — adjudication decisions where the builder is named as respondent
- `qbcc` — subcontractor charges lodged against a property
- `austlii_*` (any jurisdiction) — decisions identified as Security of Payment enforcement
- `fwo` — any Fair Work Ombudsman enforcement outcome
- `paymentTimes` — payment score below industry average for the entity's sector

Severity: `"significant"` if adjudication decisions or subcontractor charges exist; `"findings"` if payment times below average or FWO outcome.

---

**`LICENSING`** — Licensing & Regulatory Standing

> *These results indicate the builder may not hold the required licence for the contracted work, or has been subject to regulatory enforcement. In most states, an unlicensed contractor cannot legally take a deposit, and work performed without the correct licence may void home warranty insurance and complicate any defect claims.*

Triggered by any of:
- `qbcc` — licence expired, suspended, cancelled, or not found for the relevant state
- `qbcc` — disciplinary outcomes (conditions, suspensions, cancellations)
- `vicBpc` — enforcement action recorded within the past 5 years
- `waBuildingEnergy` — enforcement action recorded within the past 6 years
- `asicDisqualified` — any current director matches the ASIC disqualified persons register

Severity: `"significant"` if licence is not active or a director is disqualified; `"findings"` for disciplinary outcomes or regulatory actions.

---

**`LEGAL`** — Legal Proceedings & Dispute History

> *These results show the builder has been named in court or tribunal proceedings. Isolated proceedings are not unusual in the construction industry. Multiple or recent matters — particularly in superior courts, or involving regulatory bodies — suggest a pattern of dispute that warrants closer scrutiny.*

Triggered by:
- `austlii_*` (any jurisdiction) — 3 or more decisions found (`riskLevel: "findings"`); 6 or more (`riskLevel: "significant"`)
- `austlii_federal` specifically — any result (`riskLevel: "significant"`)
- `austlii_*` — any decision within the past 2 years where the builder appears as respondent/defendant (`riskLevel: "findings"`)

Severity: `"significant"` if Federal Court proceedings found or 6+ decisions across all jurisdictions; `"findings"` otherwise.

---

**`CORPORATE`** — Corporate Structure & Phoenix Risk

> *These results raise questions about the builder's corporate structure. Phoenix activity — where directors move assets from a failing company to a new entity to avoid paying creditors — is a known risk in the Australian construction industry. These signals do not confirm phoenixing but indicate a structure that warrants closer scrutiny of trading history before committing.*

Triggered by any of:
- `asic` — company status is not Active or Registered
- `asicDisqualified` — any current director matches the disqualified persons register
- `asicExtract` (deep check) — a director has resigned from 2 or more subsequently deregistered companies

Severity: `"significant"` if a director is disqualified or company status is not Active; `"findings"` for director history patterns.

---

#### Output type

```typescript
type RiskGroupResult = {
  id: "INSOLVENCY" | "PAYMENT" | "LICENSING" | "LEGAL" | "CORPORATE"
  label: string                   // e.g. "Insolvency & Financial Distress"
  description: string             // prescribed static copy as above
  severity: "significant" | "findings"
  triggers: {
    scraperKey: string            // e.g. "qbcc", "austlii_federal"
    finding: string               // e.g. "3 adjudication decisions found as respondent"
    anchor: string                // report section anchor link
  }[]
}
```

Groups with no triggers are omitted from the output. The Risk Summary panel renders only triggered groups, sorted severity-descending (`significant` before `findings`). If no groups are triggered, the panel renders a single "No significant findings" statement.

The `triggers` array provides the source-linked evidence for each group — every claim in the summary is directly traceable to a specific scraper result, with an anchor link to its section in the report.

---

## 8. Third-party Integrations

### 8.1 Stripe

- `stripe` npm package (server-side)
- `@stripe/stripe-js` + `@stripe/react-stripe-js` (client-side Elements)
- Products configured in Stripe Dashboard; price IDs in env
- Webhook endpoint at `POST /api/payments/webhook` — verify signature with `stripe.webhooks.constructEvent`
- For monitoring: Stripe Subscriptions (monthly billing, cancel any time)
- For one-time purchases: Stripe PaymentIntents

**Env vars:**
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_RECHECK_SINGLE
STRIPE_PRICE_RECHECK_5PACK
STRIPE_PRICE_DEEP_CHECK_SINGLE
STRIPE_PRICE_DEEP_CHECK_5PACK
STRIPE_PRICE_MONITORING_MONTHLY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

### 8.2 Resend (Email)

Used for: report delivery, verification emails, email sequences.

**Templates (React Email components at `web/emails/`):**
- `ReportEmail` — inline report summary + link to full report
- `VerifyEmail` — account verification
- `PasswordReset`
- `BeforeYouSign` — sequence for pre-contract homeowners/developers
- `DuringBuild` — sequence for contracted users
- `SubcontractorOnboarding` — sequence for subcontractor persona
- `FindingsAlert` — triggered when report has significant findings
- `CleanReport` — triggered when no significant findings
- `RecheckReminder30d` / `RecheckReminder90d`
- `PaymentDueReminder` — from project timeline
- `WatchlistAlert` — new AustLII/ASIC event for watched builder
- `ReEngagement` — 14-day no-engagement

**Env vars:**
```
RESEND_API_KEY
FROM_EMAIL=noreply@knowyourbuilder.com.au
```

### 8.3 Google OAuth

Via NextAuth.js `GoogleProvider`.  

**Env vars:**
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET
NEXTAUTH_URL
```

### 8.4 Cloudflare R2 (File Storage)

Used for contract uploads (temporary; deleted after extraction).

**Flow:**  
1. Client uploads file to Next.js API route  
2. API route streams to R2 with a TTL-based lifecycle rule (auto-delete after 1 hour)  
3. Express extraction endpoint reads from R2 URL  
4. Extraction completes; R2 object deleted  

For clause opt-in: anonymised JSON stored in a separate R2 bucket with no TTL.

**Env vars:**
```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_CONTRACTS
R2_BUCKET_CLAUSES
```

### 8.5 Anthropic Claude API

**Env vars:**
```
ANTHROPIC_API_KEY
```

Use `@anthropic-ai/sdk`. Use `claude-opus-4-7` for contract extraction (document understanding quality).

Enable prompt caching (`cache_control: { type: "ephemeral" }`) on the system prompt block to reduce latency on repeated uploads.

---

## 9. Background Jobs (BullMQ + Redis)

### 9.1 Queue definitions

```
web/lib/queues/
  monitoring.ts       — scheduled re-checks
  emailSequence.ts    — step-based email sequences
  pdfGeneration.ts    — pre-generate PDFs for completed reports
```

### 9.2 Monitoring job

**Enqueued by:** `POST /api/monitoring` (on subscription creation) and by the monitoring worker itself (re-enqueues after each run)

**Job payload:**
```typescript
{
  userId: string,
  entityAbn: string,
  entityName: string,
  checkType: "daily" | "weekly" | "monthly"
}
```

**Worker logic (`web/workers/monitoring.ts`):**
1. Call Express `/api/search` for the entity (same scraper pipeline)
2. Compare new findings against last stored `reportJson` for this entity
3. If delta detected (new court decision, licence change, insolvency notice, etc.):
   - Insert `Alert` row
   - Send `WatchlistAlert` email via Resend
4. Update `MonitoringSubscription.nextXxxCheck` timestamps
5. Re-enqueue next job

**Schedules:**
- `daily`: ASIC insolvency notices, ATO tax debt
- `weekly`: AustLII court decisions, FWO enforcement
- `monthly`: Licence registers (QBCC, deep links summary)

### 9.3 Email sequence job

**Enqueued by:** `POST /api/reports/save` (one job per applicable sequence)

**Job payload:**
```typescript
{
  userId: string,
  searchId: string,
  sequenceKey: string,
  step: number
}
```

**Worker logic:**
1. Look up `EmailSequenceState` for `userId + sequenceKey`
2. Send the email for the current step
3. Mark step complete; schedule next step if any

**Sequence definitions (hard-coded in worker):**

| sequenceKey | Persona | Steps |
|---|---|---|
| BEFORE_SIGN | Homeowner / Developer | 0: report summary + checklist; 1 (day 3): contract review offer; 2 (day 7): HWI reminder |
| DURING_BUILD | Any (contracted) | 0: monitoring offer; 1 (day 7): stage inspection offer |
| SUBCONTRACTOR | Subcontractor | 0: PPSR offer; 1 (day 3): trade credit insurance offer |
| FINDINGS | Any | 0: plain-language findings summary + recommended action |
| CLEAN | Any | 0: "checks out" email + persona-appropriate next steps |
| RECHECK_30D | Any (project ongoing) | 0: re-check reminder |
| RECHECK_90D | Any | 0: re-check reminder |
| PAYMENT_DUE | Any (timeline set) | 0: payment-due prompt (sent 2 days before each payment date) |
| REENGAGEMENT | Any | 0: report summary + return link (sent at day 14 if no further engagement) |

---

## 10. Environment Variables (complete)

### Next.js (`web/.env.local`)
```
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Express scraping service
SCRAPING_SERVICE_URL=http://localhost:3001

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_RECHECK_SINGLE=price_...
STRIPE_PRICE_RECHECK_5PACK=price_...
STRIPE_PRICE_DEEP_CHECK_SINGLE=price_...
STRIPE_PRICE_DEEP_CHECK_5PACK=price_...
STRIPE_PRICE_MONITORING_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...

# Resend
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@knowyourbuilder.com.au

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_CONTRACTS=kyb-contracts
R2_BUCKET_CLAUSES=kyb-clauses

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

### Express server (`server/.env`)
```
PORT=3001
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 11. Implementation Phases

Phases are sized to complete within a single context window (roughly 8–12 file operations each). Each phase has a concrete exit criterion — something runnable or testable that confirms the work is done before moving on.

**Convention:** At the end of each phase, update `CLAUDE.md` with a brief note on any new conventions, key file paths, or architectural decisions made during that phase. This ensures the next session starts with that context available.

---

### Phase 1a — Next.js scaffold + Prisma schema

**Files created:**
- `web/package.json` — Next.js 14, Prisma, NextAuth, Resend, Stripe, BullMQ, React Email dependencies
- `web/tsconfig.json`
- `web/next.config.ts`
- `web/app/layout.tsx` — root layout (fonts, global styles, session provider shell)
- `web/app/globals.css`
- `web/lib/db.ts` — Prisma client singleton
- `web/prisma/schema.prisma` — full schema from §3.1
- `web/.env.local.example`

**Exit criteria:** `cd web && npm install && npx prisma db push` runs without error.

---

### Phase 1b — Shared types, theme, and API client

**Files read:** `src/theme.ts`, `src/types/index.ts`, `src/services/api.ts`  
**Files created:**
- `web/src/theme.ts` — port with web-specific additions (no React Native units)
- `web/src/types/index.ts` — port + add `RiskGroupResult`, `Persona` enum
- `web/lib/api.ts` — port `runDueDiligence()` and `checkServer()` for browser fetch + NDJSON

**Exit criteria:** TypeScript compiles cleanly (`npx tsc --noEmit`) with no errors.

---

### Phase 1c — Home screen

**Files read:** `src/screens/HomeScreen.tsx`, `src/components/FormInput.tsx`, `src/components/DirectorInput.tsx`  
**Files created:**
- `web/app/page.tsx` — search bar hero, no persona/gate yet (stubs for those steps)
- `web/components/SearchBar.tsx` — name / ABN / licence number input with validation

**Exit criteria:** `npm run dev` serves the homepage at `localhost:3000`; search bar renders and basic client-side validation works.

---

### Phase 1d — Searching screen

**Files read:** `src/screens/SearchingScreen.tsx`, `src/components/SearchProgressItem.tsx`  
**Files created:**
- `web/app/search/page.tsx` — NDJSON stream reader, per-row live status
- `web/components/SearchProgressItem.tsx` — single source row (Searching / Found / Not found / Unavailable states)

**Exit criteria:** Submitting a search navigates to `/search`, rows update live as results arrive from Express.

---

### Phase 1e — Report screen

**Files read:** `src/screens/ReportScreen.tsx`, `src/components/ReportSection.tsx`, `src/components/ResultCard.tsx`  
**Files created:**
- `web/app/report/[searchId]/page.tsx` — six-section layout, sticky ToC, collapsible sections on mobile
- `web/components/ReportSection.tsx` — section wrapper with risk badge slot
- `web/components/ResultCard.tsx` — individual result card with source link
- `web/components/RiskBadge.tsx` — icon + label badge (never colour-only)

**Exit criteria:** Navigating to `/report/[searchId]` renders a complete report from stored `reportJson`.

---

### Phase 1f — Persona selection + email gate + report persistence + email delivery

**Files created:**
- `web/components/PersonaSelector.tsx` — four icon cards (Homeowner / Subcontractor / Developer / Lender)
- `web/components/EmailGate.tsx` — email field, state/project-type pills, deep check opt-in
- `web/app/api/reports/save/route.ts` — persists `Search` row, stores `reportJson`; risk grouping stubbed (returns `null` until Phase 2)
- `web/lib/resend.ts` — Resend client
- `web/emails/ReportEmail.tsx` — report delivery email (summary + link to full report)

**Exit criteria:** Full anonymous flow works end-to-end — search → live progress → report → report email received. Deploy to Vercel + Railway (Express) and confirm the flow works in production.

---

### Phase 2 — Risk grouping engine + Risk Summary panel

**Files created:**
- `web/lib/riskGrouper.ts` — deterministic engine mapping `SearchResult[]` to `RiskGroupResult[]` per §7.2
- `web/components/RiskSummaryPanel.tsx` — renders triggered groups with prescribed descriptions and source-linked trigger bullets; "No significant findings" fallback

**Files edited:**
- `web/app/api/reports/save/route.ts` — call `riskGrouper()` synchronously; store result in `Search.riskSummary`
- `web/app/report/[searchId]/page.tsx` — render `<RiskSummaryPanel>` at top of report after stream completes; add `riskLevel` badge to each `<ReportSection>`

**Exit criteria:** Completed reports show the Risk Summary panel. Running the same search twice produces identical Risk Summary output.

---

### Phase 3a — Auth (NextAuth + registration)

**Files created:**
- `web/lib/auth.ts` — NextAuth config: `CredentialsProvider` + `GoogleProvider`, Prisma adapter, JWT session strategy
- `web/app/api/auth/[...nextauth]/route.ts`
- `web/app/api/auth/register/route.ts` — email + bcrypt password, sends verification email
- `web/app/auth/login/page.tsx`
- `web/app/auth/register/page.tsx`
- `web/emails/VerifyEmail.tsx`

**Exit criteria:** User can register, verify email, log in with credentials, log in with Google, and log out. Session persists across page reloads.

---

### Phase 3b — Account dashboard shell + Saved Reports tab

**Files created:**
- `web/app/account/layout.tsx` — dashboard shell with tab nav (Reports | Watchlist | Monitoring | Alerts | Billing)
- `web/app/account/page.tsx` — redirects to `/account/reports`
- `web/app/account/reports/page.tsx` — paginated saved reports list
- `web/app/api/user/searches/route.ts` — `GET` returns paginated searches for current user
- `web/components/ReportCard.tsx` — report summary card with staleness badge, Re-check / Share / PDF button stubs

**Exit criteria:** Logged-in user sees their past searches at `/account/reports` with correct staleness indicators.

---

### Phase 3c — PDF export + shareable links

**Files created:**
- `web/app/api/report/[searchId]/pdf/route.ts` — Puppeteer renders `/report/[searchId]` and streams PDF; auth check (own report or valid share token)
- `web/app/api/share/route.ts` — `POST` creates `ShareableLink` (30-day expiry); `GET /api/share/:token` returns report JSON
- `web/app/report/share/[token]/page.tsx` — read-only report view (no auth required, 404 if expired)

**Files edited:**
- `web/components/ReportCard.tsx` — wire Share and PDF buttons to real endpoints

**Exit criteria:** PDF downloads correctly for own reports; share links work without auth and return 404 after 30 days.

---

### Phase 4a — File upload + R2 storage

**Files created:**
- `web/lib/r2.ts` — S3-compatible R2 client (upload, delete, presigned URL)
- `web/app/api/upload/route.ts` — receives multipart file, streams to R2 with 1-hour lifecycle, returns `{ r2Key, fileType, warning? }`
- `web/components/ContractUpload.tsx` — drag-and-drop zone, file type/size validation, upload progress, replaces search bar on the home page when active

**Exit criteria:** A PDF uploaded via the UI lands in R2 and the key is returned to the browser. Non-PDF/DOCX/image files are rejected client-side.

---

### Phase 4b — Claude extraction + confirmation card + clause opt-in

**Files created:**
- `server/scrapers/contractExtractor.js` — reads file from R2, sends to Claude API (`claude-opus-4-7`), returns structured extraction JSON
- `web/components/ExtractionConfirmCard.tsx` — displays extracted fields (all editable), confidence warning if low, clause opt-in checkbox

**Files edited:**
- `server/index.js` — add `POST /api/extract` endpoint (calls `contractExtractor`, deletes R2 object after)
- `web/app/page.tsx` — wire upload path: upload → poll `/api/extract` → show `ExtractionConfirmCard` → on confirm, advance to persona selection

**Exit criteria:** Uploading a building contract pre-populates the confirmation card. User can edit fields before proceeding. R2 object is deleted after extraction.

---

### Phase 5 — Disambiguation

**Files created:**
- `web/components/DisambiguationCard.tsx` — list of entity matches, each with name / ABN / state / type / registration date / "This one" button
  
**Files edited:**
- `server/scrapers/abn.js` — add `searchByName()` export returning up to 10 matches from ABR
- `server/index.js` — add `POST /api/search/disambiguate` endpoint
- `web/app/page.tsx` — after name search submit, call `/api/search/disambiguate`; if >1 match, render `DisambiguationCard` before advancing; if exactly 1 or ABN/licence search, advance immediately

**Exit criteria:** Searching "Smith Construction" shows a disambiguation card when multiple entities match. Selecting one advances to persona selection with the correct ABN pre-set. ABN searches skip disambiguation.

---

### Phase 6a — ASIC scrapers: company search + disqualified directors

**Files created:**
- `server/scrapers/asic.js` — scrapes ASIC Connect: company status, current directors + appointment dates, registered office, charge count
- `server/scrapers/asicDisqualified.js` — checks each director name against ASIC disqualified persons register; returns match/no-match per director

**Files edited:**
- `server/index.js` — add `asic` and `asicDisqualified` to the searches array; `asicDisqualified` runs after `asic` resolves (directors needed as input)
- `web/app/report/[searchId]/page.tsx` — add ASIC results to section 8.1 (Identity); render disqualified director flag as critical banner if any match
- `web/lib/riskGrouper.ts` — add `CORPORATE` group triggers for `asic` status and `asicDisqualified` matches

**Exit criteria:** Reports show ASIC company status and current directors. A disqualified director match renders a red critical banner in section 8.1 and triggers the CORPORATE risk group.

---

### Phase 6b — ASIC insolvency notices + ATO tax debt

**Files created:**
- `server/scrapers/asicInsolvency.js` — scrapes ASIC Published Notices for external administration, winding-up, and liquidation entries matching the entity
- `server/scrapers/atoDebt.js` — filters ASIC Published Notices for ATO debt disclosure category

**Files edited:**
- `server/index.js` — add `asicInsolvency` and `atoDebt` to searches array
- `web/app/report/[searchId]/page.tsx` — add to section 8.3 (Financial Risk); insolvency notice renders as full-width red banner at top of section
- `web/lib/riskGrouper.ts` — add `INSOLVENCY` group triggers for both scrapers

**Exit criteria:** Reports for entities with ASIC insolvency notices show a red banner in section 8.3 and trigger the INSOLVENCY risk group in the Risk Summary.

---

### Phase 6c — FWO + VIC BPC + WA Building & Energy scrapers

**Files created:**
- `server/scrapers/fwo.js` — scrapes FWO enforcement outcomes register
- `server/scrapers/vicBpc.js` — scrapes VIC Building and Plumbing Commission disciplinary register
- `server/scrapers/waBuildingEnergy.js` — scrapes WA Building and Energy enforcement media releases

**Files edited:**
- `server/index.js` — add all three to searches array
- `web/app/report/[searchId]/page.tsx` — add FWO results to section 8.5 (Courts/Disciplinary); VIC BPC and WA Building & Energy as subsections under 8.5 with jurisdiction labels
- `web/lib/riskGrouper.ts` — add `LICENSING` group triggers for VIC BPC and WA Building & Energy; `PAYMENT` group trigger for FWO

**Exit criteria:** FWO, VIC BPC, and WA enforcement results appear in section 8.5 for affected entities. Appropriate risk groups are triggered in the Risk Summary.

---

### Phase 7a — Stripe setup + PaymentIntent flow

**Files created:**
- `web/lib/stripe.ts` — Stripe server client
- `web/app/api/payments/create-intent/route.ts` — creates `PaymentIntent` for one-time purchases; records `Payment` row on success
- `web/app/api/payments/webhook/route.ts` — verifies Stripe signature; on `payment_intent.succeeded` credits `PackBalance` if pack purchase
- `web/components/PaymentModal.tsx` — Stripe Elements card form, amount display, submit

**Exit criteria:** A test payment of $3.00 (RECHECK_SINGLE) completes in Stripe test mode, PaymentIntent webhook fires, and `PackBalance` is credited.

---

### Phase 7b — Re-check gate + pack balance display

**Files edited:**
- `web/components/EmailGate.tsx` — for returning users whose email matches a prior search on the same entity, show re-check pricing instead of "free" copy; gate the search behind payment if no pack balance
- `web/app/api/reports/save/route.ts` — before persisting, check if this entity was previously searched by this user; if so, require a re-check entitlement (pack balance or new payment)
- `web/app/account/reports/page.tsx` — wire Re-check button to PaymentModal or decrement pack balance directly if available

**Files created:**
- `web/app/api/payments/pack-balance/route.ts` — `GET` returns `{ freeChecks, deepChecks }` for current user

**Exit criteria:** A returning user searching a previously checked entity sees the re-check price gate. Purchasing a pack or single re-check allows the search to proceed.

---

### Phase 7c — Deep check scrapers

**Files created:**
- `server/scrapers/asicExtract.js` — calls ASIC Data API (paid); returns full historical director list + charges register; only runs when `isDeepCheck: true`
- `server/scrapers/afsaNpii.js` — calls AFSA NPII API per director (paid); only runs when `isDeepCheck: true`

**Files edited:**
- `server/index.js` — add both scrapers to searches array, gated on `isDeepCheck`
- `web/app/report/[searchId]/page.tsx` — render deep check sections (historical directors, charges detail, director personal insolvency) under 8.1 and 8.3 with "Deep check" label
- `web/lib/riskGrouper.ts` — add deep-check triggers: `INSOLVENCY` group for `afsaNpii` results and related entity deregistrations from `asicExtract`; `CORPORATE` group for director resignation patterns

**Exit criteria:** A deep check search returns historical director data and director personal insolvency results. Deep check sections render in the report with appropriate labels.

---

### Phase 8a — BullMQ + Redis setup + monitoring worker

**Files created:**
- `web/lib/redis.ts` — Redis client (ioredis)
- `web/lib/queues/monitoring.ts` — BullMQ queue definition + helper to enqueue monitoring jobs
- `web/workers/monitoring.ts` — worker: calls Express `/api/search`, diffs against last `reportJson`, inserts `Alert` rows for changes

**Exit criteria:** Manually enqueuing a monitoring job via the queue runs a search and inserts an `Alert` row when a change is detected. Worker handles errors gracefully (failed jobs go to dead-letter queue, not crash).

---

### Phase 8b — Monitoring subscription purchase flow

**Files created:**
- `web/app/api/monitoring/route.ts` — `POST` creates `MonitoringSubscription` + Stripe Subscription; `DELETE` cancels both; `GET` returns active subscriptions
- `web/app/account/monitoring/page.tsx` — subscription list with entity name, next-check date, cancel button

**Files edited:**
- `web/app/api/payments/webhook/route.ts` — handle `customer.subscription.deleted` to set `MonitoringSubscription.active = false`
- `web/lib/queues/monitoring.ts` — enqueue initial daily/weekly/monthly jobs when subscription is created

**Exit criteria:** User purchases monitoring for an entity; Stripe subscription is created; monitoring jobs are enqueued; subscription appears in the dashboard; cancellation stops billing and deactivates the subscription.

---

### Phase 8c — Alert system + alert email

**Files created:**
- `web/app/api/alerts/route.ts` — `GET` returns alerts (filterable by `read`); `PATCH /:id` marks read
- `web/app/account/alerts/page.tsx` — unread/read alert list; each alert shows what changed + "Re-run search ($3)" link
- `web/emails/WatchlistAlert.tsx` — alert email: plain-language change description + re-run CTA

**Files edited:**
- `web/workers/monitoring.ts` — after inserting `Alert` row, send `WatchlistAlert` email via Resend

**Exit criteria:** When the monitoring worker detects a change, an `Alert` row is created, the alert appears in the dashboard, and an email is sent to the user.

---

### Phase 9a — Watchlist

**Files created:**
- `web/app/api/watchlist/route.ts` — `GET` list; `POST` add; `DELETE /:entityAbn` remove
- `web/app/account/watchlist/page.tsx` — builder cards showing entity name, last-checked date, findings summary; Re-check and Remove buttons

**Files edited:**
- `web/app/report/[searchId]/page.tsx` — "Add to watchlist" button in report header (toggles; shows current state)

**Exit criteria:** User can add a builder to their watchlist from a report, view it in the dashboard, re-check it (respecting entitlement), and remove it.

---

### Phase 9b — Project timeline

**Files created:**
- `web/app/api/timeline/route.ts` — `POST` create; `PATCH /:searchId` update; `GET /:searchId` retrieve
- `web/components/ProjectTimeline.tsx` — milestone entry form: contract signed date, start date, completion date, payment schedule entries, project value bucket, finance arranged

**Files edited:**
- `web/app/report/[searchId]/page.tsx` — render `<ProjectTimeline>` in the post-report "About your project" panel (collapsed by default, expands on tap)

**Exit criteria:** User can enter and save a project timeline from a report. Timeline data persists and reloads on return visits.

---

### Phase 9c — Email sequence engine

**Files created:**
- `web/lib/queues/emailSequence.ts` — BullMQ queue definition; helper `enqueueSequence(userId, searchId, sequenceKey)` that creates `EmailSequenceState` row and enqueues first job
- `web/workers/emailSequence.ts` — worker: reads `EmailSequenceState`, sends current step's email via Resend, schedules next step if any, marks complete when done

**Files edited:**
- `web/app/api/reports/save/route.ts` — after persisting report, call `enqueueSequence` for the applicable sequences based on persona and findings (BEFORE_SIGN, DURING_BUILD, SUBCONTRACTOR, FINDINGS, CLEAN, REENGAGEMENT)

**Exit criteria:** Completing a search enqueues the correct sequence for the persona. The worker sends the first email and schedules the second step. Sequences do not double-send on repeated runs.

---

### Phase 9d — Email sequence templates (part 1)

**Files created:**
- `web/emails/BeforeYouSign.tsx` — pre-contract homeowner/developer: report summary checklist, contract review offer, HWI check
- `web/emails/DuringBuild.tsx` — contracted users: monitoring offer, stage inspection offer
- `web/emails/SubcontractorOnboarding.tsx` — subcontractor/supplier: PPSR registration offer, trade credit insurance
- `web/emails/FindingsAlert.tsx` — significant findings: plain-language summary of top risk groups, relevant recommended action
- `web/emails/CleanReport.tsx` — no significant findings: confirmation + persona-appropriate next steps

**Exit criteria:** All five templates render correctly in React Email preview. No broken variable references.

---

### Phase 9e — Email sequence templates (part 2) + re-engagement

**Files created:**
- `web/emails/RecheckReminder.tsx` — 30-day and 90-day re-check reminder (single template with `dayCount` prop)
- `web/emails/PaymentDueReminder.tsx` — triggered 2 days before each payment schedule milestone; includes re-check CTA and stage inspection offer
- `web/emails/ReEngagement.tsx` — 14-day no-engagement: report summary, return link
- `web/emails/PasswordReset.tsx`

**Files edited:**
- `web/workers/emailSequence.ts` — wire `RECHECK_30D`, `RECHECK_90D`, `PAYMENT_DUE` sequences (triggered by timeline dates via BullMQ delayed jobs)

**Exit criteria:** All templates render. Payment-due emails fire correctly relative to timeline dates stored in the database.

---

### Phase 10a — Builder comparison view

**Files created:**
- `web/app/compare/page.tsx` — up to 3 builders side-by-side; each column is a compact report summary; accepts `?ids=searchId1,searchId2,searchId3` query param
- `web/components/ComparisonColumn.tsx` — single-builder column: entity name, risk group badges, per-section summary rows

**Exit criteria:** `/compare?ids=id1,id2` renders a valid side-by-side comparison. Up to 3 builders; attempting 4 shows an error.

---

### Phase 10b — Staleness banners + re-check prompts

**Files edited:**
- `web/app/account/reports/page.tsx` — show staleness badge ("X days old") on reports >30 days; inline re-check CTA with price disclosed
- `web/app/report/[searchId]/page.tsx` — if report is >30 days old, show a top-of-page banner: "This report is X days old — a lot can change. Re-run for $3 / $18 including deep check."

**Exit criteria:** Reports older than 30 days show the staleness banner on the dashboard and at the top of the report screen.

---

### Phase 10c — WCAG + performance + analytics

**No new files.** Edits across existing components:
- Audit all colour usage — every risk badge must have icon + label (never colour alone)
- Add `aria-label` to all external links (`target="_blank"`)
- Confirm all report sections are keyboard-navigable (focus ring visible, tab order logical)
- Add basic analytics events (email capture rate, persona selection, partner link clicks) via a lightweight provider (e.g. Plausible or a simple `POST /api/events` endpoint)
- Load-test the Express scraping service; confirm p90 report time is under 45 seconds

**Exit criteria:** Lighthouse accessibility score ≥ 90. No colour-only risk indicators remain. p90 report time measured and documented.

---

## 12. Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | Next.js 14 App Router | Web-first per SPEC; SSR for shareable report URLs; NextAuth.js for auth; routing needed for dashboard, share links, PDF |
| Retain Express scraping service | Yes | NDJSON streaming is a core constraint; scrapers already working; no reason to rewrite |
| Database | PostgreSQL + Prisma | Relational model suits user-search-timeline-payment graph; Prisma gives type safety + migrations |
| Auth | NextAuth.js | Google OAuth + credentials out of the box; Prisma adapter; standard for Next.js |
| Email | Resend + React Email | Developer-friendly; React Email for template components; good deliverability |
| Payments | Stripe | Industry standard; supports subscriptions for monitoring |
| File storage | Cloudflare R2 | S3-compatible; zero egress fees; lifecycle rules for auto-deletion |
| Background jobs | BullMQ + Redis | Robust job queues for monitoring and email sequences; retry logic; schedule support |
| Risk Summary | Deterministic rule engine (`riskGrouper.ts`) | Identical findings → identical output; every claim is source-linked; prescribed descriptions under editorial control; no LLM non-determinism or latency |
| Contract extraction model | `claude-opus-4-7` | Best document understanding; used only once per upload |
| No mobile app | — | SPEC §17 explicitly rules it out; Next.js responsive design covers 375px–1440px |
```
