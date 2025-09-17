# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Executive Function AI - A therapeutic ADHD cognitive orthotic (NOT a productivity app) that provides executive function support through cognitive scaffolding. Core mission: reduce user friction, build self-efficacy through validated psychological principles. Currently deployed as a landing page for waitlist collection, evolving into a full system.

## Current Infrastructure

**Google Cloud Platform (GCP)**
- **Cloud Run**: Hosts the containerized Node.js/Express application at `https://execufunction-web-cuulwl4ska-uc.a.run.app`
- **Cloud SQL PostgreSQL**: Database instance `exf-core-pg` with private IP (10.138.64.3)
- **Artifact Registry**: Docker images stored in `us-central1-docker.pkg.dev/skilled-axis-472019-t7/exf-repo/`
- **VPC**: Custom network `exf-vpc` with subnet `exf-subnet` (10.0.0.0/24)
- **Project ID**: `skilled-axis-472019-t7`

## Key Commands

### Local Development
```bash
# Install dependencies
npm install

# Run locally (requires .env with DB credentials)
node server.js

# Build Docker image locally
docker build -t exf-app .
```

### Database Operations
```bash
# Connect to Cloud SQL instance
gcloud sql connect exf-core-pg --user=app_user --database=execufunction --project=skilled-axis-472019-t7

# Run migrations (from Cloud SQL console or proxy)
psql -h /cloudsql/skilled-axis-472019-t7:us-central1:exf-core-pg -U app_user -d execufunction -f migrations/V1__initial_schema.sql
```

### Deployment
```bash
# Build and push to Artifact Registry
gcloud builds submit --tag us-central1-docker.pkg.dev/skilled-axis-472019-t7/exf-repo/exf-app:latest --project=skilled-axis-472019-t7

# Deploy to Cloud Run
source .env && gcloud run deploy execufunction-web \
  --image=us-central1-docker.pkg.dev/skilled-axis-472019-t7/exf-repo/exf-app:latest \
  --add-cloudsql-instances=skilled-axis-472019-t7:us-central1:exf-core-pg \
  --set-env-vars="DB_HOST=/cloudsql/skilled-axis-472019-t7:us-central1:exf-core-pg,DB_USER=app_user,DB_PASSWORD=$DB_PASSWORD,DB_NAME=execufunction" \
  --region=us-central1 --project=skilled-axis-472019-t7
```

## Architecture

### Application Structure
- **server.js**: Express server that serves both static files and API endpoints
  - Serves static files from `public/execufunction/`
  - Connects to Cloud SQL via Unix socket at `/cloudsql/PROJECT:REGION:INSTANCE`
  - Implements no-cache headers for OAuth-sensitive endpoints

### API Endpoints
- **POST /api/join-waitlist**: Collects email signups with deduplication and audit logging
  - Rate limited to 5 requests per minute
  - Stores in `waitlist_entries` table with `outreach_events` audit trail

- **POST /api/contact**: Accepts contact form submissions
  - Validates email and message (min 5 chars)
  - Stores in `contact_messages` table

### Database Schema
Core tables with PostgreSQL extensions (pgcrypto, citext):
- `waitlist_entries`: Email signups with UTM tracking and outreach status
- `contact_messages`: Contact form submissions
- `users`: Future user accounts (prepared for Google OAuth)
- `outreach_events`: Audit log for CRM activities
- `consents`: Privacy/legal consent tracking
- `system_logs`: General system audit logs

### Security Considerations
- Organization policy blocks `allUsers` access (requires authenticated access or custom domain)
- Database uses strong passwords stored in `.env`
- Cloud SQL accessed via secure proxy/socket, not public IP
- Rate limiting on signup endpoints
- No-cache headers on sensitive endpoints

## Core Principles (Learned from WinonaOS)

### What We're Building
- **Energy-based task system**: Users self-report energy state and "spend" it on appropriate tasks
- **Calendar-driven core loop**: Understanding user's schedule through Google Calendar integration
- **Intelligent check-ins**: Scheduled logs that structure tasks and break them into components
- **Google Workspace integration**: Practical execution support, not just planning

