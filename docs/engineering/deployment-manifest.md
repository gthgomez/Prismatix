# Deployment Manifest — Prismatix (PX00 baseline)

Purpose: sanitized, reproducible baseline of what is **expected** to be deployed for
Prismatix, captured so that deployment drift can be detected mechanically by
`scripts/check-deployment-parity.mjs` (contract tests:
`tests/deployment/check-deployment-parity.test.ts`).

- Basis of deployed facts: the June 2026 deployment audit (read-only observation of
  provider/deployment metadata; no secret values were fetched).
- Basis of repo facts: the audited main SHA below.
- Captured: 2026-10-06 (PX00). First codified baseline; supersedes nothing.
- Change class: documentation + tooling only. PX00 deploys nothing and alters no
  production state.

## Sanitization policy (applies to this file and every artifact derived from it)

1. No secrets ever: no API keys, no token values of any kind (including anon or
   service-role tokens), no provider credential names or values, no production secret
   values. Facts that would require reading a secret are recorded as
   **unknown / unverified** instead.
2. Unknown or unverifiable facts are recorded as **unknown / unverified** — never
   guessed, never presented as verified.
3. The frontend deployment identity is **unverified**; it must never be recorded as
   verified until a Vercel build SHA is observed and pinned.
4. The parity checker enforces the same policy on any *observed* artifact
   (`SECRET_DETECTED`, error severity).
5. Protected advisories stay private; this public manifest records only the baseline
   facts needed for drift detection.

## 1. Release identity

