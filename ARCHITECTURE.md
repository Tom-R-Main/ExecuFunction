# ExecuFunction Architecture Blueprint (GCP + pgvector)

_Last updated: 2025-09-17_

## 1. Guiding Principles
- **Single brand/domain**: everything lives at `https://execufunction.com`; "Winona" is an in-app persona only.
- **GCP-native stack**: Cloud Run services, Cloud SQL (Postgres 15/16 + `pgvector`), Secret Manager, Vertex AI.
- **Deterministic-first, semantic-second**: structured facts stay in normalized tables; semantic recall augments prompts via pgvector.
- **Context Composer**: central gateway builds prompts with token budgets, guardrails, and logging before calling Vertex Gemini.
- **Jobs for eventual consistency**: embeddings, calendar sync, ritual aggregation run as Cloud Run Jobs with retries/alerts.
- **Isolation & auditability**: RLS using `SET LOCAL app.current_user_id` per request; read-only `ai_read` role for retrieval.

## 2. High-Level System
```
User → Flutter Frontend → API (Cloud Run)
        |                     |
        |                     ├─ private IP → Cloud SQL (Postgres + pgvector)
        |                     ├─ Vertex AI Embeddings + Gemini
        |                     └─ Cloud Logging & Monitoring

Cloud Scheduler → Cloud Run Jobs (Calendar Sync, Channel Renewal, Ritual Aggregate, Embedding Worker)
```

- **Frontend**: Flutter web today (mobile later). Uses Google Identity Platform for login.
- **Backend API**: Node/TypeScript (or Go) service on Cloud Run. Modules: Auth, Tasks, Calendar, Rituals, Memory/RAG, Conversation Gateway.
- **Data**: Cloud SQL Postgres 15/16 (private IP). Extensions: `pgcrypto`, `citext`, `vector`.
- **LLM**: Vertex AI (text-embedding-004 + Gemini 2.5 Flash/Pro).
- **Async jobs**: Cloud Run Jobs for embedding, calendar sync, channel renewal, ritual aggregation.
- **Secrets**: Secret Manager (DB creds, OAuth secrets, future SMTP/Chat).
- **Observability**: Cloud Logging, Cloud Monitoring dashboards, Cloud SQL Insights.

## 3. Authentication
1. **Frontend** obtains Google ID token via Identity Platform.
2. **POST `/auth/google`** → backend verifies token (Google certs, `aud/iss/exp`).
3. Backend upserts `users` row, issues HttpOnly Secure cookies (`session`, optional `refresh`).
4. Every request:
   - Verify session/JWT.
   - `BEGIN; SET LOCAL app.current_user_id = $userUuid;` (per-request transaction).
   - Execute SQL (RLS ensures tenant isolation) → `COMMIT`/`ROLLBACK`.
5. DB roles:
   - `app_rw`: read/write tables.
   - `ai_read`: SELECT-only for RAG.
6. Security: rate-limit auth endpoints, rotate signing secrets, enforce cookie flags (`HttpOnly`, `Secure`, `SameSite=Lax`).

## 4. Data Model (excerpt)

| Domain | Key Tables | Notes |
|--------|------------|-------|
| Users  | `users`, `profiles`, `system_logs` | minimal PII, audit logs |
| Tasks  | `tasks`, `task_steps`, `task_checklists` | soft delete via `deleted_at`; `updated_at` triggers |
| Calendar | `calendar_accounts`, `calendar_tokens`, `calendar_sync_state`, `calendar_events`, `calendar_raw` | push channels + fallback poll |
| Rituals | `ritual_logs`, `ritual_daily_summaries` | nightly summaries feed memories |
| Memory/RAG | `memory_notes (vector)`, `embedding_jobs`, `embedding_failures`, views `ai_context_summary_v`, `daily_agenda_v` | `vector_cosine_ops`, IVFFlat + HNSW |
| Graph Memory | `memory_events`, `entities`, `event_links`, `cues` | episodic "what-where-when-who" graph |

