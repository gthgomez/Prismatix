# Prismatix — Release Readiness Assessment & Operator Deployment Runbook

**Campaign Date:** November 7, 2026  
**Auditor / Lead Engineer:** Antigravity (Acting Principal Engineer & System Maintainer)  
**Repository:** `https://github.com/gthgomez/Prismatix`  
**Current Default Branch (`main`):** `0a50ebdd5395d53d0961f6e0400c1f3abdcd9131`  
**Release Readiness Decision:** **QUALIFIED FOR RELEASE / MERGE-READY** (Pending Operator Authorization to trigger production deployment)

---

## 1. Production Deployment Warning

> [!WARNING]
> Merging PR #59, PR #60, or PR #61 into `main` automatically triggers a **production frontend deployment** via Vercel GitHub integration.
> 
> Merging into `main` must **never** be performed before applying database migrations and deploying backend Edge Functions. Deploying frontend code ahead of database migrations will cause runtime schema errors for active users.

---

## 2. Deployment Sequence & Operational Runbook

When production change authorization is granted, operators must execute deployments in the following strict order:

```
Step 1: Database Migrations (Supabase DB)
      ↓
Step 2: Storage Buckets & Policies
      ↓
Step 3: Edge Functions Deployment (Deno)
      ↓
Step 4: Stacked PR Merges into main (Vercel Frontend Build)
      ↓
Step 5: Post-Deployment Smoke Verification
```

### Step 1: Database Migrations
Apply the three Wave 2 migration files in sequential order to the production Supabase database:
1. [`supabase/migrations/20261107040000_wave2_productivity.sql`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107040000_wave2_productivity.sql):
   - Creates `px16_import_conversation`, `px17_branch_conversation`, and `px17_record_message_version` RPCs.
   - Attaches `trg_protect_message_provenance` trigger.
   - Enforces relational project ownership checks on `conversations` and `prompt_templates`.
2. [`supabase/migrations/20261107050000_wave2_knowledge.sql`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107050000_wave2_knowledge.sql):
   - Configures `project-documents` storage bucket with user-isolated RLS.
   - Creates GIN full-text search index `idx_project_document_chunks_fts`.
   - Creates `px22_search_project_knowledge` RPC.
3. [`supabase/migrations/20261107060000_wave2_multimodal.sql`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107060000_wave2_multimodal.sql):
   - Creates `public.artifacts` table and RLS policies.
   - Creates `px28_record_image_message` and `px29_save_artifact_revision` RPCs.

### Step 2: Storage Buckets
Ensure the following buckets exist in Supabase Storage:
- `project-documents`: Private, 20MB (`20971520` bytes) file size limit, mime-types: `application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown`.
- `chat-uploads`: Private, 25MB file size limit.

### Step 3: Edge Functions Deployment
Deploy the new and existing Supabase Edge Functions:
```bash
supabase functions deploy router
supabase functions deploy provider-settings
supabase functions deploy page-reader
supabase functions deploy web-search
```

**Required Edge Function Secrets:**
- `SUPABASE_URL`: Production Supabase API endpoint.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for internal RPCs.
- `BYOK_ENCRYPTION_KEY`: 32-byte hex/base64 key for AES-256-GCM BYOK credential encryption.
- `ALLOWED_ORIGIN`: Production frontend origin (`https://prismatix-*.vercel.app` or custom domain).

### Step 4: PR Merge Order
Merge the stacked pull requests sequentially:
1. Merge PR #59 (`feat/prismatix-wave2-productivity`) into `main`.
2. Rebase or verify PR #60 base points to `main`, then merge PR #60 (`feat/prismatix-wave2-knowledge`) into `main`.
3. Rebase or verify PR #61 base points to `main`, then merge PR #61 (`feat/prismatix-wave2-multimodal`) into `main`.

### Step 5: Post-Deployment Smoke Verification
- Sign in with an authorized user account.
- Ingest a URL via URL Ingestion modal (verify SSRF block on `http://169.254.169.254` and successful fetch of public web page).
- Create a project, upload a document, and execute a grounded knowledge search.
- Generate a test image and verify that the financial ledger records `unmetered` ($0.00) for preview SVG or `settled` for real BYOK API dispatch.
- Test conversation branching from message toolbar and verify cloned history up to boundary.

---

## 3. Rollback & Contingency Plan

If an unexpected production defect occurs:
1. **Frontend Rollback:** In the Vercel dashboard, instantly redeploy the previous production deployment corresponding to commit `0a50ebd`.
2. **Database Rollback:** The new RPCs and tables are additive and do not break Wave 1 queries. If necessary, revert `20261107060000`, `20261107050000`, and `20261107040000` via migration rollback script.
3. **Edge Functions Rollback:** Redeploy previous versions of `router` and `provider-settings`.
