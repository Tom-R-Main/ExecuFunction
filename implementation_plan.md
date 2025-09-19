# Implementation Plan — ExecuFunction

_Last updated: 2025-09-17_

## 0. Purpose, Scope, and Usage Guidance
This plan translates `ARCHITECTURE.md` into a granular execution playbook. It is organised by capability rather than calendar time; teams may progress multiple tracks in parallel provided dependencies are met. Each section cross-references the relevant architecture subsection, enumerates artefacts to deliver, defines validation steps, and records instrumentation that must be in place before declaring a capability production ready.

Use this document as a living operations manual:
- Update the **Decision Log** whenever scope or tooling choices change.
- Record actual metrics and validation links under each capability once completed.
- Treat “Exit Gates” as hard requirements; shipping without them violates the architecture contract.

## 1. Guiding Principles
1. **Security-first** (ref: `ARCHITECTURE.md §2 Secure AI Gateway`): all user traffic flows through a safety filter for prompt-injection mitigation while user data stays encrypted and inaccessible to operators.
2. **Deterministic-first** (ref: `ARCHITECTURE.md §3 Core Data Model`): authoritative state lives in Cloud SQL under RLS. AI augments but does not mutate state without human confirmation.
3. **Measure before trust** (ref: `ARCHITECTURE.md §6 Observability & SLOs`): every subsystem defines metrics, dashboards, and alerts prior to rollout; regression thresholds connect to automated rollback.
4. **Modular growth** (ref: `ARCHITECTURE.md §8 Future Phases`): advanced features (episodic graph, proactive cards) remain feature flags until MVP value is proven.
5. **Migration-ready** (ref: `ARCHITECTURE.md §5.3 Vector Strategy`): run pgvector initially but document objective triggers for switching to managed vector search.

## 2. Capability Map Overview
| Capability | Architecture Reference | Dependencies | Exit Gates |
| --- | --- | --- | --- |
| Foundation Platform | §§2, 4, 6 | none | Deploy by digest; gateway tests green |
| Calendar Ingestion Loop | §4.1 | Foundation | Agenda API p95 < 2 s; webhook sanitised |
| Semantic Memory (RAG) | §5 | Foundation | Eval harness stable; faithfulness ≥ target |
| Assistant Behaviours | §7 | Calendar + RAG | Human-in-loop writes only; audit trail |
| Hardening & Scaling | §§2.4, 6.3, 8 | Prior capabilities | DR drill pass; migration triggers published |

Subsections below expand each capability into actionable steps.

---

## 3. Foundation Platform
**Objective:** Establish the secure, observable, auto-deploying skeleton that all later capabilities rely on.

### 3.1 Repository & CI/CD Pipeline (ref: `ARCHITECTURE.md §6.1 Deployment`)
- **Artefacts**
  - `.github/workflows` or Cloud Build triggers (`cloudbuild.yaml`) running lint → unit tests → integration tests → Docker build → deploy.
  - Build metadata script writing `build_sha`, `build_time`, `git_branch` into container env vars.
- **Tasks**
  1. Author Cloud Build configs for `staging` and `production` service targets; use substitutions for project ID and region.
  2. Implement deploy step using `gcloud run deploy ... --image $IMAGE_DIGEST --no-traffic` followed by traffic splitting (blue/green).
  3. Add smoke tests (curl `/healthz`, `/configz`) post-deploy with automatic rollback on failure.
  4. Configure build notifier (Slack/email) that includes build SHA, traffic split, and dashboards links.
- **Status**
  - ✅ _2025-09-17:_ Cloud Build pipeline builds the image, deploys by digest with `--no-traffic`, runs readiness smoke tests, and promotes revisions for `exf-app-staging`/`exf-app`. Pipeline uses `gitbuild@skilled-axis-472019-t7.iam.gserviceaccount.com` which has `roles/run.invoker` on both services. Remaining to-do: add build metadata env injection and notifier.
- **Validation**
  - Manual run from clean branch shows green pipeline within target duration (<8 min).
  - Rollback test: deliberately fail smoke test; confirm pipeline rolls back traffic and posts alert.
- **Instrumentation**
  - Build metrics to Cloud Monitoring (`build_duration_seconds`, `deploy_status`).

