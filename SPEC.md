# Know Your Builder — Product Specification

**Version:** 1.5  
**Date:** 2026-05-18  
**Status:** Draft

---

## 1. Product Vision

Know Your Builder is a free due diligence tool for anyone considering going into business with an Australian builder or property developer. It produces an instant, structured risk report by querying government and public databases in real time.

**The primary objective is building lasting relationships with users.** People who search a builder are in active procurement for a construction project — often the largest financial commitment of their lives. That intent signal, combined with project context captured during the search flow, makes each user a valuable connection for a range of adjacent services. Revenue from those referral relationships, alongside modest direct fees, is how the product sustains itself. It is not designed to maximise revenue; it is designed to cover operating costs and generate a modest profit while providing a genuinely useful public service.

The report is free. The product earns trust by giving away something useful, which is what makes users return, refer others, and accept follow-on offers when they are genuinely relevant. Subsequent paid features — re-checks, watchlists, and monitoring — are priced on a small pay-as-you-go basis that reflects the secondary role of direct revenue: modest cost recovery, not extraction.

---

## 2. User Personas

Users select their persona early in the flow. The selection is quick and required — it takes a single tap from a labelled icon card. It does not gate the search, but it shapes which recommendations are presented throughout the report, how the Risk Summary frames its commentary, and the email sequences that follow.

| Persona | Primary concern | Adjacent product opportunity |
|---|---|---|
| Homeowner / owner-builder | Will my builder complete the job and not go broke mid-project? | Construction finance, building inspections, home warranty insurance, contract review |
| Subcontractor / supplier | Will I get paid, and is this builder financially stable? | Trade credit insurance, PPSR registration services, debt recovery |
| Property developer | Does my head contractor have a clean legal and regulatory record? | Construction finance, legal services, project management tools |
| Financier / lender | Does this builder present credit or insolvency risk? | Credit reporting services, valuation services |
| Commercial tenant / landlord | Is this construction company a reliable counterparty? | Legal services, building inspections |

The persona is stored against the user's profile and used to route referral recommendations and personalise email sequences. If a user's use case spans multiple personas (e.g. a developer who is also financing the project), they select the one that best represents their primary exposure. The selection can be changed from account settings at any time.

---

## 3. Core Value Proposition

- **Free and instant.** The full report using all free data sources is always free on first search. No paywall on core functionality.
- **Start from your contract.** Users can upload their building contract and the product extracts entity details automatically — no need to know the ABN or legal entity name.
- **Breadth across all states.** A single search covers licensing, courts, payment behaviour, corporate history, and financial risk signals nationwide.
- **Risk-first framing.** Each section answers a specific risk question in plain language, not a data dump.
- **Transparent sourcing.** Every finding links to its primary source for independent verification.
- **Grows with your project.** The product stays useful beyond the initial check — watchlists, re-check reminders, and monitoring keep users engaged across the life of their project.

---

## 4. Search Input

A search can be initiated in two ways:

### 4.1 Manual search

The user enters one or more of the following:

| Input | Purpose |
|---|---|
| Builder / company name | Triggers name-based lookup across all sources |
| ABN or ACN | Resolves exact entity; handles ambiguous names |
| Licence number | Useful when name is unknown or ambiguous |

**Disambiguation.** Name searches frequently return multiple matching entities. When this occurs, the user is shown a disambiguation card for each match — displaying entity name, ABN, state, entity type, and registration date — before the full search runs. A "Not this one" option pages through results. ABN and licence number searches resolve unambiguously and skip this step.

### 4.2 Contract upload

The user uploads a copy of their building contract. The product extracts entity identifiers automatically and pre-populates the search. See section 6 for full specification.

Both paths converge at the persona selection step, then the email capture gate, before the search runs.

**Multi-entity awareness.** Volume builders frequently operate across 10–100+ related ABNs. Where ASIC data reveals related entities sharing directors or addresses, the report flags them and offers to extend the search. This is the primary phoenixing detection mechanism.

---

## 5. User Data Strategy

The product's core commercial asset is its user relationships. Every interaction is designed to capture context that enables relevant follow-up — without feeling like a form or a friction point.

### 5.1 Data captured at search

The persona selection step precedes the email gate and is the first meaningful data point captured. Before results load, the user then provides their email and optional project context.

**Persona selection (required, pre-search):**
- One of: Homeowner / owner-builder; Subcontractor or supplier; Property developer; Financier or lender; Commercial tenant or landlord
- Shown as icon cards on first use; retained for subsequent sessions and editable from the account profile

