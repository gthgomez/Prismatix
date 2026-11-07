# Prismatix — Integration, Reliability & Security Findings Ledger

**Campaign Date:** November 7, 2026  
**Auditor / Lead Engineer:** Antigravity (Acting Principal Engineer & System Maintainer)  
**Repository:** [https://github.com/gthgomez/Prismatix](https://github.com/gthgomez/Prismatix)  
**Scope:** Waves 1 & 2 (Features F01–F30, Persistence Architecture, BYOK Credential Resolution, Financial Integrity, Multi-Tenant RLS, and Server-Owned Execution)

---

## 1. Findings Summary

| ID | Severity | Affected Features | Component | Status | Summary |
|---|---|---|---|---|---|
| **FIND-01** | **P0** | F16, F17 | Persistence Architecture | **RESOLVED** | Direct client `messages.insert` bypassed server-owned message contract revoked in PX07. Fixed via atomic RPCs `px16_import_conversation` and `px17_branch_conversation`. |
| **FIND-02** | **P0** | F01–F05, F17 | Database Security & Provenance | **RESOLVED** | Authenticated users could mutate server-authored assistant message columns via `messages_update_own`. Fixed via database trigger `trg_protect_message_provenance`. |
| **FIND-03** | **P0** | F09, F16, F19 | Multi-Tenant Authorization | **RESOLVED** | Cross-tenant foreign key injection on `conversations`, `prompt_templates`, and `project_documents`. Fixed via composite RLS policies validating parent ownership. |
| **FIND-04** | **P0** | F28 | Financial Accounting & Persistence | **RESOLVED** | Image generation persistence attempted invalid direct inserts referencing nonexistent columns `model` and `actual_cost`, and hardcoded synthetic previews as settled. Fixed via RPC `px28_record_image_message` with truthful `unmetered` vs `settled` accounting. |
| **FIND-05** | **P0** | F23 | URL Reading & Network Defense | **RESOLVED** | Browser-only URL reader lacked CORS capability on external targets and lacked server-side SSRF gating. Fixed via edge function `page-reader` with strict CIDR validation (RFC 1918, loopback, IMDS 169.254.169.254), redirect hop gating, and 2MB streaming cap. |
| **FIND-06** | **P0** | F11, F24 | BYOK Search & Privacy | **RESOLVED** | Web search could not resolve user's encrypted `brave` key from client without exposing keys. Fixed via authenticated server edge function `web-search` with server-side decryption and SSRF citation filtering. |
| **FIND-07** | **P0** | F21, F22 | Storage & Knowledge Retrieval | **RESOLVED** | Document chunks were not backed by database full-text search indexing, and original document binaries lacked dedicated storage RLS. Fixed via `project-documents` storage bucket, GIN FTS index, and `px22_search_project_knowledge` RPC. |
| **FIND-08** | **P0** | F29 | Artifacts Persistence | **RESOLVED** | Generated code artifacts only existed ephemerally in React component state. Fixed via `public.artifacts` table with user/conversation RLS and `px29_save_artifact_revision` RPC. |
| **FIND-09** | **P1** | F20 | Local Preferences & Cache | **RESOLVED** | User preference cache in localStorage was un-scoped, leaking across user accounts on shared browsers. Fixed via user-scoped storage keys and timestamped conflict resolution. |
| **FIND-10** | **P1** | F19 | Prompt Library Usability | **RESOLVED** | UI lacked template editing capabilities, forcing users to delete and recreate templates. Fixed via inline editing mode and `updatePromptTemplate` service. |
| **FIND-11** | **P1** | F18 | UI Accessibility | **RESOLVED** | Tag creation relied on blocking `window.prompt()`, breaking mobile and headless tests. Fixed via accessible inline tag input. |
| **FIND-12** | **P1** | F17 | Response Versioning UI | **RESOLVED** | Message response versions were recorded in metadata but lacked interactive switcher. Fixed via `< 1/2 >` version switcher in `ChatMessageItem.tsx`. |
| **FIND-13** | **P1** | F30 | PWA Service Worker Caching | **RESOLVED** | Service worker risked caching private API and Supabase functions responses. Fixed via explicit bypass for `/functions/`, search APIs, and authenticated routes. |
| **FIND-14** | **P0** | F01–F05, F17 | Database Trigger Authorization Bypass | **RESOLVED** | `trg_protect_message_provenance()` was declared `SECURITY DEFINER` and checked `current_user = 'postgres'`. Because the trigger owner is `postgres`, `current_user` was always `postgres`, allowing authenticated clients to bypass immutability checks. Fixed by converting trigger to `SECURITY INVOKER`, reading `request.jwt.claim.role` and `request.jwt.claim.sub` via `current_setting(...)`, and protecting content, models, and cost. |
| **FIND-15** | **P0** | F28 | Financial Settlement Forgery Vulnerability | **RESOLVED** | `px28_record_image_message` accepted `p_is_mock` and `costUsd` from authenticated callers, allowing arbitrary browser requests to forge settled charges. Fixed by enforcing that `authenticated` callers can never record settled status or non-zero cost (forced to `unmetered` and 0); only backend `service_role` can record settled executions. |
| **FIND-16** | **P0** | F29 | Artifact Identity Schema Mismatch & In-Memory IDs | **RESOLVED** | `generateArtifactId()` generated string IDs `art_xxxx` violating PostgreSQL `uuid` schema constraint. Also, `ChatInterface.tsx` was performing direct client upserts instead of using atomic revision RPC `px29_save_artifact_revision`. Fixed with RFC 4122 UUID generation and atomic DB helpers `persistArtifactToDatabase` and `persistArtifactRevisionToDatabase`. |
| **FIND-17** | **P1** | F21 | Document Ingestion Storage Atomicity & Cleanup | **RESOLVED** | Storage upload failures did not halt document creation, and database insert failures leaked uploaded storage binaries. Fixed with atomic rollback compensation in `addProjectDocument`. |
| **FIND-18** | **P1** | F23 | URL Reader Authentication & SSRF Rebinding Defense | **RESOLVED** | `page-reader` Edge Function accepted unauthenticated callers, lacked per-user rate limits, and was susceptible to DNS rebinding. Fixed with Supabase auth JWT verification, 15 req/min rate limiting, Deno DNS resolution IP validation, and fail-closed handling in client `urlPageReader.ts`. |
| **FIND-19** | **P1** | F11, F24 | Redundant Search Execution in Research Workflow | **RESOLVED** | When both `researchMode` and `webSearchEnabled` were active, web search and project knowledge search ran twice per turn. Fixed via unified per-turn search planning in `ChatInterface.tsx`. |
| **FIND-20** | **P1** | F22 | Project Knowledge Fallback Table Scan on Zero Hits | **RESOLVED** | `searchProjectKnowledge` fell back to a 100-chunk table scan whenever the RPC returned an empty array `[]`. Fixed by recognizing `[]` as an authoritative zero-match result. |
| **FIND-21** | **P0** | F28 | Client-Forged Assistant Images & Settlement Bypass | **RESOLVED** | `px28_record_image_message` allowed authenticated callers to insert assistant messages into conversations. Revoked `px28_record_image_message` execution from `authenticated` role and restricted it exclusively to `service_role`, strictly maintaining the PX07 architectural invariant. |
| **FIND-22** | **P0** | F28 | Missing Authenticated Server-Owned BYOK Image Generation Edge Function | **RESOLVED** | `ChatInterface` did not provide execution credentials to `ImageGenerationModal`, causing silent mock mode activation, and the frontend service fetched external providers directly from the browser. Built authentic Edge Function `supabase/functions/image-generation/index.ts` with server-side BYOK key resolution, authoritative admission (`px05_admit_execution`), durable ledger identity (`px03_create_execution`), private storage persistence (`chat-uploads`), and service-role message persistence. |
| **FIND-23** | **P1** | F29 | Artifact Double-Revision on Editor Save | **RESOLVED** | `ArtifactViewerModal` and `ChatInterface` were calling both `persistArtifactToDatabase` (which upserted the local version list) and `px29_save_artifact_revision` (which appended a second revision), causing two revisions per edit. Removed redundant upsert and made `px29_save_artifact_revision` the single authoritative mutator. |
| **FIND-24** | **P1** | F29 | Artifact ID Regeneration and Version Loss on Reopen | **RESOLVED** | `ChatInterface:handleOpenArtifact` generated a fresh random UUID on every artifact click, losing previously saved revisions. Introduced `getOrCreateArtifactForMessage` to query `public.artifacts` by conversation and title/message ID before creating new records. |
| **FIND-25** | **P0** | F23 | URL Page-Reader Fail-Open Fallback & DNS Rebinding Vulnerability | **RESOLVED** | When Supabase environment variables were missing, `page-reader` defaulted to `userId = 'authenticated_user'` instead of failing closed with 500/401. Also, HTTP fetches could be hijacked via DNS rebinding between check time and fetch time. Hardened `page-reader` to fail closed and rewrite HTTP fetch targets directly to the validated IP with original `Host:` header. |

---

## 2. Detailed Findings Ledger

### FIND-01: Server-Owned Persistence Architecture Violation (P0)
- **Affected Features:** F16 Conversation Import, F17 Conversation Branching
- **Observed Behavior:** Client code executed `client.from('messages').insert(...)` directly. In a live production database where migration `20261006040000_px07_conversation_continuity.sql` revoked authenticated INSERT privileges, all client imports and branches failed with HTTP 403 / RLS violations.
- **Root Cause:** Wave 2 prototype code was written against mocked Supabase clients that unconditionally resolved `.insert()`.
- **Repair:**
  - Created migration `20261107040000_wave2_productivity.sql` containing atomic server-owned RPCs:
    - `px16_import_conversation`: Verifies `auth.uid()`, re-keys foreign collisions, validates project ownership, bounds messages to 100k characters with disclosure notice, and batch inserts imported messages with `metadata->'imported': true` and zero billing.
    - `px17_branch_conversation`: Verifies source conversation ownership, boundary message membership, and slices history deterministically using `row_number() over (order by created_at asc, id asc)`.
  - Refactored `src/services/conversationImport.ts` and `src/services/conversationBranching.ts` to invoke these RPCs.
- **Verification:** Verified against real PostgreSQL 16 in `tests/integration/wave2_productivity_persistence.sql` under authenticated non-superuser roles; verified in browser via Playwright `pr4_productivity.spec.ts`.

---

### FIND-02: Message Column Mutation and Provenance Tampering via RLS (P0)
- **Affected Features:** F01–F05 Core Persistence, F17 Response Versions
- **Observed Behavior:** While authenticated users could not insert messages, the existing policy `messages_update_own` allowed authenticated users to update their own messages. A malicious client could alter `role`, `model_used`, `execution_id`, `actual_cost`, or overwrite assistant responses.
- **Root Cause:** Update policy on `public.messages` lacked column immutability constraints.
- **Repair:** Added trigger `trg_protect_message_provenance` on `public.messages`. If an authenticated caller attempts to modify `id`, `conversation_id`, `role`, `execution_id`, `model_used`, `token_count`, or `content` on an assistant message, the database rejects the transaction with `illegal_message_mutation`.
- **Verification:** SQL integration test in `tests/integration/wave2_productivity_persistence.sql` verified that attempted mutations by authenticated users throw exceptions.

---

### FIND-14: Database Trigger Authorization Bypass via SECURITY DEFINER (P0)
- **Affected Features:** F01–F05 Core Persistence, F17 Response Versions
- **Observed Behavior:** The function `trg_protect_message_provenance()` was declared `SECURITY DEFINER` and checked `current_user = 'postgres'`. In PostgreSQL, a security definer function executes as its owner (`postgres`). Therefore, `current_user = 'postgres'` evaluated to true even when invoked from an authenticated application client, allowing client updates to bypass immutability restrictions.
- **Root Cause:** Conflation of trigger execution identity and session caller identity.
- **Repair:** Converted the trigger function to `SECURITY INVOKER`, read session claims via `current_setting('request.jwt.claim.role', true)`, and checked `request.jwt.claim.sub` against `auth.uid()`.
- **Verification:** Tested in `tests/integration/wave2_productivity_persistence.sql` where direct UPDATE attempts by authenticated role fail with `illegal_message_mutation`.

---

### FIND-21: Client-Forged Assistant Images & Settlement Bypass (P0)
- **Affected Features:** F28 BYOK Image Generation, PX07 Server-Owned Persistence
- **Observed Behavior:** The initial implementation of `px28_record_image_message` permitted the `authenticated` role to invoke it directly, allowing clients to insert synthetic assistant messages into conversations without server execution.
- **Root Cause:** Granting `execute` to `authenticated` violated the server-owned execution boundary established in PX07.
- **Repair:**
  - Revoked execute on `px28_record_image_message` from `authenticated`, `anon`, and `public`.
  - Granted execute strictly to `service_role`.
  - Added an explicit role check `if v_caller_role = 'authenticated' then raise exception 'client_execution_prohibited...'; end if;`.
  - Added `p_user_id` parameter to allow backend Edge Functions to pass the validated subject ID.
- **Verification:** Verified in `tests/integration/wave2_multimodal_persistence.sql` (Step 7 and Step 9 fail with `client_execution_prohibited` or permission denied; Step 10 succeeds for `service_role`).

---

### FIND-22: Server-Owned BYOK Image Generation Edge Function (P0)
- **Affected Features:** F28 BYOK Image Generation, Financial Accounting
- **Observed Behavior:** `ImageGenerationModal` executed `mockMode: useMockMode || !userApiKey`. Because `userApiKey` was absent in normal operation, configured users always entered mock mode. Furthermore, `imageGenerationService.ts` contained direct browser fetch paths to OpenAI and OpenRouter requiring plaintext keys.
- **Root Cause:** Missing authenticated Edge Function for multimodal image generation.
- **Repair:**
  - Created `supabase/functions/image-generation/index.ts`:
    1. Authenticates user JWT token via Supabase Auth.
    2. Resolves encrypted BYOK credential using `get_user_provider_key_material` and `decryptKey()`.
    3. Validates model, size, and cost parameters against `SUPPORTED_IMAGE_MODELS`.
    4. Creates durable execution identity via `px03_create_execution`.
    5. Performs authoritative cost admission via `px05_admit_execution`.
    6. Dispatches request to provider with timeout and error handling.
    7. Decodes and uploads image bytes to private `chat-uploads` storage bucket (`${userId}/images/${executionId}.png`).
    8. Generates authorized signed access URL.
    9. Records model call and commits reservation in ledger.
    10. Persists message via `service_role` call to `px28_record_image_message`.
  - Refactored `src/services/imageGenerationService.ts` and `src/components/ImageGenerationModal.tsx` to invoke the Edge Function.
- **Verification:** Unit tested in `tests/multimodal/multimodal_wave2.test.ts` (22 tests); browser verified in Playwright `pr6_multimodal.spec.ts`.

---

### FIND-23: Artifact Double-Revision on Editor Save (P1)
- **Affected Features:** F29 Durable Editable Artifacts & Versioning
- **Observed Behavior:** Every save in `ArtifactViewerModal` resulted in two version increments (e.g. jumping from Version 1 directly to Version 3).
- **Root Cause:** `ArtifactViewerModal:handleSave` appended a version locally and triggered `onUpdateArtifact`. In `ChatInterface`, `onUpdateArtifact` called `persistArtifactToDatabase` (which upserted the whole record including the new version) and then immediately called `persistArtifactRevisionToDatabase` (which invoked `px29_save_artifact_revision`, appending another version).
- **Repair:** Removed `persistArtifactToDatabase` from the update handler in `ChatInterface.tsx`. All revisions are exclusively managed by the atomic PostgreSQL RPC `px29_save_artifact_revision`.
- **Verification:** Verified in `tests/multimodal/multimodal_wave2.test.ts` and `tests/integration/wave2_multimodal_persistence.sql` where single save creates exactly one version increment.

---

### FIND-24: Artifact ID Regeneration and Version Loss on Reopen (P1)
- **Affected Features:** F29 Durable Editable Artifacts & Versioning
- **Observed Behavior:** Clicking on an extracted code artifact always generated a fresh UUID, disconnecting it from previously saved database revisions.
- **Root Cause:** `extractArtifactsFromText` assigned random UUIDs on each extraction without querying `public.artifacts` by conversation and title.
- **Repair:** Added `getOrCreateArtifactForMessage(client, conversationId, userId, extracted, messageId)` in `src/services/artifactService.ts`. It loads the persistent artifact from PostgreSQL if it exists, preserving all historical versions.
- **Verification:** Verified in `tests/multimodal/multimodal_wave2.test.ts` test `getOrCreateArtifactForMessage retrieves existing artifact from database without generating fresh ID`.

---

### FIND-25: URL Page-Reader Fail-Open Fallback & DNS Rebinding Vulnerability (P0)
- **Affected Features:** F23 Secure Server-Side Webpage Ingestion
- **Observed Behavior:** In `supabase/functions/page-reader/index.ts`, if Supabase environment variables were missing, `userId` defaulted to `'authenticated_user'` instead of failing closed. In addition, HTTP requests were susceptible to DNS rebinding attacks between initial resolution check and fetch execution.
- **Root Cause:** Lack of fail-closed configuration assertion and separate fetch DNS resolution.
- **Repair:**
  - Enforced fail-closed behavior: returns 500 if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, and 401 if user auth token is missing or invalid.
  - Rewrote HTTP fetch target directly to the validated IP address with original `Host:` header to eliminate DNS rebinding.
  - Re-resolved and validated all A and AAAA DNS records prior to connection.
- **Verification:** Verified in `tests/knowledge/knowledge_wave2.test.ts` and Deno check.