### 3.2 Secure AI Gateway Scaffold (ref: `ARCHITECTURE.md §2`)
- **Artefacts**
  - Gateway module with middleware stack: authentication, safety sanitiser, audit logging.
  - Unit test suite with adversarial payloads.
- **Tasks**
  1. Implement Google Identity token verifier (expect `iss`, `aud`, `exp` checks) and stub user resolution.
  2. Develop sanitiser pipeline focused on safety:
     - Strip HTML/script tags; normalise whitespace.
     - Neutralise imperative verbs (“RUN”, “DELETE”, “EXECUTE”) when embedded inside untrusted text; maintain whitelist for legitimate use.
     - Detect suspicious prompts using heuristics + regex (e.g., `(?i)ignore previous instructions`).
  3. Ensure gateway never logs raw payloads; record only redacted hashes/metadata for audit.
  4. Stub Vertex AI client returning deterministic fake content for early tests.
  5. Expose `/gateway/selftest` endpoint running sanitiser round-trip on canned payloads.
- **Validation**
  - Unit tests cover: benign input, prompt injection, nested HTML, Unicode.
  - Security review confirms encryption-at-rest/in-transit and restricted operator access to plaintext (break-glass only).
- **Instrumentation**
  - Gateway logs include `sanitiser_actions`, `payload_hash`, `gateway_latency_ms`.
  - Alert when sanitiser drops/rewrites >5% of payloads in 1h window.