**Email (required):**
- Primary identifier; used to deliver the report and for follow-up

**Optional (pill selectors inline below the email field):**
- State / territory — scopes licence register links and partner recommendations
- Project type — new build / renovation / commercial / subdivision / other
- Project stage — haven't signed yet / about to sign / already contracted / project underway

The optional questions are framed as improving search relevance. No compulsion.

### 5.2 Data captured post-report

At the bottom of a completed report, an optional panel invites the user to add:
- Approximate project value (under $100k / $100k–$500k / $500k–$2M / $2M+)
- Planned start date
- Whether finance is arranged
- Whether a building contract is signed

Framed as unlocking a personalised checklist. Expected completion rate: 20–40%.

### 5.3 Data model

Each profile stores: email, name (if provided), persona, search history, project context, and engagement signals (reports viewed, links clicked, monitoring active). This profile compounds with each return visit and is the foundation for the referral model.

### 5.4 Consent and privacy

- Disclosed at the email capture step: "We'll email you your report and occasional relevant offers. Unsubscribe any time."
- Data is never sold. Partners receive qualified referrals, not raw data.
- Users can delete their account and all data at any time.
- Privacy policy linked from the capture form.

---

## 6. Contract Intelligence (Upload Path)

### 6.1 Purpose

Many users have a contract in hand but do not know the builder's ABN or legal entity name. The contract may show a trading name or a project-specific subsidiary. The upload path removes this friction and captures richer project context as a side-effect.

### 6.2 Accepted formats

- PDF (most contracts)
- DOCX / DOC
- Image files (JPG, PNG) — treated as scanned documents; accuracy is lower and the user is warned

File size limit: 20MB. Single document only in v1.

### 6.3 Extraction targets

**Entity identifiers (used to run the search):**
- Builder / contractor legal entity name
- ABN or ACN
- Builder's licence number
- Builder's registered address

**Project context (used for lead qualification and recommendations):**
- Project address / state
- Nature of works
- Contract price / project value
- Commencement and practical completion dates
- Payment schedule structure
- Principal's name (for personalisation)

Not all fields will be present in every contract. The system extracts what it can and prompts for confirmation before searching.

### 6.4 Extraction approach

Server-side extraction via the Claude API with a purpose-built structured extraction prompt. This handles variation in contract layout better than regex. Extracted fields returned as structured JSON, displayed for user confirmation before the search runs. Target: extraction and confirmation within 15 seconds of upload.

### 6.5 Confirmation step

After extraction, the user sees a pre-populated card (all fields editable):
- Builder name, ABN/ACN, licence number
- Project value and state (used for scoping, not searching)

The user confirms or corrects, then proceeds to the persona selection step and email capture gate. The confirmation replaces the manual search field.

### 6.6 Data handling

Contract documents are discarded after extraction by default. Extracted structured fields are stored as part of the user profile. Disclosed at upload: *"We extract key details from your contract to run your search. The document itself is not stored."*

**Anonymised clause data (opt-in).** Users may separately consent to their contract being retained in anonymised form for the purpose of clause benchmarking. If they opt in, the document is processed to strip all identifying information — entity names, addresses, personal names, and specific project references replaced with category placeholders — before being stored as structured clause data (JSON schema). The anonymised clause data has no link back to the individual user or entity. The purpose is to build a dataset of standard and non-standard risk allocation terms across Australian construction contracts, which may support a future product feature allowing users to compare their own contract terms against industry norms. This consent step is presented separately from the main upload flow; it is entirely optional and clearly distinguished from the primary extraction-for-search use. Infrastructure is built to accommodate this dataset; the end-user benchmarking product is not in scope for v1 (see section 19).

---

## 7. Adjacent Products & Partner Ecosystem

These are the services Know Your Builder connects users to based on their persona, project profile, and report findings. Presented as helpful next steps, not advertisements. Persona is the primary routing signal — only recommendations relevant to the selected persona are shown.

### 7.1 Construction finance

**Trigger:** Homeowner, developer, or lender persona; user has not arranged finance, or project value > $100k.  
**Offer:** "Compare construction loan rates from [X] lenders."  
**Revenue:** Referral fee per settled loan or per qualified lead.

### 7.2 Building & pest inspections

