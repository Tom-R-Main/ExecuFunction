Executive Function website (Azure Static Web Apps)

Overview
- Public marketing site for Executive Function (execufunction.com).
- Deployed on Azure Static Web Apps (SWA) with free, auto‑renewing TLS.
- Includes minimal API endpoints:
  - GET /api/context/envelope: compact JSON envelope (now, tz, next_3_events).
  - GET /api/calendar/next3: returns next 3 upcoming events (ICS demo mode).
  - POST /api/join-waitlist: collect emails with minimal PII and no-store headers.

Structure
- Root: static site pages (HTML/CSS/JS).
- staticwebapp.config.json: routing, security headers, SPA fallback.
- api/: Azure Functions (Node.js, commonjs) for context, calendar, waitlist.
- api/_lib/calendar.js: tiny ICS parser + next-3 selector.

Local development
- You can preview static pages locally with any static server.
- Functions are designed for SWA’s built-in Functions runtime. To run locally, use Azure Functions Core Tools.

Configuration (Azure SWA)
- Environment variables (SWA → Configuration → Application settings):
  - STATIC_ICS_URL: Optional. Public ICS URL to parse for calendar/next3. If unset, a baked-in sample is used.
- Custom domains:
  - www.execufunction.com (CNAME to SWA); apex can 301 → www at registrar.

API contracts
- GET /api/context/envelope → 200 JSON:
  {
    "now_iso": "2025-01-01T12:00:00Z",
    "tz": "America/Chicago",
    "next_3_events": [ { "title": "...", "start": "...", "end": "..." } ]
  }

- GET /api/calendar/next3 → 200 JSON:
  { "events": [ { "title": "...", "start": "...", "end": "..." } ] }

- POST /api/join-waitlist (JSON: { email }) → 201 JSON: { ok: true }
  - Responds 400 for invalid email, 429 for obvious repeat within a short window.

Security & headers
- staticwebapp.config.json sets HSTS, no‑sniff, frame denial, referrer policy.
- /api/* endpoints add Cache-Control: no-store and related headers at function level.

Next steps
- Add real storage to waitlist (Azure Table via @azure/data-tables) by adding STORAGE_CONNECTION_STRING in SWA settings.
- Add Project and Architecture pages content.
- (Optional) Expand calendar to OAuth mode later (token broker).