### 3.3 Secrets & Configuration (ref: `ARCHITECTURE.md §4`)
- **Artefacts**
  - Secret Manager entries: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CALENDAR_CLIENT_ID`, etc.
  - Terraform or manual runbook documenting secret creation and IAM bindings.
- **Tasks**
  1. Create per-service Google service accounts (API, jobs, build) with least privilege.
  2. Bind secrets to service accounts with `roles/secretmanager.secretAccessor` and store version IDs in env vars.
  3. Configure CMEK for Cloud SQL storage and secrets (if policy requires).
  4. Implement configuration loader verifying presence + checksum at boot; fail-fast if missing.
- **Validation**
  - Secret rotation dry run: create new version, mark primary, redeploy, confirm no downtime.
- **Instrumentation**
  - Config checksum logs; alert on mismatch.

### 3.4 Observability Baseline (ref: `ARCHITECTURE.md §6.2`)
- **Artefacts**
  - Logging middleware adding `trace_id`, `user_hash`, `route`, `latency_ms`, `build_sha`.
  - Dashboards: API latency, error rate, gateway sanitiser actions.
  - Alerts: API p95 > 300 ms (5 min), error rate > 1% (5 min), log ingestion failure.
- **Tasks**
  1. Implement OpenTelemetry or custom trace propagation; set up Cloud Trace integration.
  2. Create Cloud Monitoring dashboards with grouped charts per capability.
  3. Configure uptime checks on `/healthz`, `/configz` from two regions.
- **Validation**
  - Synthetic load test (hey/k6) hitting `/healthz` with concurrency 20 for 2 min; confirm traces and logs appear.
- **Instrumentation**
  - Baseline metrics stored for comparison post feature deployments.

**Foundation Exit Gates**
- Pipeline deploys by digest with automated rollback verified.
- Secure AI Gateway unit tests + self-test endpoint pass.
- Logging/monitoring dashboards exist with baseline metrics.

---

## 4. Calendar Ingestion Loop
**Objective:** Establish resilient calendar synchronisation that delivers a clean agenda to the UI and downstream AI.

### 4.1 OAuth & Token Broker (ref: `ARCHITECTURE.md §4.1.1`)
- **Artefacts**
  - OAuth consent screen configuration + Google Workspace scopes request doc.
  - Backend route `/auth/google/callback` exchanging code for tokens.
  - Tables: `calendar_accounts`, `calendar_tokens` (encrypted refresh token, expiry, scope).
- **Tasks**
  1. Implement PKCE flow for SPA → backend callback → token exchange.
  2. Encrypt refresh tokens using Cloud KMS (AES-256) before storage.
  3. Build token rotation job checking `expires_at`, refreshing ahead of expiry, updating DB atomically.
  4. Implement revocation endpoint clearing tokens & disabling sync.
- **Validation**
  - Integration test hitting sandbox calendar account verifying tokens stored, rotation occurs, revocation stops sync.
  - Security review ensures no tokens logged; secrets stored encrypted at rest.

### 4.2 Data Model & Sanitisation (ref: `ARCHITECTURE.md §4.1.2`)
- **Schema**
  - `calendar_events`: `user_id`, `provider`, `provider_event_id`, `start_utc`, `end_utc`, `summary`, `description_sanitised`, `location_sanitised`, `etag`, `hash`, `raw_payload` (JSONB, encrypted optional).
  - `calendar_sync_state`: `user_id`, `sync_token`, `last_synced_at`, `channel_id`, `channel_expiration`.
  - `calendar_raw`: log of webhook payloads for replay.
- **Tasks**
  1. Apply RLS policies `USING user_id = app.current_user_uuid()`.
  2. Add indexes `(user_id, start_utc)`, `(user_id, provider_event_id)`.
  3. Write sanitiser integration: inbound summaries/descriptions pass through gateway sanitiser before storage.
  4. Hash raw payload for dedupe; optionally store encrypted raw for audit.
- **Validation**
  - Unit test ensures safety filter removes malicious instructions while leaving legitimate content unchanged.
  - Verify RLS prevents cross-user access via test harness.

### 4.3 Sync Worker (ref: `ARCHITECTURE.md §4.1.3`)
- **Flow**
  - Initial full sync (`events.list` with timeMin/timeMax) populates DB.
  - Watch channel created; webhooks persisted to `calendar_raw`.
  - Scheduled job replays raw payloads, resolves `sync_token`, handles `410 Gone` by refreshing token + full sync.
- **Tasks**
  1. Build Cloud Scheduler triggers (every 5 min) for backlog drain.
  2. Implement exponential backoff on `403`/`429` errors, recording attempts.
  3. Ensure idempotency: compute event hash (summary+start+end+attendees) to avoid duplicate rows.
  4. Log metrics: `sync_duration_ms`, `events_upserted`, `events_deleted`.
  5. Add cleanup job removing stale channels (expired >1 day) and resubscribing.
- **Validation**
  - Simulate channel expiration; confirm resubscribe logic executed.
  - Replay adversarial payload ensuring sanitiser neutralises before DB write.
- **Instrumentation**
  - Dashboard chart for sync backlog (time since last processed raw payload per user).
  - Alert when backlog >15 min or error rate >5%.

### 4.4 Agenda API & UI (ref: `ARCHITECTURE.md §4.1.4`)
- **API Envelope**
  ```json
  {
    "now_utc": "2025-09-17T14:00:00Z",
    "time_zone": "America/Chicago",
    "next_events": [ {"id": "evt_1", "start_local": "...", "end_local": "...", "summary": "...", "location": "...", "sanitiser_flags": [] } ],
    "conflicts": [ ... ],
    "meta": {"generated_at": "...", "source": "calendar_events"}
  }
  ```
- **Tasks**
  1. Implement API route retrieving events for `now` ± 24h, ordering by start.
  2. Compute conflicts (overlapping start/end) server-side.
  3. Expose sanitiser flags to UI (e.g., event field truncated due to sanitisation).
  4. Build Today page: timeline view, quick-add idea (no DB write yet), connection status indicator.
- **Validation**
  - Automated tests for DST boundaries, timezone conversions (use `moment-timezone` or `luxon`).
  - Accessibility pass: screen-reader labels, keyboard navigation.
- **Instrumentation**
  - API p95 latency chart; error budget tracking (<1% failure).

**Calendar Exit Gates**
- User onboarding: connect → redirect → agenda shown within 30 seconds real time.
  Document with screen recording and metrics.
- Sanitiser catches seeded malicious invite; logged in dashboard.
- Alerts for sync backlog + channel renewal active.

---

## 5. Semantic Memory (RAG) MVP
**Objective:** Provide recall for user notes and summaries, augmenting deterministic agenda/tasks while maintaining measurable quality.

### 5.1 Data Structures (ref: `ARCHITECTURE.md §5.1`)
- **Schema**
  - `memory_notes`: `id UUID`, `user_id`, `kind`, `body`, `embedding vector(768)`, `created_at`, `updated_at`, `importance`, `source`.
  - `embedding_jobs`: `id`, `note_id`, `action (UPSERT/DELETE)`, `attempts`, `last_error`, `available_at`, `processed_at`.
  - RLS with `app.current_user_uuid`.
- **Tasks**
  1. Enable `vector` extension on Cloud SQL.
  2. Create ivfflat index (lists tuned per size); plan for hnsw when >500k rows.
  3. Add triggers for new/updated notes to queue embedding job; on delete queue deletion action.
  4. Implement dead-letter queue table for repeated failures.
- **Validation**
  - RLS tests verifying cross-user isolation.
  - Migration scripts idempotent and version controlled.

### 5.2 Write Path & Sanitisation (ref: `ARCHITECTURE.md §5.2`)
- **Tasks**
  1. All user text (journal, ritual, manual notes) flows through Secure AI Gateway before DB insert.
  2. Generate deterministic note ID; record metadata (source, link to originating feature).
  3. Insert into `memory_notes` with `embedding NULL`; queue embedding job.
- **Validation**
  - Unit tests ensure safety sanitiser leaves legitimate text untouched and stored values match user input except for stripped malicious commands.

### 5.3 Embedding Worker (ref: `ARCHITECTURE.md §5.2.2`)
- **Flow**
  1. Worker fetches batch with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $BATCH`.
  2. Applies exponential backoff on failure, increments `attempts`.
  3. Calls Vertex AI Embeddings (`text-embedding-004`), handles quotas.
  4. Writes embedding vector, updates timestamps, marks job processed.