**Trigger:** Homeowner or developer persona; project is underway or about to start, or report contains findings in sections 8.3 or 8.4.  
**Offer:** "Book a stage inspection before your next progress payment."  
**Revenue:** Referral fee per booking.

### 7.3 Building contract legal review

**Trigger:** Homeowner or developer persona; user has not yet signed a contract.  
**Offer:** "Have a construction lawyer review your contract before you sign."  
**Revenue:** Referral fee per engagement.

### 7.4 Home warranty insurance

**Trigger:** Homeowner persona; residential project in NSW, QLD, VIC, SA, or WA (mandatory HWI states).  
**Offer:** "Verify your builder's home warranty insurance before work starts."  
**Revenue:** Commission per policy referred.

### 7.5 Trade credit insurance & PPSR registration

**Trigger:** Subcontractor or supplier persona.  
**Offer:** "Protect your invoices with a PPSR registration or trade credit insurance."  
**Revenue:** Referral fee per registration or policy.

### 7.6 Monitoring (own product)

**Trigger:** User has contracted with the builder (any persona).  
**Offer:** "Get alerts if anything changes while your project is underway."  
**Revenue:** Direct pay-as-you-go fees (see section 15).

### 7.7 Placement rules

Recommendations appear in two locations only:
1. **Inline** — one contextually relevant offer at the bottom of the most relevant report section. Never stacked.
2. **Post-report "What to do next" panel** — 2–3 prioritised recommendations after the Risk Summary, tailored to the user's persona.

Never shown mid-report or mid-search. Visually distinct from report content and risk findings — must never be mistaken for a data result.

---

## 8. Report Structure

The report is divided into six sections, each answering a distinct risk question. Sections render as they arrive (streaming); users see results populate section by section rather than waiting for everything to complete.

**Data tiers.** All free sources are included in the free report. Two sources carry a per-search cost — the ASIC company extract ($19) and the AFSA National Personal Insolvency Index (NPII, fee to be confirmed, estimated $3–5) — and are available as an optional deep check add-on at near-cost pricing. These are marked **[deep check]** below. The free report is genuinely comprehensive for the majority of users; the deep check adds historical corporate history and director-level personal insolvency data.

**Error handling.** If a data source is temporarily unavailable, the section shows "Source temporarily unavailable" with a direct link so the user can check manually. One failed source never blocks the rest of the report.

### 8.1 Identity & Corporate Structure

**Risk question:** *Who exactly am I dealing with, and how is the entity structured?*

Data sources:
- Australian Business Register (ABN lookup) — entity name, ABN, ACN, GST status, entity type, registration date, business address
- ASIC free company search — current directors and secretaries, registered office, company status, number of registered charges
- ASIC Disqualified Directors register — automated check of each current director against ASIC's banned and disqualified register (free)
- ASIC company extract — full current and historical director list with appointment and resignation dates, complete charges register **[deep check]**

Displayed as:
- Entity summary card (name, ABN/ACN, status, registration date)
- Current directors list with appointment dates
- Disqualified director flag if any current director appears on the ASIC banned register (critical signal)
- Historical directors panel — appointment and resignation dates, other current directorships; shows director movement across entities (phoenixing signal) **[deep check]**
- Related entities panel — other companies sharing one or more current directors
- Registered charge count (free); charge details **[deep check]**

Risk indicators:
- Entity status: Registered / Deregistered / Under administration / Struck off
- Current director matches ASIC disqualified/banned register (critical)
- Director previously resigned from 2+ deregistered companies (phoenixing signal) **[deep check]**

---

### 8.2 Licences & Registrations

**Risk question:** *Is this builder licensed for the work being contracted, and in good standing?*

| Jurisdiction | Source | Method |
|---|---|---|
| QLD | QBCC Licence Register | Scraped |
| NSW | NSW Fair Trading Contractor Licence (Verify NSW) | Deep link |
| VIC | VBA / BPC Practitioner Register | Deep link |
| WA | Building and Energy (DMIRS) Online Licence Search | Deep link |
| SA | Consumer and Business Services | Deep link |
| TAS | Consumer, Building and Occupational Services | Deep link |
| NT | NT Building Practitioners Register | Deep link |
| ACT | Access Canberra Building Licences | Deep link |

**Home warranty insurance status — insolvency proxy:**

