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
