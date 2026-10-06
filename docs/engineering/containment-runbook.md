# Containment Runbook — PX01 Storage Exposure & Paid-Access Hardening

Status: Private / internal. Do not publish unfixed vulnerability details.
Scope: Storage policy containment, server-managed entitlements, client-write
containment, signup gating, worker authentication.

This runbook is operational sequence only. It deliberately contains no exploit
specifics, no live identifiers, and no secrets. Reference the internal incident
record (kept separately, access-controlled) for finding details.

## 0. Ground rules

- Do not delete evidence (logs, policy metadata, screenshots) at any point.
- Do not publish unfixed details outside the access-controlled incident record.
- Never restore a broad permissive storage policy as a rollback measure.
- Do not rotate the public anon key as a substitute for fixing authorization;
  the anon key is public by design.
- Rollback = disable the affected feature or deny access (fail closed), not
  re-exposure.

## 1. Back up current state (before touching anything)

Capture and store in the incident record:

- Effective storage policies and metadata:
  ```sql
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname = 'storage'
  order by tablename, policyname, cmd;
  ```
- Current RLS policies on `public.cost_logs` and `public.video_assets`
  (same query, `schemaname = 'public'`).
- Production auth configuration, captured explicitly from the production
  project (dashboard + API), including: signup enabled/disabled (general,
  email, phone, anonymous), email confirmation state, and CAPTCHA provider
  state. `supabase/config.toml` in the repository is NOT proof of production
  settings; production flags must be checked explicitly and recorded.
- Available retention settings for API/auth/database logs, and the time window
  that will be retained for the historical-scope investigation.

## 2. Stage and rehearse

1. Provision a staging database that mirrors production: an already-migrated
   schema that still contains the legacy (dashboard-created) storage rules.
2. Apply the reviewed production patch
   (`supabase/migrations/20261006000000_px01_storage_entitlements.sql`) to
   staging only.
3. Run the containment assertions from the repo root:
   ```
   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f tests/security/storage-isolation.sql
   ```
   The script stages the legacy drift inside a transaction, re-applies the
   migration, asserts the contained state, and rolls back. It must print PASS.
4. Run the edge-function security tests:
   ```
   npm test
   ```
   (`tests/security/entitlements.test.ts` covers fail-closed entitlements,
   worker-secret denial with zero queue mutations / zero provider calls, and
   pre-mutation denial in the intake path.)
5. Verify with controlled fixture accounts (two distinct users + anonymous):
   - Anonymous: no object rows visible, no object listing, no inserts.
   - Account A: can access its own authorized fixture; cannot list, read, or
     sign a URL for account B's fixture.
   - Account B: same, mirrored.
   - Direct API calls bypassing the UI (router, video-intake) are denied
     without an active entitlement (`not_entitled`), and denied fail-closed on
     entitlement lookup failure (`entitlement_unavailable`).
   - Worker invocation with a missing or incorrect worker secret performs zero
     queue mutations and zero provider calls.
   - Client attempts to write the cost ledger or worker-owned asset fields are
     denied or stripped.

## 3. Apply the narrow production patch

Sequencing matters — the edge functions fail closed if deployed before the
migration exists (entitlement lookups error → requests denied):

1. Apply the migration to production (database change first).
2. Deploy the updated edge functions (router, video-intake, video-worker).
3. Confirm production auth flags match the intended state (signup disabled,
   confirmation/CAPTCHA settings as recorded in step 1). Adjust in the
   production project explicitly; do not assume config.toml propagation.
4. Set/confirm deployment environment: `VIDEO_WORKER_SECRET` present and
   strong; internal cron trigger configured to send it.

## 4. Grant initial entitlements (out-of-band, service_role only)

- No user is entitled by default; the migration grants nothing.
- Operators insert approved-user rows into `prismatix_internal.access_grants`
  using a service_role connection (never from the client):
  ```sql
  insert into prismatix_internal.access_grants
    (subject_id, role, enabled, allowed_features, max_daily_usd, max_per_execution_usd, updated_by)
  values
    ('<approved-user-uuid>', 'user', true, array['chat']::text[], 5.0, 1.0, '<operator-uuid>');
  ```
- Review `allowed_features` per user; add `video`/`memory`/`review`/`smd` only
  as approved. Spend caps are advisory fields consumed by the gate code.

## 5. Post-apply verification

- Re-run the fixture-account matrix from step 2.5 against production with
  dedicated test accounts.
- Confirm router chat works for an entitled fixture account and returns a
  stable `not_entitled` error for a non-entitled one.
- Confirm anonymous storage reads return zero rows.
- Spot-check that worker cron runs process only entitled owners' jobs.

## 6. Retain logs & investigate historical scope

- Preserve API/auth/database logs covering the full exposure window before any
  retention expiry; export where needed.
- Investigate historical scope: which object rows were enumerable, any
  unexpected object reads/uploads by non-owners, forged cost ledger entries,
  and worker-owned field modifications from client roles.
- Record findings in the access-controlled incident record. Do not publish
  unfixed details.

## 7. Rollback (if required)

- Disable the affected feature (e.g. `ENABLE_VIDEO_PIPELINE=false`, deny
  entitlements by setting `enabled=false`) rather than re-exposing data.
- Never restore the broad read/upload policies as an automatic rollback.
- If the entitlement gate misbehaves, fail closed (deny) and fix forward; do
  not open access as a workaround.