| Jurisdiction | Source | Signal |
|---|---|---|
| NSW | HBCF claim count via Verify NSW | Each claim = prior insolvency or failure to complete; non-zero count is a moderate-to-high risk signal |
| VIC | Domestic Building Insurance (DBI) status via BPC Find a Practitioner | If a builder cannot obtain DBI, they are legally prohibited from taking a deposit on residential work — inability to hold DBI is itself a critical risk signal |
| QLD | QBCC Home Warranty Scheme status | Checked as part of the QBCC licence scrape |

Displayed as:
- Licence card per jurisdiction: number, category/class, holder name, status, expiry
- Clear distinction between **verified live data** (scraped) and **check required** (deep link)
- HWI status card for NSW, VIC, and QLD where the signal is accessible

Risk indicators:
- Licence expired / suspended / cancelled
- Licence class does not cover the contracted work type
- No licence found in the relevant jurisdiction
- HBCF claims on record — one or more is a moderate-to-high signal depending on recency (NSW)
- DBI unobtainable or not current (VIC — critical if residential work)

---

### 8.3 Financial Risk Signals

**Risk question:** *Is this builder likely to become insolvent during or after the project?*

Data sources:
- ASIC insolvency notices — external administration, winding-up applications, liquidation notices
- ATO debt disclosure — ASIC publishes ATO notifications when a tax debt exceeds $100,000 and is 90+ days overdue
- ABR / ASIC — entity age and related entity deregistration history (phoenixing proxy)
- Payment Times Reporting Register — payment performance metrics for large entities ($100M+ revenue)
- AFSA National Personal Insolvency Index (NPII) — personal bankruptcy, debt agreements, and personal insolvency arrangements for each current director **[deep check]**

Displayed as:
- Insolvency status banner if any current event is found
- ATO tax debt flag if disclosed
- Related entity deregistration timeline — previously deregistered companies sharing current directors, with dates
- Payment Times score where available
- Director personal insolvency record **[deep check]**

Risk indicators:
- Active insolvency event (critical)
- ATO tax debt disclosed (high)
- Director with personal bankruptcy or debt agreement history **[deep check]** (high)
- 2+ related entities deregistered in past 5 years (moderate — phoenixing signal)
- Entity registered less than 2 years ago (moderate — contextual)

---

### 8.4 Payment Behaviour

**Risk question:** *Does this builder pay subcontractors and suppliers on time?*

**Context on interstate data.** Queensland is the only Australian jurisdiction with a named, publicly searchable Security of Payment adjudication register. All other states route SoP adjudications through private Authorised Nominating Authorities with no obligation to publish named outcomes. The NT publishes every determination but anonymises all party names by statute. For interstate builders, the best available proxies are court-enforced adjudications (which appear on AustLII with full party names), regulatory disciplinary registers, and the Payment Times Reporting Register.

Data sources:
- QBCC Adjudication Register — decisions naming the builder as respondent in unpaid progress claim disputes (QLD)
- QBCC Subcontractor Charges Register — charges lodged by unpaid subcontractors against the property (QLD)
- Payment Times Reporting Register — reported small-business payment metrics for entities with $100M+ revenue (all states)
- Court-enforced SoP adjudications via AustLII — where a subcontractor took an unpaid adjudication to court, the decision names the parties (all states)

Displayed as:
- QBCC adjudication decisions: date, amount, outcome (QLD)
- Subcontractor charges: charge details and current status (QLD)
- Payment Times metrics panel where available
- AustLII SoP-related court decisions (grouped under this section where the context is a payment dispute)

Risk indicators:
- Adjudication decisions found against the builder as respondent (number and recency)
- Outstanding subcontractor charges
- Payment Times score below industry average
- Court judgment arising from unpaid SoP adjudication found on AustLII

---

### 8.5 Court, Tribunal & Disciplinary History

**Risk question:** *Has this builder been taken to court, subjected to tribunal proceedings, or disciplined by a building regulator?*

Data sources:
- AustLII — full-text search across all Australian courts and tribunals:
  - Federal: Federal Court, Federal Circuit and Family Court, Fair Work Commission
  - All states/territories: Supreme Courts, District/County Courts, Magistrates Courts, and specialist tribunals (VCAT, NCAT, QCAT, SAT, SACAT, ACAT, etc.)
- Fair Work Ombudsman compliance register — named businesses subject to FWO enforcement outcomes (court orders, enforceable undertakings) for underpayment of workers; significant in a sector with endemic wage theft
- QBCC Disciplinary Outcomes — licence conditions, suspensions, cancellations (QLD)
- VIC Building and Plumbing Commission (BPC) Prosecution & Disciplinary Register — named enforcement actions against Victorian builders since 2018, searchable by company name; retained 5 years post-sanction (VIC)
- WA Building and Energy disciplinary media releases — named enforcement outcomes retained 6 years; includes contract payment breaches and fraudulent documents (WA)
- SafeWork / state WHS regulators — pre-populated deep links