### Architecture Lessons from WinonaOS Failures
1. **Start simple**: WinonaOS went from 7+ services → minimal proxy (we're starting minimal)
2. **Avoid OAuth complexity**: Their caching issues, state management problems taught us to use database for state, never cache OAuth endpoints
3. **Skip vector DBs initially**: Memory Bank replaced complex memory tables - we use PostgreSQL first
4. **No navigation anti-patterns**: Never pass complex objects through routes (broke in production)
5. **Git state matters**: Cloud Build uses git commits, not local files

### Security Principles
- **Never use "OR true" in RLS policies** - Critical vulnerability from WinonaOS
- **OAuth endpoints must be uncacheable**: Add no-store, no-cache headers
- **State persistence in database**: Never in-memory for serverless environments
- **Minimal service account permissions**: Least privilege always
- **No secrets in code**: Use Google Secret Manager exclusively

## Development Methodology

### Ticket-Based Development (60 tickets planned)
Each ticket includes:
- **Intent**: Clear purpose
- **Deliverables**: Concrete outputs
- **Implementation**: Backend/infra focus (no frontend)
- **Acceptance**: Testable criteria
- **Observability/Runbook**: Monitoring and recovery
- **Docs to touch**: Files to update
- **Risks/Notes**: Known issues

### Document-Driven Architecture
Keep `/context/` as source of truth:
- `DATA_MODEL.sql` - Canonical schema
- `API_CONTRACT.md` - RPC signatures and endpoints
- `SCREENS.md` - UI routes and auth gates (reference only)
- `TEST_CASES.md` - Acceptance tests
- `CONFIG.md` - Secrets and configuration
- `COPY.md` - Product voice and messages
- Migration files: `[ticket]_*.sql`
- Reports: `[ticket]_VERIFICATION_REPORT.md`

### Before ANY Implementation
1. **Run schema backup**: `./backup_schema.sh` (if exists)
2. **Check existing tables**: Search migrations folder
3. **Check existing functions**: Review server.js
4. **Reality check**: Many features may be partially built

## Phase Implementation Guide

### Phase 3: Auth & Identity (Tickets 21-23)
- **Profiles table**: Minimal user profiles with display_name
- **user_identity_view**: Stable rendering without hitting auth tables
- **Route guards**: Single source of truth for auth states
- **RLS hardening**: Owner-only policies on all tables

### Phase 4: Context Composer (Tickets 24-25)
- **Envelope budget**: ≤250 tokens (~1000 chars) auto-included in all LLM calls
- **Smart field dropping**: Priority-based trimming when near limits
- **TTL strategy**: 120s for calendar fields, 30s for task state

### Phase 5: Calendar Integration (Tickets 26-29)
- **OAuth token broker**: Never store refresh tokens client-side
- **calendar_cache table**: Lean mirror for quick reads
- **Incremental sync**: Background freshness with 410 resync handling
- **Next-3 service**: Single source for upcoming events

### Phase 6: Check-in Flow (Tickets 30-32)
- **2-minute timer**: Server-enforced time boundaries
- **Tangent guardrails**: Keep responses focused and brief
- **Task creation**: Convert check-ins to concrete next steps

### Phase 7-8: Tasks & Config (Tickets 33-40)
- **Minimal task entity**: next_action, status, timestamps only
- **Context items**: Metadata pointers, not content ingestion
- **Subtasks**: Flat list, no nesting, max 7 items
- **Global error boundaries**: Build info and reset guidance

### Phase 9-10: Rate Limits & Migrations (Tickets 41-43)
- **Token buckets**: Per-user caps with graceful degradation
- **Migration registry**: Track all schema changes with hashes
- **ai_read role**: Read-only access for grounding prompts

### Phase 11-13: Memory System (Tickets 44-53)
- **Relational, not vector**: Structured facts in PostgreSQL
- **Human-readable**: subject-predicate-object triples
- **User control**: View and delete any stored memory
- **Extraction limits**: Max 5 facts from any text

### Phase 14-16: Production Hardening (Tickets 54-60)
- **Secret rotation**: Quarterly with GSM
- **Traffic splitting**: 90/10 → 100/0 pattern
- **Disaster recovery**: Documented restore procedures
- **Data rights**: Export and purge endpoints

## Migration from Azure

The codebase originated from Azure Static Web Apps (see `public/execufunction/`):
- Azure Functions → Cloud Run endpoints
- Azure Table Storage → Cloud SQL PostgreSQL
- staticwebapp.config.json → Express middleware for headers

## Known Issues & Workarounds

1. **VPC Connector**: Failed to create properly; using Cloud SQL Proxy instead
2. **Public Access**: Org policy blocks `allUsers`; requires authenticated access until custom domain is configured
3. **Email Delivery**: Contact form doesn't send emails yet; needs SendGrid/Mailgun integration

## Critical Implementation Notes

### Database Schema Evolution
```sql
-- Current tables (basic landing page)
waitlist_entries, contact_messages, users, outreach_events, consents, system_logs

-- Next phase tables (from tickets)
profiles, calendar_cache, calendar_sync_state, oauth_tokens
tasks, subtasks, context_items
memory_facts, memory_links
usage_stats, schema_migrations
```

### OAuth Implementation Checklist
```javascript
// 1. ALWAYS make OAuth endpoints uncacheable
app.disable('etag');
res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

// 2. Use POST for OAuth start (harder to cache)
router.post('/oauth/google/start', async (req, res) => {
  // Save state to database, not memory
});

// 3. Token broker pattern
// Never expose refresh tokens to clients
// Store in GSM or encrypted in database
```

### Model Gateway Pattern (Ticket 48)
All LLM calls go through single chokepoint:
- Inject context composer envelope
- Enforce token budgets
- Scrub inputs for safety
- Log costs without storing prompts
- Rate limit per user

## Current Implementation Status (as of 2025-09-15)

### ✅ Deployed Infrastructure
- **Cloud Run Service**: `execufunction-web` live at https://execufunction-web-cuulwl4ska-uc.a.run.app
  - Container image: `us-central1-docker.pkg.dev/skilled-axis-472019-t7/exf-repo/exf-app:latest`
  - Configured with VPC connector `exf-connector` for private database access
  - Max 20 instances, 512Mi memory, 1 CPU
  - Environment variables properly configured for database connection

- **Cloud SQL PostgreSQL**: Instance `exf-core-pg` running PostgreSQL 15
  - Private IP: 10.138.64.3 (no public IP for security)
  - Connected via VPC network `exf-vpc`
  - db-f1-micro tier with 10GB SSD storage
  - Accessed via Unix socket at `/cloudsql/skilled-axis-472019-t7:us-central1:exf-core-pg`

- **VPC Network**: `exf-vpc` with connector `exf-connector`
  - IP range: 10.8.0.0/28
  - Enables secure Cloud Run to Cloud SQL communication

### ✅ Application Components
- **Node.js/Express Server** (`server.js`):
  - Serves static landing page from `public/execufunction/`
  - API endpoints implemented:
    - `POST /api/join-waitlist`: Rate-limited (5 req/min) with deduplication
    - `POST /api/contact`: Contact form submission with validation
  - No-cache headers configured for future OAuth endpoints
  - Database connection pool configured with private IP

### ✅ Database Schema (V1__initial_schema.sql applied)
- Tables created:
  - `waitlist_entries`: Email signups with UTM tracking and outreach status
  - `contact_messages`: Contact form submissions
  - `users`: Ready for Google OAuth integration
  - `outreach_events`: CRM audit trail for waitlist management
  - `consents`: Privacy/legal consent tracking
  - `system_logs`: General system audit logs
- Extensions enabled: pgcrypto, citext (case-insensitive emails)
- Proper indexes and constraints applied

### ✅ Frontend/Landing Page
- Static site serving from `public/execufunction/`
- Three core value propositions displayed
- Functional waitlist signup form
- Contact and privacy pages
- Responsive design with custom CSS

## Next Steps for Production

1. ~~Run database migrations to create tables~~ ✅ COMPLETE
2. Implement profiles table and user_identity_view (Ticket 21)
3. Create Context Composer with token budget (Ticket 24)
4. Set up Google Calendar OAuth with token broker (Ticket 26)
5. Build Model Gateway for Vertex AI (Ticket 48)
6. Configure custom domain mapping
7. Update Namecheap DNS records from Azure to GCP