### pgvector details
- `CREATE EXTENSION vector;`
- `memory_notes.embedding vector(768)` (match Vertex embedding dim).
- **Indexes**
  - Baseline: `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 200);`
  - High-recall: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);`
- Runtime tuning: `SET LOCAL ivfflat.probes = 20` or `SET LOCAL hnsw.ef_search = 128` depending on query path.
- Optional: hash partition `memory_notes` by `user_id` when corpus grows.

### Graph memory tables (episodic layer)
- `memory_events`: `id`, `user_id`, `started_at`, `ended_at`, `location_id`, `title`, `summary_text`, `emotion_score (-1..1)`, `importance (0..1)`, `embedding vector(768)`.
- `entities`: `id`, `user_id`, `kind` (`person|topic|artifact|place|task|ritual`), `display_name`, `metadata jsonb`.
- `event_links`: `(event_id, entity_id, role, notes)` with roles such as `attended|mentioned|owner|blocked_by|relates_to`.
- `cues`: `(event_id, cue_type time|place|person|calendar|device, cue_value, cue_window, action_json)`.
- Indexing: HNSW/IVFFlat on `memory_events.embedding`, plus btree on `(user_id, started_at)` and `(user_id, location_id)`; `event_links` indexed on `(user_id, event_id)` and `(user_id, entity_id)`.

### RLS pattern
```
CREATE OR REPLACE FUNCTION app.current_user_uuid() RETURNS uuid AS $$
  DECLARE v text := current_setting('app.current_user_id', true);
  BEGIN
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

CREATE POLICY tasks_rls ON tasks
  USING (user_id = app.current_user_uuid())
  WITH CHECK (user_id = app.current_user_uuid());