Displayed as:
- Court/tribunal results grouped by jurisdiction, linked to AustLII source
- FWO enforcement outcomes if found
- QBCC disciplinary decisions if found (QLD)
- VIC BPC enforcement actions if found (VIC)
- WA Building and Energy enforcement actions if found (WA)
- SafeWork check links by state

Risk indicators:
- Volume and recency of court/tribunal proceedings
- Federal Court proceedings (suggests serious commercial disputes)
- Fair Work Commission or FWO proceedings (wage theft / underpayment signal)
- Regulatory enforcement action in VIC or WA registers

---

### 8.6 Additional Databases — Manual Review

A short list of pre-populated deep links for databases that are material, cannot be reliably automated, and are not already covered by the searches above. Each link has a one-line description of what to look for. This section is deliberately concise — its purpose is to direct users to the highest-value remaining sources, not to replicate what the automated search has already covered.

| Link | What to look for |
|---|---|
| NSW Register of Building Work Orders | Stop work and rectification orders; a pattern of orders suggests systemic non-compliance with building standards (NSW) |
| WA Building & Energy enforcement actions | Broader browsing beyond the automated check; includes payment-related and document fraud breaches not always captured in full by the scraper (WA) |
| ACT Register of Disciplinary Actions (ACT Open Data) | Named disciplinary actions against ACT-licensed practitioners, 10-year history (ACT) |
| SafeWork prosecution registers | WHS enforcement outcomes including prosecutions and enforceable undertakings — check the register for the state where work is being performed (WA, SA, TAS, NT, ACT) |

---

## 9. Risk Summary

Every completed report opens with a **Risk Summary** panel (rendered after all sections complete, anchored at the top via smooth scroll):

- **Key findings** — the two to four most significant results from across the report, in plain language, with anchor links to the relevant sections
- **What these findings suggest** — a concise commentary interpreting the pattern of findings: what risk they may indicate, whether they appear isolated or systemic, and what level of further scrutiny is warranted. This is a contextual interpretation, not a verdict. Two findings of the same type can mean different things depending on their age, volume, recency, and the nature of the relationship being entered into. The commentary reflects the user's persona where known — the same adjudication history means something different to a homeowner than to a subcontractor.
- **Before you proceed** — a short checklist of items to manually verify or seek professional advice on, tailored to the most significant findings

There is no score, band, or categorical rating. The purpose of the summary is to help users understand what the results mean together — not to reduce them to a single number or label. Risk commentary is generated from the structured findings using the Claude API, with a prompt calibrated to interpret findings in context and to avoid over- or under-stating their significance.

---

## 10. User Flow

```
Landing page (search bar is the hero element)
    │
    ├──▶ Manual search (name / ABN / licence number)
    │         │
    │         ├──▶ [if name search] Disambiguation card
    │         │         │
    │         └─────────┘
    │
    └──▶ Upload contract ──▶ Extraction (≤15s) ──▶ Confirmation card
                                                          │
                                              (both paths converge here)
                                                          │
                                                          ▼
                                              Persona selection
                                              ("What best describes you?")
                                              (icon cards — one tap, required on first use)
                                                          │
                                                          ▼
                                              Email capture gate
                                              (first use: free report)
                                              (returning: re-check or deep check prompt)
                                                          │
                                                          ▼
                                              Searching screen
                                              (live status, one row per source)
                                                          │
                                                          ▼
                                              Report screen
                                              (sections stream in as they arrive)
                                              (Risk Summary anchored at top on completion)
                                                          │
                                              ┌───────────┴────────────┐
                                              ▼                        ▼
                                   "About your project"       "What to do next"
                                   panel (optional)           (2–3 recommendations,
                                                               persona-tailored)
                                                                       │
                                                          ┌────────────┴─────────┐
                                                          ▼                      ▼
                                                  Partner referral         Monitoring /
                                                                           Watchlist
```

### 10.1 Persona selection step

Shown on first use and whenever no persona is set on the account. Shown as five icon cards:

> **"What best describes you?"**  
> 🏠 Homeowner · 🔨 Subcontractor · 🏗️ Developer · 🏦 Lender / financier · 🏢 Tenant / landlord