- **Tasks**
  - Configure Cloud Run Job (container) + Scheduler (frequency configurable).
  - Implement batch size env var, concurrency guard (limit to avoid connection spikes).
  - Log `embedding_latency_ms`, `embedding_batch_size`, `embedding_failures_total`.
  - Support manual requeue (admin command).
- **Validation**
  - Load test with synthetic notes (1k) verifying backlog drained within SLA.
  - Fault injection: simulate Vertex failure; ensure retries respect backoff, DLQ captures after max attempts.

### 5.4 Search API (ref: `ARCHITECTURE.md §5.3`)
- **Endpoint** `/rag/search`
  - Input: `query`, `k`, optional filters (`kinds`, `from_ts`, `to_ts`).
  - Steps: embed query → set GUC → run ivfflat search with adjustable `ivfflat.probes` → fetch deterministic facts (tasks, events) → assemble context bundle with token budgeting.
- **Tasks**
  1. Implement query embed call (Flash by default; Pro fallback for complex tasks via heuristics).
  2. Allow tuning of probes via request (within floor/ceiling) for accuracy vs latency.
  3. Compose context sections: `facts`, `memories`, `metadata`. Ensure total tokens pre-prompt ≤ envelope limit (default 250 tokens).
  4. Provide fallback when no memories: return deterministic facts + disclaimers.
- **Validation**
  - Latency tests show p95 < 800 ms for dataset size baseline (document actual figures).
  - Unit tests for context budgeting (simulate long memory text).
- **Instrumentation**
  - Metrics: `rag_latency_ms`, `rag_ivfflat_probes`, `rag_context_tokens`, `rag_cache_hit_rate` (if caching implemented).

### 5.5 Evaluation Harness (ref: `ARCHITECTURE.md §5.4`)
- **Artefacts**
  - `golden_queries.yaml` with query, expected facts, evaluation notes.
  - Job script running nightly, storing metrics in BigQuery / Cloud Monitoring.
- **Metrics**
  - Retrieval: Precision@5, MRR, nDCG.
  - Generation: Faithfulness, Context Utilisation, Repetition %, BERTScore (optional).
- **Tasks**
  1. Build harness that hydrates staging DB snapshot, runs queries, compares outputs.
  2. Emit metrics to Monitoring; create dashboard and alerts (threshold ±5% change).
  3. Integrate into CI for gating (optional but recommended).
- **Validation**
  - Run harness manually; confirm results logged and accessible.
  - Regression test: deliberately remove chunk to trigger metric drop; ensure alert triggers.