```

## 5. Calendar Flow
1. **Connect calendar**:
   - User completes OAuth → backend stores tokens in `calendar_tokens`, account row in `calendar_accounts`.
   - Create push channel (`watch`) → save `channel_id`, `expiration`, initial `sync_token` in `calendar_sync_state`.
2. **Webhook ingestion** (`POST /calendar/webhook`):
   - Validate headers/channel.
   - Write payload to `calendar_raw` (staging).
   - Trigger immediate delta sync.
3. **Sync job** (scheduled & on-demand):
   - Refresh tokens if expired.
   - Fetch delta via `sync_token`; fallback to time-window fetch on invalidation.
   - Normalize/upsert into `calendar_events` (unique `(user_id, source, ext_event_id)`).
   - Update `calendar_sync_state` with new `sync_token`/timestamp.
4. **Channel renewal job**: renew channels before expiration; fallback to polling if watch fails.
5. **UI/RAG** read from `calendar_events` and aggregated view `daily_agenda_v`.
6. **Alerts**: repeated `sync_token` invalidation, channel renewal failures, upsert errors.

## 6. Task & Ritual System
### Tasks
- CRUD APIs operate within transaction + GUC.
- `task_steps` captures micro-breakdowns; `order_index` for ordering.
- Daily agenda view merges tasks + calendar events for conversation context.
- Optional calendar integration: tasks flagged to sync create/update events through Calendar Service.

### Rituals
- `ritual_logs` store quick entries (energy, mood, free text).
- Nightly **Ritual Aggregate Job** summarizes into `ritual_daily_summaries` and writes a short `memory_notes` entry (kind `ritual_summary`) → queued for embedding.

## 7. Memory & RAG
1. **Write path**: storing a conversation turn, journal note, or ritual summary inserts into `memory_notes`; trigger enqueues job in `embedding_jobs`.
2. **Embedding job**:
   - `SELECT ... FOR UPDATE SKIP LOCKED` a batch.
   - Call Vertex embeddings (batch if supported).
   - Update `memory_notes.embedding`; mark job processed.
   - After `N` failures, move to `embedding_failures` and alert.
3. **/rag/search** endpoint:
   - Embed query via Vertex.
   - Transaction: set GUC → fetch structured facts (tasks due, upcoming events, recent rituals) + vector matches ordered by `<=>` distance.
   - Optional `SET LOCAL ivfflat.probes = 20`.
   - Return context bundle (memories + facts + token counts + TTL) for Conversation Gateway.

### Retrieval corpus management
- **Chunking**: use recursive splitter with doc-level metadata (title, source, timestamps). For high-stakes corpora, enable semantic/proposition chunking.
- **Re-embedding pipeline**: cron- or event-driven job to re-chunk and re-embed documents when source files change; leverage the same embedding worker.
- **Metadata**: every chunk stores `doc_id`, `doc_title`, `doc_created_at`, `section_path`, enabling hybrid filtering.

### Graph memory layer
- **Write path**: when storing a conversation turn/ritual/task interaction, also create or update `memory_events` and associated `entities`/`event_links`; enqueue embedding.
- **Consolidation policy**:
  - Fetch ~10 nearest `memory_events`.
  - Structured dupe test: same day ±2h & ≥2 shared entities ⇒ `UPDATE` existing event.
  - Merge: cosine ≥0.88 & ≥3 overlapping entities ⇒ merge summaries, `importance += 0.1` (cap 1.0).
  - Archive: `importance < 0.15` and age > 180 days and zero rehearsals ⇒ set `archived_at`.
- **Salience scoring**: `score = 0.55*semantic + 0.20*emotion + 0.15*time_proximity + 0.10*entity_overlap`, decayed by `exp(-λ * days_since_update)` (`λ≈0.01`). Emotion sourced from ritual mood logs + sentiment; entity overlap counts matched people/places/tasks.
- **Prospective memory & cues**:
  - Intention Builder UI captures goal → steps → cue → owner → first tiny action.
  - Stored as `entities(kind='task')` plus prospective `memory_event` + `cues` rows.
  - Cue engine drives time-, event-, or place-based triggers; rehearsals (2–3) increase `importance` and reduce decay.
- **Queryless proactive cards**: strict throttle surfaces ≤2 cards when cues fire (e.g., “Meeting with Ezra at 3:00 — you promised to send Q3 sheet”). Implemented as Context Composer hook post-agenda, with token budget and logging.

### Graph retrieval API (`/graphmem/search`)
- Request: `{ user_id, cues?: { time, place, people[] }, text?, k? }`.
- Pipeline:
  1. Structured filters using `cues` to narrow candidate events.
  2. Vector search on `memory_events.summary_text` within candidates; widen scope if none.
  3. Expand 1-hop neighbors via `event_links` to gather related entities/tasks.
  4. Re-rank via salience formula; cap 5 results; log trims.
- Response: `{ events: [...], entities: [...], evidence: [{event_id, score_breakdown}] }`.
- Conversation Gateway bundles `/graphmem/search` output with `/rag/search` facts under shared token caps.

### Evaluation harness
- `/rag/eval` (Cloud Run Job) runs 30–50 golden queries nightly.
- Metrics: Precision@5, MRR, nDCG.
- Logs to BigQuery / Cloud Monitoring; alerts on regression beyond threshold.
- Supports parameter sweeps (`hnsw.ef_search`, chunk size) with results persisted for comparison.
- Extend suite with graph memory benchmarks (e.g., “Find the plan with Ezra at the library last month”). Track vector-only vs. hybrid accuracy and latency; canary new rankers via traffic split.

### Prompt presets
- Conversation Gateway exposes `purpose` flag:
  - `grounded`: low temperature (<0.5), conservative sampling, retrieval required.
  - `brainstorm`: higher temperature (~1.2) with min-p sampling; still limited by guardrails.
- Envelope limited to 250–400 tokens before persona/system prompt; trimming logged (`context.trimmed=true`, `tokens_removed`).

### Canary playbook
- Deploy new retrieval + prompt preset via Cloud Run revision.
- Route 10% traffic to canary using Cloud Run traffic split.
- Monitor p95 latency, faithfulness scores, and /rag/eval metrics.
- Promote to 100% once metrics stabilize; otherwise rollback.

### Privacy & UX notes
- Surface no more than three focus items on the dashboard (agenda + memory cards) to avoid overwhelm.
- Per-entity visibility controls (e.g., mark family memories private-only).
- Export/delete flows leverage `user_id` joins across graph + vector tables; TTL raw text while retaining concise summaries.

## 8. Conversation Gateway
- Receives user message → stores as memory note (kind `conv_turn`), enqueues embedding.
- Calls `/rag/search` with persona instructions and token budgets.
- Builds prompt (persona/system directives + facts + top-k memories) under defined token caps.
- Invokes Vertex Gemini (Flash baseline, Pro for complex tasks).
- Sanitizes response, logs token usage, stores AI reply (TTL for raw text, long-term summary).
- Adds moderation or fallback if needed.

## 9. Logging & Observability
- **Structured logs** (JSON) with `trace_id`, `span_id`, hashed `user_id`, route, latency, `rag.probes`, `rag.tokens_in/out`, job metrics.
- Include graph metrics: `graph.ef_search`, `graph.semantic_score`, `graph.emotion`, `graph.results_returned`, `context.proactive_cards`.
- **Dashboards/SLOs**:
  - API p95 < 400 ms, error rate < 1%.
  - RAG p95 < 800 ms.
  - Embedding backlog < threshold, attempts < 5.
  - Calendar sync success rate > 99%.
- **Alerts**: 5xx spikes, embedding job retries, sync token invalidation, channel renewal failure, Cloud SQL connection saturation.
- **Cloud SQL Insights** to monitor slow queries; tune indexes/rebuild IVFFlat as data evolves.
- Export logs to BigQuery if long retention needed.

## 10. Networking & Security
- Cloud Run ↔ Cloud SQL via private IP using Serverless VPC Connector.
- Service account permissions: `cloudsql.client`, `secretmanager.secretAccessor`, OAuth scopes.
- All secrets in Secret Manager; rotate DB creds periodically.
- Consider CMEK for DB + Secret Manager when policy requires.
- Logs keep hashed user IDs; TTL policy for raw conversation text (e.g., 90 days) with longer-lived summaries.
- Implement export/delete endpoints for user data by linking tables via `user_id`.

## 11. CI/CD
- Cloud Build trigger on `main`.
- Pipeline: lint/test → build image → run DB migrations → deploy to staging → smoke test → canary deploy (e.g., 10% traffic, 5 min) → full rollout or automatic rollback on error threshold.
- `cloudbuild.yaml` includes `options: { logging: CLOUD_LOGGING_ONLY }` (required when using user-managed service account).
- Cloud Scheduler triggers for jobs deployed via Cloud Build as well.

## 12. Immediate Checklist
- [ ] Enable `vector` extension; apply DDL (tables, RLS, triggers, indexes).
- [ ] Middleware wraps every request in transaction + `SET LOCAL app.current_user_id`.
- [ ] Implement `/rag/search` and Context Composer pipeline.
- [ ] Deploy embedding job + alert on `embedding_jobs.attempts >= 5`.
- [ ] Wire calendar OAuth flow, webhook, sync job, channel renewal job.
- [ ] Build dashboards & alerts for SLOs (API latency, RAG latency, job backlog, sync failures).
- [ ] Document data retention, export/delete processes.
- [ ] Test canary deploy + rollback path.
- [ ] Create HNSW index (cosine), expose `ef_search` tuning knob, and document default settings.
- [ ] Add chunking/re-embedding job + `/rag/eval` harness (Precision@5, MRR, nDCG) with alerting.
- [ ] Add Vertex purpose presets (`grounded`, `brainstorm`) + envelope cap logging.
- [ ] Configure traffic-split canary for retrieval/prompt changes; monitor faithfulness + latency.
- [ ] Implement graph memory tables + consolidation policy + salience ranker.
- [ ] Build `/graphmem/search` API + proactive cue engine (queryless cards, rehearsal boosts).
- [ ] Extend evaluation suite with graph scenarios; compare vector vs. hybrid recall.

---
This document should be updated as the system evolves. For lower-level specs (API contracts, database migrations), add dedicated docs under `docs/` (e.g., `DATA_MODEL.sql`, `RAG.md`, `CALENDAR.md`).
