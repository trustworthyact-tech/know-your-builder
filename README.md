# Know Your Builder

An Australian builder due diligence tool that searches 40+ government databases and produces a structured report covering financial position, payment history, building licences, and litigation history.

## What it searches

**Identity & Financial**
- Australian Business Register (ABN lookup)

**Payment & Compliance**
- Payment Times Reporting Register
- Modern Slavery Statements Register

**Building Licences**
- QBCC (QLD) — licence register and adjudication decisions
- Pre-populated links to VIC, NSW, WA, SA, NT, ACT, TAS licence registers

**Courts & Tribunals (via AustLII)**
- Federal: Federal Court, Federal Circuit Court, Fair Work Commission
- All states and territories: Supreme Courts, District/County Courts, Magistrates Courts, VCAT, NCAT, QCAT, SAT, and more

**Additional Databases (manual review links)**
- ASIC company search
- State and territory SafeWork agencies
- Insolvency notices
- State Supreme Court registers not covered by AustLII

## Stack

- **Frontend:** Expo (React Native + web), React Navigation, TypeScript
- **Backend:** Node.js / Express, streaming NDJSON responses
- **Scraping:** Axios + Cheerio

## Running locally

Two processes must run simultaneously:

```bash
# Terminal 1 — API server
cd server && node index.js

# Terminal 2 — Expo dev server
npx expo start --tunnel
```

Press `w` in the Expo terminal to open in browser. Scan the QR code with Expo Go to run on a physical device.

**Physical device:** create `.env.local` in the project root and set your Mac's LAN IP:
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3001
```
Restart the Expo server after changing this file.

## Architecture

```
HomeScreen → SearchingScreen → ReportScreen
                  │
                  ▼
         src/services/api.ts       (fetch + NDJSON stream)
                  │
                  ▼
         server/index.js :3001     (Express, runs all scrapers in parallel)
                  │
        ┌─────────┼──────────────────────────────┐
        ▼         ▼         ▼          ▼          ▼
     abn.js  austlii.js  qbcc.js  paymentTimes  modernSlavery  links.js
```

The server streams results back as newline-delimited JSON (NDJSON). Each scraper runs independently via `Promise.all`; results appear in the UI as they arrive rather than waiting for all searches to finish.

`links.js` is not a scraper — it generates pre-populated search URLs for databases that cannot be scraped programmatically.

## Disclaimer

This tool is for research purposes only and does not constitute legal or financial advice. Always verify information from primary sources before making decisions.