**RAG Exit Gates**
- `/rag/search` p95 latency baseline recorded and below target.
- Evaluation harness running nightly with metrics in Monitoring.
- Faithfulness metric ≥ agreed baseline (document numeric).
- Token budgeting ensures composer never exceeds limit; fallback message on overflow proven.

---

## 6. Assistant Behaviours
**Objective:** Deliver actionable suggestions while preserving human oversight and auditability.

### 6.1 Quick Actions (ref: `ARCHITECTURE.md §7.1`)
- **Features**
  - Daily summary, buffer suggestions, conflict alerts derived from deterministic data.
  - Rendered in UI with accept/decline actions (no auto-apply).
- **Tasks**
  1. Implement deterministic rules (e.g., if two meetings <15 min apart → buffer suggestion).
  2. Expose via API `GET /assistant/actions` returning structured list with `action_type`, `confidence`, `required_confirmation`.
  3. UI components for action display, card states, analytics instrumentation.
- **Validation**
  - Unit tests for rules across boundary cases (e.g., overlapping events, travel time placeholders).
  - UX review for clarity; ensure accept/decline obvious.
- **Instrumentation**
  - Log `action_impressions`, `action_accepts`, `action_declines`, `action_dismissals`.

### 6.2 LLM-assisted Planning (ref: `ARCHITECTURE.md §7.2`)
- **Flow**
  1. User invokes `plan day` or similar; API gathers deterministic facts + RAG memories.
  2. Secure AI Gateway applies safety filtering and forwards the prompt to Vertex (likely Gemini 2.5 Flash/Pro hybrid) over encrypted channels.
  3. Response parsed into structured plan (JSON schema enforced).
  4. Present diff to user; require explicit confirmation to write.
  5. On confirm, perform deterministic writes (calendar events, tasks updates).
- **Tasks**
  1. Define JSON schema for responses (tasks list, scheduled times, notes).
  2. Implement strict parser with validation; reject invalid responses, display error.
  3. Build preview UI showing recommended changes (diff viewer).
  4. Writeback layer applying changes inside transaction; log to `system_logs` (user_id, request_id, before/after, model_version).
  5. Add throttling: per-user request rate limit (token bucket), global concurrency control to manage Vertex spend.
- **Validation**
  - Test harness with canned prompts verifying schema compliance.
  - Simulate Vertex returning malformed JSON; ensure gracefully handled.
  - Confirm audit log entries created for every attempted write, even rejected.
- **Instrumentation**
  - Metrics: `assistant_requests_total`, `assistant_success_total`, `assistant_writebacks_total`, token usage per request, model selection distribution.
  - Alert when writebacks attempted without confirmation (should never happen).

### 6.3 Governance & Settings (ref: `ARCHITECTURE.md §7.3`)
- **Tasks**
  1. Expose settings for user to tune aggressiveness (e.g., proactive prompts on/off, buffer length).
  2. Implement feature flags / kill switches per capability.
  3. Provide audit UX (log viewer) showing user the history of AI suggestions and actions.
- **Validation**
  - GDPR/CCPA review for audit trails.

**Assistant Exit Gates**
- No automated writes without explicit user confirmation; tests ensure enforcement.
- Audit logs accessible and tamper evident.
- Token usage monitored; alert thresholds defined.

---

## 7. Hardening & Scaling
**Objective:** Ensure the platform remains secure, reliable, and scalable as load grows.

### 7.1 Security Exercises (ref: `ARCHITECTURE.md §2.4`)
- **Tasks**
  1. Build prompt-injection canary dataset (malicious calendar invites, ritual entries) and run through gateway regularly.
  2. Verify encryption-at-rest/in-transit posture (Cloud SQL, Secret Manager, Cloud Run) and document that operators cannot read plaintext without break-glass approval.
  3. Implement HTTP security headers (CSP, HSTS, X-Frame-Options) and strict CORS.
  4. Pen-test gateway endpoints; rectify findings.
- **Validation**
  - Document results of canary runs; ensure no malicious instruction reaches LLM.
  - Security checklist signed with encryption controls verified.

### 7.2 Resilience Drills (ref: `ARCHITECTURE.md §6.3`)
- **Tasks**
  1. Disaster recovery rehearsal: restore Cloud SQL snapshot to staging; run regression tests to confirm data integrity.
  2. Fail Cloud Run service intentionally (simulate region failure) to verify auto-recovery.
  3. Establish RTO/RPO targets; document results.