One tap selects and advances to the email capture gate. The selection is saved to the user profile and can be changed from account settings. On returning sessions the persona is already set; the step is skipped unless the user actively changes it.

### 10.2 Email capture gate

**First-time users:**
- Headline: "Run your free builder check"
- Email field: "Send my report to:"
- Two pill selectors: state, project type
- Subtext: "Free, instant, no credit card."
- CTA: "Run search"

**Returning users:**
- Free sources remain accessible at no cost for new entities; re-checks on previously searched entities incur a small fee (see section 15)
- Deep check add-on available at any point
- Mid-session re-searches (refining a name) do not re-trigger the gate

### 10.3 Searching screen

Live status list — one row per data source — updating as each scraper returns. States: Searching → Found / Not found / Unavailable. Partial results are visible and readable immediately. Not a spinner.

### 10.4 Report screen

Each section has: a plain-language risk question header, a risk indicator badge (visible as soon as data arrives), the data, "View source" links, and one contextual recommendation at the bottom (where applicable and persona-relevant).

**Report navigation:** A sticky table of contents sits at the top of the report listing all six sections plus the Risk Summary. Each entry is an anchor link. On mobile, sections collapse to header + badge by default and expand on tap.

---

## 11. Saving & Sharing

- **Email delivery** — the report is automatically emailed on completion; users have it even if they close the tab
- **Save to account** — previous reports accessible from the account dashboard
- **PDF export** — free; clean printable version suitable for sharing with a lender or solicitor
- **Shareable link** — 30-day read-only link for recipients without an account
- **Timestamp** — prominently displayed on all reports; data currency matters for due diligence

---

## 12. Monitoring

Ongoing monitoring is available on a pay-as-you-go basis for users who have engaged a builder and want alerts if anything changes during the project:

- Re-checks on a defined schedule: daily (ASIC insolvency); weekly (court records, FWO); monthly (licences)
- Email alerts for: licence status change, insolvency event, new court/tribunal decision, ATO debt flag, new QBCC adjudication, FWO enforcement action
- Alert includes a plain-language explanation of what changed and what it means for the user's persona
- Billed monthly per entity monitored; no annual commitment, cancel any time

Positioned contextually to users who have stated they are already contracted or underway. The monitoring offer uses the persona to tailor the framing: for a homeowner the focus is insolvency and licence; for a subcontractor the emphasis is adjudication and payment signals.

---

## 13. Relationship Features

These features extend the product's usefulness beyond the initial report and drive return visits without requiring a large commercial transaction. They are the primary mechanism for building the long-term user relationships the product is designed around. Where a small fee applies, it is set at a level that covers operating cost with a modest margin — consistent with the secondary role of direct revenue.

### 13.1 Builder Watchlist

Any user with an account can add a builder to their watchlist.

- Shows the builder's most recent findings summary and the date of the last check
- A "Re-check" button runs a new free-tier report for a small per-check fee
- No subscription required; no automated alerts (automated alerts are a monitoring feature)
- Designed for users who haven't yet contracted and want to keep an eye on a builder they're considering

### 13.2 Re-check Reminders

When a user returns to a saved report older than 30 days, a banner prompts: *"This report is X days old — a lot can change. Re-run for $3 / $18 including deep check."*