| Property | Value |
| --- | --- |
| Audited main SHA | `41d9b9e7d2f97867d78077e605294b6e49f4b2e0` |
| Audited main subject | fix(router): add cost log idempotency, improve DB error handling (#11) |
| Emergency patch base | `41d9b9e7d2f97867d78077e605294b6e49f4b2e0` — the only repo state verified in this audit. The deployed `router` (v53) predates it and corresponds to an older, unidentified commit, so an emergency patch must be cut from this audited SHA and re-verified against the deployed bundle hashes in §4. Do **not** assume latest main is the patch base without re-verification. |

## 2. Frontend (Vercel)

| Property | Value |
| --- | --- |
| Provider | Vercel |
| Project name / URL | unknown / unverified (not captured in the June 2026 audit) |
| Deployed build SHA | **unknown / unverified** |
| Deployment date | unknown / unverified |

The frontend identity is deliberately recorded as unknown. A parity check that cannot
produce a Vercel build SHA must yield `UNKNOWN_FRONTEND` (info) — never a claim that the
frontend is verified. A later packet must capture the Vercel project/build metadata
read-only, then update this section and the machine baseline together.

## 3. API (Supabase)

| Property | Value |
| --- | --- |
| Project name | Prismatix Router |
| Project ref | `sqjfbqjogylkfwzsyprd` |
| Endpoint base | `https://sqjfbqjogylkfwzsyprd.supabase.co` |
| Functions endpoint base | `https://sqjfbqjogylkfwzsyprd.supabase.co/functions/v1/<slug>` |
| Region / plan | unknown / unverified |

## 4. Edge functions inventory — six deployed slugs

The deployment has **six** function slugs. The repo contains only **five** function
directories; the sixth slug (`spend-stats`) is a legacy hyphenated duplicate of
`spend_stats` with no repo directory.

| Slug | Repo dir | Deployed version | verify_jwt (deployed) | bundle_sha256 (deployed) | Notes |
| --- | --- | --- | --- | --- | --- |
| `router` | yes | v53 | true | `2e2865a3843fb3ad4d0f8e872a7a8c176c90a1fa5121284fdf1eda320709d3bf` | Primary routed-generation function. Deployed bundle is months behind audited main (§1). |
| `spend_stats` | yes | v5 | false | unknown | Manual `Authorization: Bearer <user token>` validation in-function (source-confirmed). Repo `supabase/config.toml` declares `verify_jwt = true` — a known repo-vs-deployed divergence. |
| `spend-stats` | no | unknown | unknown | unknown | Legacy hyphenated duplicate; no repo directory. Retirement decision deferred to a later packet. |
| `video-intake` | yes | unknown | unknown (repo config: true) | unknown | Deployed gateway setting not captured. |
| `video-status` | yes | unknown | unknown (repo config: true) | unknown | Deployed gateway setting not captured. |
| `video-worker` | yes | v4 | false | `88dbce8cb4dd582f1a2486dafc7a3e0fc671ea43e3c3f9b58bcb71c852b89fbc` | Background worker posture; repo config agrees (`verify_jwt = false`). |

Known drift: the deployed `router` v53 bundle (hash above) is months behind audited main
`41d9b9e7d2f97867d78077e605294b6e49f4b2e0`. Bundle hashes are pinned only for `router`
and `video-worker`; every other hash in the table is unknown and must be captured before
it can be compared.

## 5. Migrations

Applied on the deployed database (June 2026 audit) — nine:

1. `20260210000000_init_conversations_messages.sql`
2. `20260211070000_add_user_memory.sql`
3. `20260212090000_add_cost_logs.sql`
4. `20260216100000_add_video_pipeline.sql`
5. `20260216103000_schedule_video_worker_cron.sql`
6. `20260219100000_add_metadata_to_video_assets.sql`
7. `20260308000000_security_fix_search_path.sql`
8. `20260410000000_add_routing_eval_columns.sql`
9. `20260519000000_harden_router_security.sql`

Repo migrations at the audited SHA: the nine above **plus**:

- `20260601000000_add_cost_log_idempotency.sql` — **NOT applied** on the deployed
  database.

Consequence: production `cost_logs` has no `idempotency_key` column, and the audited-main
router (which writes idempotency keys) cannot be deployed until this migration is
applied. This repo-vs-production gap is the primary known deployment debt. The pending
migration is deliberately **excluded from the expected applied set** in parity checks
(it is pending, not expected) — see §11.

The machine baseline uses bare timestamp prefixes (e.g. `20260210000000`) as applied-set
identifiers.

## 6. Schema parity anchors

Columns the parity checker expects on the deployed database, derived **only from applied
migrations** — the pending idempotency migration's column is intentionally absent until
that migration is deployed:

- `cost_logs`: id, user_id, conversation_id, model, provider, input_tokens,
  output_tokens, thinking_tokens, input_cost, output_cost, thinking_cost, total_cost,
  pricing_version, complexity_score, route_rationale, created_at
- `video_assets`: id, user_id, conversation_id, storage_bucket, storage_path, mime_type,
  file_size_bytes, duration_ms, width, height, status, checksum_sha256, error_code,
  error_message, metadata, created_at, updated_at

Once `20260601000000_add_cost_log_idempotency.sql` is applied, add `idempotency_key` to
the `cost_logs` anchor list and to the expected fixture in the tests.

## 7. Allowed origins

- Edge-function CORS contract (repo, source-confirmed): every function reads an
  `ALLOWED_ORIGIN` platform secret and echoes it as `Access-Control-Allow-Origin`,
  falling back to `http://localhost:3000` when the secret is unset. `router` allows
  `POST, OPTIONS`; `spend_stats` allows `GET, OPTIONS`; the video functions apply the
  same origin header with their own method sets (see each function's handler).
- Production `ALLOWED_ORIGIN` value: **unknown / unverified** — it is a platform secret;
  its value must never be captured into an artifact (sanitization policy).
- Local development redirect allow-list (`supabase/config.toml`):
  `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:5173`,
  `http://127.0.0.1:5173`.

## 8. Feature enablement

| Flag | Where it lives | Production value |
| --- | --- | --- |
| `VITE_ENABLE_VIDEO_PIPELINE` | frontend build env | unknown / unverified |
| `ENABLE_VIDEO_PIPELINE` | platform secret | unknown / unverified |
| `ENABLE_DEBATE_MODE` | platform secret | unknown / unverified |
| `ENABLE_SMD_LIGHT` | platform secret | unknown / unverified |
| `ENABLE_DEEPINFRA` | platform secret | unknown / unverified |
| `ENABLE_SERVER_SPEND_LIMIT` | platform secret | unknown / unverified |

All server flags are platform secrets whose values are intentionally not captured
(sanitization policy); the frontend flag is baked into the deployed build, which is
unverified (§2). Video feature enablement in production is therefore **unknown**: the
three video functions are deployed, but whether the production frontend build exposes
video UI is unverified. The full repo-declared secret list is in `README.md`
("Environment"); none of those values belong in this file.

## 9. Auth posture (production)

| Property | Production status |
| --- | --- |
| Auth model | Supabase Auth (user JWTs; row-level security policies guard per-user tables — see `supabase/migrations/`) |
| Signup enabled | unverified |
| Email confirmation required | unverified |
| CAPTCHA enabled (provider) | unverified |
| Leaked password protection | **reported disabled** (June 2026 audit) — hardening gap to address in a later packet |
| MFA | unknown / unverified |

Function-level auth posture (deployed):

- `router`: `verify_jwt` true — the platform rejects requests without a valid user JWT
  before the function runs.
- `spend_stats`: `verify_jwt` **false** at the gateway; the function performs manual
  `Authorization: Bearer` validation in-function (source-confirmed) before querying.
  Drift risk: a bundle change that drops the in-function check would silently remove
  authentication — the parity checker's `BUNDLE_HASH_MISMATCH` is the tripwire.
- `video-worker`: `verify_jwt` false (background worker posture).
- `video-intake` / `video-status`: deployed gateway setting unknown (repo config declares
  `verify_jwt` true).

## 10. Unknown / unverified (explicit register)

Everything in this audit that could not be verified, recorded so no later packet mistakes
absence of data for verified fact:

- Vercel project name, URL, deployed build SHA, deployment date (§2).
- Supabase region, plan, and auth toggles: signup, email confirmation, CAPTCHA (§9).
- Deployed versions and/or bundle hashes for `spend_stats`, `spend-stats`,
  `video-intake`, `video-status` (§4).
- The exact repo commit each deployed bundle was built from — hashes are pinned for
  `router` and `video-worker`, but their source commits are unverified.
- Production `ALLOWED_ORIGIN` and all server feature-flag/limit secret values (§7, §8)
  — must never be captured.
- Whether any rogue/extra functions exist beyond the six slugs — re-observation needed;
  the parity checker reports `EXTRA_FUNCTION` when an observed slug is outside this
  baseline.

## 11. Using the drift checker

```
node scripts/check-deployment-parity.mjs <expected.json> <observed.json>
npm run check:parity -- <expected.json> <observed.json>
```

- `expected.json` mirrors §§4–6 of this manifest (six slugs, applied migrations, schema
  anchors) with `frontend.build_sha` left `null` until §2 is verified. Unknown values
  are `null`, never guessed.
- `observed.json` is a fresh read-only capture in the same shape (PX12 will wire this
  into CI).
- Exit codes: `0` parity holds (warnings/info allowed), `1` any error-severity finding,
  `2` usage/input error.
- Findings: `MISSING_FUNCTION` (error), `EXTRA_FUNCTION` (warn), `BUNDLE_HASH_MISMATCH`
  (error), `MISSING_MIGRATION` (error), `MISSING_COLUMN` (error), `STALE_FRONTEND`
  (error), `UNKNOWN_FRONTEND` (info), `SECRET_DETECTED` (error).
- The checker never prints secret values: a `SECRET_DETECTED` finding reports the JSON
  path and matched pattern name only.

Updating this manifest: when the deployment changes deliberately, update the affected
section **and** the expected fixture in the tests in the same change — the tests pin the
six slugs, the pinned bundle hashes, the applied migration set, the schema anchors, and
this file's sanitization.

---

## 12. Release identity contract (PX02)

Every `router` response — including OPTIONS preflight, validation errors, and
auth rejections — is stamped with the identity of the deployed revision via
five response headers, resolved once at function startup from project env
(Supabase secrets). The same identity is returned in the `release` field of
the authenticated capabilities contract (`POST /functions/v1/router` with
body `{ "action": "capabilities" }`; requires a valid user token, does NOT
require a chat entitlement).

| Header | Env var | Default when unset | Meaning |
| --- | --- | --- | --- |
| `X-Prismatix-Protocol` | `PRISMATIX_PROTOCOL_VERSION` | `1` (code constant `PROTOCOL_VERSION`) | Wire protocol version. `1` = first versioned protocol: capabilities contract + `X-Prismatix-*` headers (introduced by PX02). Bump when the contract changes in a way clients must detect. |
| `X-Prismatix-Schema` | `PRISMATIX_SCHEMA_VERSION` | `unspecified` | Database schema/migration revision the deployed code is qualified against. |
| `X-Prismatix-Catalog` | `PRISMATIX_CATALOG_VERSION` | `unspecified` | Model catalog revision (the exact-match set accepted by `normalizeModelOverride`). |
| `X-Prismatix-Tariff` | `PRISMATIX_TARIFF_VERSION` | `unspecified` | Tariff/pricing revision used by the cost engine. Single source: `supabase/functions/_shared/model_tariff.ts` (`MODEL_TARIFF_VERSION`) — both `src/pricingRegistry.ts` and `supabase/functions/router/pricing_registry.ts` re-export it. Surfaced per-request as `X-Cost-Pricing-Version`. Set the secret to the same string. |
| `X-Prismatix-Release` | `RELEASE_SHA` | `unknown` | Git SHA of the deployed revision. |

All five header names are listed in the router's
`Access-Control-Expose-Headers`, so a cross-origin browser client can read
them.

### The `unknown` SHA rule

`releaseSha` defaults to the literal string `unknown` and MUST NOT be
replaced by any guessed, reconstructed, or "last known" value — in code, in
tooling, or in this manifest. An `X-Prismatix-Release: unknown` header on a
live deployment means the deployment pipeline did not inject `RELEASE_SHA`;
that is a deployment-process defect to fix, not a value to paper over.
Identity fields that are unset are reported as `unspecified` (or the code's
own `PROTOCOL_VERSION` for the protocol) so drift is visible instead of
hidden behind stale hardcoded values. Identity values are sanitized to
printable ASCII before being emitted as headers.

### Deployment checklist (release identity)

1. Set in Supabase project secrets before deploying a contained release:
   `RELEASE_SHA` (the exact deployed git SHA), `PRISMATIX_SCHEMA_VERSION`
   (the newest applied migration, e.g. `20261006000000`), and — when the
   catalog/tariff are pinned — `PRISMATIX_CATALOG_VERSION` /
   `PRISMATIX_TARIFF_VERSION`.
2. After deploy, verify from an allowed origin (or curl):
   `X-Prismatix-Release` equals the deployed SHA and `X-Prismatix-Schema`
   equals the approved patch manifest's schema revision.
3. Acceptance item "live revision and schema match the approved patch
   manifest" is an **authorized-production-run** item: it is verified against
   the live deployment during the containment run, not claimed from the repo.

## 13. Capabilities contract (PX02)

`POST /functions/v1/router`, body `{ "action": "capabilities" }`, with
`Authorization: Bearer <user token>`:

- **200** for any authenticated user — the read-only view does not require a
  chat entitlement (the entitlement gate still guards all paid execution).
- **401** without a valid token.
- Response shape:

  ```json
  {
    "release": {
      "protocolVersion": "1",
      "schemaVersion": "unspecified",
      "catalogVersion": "unspecified",
      "tariffVersion": "unspecified",
      "releaseSha": "unknown"
    },
    "capabilities": {
      "modes": ["chat"],
      "features": {
        "chat": true,
        "review": false,
        "video": false,
        "memory": true,
        "smd": false
      },
      "models": ["<canonical model IDs accepted by normalizeModelOverride>"]
    }
  }
  ```

- Values reflect **actual runtime flags** — no aspirational claims:
  `video` = `ENABLE_VIDEO_PIPELINE` (default **off**; video stays unavailable
  until its own qualification gate passes), `review` = `ENABLE_DEBATE_MODE`
  (debate enablement), `smd` = `ENABLE_SMD_LIGHT` (experimental; default
  **off**), `memory` = server-side memory retrieval/summarization, which is
  always active for web-platform requests (mobile clients are their own
  memory authority — the bypass invariant). `modes` lists `chat` plus
  `debate`/`smd_light` only when the corresponding flags are on. The payload
  never contains secrets or provider keys.

## 14. Model selection strictness (PX02, F17)

An unknown manual `modelOverride` (a non-empty value other than `auto` that
`normalizeModelOverride` cannot exact-match against the registry or synonym
table) is rejected with **HTTP 400** `{ "error": "unknown_model", "code":
"unknown_model" }` and **zero provider calls**. The router never silently
falls back to Auto for an unknown manual selection and never substring-maps a
new model generation onto an older one. The documented `debate` /
`debate:<profile>` compatibility toggle is a mode switch, not a model
selection, and remains accepted. Contract tests:
`tests/integration/deployment-contract.test.ts`.

## 15. Stats slugs (audit note, PX02)

Two stats slugs are deployed: `spend_stats` (repo dir; gateway
`verify_jwt = false` in production, while repo `supabase/config.toml`
declares `true` — known divergence) and the legacy hyphenated `spend-stats`
duplicate (no repo dir). `spend_stats` validates the Bearer token manually
in-function, so authentication holds regardless of the gateway setting; the
exported `handleSpendStats(req, deps)` seam makes this testable
(`tests/integration/deployment-contract.test.ts`). Both slugs' consumers are
preserved until retirement of the duplicate is safe in a later packet.

## 16. Execution / model-call ledger (PX03, F03/F06/F07/F19/F21)

PX03 replaces the content-hashed `cost_logs` idempotency key with a durable
execution/call ledger. It deploys **one additive migration** and **no new edge
function slug** (the ledger is written by the existing `router` function).

### 16.1 Migration

| File | Class | Notes |
| --- | --- | --- |
| `supabase/migrations/20261006010000_px03_execution_ledger.sql` | additive | Adds `prismatix_internal.executions`, `prismatix_internal.model_calls`, `prismatix_internal.reconciliation_jobs`; adds `public.cost_logs.cost_status` (default `estimated_legacy`). No fabricated historical backfill. |

**Deploy order (required): apply this migration BEFORE deploying the router
build that writes the ledger.** The router writes `cost_logs.cost_status` and
calls the `px03_*` RPCs; against a pre-PX03 schema those writes fail closed
(the execution is marked `indeterminate` and a reconciliation job is enqueued)
rather than corrupting data, but the ledger is not populated until the schema
is present.

### 16.2 Authority tables and access

The three authority tables live in `prismatix_internal`, which stays **out of
PostgREST** (`[api].schemas = public, graphql_public`) exactly as PX01
established. All writes go through service-role-only `security definer` RPCs in
the exposed `public` schema — `px03_create_execution`, `px03_record_model_call`,
`px03_finalize_execution`, `px03_enqueue_reconciliation` — mirroring
`public.get_access_grant`. RLS is enabled on all three tables with no
INSERT/UPDATE/DELETE policy for `anon`/`authenticated` and SELECT-own policies
on `executions` / `model_calls` (defence-in-depth; the schema is not exposed).

### 16.3 Identity contract

- `executions` is keyed by `(subject_id, client_request_key)` and bound to a
  `payload_hash`. Reusing a key with a different payload is **HTTP 409**
  `request_key_conflict` (`SQLSTATE PT409`) and dispatches nothing.
- `model_calls` is keyed by `(execution_id, stage, participant,
  attempt_number)`. Distinct provider dispatches are distinct rows; a retry of
  the same accounting event dedupes to one row.
- `cost_status ∈ { settled, pending, estimated_legacy }`. Missing/unknown
  provider usage is `pending` with a durable `reconciliation_jobs` row — never
  a fabricated `$0`, never `settled`. Existing `cost_logs` rows keep their
  `legacy:` keys and are labelled `estimated_legacy`.

Verification: `tests/routing/execution_identity.test.ts` (vitest, injected fake
client) and `tests/integration/ledger-settlement.sql` (self-contained
BEGIN/ROLLBACK; run against a migrated database per the storage-isolation
runbook).

## 17. Stream lifecycle, SSE wire contract and terminal receipts (PX06, invariant 7)

PX06 makes downstream cancellation a distinct terminal path and exposes a
structured terminal receipt. It deploys **one additive migration** (a read RPC
only) and **no new edge function slug** and **no new table**. The mobile wire
contract is unchanged: `content_block_delta` JSON and the `data: [DONE]`
terminator are byte-for-byte identical; the `receipt` event is additive and old
clients ignore it.

### 17.1 SSE wire contract

Responses are `Content-Type: text/event-stream`. The router normalizes every
provider stream into these data events:

| Event | Shape | Notes |
| --- | --- | --- |
| `content_block_delta` | `data:{"type":"content_block_delta","delta":{"text":"…"}}` | **Unchanged** mobile protocol. |
| `thought` | `data:{"type":"thought","chunk":"…"}` | Thinking stream (existing). |
| `meta` | `data:{"type":"meta",…}` | Cost/debate metadata (existing). |
| `receipt` | `data:{"type":"receipt",…TerminalReceipt}` | **Additive.** Emitted as the final data event immediately before `[DONE]` on completion. |
| terminator | `data: [DONE]` | **Unchanged**; always the last event. |
| heartbeat | `: keepalive` | SSE comment emitted on an interval (default 15 s) while the router waits on upstream; it is not a data event. |

`X-Prismatix-Execution-Id` is set on the `text/event-stream` response (and listed
in `Access-Control-Expose-Headers`) so a browser client can correlate the stream
with its execution before the receipt arrives.

The `TerminalReceipt` projection is:

```jsonc
{
  "executionId": "…", "status": "completed|cancelled|failed|indeterminate|started",
  "terminalOutcome": "ok|client_cancelled|…|null",
  "requestedModel": "…|null", "resolvedModel": "…|null", "servedModel": "…|null",
  "createdAt": "…", "finalizedAt": "…|null",
  "settlement": { "state": "settled|pending|released", "committedUsd": 0.0, "pendingCalls": 0 },
  "calls": [{ "stage": "…|null", "participant": "…|null", "attemptNumber": 1,
              "servedModel": "…|null", "costStatus": "settled|pending|estimated_legacy",
              "totalCost": 0.0 }]
}
```

Money safety: `settlement.state` is `released` only for zero calls with a
released reservation, `pending` when any call is not `settled`, otherwise
`settled`. Missing/unknown cost is `pending`, never `$0`.

### 17.2 Cancellation semantics (invariant 7)

- A downstream client disconnect finalizes the execution `cancelled`
  (`terminal_outcome = 'client_cancelled'`) and settles the reservation from the
  authoritative ledger. A disconnect is **never** reported as `completed`/`ok`.
- A mid-stream upstream read error or an outer crash/timeout finalizes the
  execution `indeterminate` (`terminal_outcome = 'aborted'` /
  `'upstream_stream_error'`) when it is not already terminal.
- Settlement follows the ledger: settled calls commit; any unsettled call keeps
  the hold (`pending`); zero provider calls releases the hold.

### 17.3 Authenticated receipt lookup

`POST` the router with a valid user bearer token and:

```jsonc
{ "action": "execution_receipt", "executionId": "<uuid>" }
```

No chat entitlement is required (it is the caller's own accounting record) and
**zero provider calls** are made. Responses:

| Status | Body | Condition |
| --- | --- | --- |
| 200 | `TerminalReceipt` | owned by the authenticated subject |
| 400 | `{ "error": "Bad Request: executionId required" }` | missing/blank id |
| 404 | `{ "error": "execution_not_found" }` | unknown **or** not owned (existence never leaked) |
| 503 | `{ "error": "accounting_unavailable", "code": "accounting_unavailable" }` | ledger lookup failure (fail closed) |

### 17.4 Migration

| File | Class | Notes |
| --- | --- | --- |
| `supabase/migrations/20261006030000_px06_execution_receipt.sql` | additive | Adds `public.px03_get_execution_receipt(p_subject_id uuid, p_execution_id uuid) returns jsonb`, `SECURITY DEFINER` with a fixed `search_path`. **Read RPC only — no new table.** Returns `NULL` unless an `executions` row matches BOTH the id and the subject id. |

**Unapplied:** the migration is committed but not yet applied to any
environment; the RPC returns 404/fails closed until it is applied. Grants:
`EXECUTE` revoked from `public`/`anon`/`authenticated`, granted only to
`service-role` — the same posture as the other `px03_*` / `px05_*` RPCs. The
`prismatix_internal` authority tables remain out of PostgREST, so this RPC is the
only read path.

Verification: `tests/routing/sse_parser.test.ts`, `tests/routing/stream_lifecycle.test.ts`
and `tests/routing/execution_receipt.test.ts` (vitest). The migration's SQL
behaviour requires a psql/staging run (not available in the CI unit environment).

## 18. Conversation continuity, attachments and bounded context (PX07-Lite)

PX07 makes conversations durable and reloadable without a relational attachments
subsystem, extra read RPCs, a transcript-reconciliation path, or server-minted
signed URLs.

### 18.1 Columns

| Table | Column | Notes |
| --- | --- | --- |
| `public.conversations` | `title text` | set from the first `user` message (`left(content, 120)`) by the write RPC |
| `public.conversations` | `last_activity_at timestamptz not null default now()` | backfilled from `greatest(created_at, max(message.created_at))` |
| `public.messages` | `execution_id uuid` | durable execution identity (PX03) |
| `public.messages` | `attachments jsonb not null default '[]'` | `check (jsonb_typeof(attachments) = 'array')` |

A partial unique index, `messages_execution_role_uidx` on
`(execution_id, role) where execution_id is not null`, makes a replay of the same
`(execution_id, role)` idempotent. A replay with different content/attachments is
rejected with SQLSTATE `PT409` (`message_conflict`).

The attachment element shape is
`{ ordinal, kind: "image"|"video"|"file", storageRef, videoAssetId, available,
name?, size? }`. Base64, signed URLs, file content, and another subject's
storage path are never stored. Image refs are private
`supabase://chat-uploads/<subject>/<path>` references; video refs carry a
`video_assets` id whose ownership is checked by the RPC; `file` (text/code)
entries carry only `name`/`size` metadata (content stays model-input-only). The
array is bounded to 16 entries and each `storageRef` to 2048 chars, in both
`normalizeAttachments` and the RPC.

### 18.2 Write RPC

`public.px07_persist_message(p_subject_id, p_conversation_id, p_execution_id,
p_role, p_content, p_token_count, p_model_used, p_attachments, p_legacy_image_url)
returns jsonb` — `SECURITY DEFINER`, fixed `search_path = public,
prismatix_internal`, `EXECUTE` revoked from `public`/`anon`/`authenticated` and
granted only to `service-role`. One transaction: validates the execution belongs
to the subject and conversation, honours the `(execution_id, role)` idempotency
contract, validates every attachment, inserts, and only then advances
`last_activity_at`/`title` and calls `increment_token_count_for_user`. Messages
are server-authored; the client `messages_insert_own` policy is dropped (owner
`select` is retained). `conversations_insert_own` is intentionally left unchanged
to bound the diff (follow-up).

The router persists the user turn with the ORIGINAL `query` (never the
memory/video-expanded `effectiveQuery`) BEFORE any provider dispatch. A
pre-inference persistence failure is fail-closed: `503 transcript_unavailable`,
the PX05 reservation is released, and zero provider calls happen. The assistant
turn is persisted at completion; on failure (or a `PT409` conflict) the stream
still completes and the terminal receipt reports `transcript.saved = false`
(never a false durable claim). `TerminalReceipt` gains an optional
`transcript?: { saved: boolean }`.

A failed/conflicting assistant persist also enqueues
`assistant_transcript_failed` / `assistant_transcript_conflict` via the existing
PX03 `reconciliation_jobs` table. This is an **audit record only** — there is no
transcript-recovery/reconciliation path, and `reconciliation_jobs` remains
accounting/audit-only (it is not extended for conversation recovery).

### 18.3 Read path and client continuity

Reads are plain RLS owner selects on `conversations` / `messages` (no new read
RPC). `src/services/conversationService.ts` provides list/load/sign/delete and
the bounded selector; the selected conversation is stored per authenticated user
and stream updates are guarded by `(conversationId, clientRequestId)`. A stable
`x-client-request-id` is reused on the 401 retry; a `409 duplicate_request` loads
the existing turn and never auto-dispatches, while `request_key_conflict` is an
error. Image attachments render from short-lived signed URLs (60s, never
persisted); video attachments render as a safe placeholder. Delete Chat removes
the conversation rows (messages cascade) and removes any image object referenced
solely by that conversation via the Storage API.

### 18.4 Bounded context

The client sends at most the router window (`maxHistoryMessages = 24`,
`maxHistoryMessageChars = 12000`, `maxHistoryTotalChars = 80000`) from
`selectContextHistory`; excluded older messages are surfaced with an "older
messages are outside the current context" indicator.

### 18.5 Migration

| File | Class | Notes |
| --- | --- | --- |
| `supabase/migrations/20261006040000_px07_conversation_continuity.sql` | additive | Columns, backfill, partial unique index, JSONB array check, `messages_insert_own` drop, and `public.px07_persist_message`. Dropping the new columns/policies is safe. |

**Unapplied:** the migration is committed but not yet applied to any
environment; until it is applied the RPC is unavailable and the router fails
closed on persistence. Verification: `tests/routing/conversation_attachments.test.ts`,
`tests/routing/conversation_persistence.test.ts`, `tests/routing/conversation_context.test.ts`,
`src/services/conversationService.test.ts`, `src/services/conversationState.test.ts`
(vitest) and `tests/integration/px07_conversation_continuity.sql` (psql/staging;
not available in the CI unit environment).