- **Validation**
  - Post-mortem-style report with timing, issues, follow-ups.

### 7.3 Scaling Strategy & Cost Monitoring (ref: `ARCHITECTURE.md §5.3`, §8)
- **Tasks**
  1. Define migration triggers: e.g., `p99_rag_latency_ms > 800` for 3 consecutive days, `vector_count > 10M`, monthly Cloud SQL shaping cost > planned budget.
  2. Create dashboard combining metrics + cost data (via Billing export / BigQuery).
  3. Draft migration runbook to Vertex Vector Search (data export/import, index build, switchover plan).
- **Validation**
  - Migration readiness review; stakeholders sign off.

### 7.4 Compliance & Privacy
- **Tasks**
  1. Document data retention policies (raw text TTL vs summaries).
  2. Implement data export & delete workflows (DSAR readiness).
  3. Review logging for PII exposure; ensure redaction where needed.
- **Validation**
  - Simulate user deletion request; confirm all data removed from primary DB + cache + logs or rendered irrecoverable (e.g., key destruction).

**Hardening Exit Gates**
- DR drill executed with RTO within target; issues resolved.
- Security exercises executed regularly (document schedule) with no critical findings outstanding.
- Migration trigger document published; reviewed quarterly.

---

## 8. Cross-Cutting Tracks
- **Documentation**: After each capability, update relevant sections in `ARCHITECTURE.md`, `RUNBOOK.md`, API docs, and onboarding guides.
- **Analytics & Feedback**: Instrument product analytics (Amplitude/Mixpanel) to capture user engagement per feature; feed into roadmap.
- **Testing Strategy**: Maintain unit/integration/e2e test pyramid; ensure coverage thresholds (>80% for critical modules) enforced in CI.
- **Accessibility**: Run accessibility audits (axe, manual) for all UI additions.

---

## 9. Immediate Next Actions
1. Implement Secure AI Gateway scaffolding with safety sanitiser unit tests (no anonymisation layer).
2. Configure Cloud Build pipeline with blue/green deploy flow and rollback test.
3. Set up OAuth consent + token broker tables; prove refresh & revoke flows.
4. Build initial agenda API + UI using sanitised calendar data (stubbed if necessary).
5. Scaffold `/rag/eval` harness with placeholder metrics and empty golden set (prepare infra early).
6. Create Cloud Monitoring dashboards covering gateway, agenda API, and build pipeline metrics.

---

## 10. Risks & Mitigations
| Risk | Description | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- |
| Prompt injection | Malicious calendar invite instructs LLM to exfil data | Sanitiser + monitoring, canary dataset, manual review of flagged events | Gateway lead | Open |
| Exposure of sensitive data in operators' tools | Logs or dashboards reveal user content | Enforce log redaction, restrict access to encrypted stores, review monitoring for plaintext | Security | Open |
| pgvector saturation | High latency when vectors grow | Monitor latency/vector counts, document migration runbook, pre-provision benchmarking env | Data infra | Open |
| Embedding backlog | Job failures causing stale memory | Backoff + DLQ + alerts, scaling Cloud Run job concurrency | Platform | Open |
| User overload | Excess proactive prompts reduce trust | Rate limit, user settings, gradual rollout with feedback | Product | Open |

---

## 11. Decision Log
| Date | Decision | Rationale | Owner |
| --- | --- | --- | --- |
| 2025-09-17 | Phased rollout (Foundation → Calendar → RAG → Behaviours → Hardening) | De-risk complexity, validate value iteratively | Tom Main |
| 2025-09-17 | pgvector on Cloud SQL for launch; migrate when triggers hit | Minimise early ops burden; keep migration roadmap ready | Tom Main |
| 2025-09-17 | Secure AI Gateway as first-class component | Blocks prompt injection while keeping data encrypted and operator access constrained | Tom Main |
| 2025-09-17 | Episodic graph memory deferred to post-MVP | Focus on core loop before advanced memory | Tom Main |

---
This plan supersedes previous iterations. Update after each milestone review and link artefacts (dashboards, runbooks, tests) inline for historical traceability.