Automated email reminders are sent at:
- 30 days after a report was run (if the user's project is still underway per their profile)
- 90 days after a report was run (regardless of project stage)
- When a builder the user has checked is mentioned in a new AustLII decision or ASIC notice (triggered by the monitoring infrastructure even for non-paying users, as a prompt to upgrade)

### 13.3 Project Timeline

Users can associate a report with a project and record key milestones:
- Contract signed date
- Construction start date
- Progress payment schedule dates
- Practical completion date

The product uses these to trigger contextually timed outreach: *"Your first progress payment is due in 2 weeks — here's what to check before you pay."* This is the most powerful relationship-building feature — it keeps Know Your Builder relevant throughout the life of the project, not just at the pre-engagement stage.

The project timeline is available to any logged-in user at no cost.

### 13.4 Builder Comparison

Users considering multiple builders can run reports on each and view them side-by-side in a comparison view. Up to 3 builders. Available to all users (using their free-tier data); the deep check add-on applies per builder.

---

## 14. Revenue Model

Revenue is designed to cover operating costs and generate a modest, sustainable profit. It is not designed to maximise extraction from users. Partner referral revenue is the primary mechanism; direct fees are secondary and priced accordingly.

| Source | Mechanism | Role |
|---|---|---|
| Partner referral fees | Per qualified lead or per settled transaction, paid by finance brokers, inspection services, legal partners, insurers | Primary — sustainability model |
| Deep check add-on fees | Near-cost per-report fee covering data costs (ASIC extract + AFSA NPII) | Secondary — cost recovery |
| Re-check fees | Small per-report fee for re-running free-tier searches on previously searched entities | Secondary — modest margin |
| Monitoring fees | Monthly per-entity fee, billed pay-as-you-go, cancel any time | Secondary — cost recovery + modest margin |
| Affiliate commissions | Per-conversion from insurance and legal partners | Supplementary |

**The product is not venture-funded and is not designed to scale to an exit.** Revenue targets should be set to sustain operations and fund incremental improvement, not to demonstrate growth metrics.

---

## 15. Accounts, Pricing & Entitlement

### 15.1 Free entitlement

The first search on a given entity (free data sources only) is always free. This includes: ABN/ABR, ASIC basic company search, ASIC Disqualified Directors register, ASIC insolvency notices, ATO debt disclosure, AustLII, QBCC registers, Payment Times, Modern Slavery register, VIC BPC disciplinary register, WA Building & Energy enforcement actions, FWO compliance register, all licence register deep links, and all manual review links.

The free report requires only a persona selection and an email address. No account creation is necessary for the first search.

### 15.2 Re-check fees

Subsequent searches of a previously searched entity incur a small per-check fee:

| Option | Price |
|---|---|
| Single free-tier re-check | $3 |
| Single deep check re-check (with ASIC extract + AFSA NPII) | $18 |
| 5-pack re-checks (free-tier) | $12 |
| 5-pack deep checks | $49 |

Packs do not expire. A first-time search of a new entity is always free (free-tier), regardless of whether the user has a pack balance.

### 15.3 Deep check (first search)

The ASIC company extract and AFSA NPII are offered as an optional add-on at the email gate for any first-time search:

| Option | Price | What it adds |
|---|---|---|
| Single deep check (first search) | $15 | ASIC full company extract (historical directors) + AFSA NPII (director personal insolvency) |

### 15.4 Monitoring pricing

| Plan | Price | Notes |
|---|---|---|
| Monthly monitoring | $9 / entity / month | Cancel any time; no annual commitment |

Priced at cost recovery with a small margin. No annual plan — monitoring is inherently project-scoped and should not require a long-term commitment.

### 15.5 Account creation flow

- No account required to run a first free search (persona selection + email gate only)
- Account creation (email + password, or Google OAuth) is prompted when the user:
  - Purchases a re-check, deep check, or monitoring
  - Saves a report or adds a builder to their watchlist
  - Sets up a project timeline
- Account dashboard: saved reports with staleness indicator, watchlist, project timelines, monitoring subscriptions, alert history, re-check / deep check pack balance

---

## 16. Email & Notification Sequences

Email is the primary CRM channel. All sequences are plain-text in tone — helpful, not promotional. Sequence content is tailored to the user's persona.

| Trigger | Sequence |
|---|---|
| First report completed, pre-contract (homeowner / developer persona) | "Before you sign" checklist — contract review offer, HWI check, inspection offer |
| First report completed, already contracted | "During your build" — monitoring offer, stage inspection offer, progress payment tips |
| First report completed, subcontractor or supplier persona | "Before you start work" — PPSR registration offer, trade credit insurance |
| Report contains significant findings | "We found some concerns" — plain-language explanation of the most relevant findings for the user's persona + relevant action (legal review, second check, monitoring) |
| Report is clean (no significant findings) | "Your builder checks out" — persona-appropriate next steps (finance, inspection, insurance) |
| Report is 30 days old, project ongoing | Re-check reminder ($3 / $18 with deep check) |
| Progress payment date approaching (from project timeline) | "Before you pay" prompt — link to re-check + stage inspection offer |
| Builder on watchlist has a new AustLII/ASIC event | "Something changed" — prompt to re-run ($3) or upgrade to monitoring |
| No engagement within 14 days | Single re-engagement with report summary |

---

## 17. UI/UX Principles

### Design language
- Clean, professional, trust-building — comparable to a legal or financial services product
- High contrast, generous whitespace, no decoration for decoration's sake
- Per-finding risk indicators: green (clear / no issues found), amber (findings present — see detail), red (significant finding requiring attention), grey (no data / check required)
- Risk indicators never use colour alone — always icon + label (accessibility)
- Recommendations are visually distinct from findings — different background, labelled "Suggested next step"
- There is no overall report colour or aggregate risk label — risk is communicated through the Risk Summary commentary and per-finding section indicators, not a single rating

### Webapp-specific decisions

- **Homepage is the search bar.** No carousel, no above-the-fold marketing copy. The product demonstrates value immediately.
- **Persona selection is the first step.** Shown as large icon cards before the email gate on first use. Quick, visual, one tap. Cannot be skipped.
- **Streaming results are a feature.** The live-updating searching screen conveys speed and competence. Each row completing is a micro-moment of progress.
- **Report navigation.** A sticky table of contents at the top of the report. Anchor links to each section. On mobile, sections collapse to header + risk badge and expand on tap — keeps the report scannable without overwhelming small screens.
- **Disambiguation before search.** Name searches that return multiple entities show a disambiguation card before the search runs. Never silently pick one.
- **Error states are informative.** A failed source shows "Temporarily unavailable" + a direct link to check manually. The report continues; one failure never blocks the rest.
- **No dark patterns.** The deep check add-on is presented as optional and explained plainly ("this covers the cost of pulling two paid databases"). No guilt-driven upsells, no artificially degraded free results. Re-check fees are disclosed clearly before any purchase.
- **Responsive first.** Layout works at 375px through 1440px. No separate mobile app or mobile-specific experience.

### Accessibility
- WCAG 2.1 AA minimum
- All external links open in new tab with aria labels
- Report sections are keyboard-navigable

---

## 18. Technical Constraints (informing spec only)

The product is built with React (Expo) on the frontend and Node.js / Express on the backend. The streaming NDJSON architecture (one JSON line emitted per scraper as it completes) is retained as a core constraint — it enables the live-updating search experience.

New scrapers follow the standard shape: `{ source, jurisdiction, category, results[], searchUrl, summary }`. Manual review links are added to `links.js` without backend changes.

The user profile, watchlist, project timeline, and account system require a persistent data store. This is a new infrastructure requirement not present in the current prototype.

The Risk Summary commentary is generated server-side using the Claude API, receiving the structured findings from all scrapers as input. The prompt is persona-aware and calibrated to interpret findings in context rather than aggregate them into a score.

The anonymised contract clause database (opt-in) requires a separate storage pipeline: a post-extraction anonymisation step that strips all identifying fields and stores clause structure as JSON. No raw document text is retained under this path.

---

## 19. Out of Scope (v1)

- International builders (Australian entities only)
- Builder "profiles" or user-generated reviews
- Numerical credit scoring, risk bands, or categorical risk ratings — risk is expressed through plain-language commentary on specific findings, not aggregate scores or tiers
- Automated ASIC director history traversal beyond the company extract (manual deep link)
- Push notifications (email alerts only)
- B2B / enterprise API access
- Embedded partner booking flows (referrals are links only)
- CreditorWatch or equivalent commercial credit bureau data
- Contract clause benchmarking as a live user-facing product feature (opt-in data collection infrastructure is in scope; the end-user benchmarking product is not)

---

## 20. Success Metrics

Primary metrics reflect relationship depth and user return, not revenue extraction:

| Metric | Target (6 months post-launch) |
|---|---|
| Email capture rate | > 80% of searches |
| Persona selection completion | > 90% of first-time users |
| Contract upload rate | > 15% of sessions |
| Project context completion | > 35% complete at least one optional question |
| Post-report panel completion | > 25% complete the "About your project" panel |
| Watchlist adoption | > 20% of registered users add at least one builder |
| Project timeline adoption | > 15% of users who state they are contracted set up a timeline |
| Return visit rate | > 25% of users run a second search within 90 days |
| Re-check attach rate | > 20% of returning users purchase a re-check on their second or subsequent search |
| Partner referral click-through | > 15% of report viewers click at least one recommendation |
| Partner referral conversion (partner-reported) | > 5% of referred users convert |
| Monitoring attach rate | > 10% of users who state they are contracted subscribe |
| Contract clause opt-in rate | > 5% of contract upload users opt in to anonymised clause storage |
| Time to full report | < 45 seconds (90th percentile) |
| Contract extraction accuracy | > 90% yield a confirmed entity match without manual correction |
| Email open rate | > 40% |
