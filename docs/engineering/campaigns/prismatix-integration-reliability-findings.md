# Prismatix — Integration, Reliability & Security Findings Ledger

**Campaign Date:** November 7, 2026  
**Auditor / Lead Engineer:** Antigravity (Acting Principal Engineer & System Maintainer)  
**Repository:** `https://github.com/gthgomez/Prismatix`  
**Scope:** Waves 1 & 2 (Features F01–F30, Persistence Architecture, BYOK Credential Resolution, Financial Integrity, and Multi-Tenant RLS)

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

---

## 2. Detailed Findings Ledger

### FIND-01: Server-Owned Persistence Architecture Violation (P0)
- **Affected Features:** [F16 Conversation Import](file:///home/ubuntu/Prismatix/src/services/conversationImport.ts), [F17 Conversation Branching](file:///home/ubuntu/Prismatix/src/services/conversationBranching.ts)
- **Observed Behavior:** Client code executed `client.from('messages').insert(...)` directly. In a live production database where migration `20261006040000_px07_conversation_continuity.sql` revoked authenticated INSERT privileges, all client imports and branches failed with HTTP 403 / RLS violations.
- **Root Cause:** Wave 2 prototype code was written against mocked Supabase clients that unconditionally resolved `.insert()`.
- **Repair:**
  - Created migration `20261107040000_wave2_productivity.sql` containing atomic server-owned RPCs:
    - [`px16_import_conversation`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107040000_wave2_productivity.sql#L8-L78): Verifies `auth.uid()`, re-keys foreign collisions, validates project ownership, and batch inserts imported messages with `metadata->'imported': true` and zero billing.
    - [`px17_branch_conversation`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107040000_wave2_productivity.sql#L80-L150): Verifies source conversation ownership, boundary message membership, and slices history deterministically using `row_number() over (order by created_at asc, id asc)`.
  - Refactored [`conversationImport.ts`](file:///home/ubuntu/Prismatix/src/services/conversationImport.ts) and [`conversationBranching.ts`](file:///home/ubuntu/Prismatix/src/services/conversationBranching.ts) to invoke these RPCs.
- **Verification:** Verified against real PostgreSQL 16 in [`wave2_productivity_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_productivity_persistence.sql) under authenticated non-superuser roles; verified in browser via Playwright `pr4_productivity.spec.ts`.

---

### FIND-02: Message Provenance and Ledger Integrity Bypass (P0)
- **Affected Features:** [F01–F05 Core Persistence](file:///home/ubuntu/Prismatix/supabase/migrations/20261006040000_px07_conversation_continuity.sql), [F17 Response Versions](file:///home/ubuntu/Prismatix/supabase/migrations/20261107040000_wave2_productivity.sql)
- **Observed Behavior:** While authenticated users could not insert messages, the existing policy `messages_update_own` allowed authenticated users to update their own messages. A malicious client could alter `role`, `model_used`, `execution_id`, `actual_cost`, or overwrite assistant responses.
- **Root Cause:** Update policy on `public.messages` lacked column immutability constraints.
- **Repair:** Added trigger [`trg_protect_message_provenance`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107040000_wave2_productivity.sql#L152-L195) on `public.messages`. If an authenticated caller attempts to modify `id`, `conversation_id`, `role`, `execution_id`, `model_used`, `token_count`, or `content` on an assistant message, the database rejects the transaction with `illegal_message_mutation`.
- **Verification:** SQL integration test in [`wave2_productivity_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_productivity_persistence.sql) verified that attempted mutations by authenticated users throw exceptions.

---

### FIND-03: Relational Cross-Tenant Foreign Key Injection (P0)
- **Affected Features:** [F09 Projects](file:///home/ubuntu/Prismatix/supabase/migrations/20261107010000_f09_project_workspaces.sql), [F16 Import](file:///home/ubuntu/Prismatix/src/services/conversationImport.ts), [F19 Prompt Library](file:///home/ubuntu/Prismatix/src/services/promptTemplateService.ts), [F21 Project Documents](file:///home/ubuntu/Prismatix/src/services/projectDocumentLibrary.ts)
- **Observed Behavior:** Table RLS policies checked only `auth.uid() = user_id`. An attacker could specify `project_id` or `conversation_id` belonging to User B, associating their records with another tenant's project or conversation.
- **Root Cause:** Shallow RLS policies without foreign table ownership verification.
- **Repair:** Hardened RLS policies across `conversations`, `prompt_templates`, `project_documents`, `project_document_chunks`, and `artifacts` with composite clauses:
  ```sql
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.projects p
      where p.id = project_documents.project_id
        and p.user_id = auth.uid()
    )
  );
  ```
- **Verification:** Verified in [`wave2_knowledge_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_knowledge_persistence.sql) and [`wave2_multimodal_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_multimodal_persistence.sql); cross-tenant inserts fail with integrity/privilege exceptions.

---

### FIND-04: Fraudulent Settled Cost Accounting & Invalid Schema in Image Generation (P0)
- **Affected Features:** [F28 BYOK Image Generation](file:///home/ubuntu/Prismatix/src/services/imageGenerationService.ts), [Spend Accounting](file:///home/ubuntu/Prismatix/src/components/ChatInterface.tsx)
- **Observed Behavior:**
  1. [`ChatInterface.tsx:1335`](file:///home/ubuntu/Prismatix/src/components/ChatInterface.tsx#L1335) attempted direct client insert into `public.messages` with nonexistent columns `model` and `actual_cost`.
  2. Mock/test SVG generations were recorded with `cost: { status: 'settled', finalUsd: 0.040 }`, fabricating real financial charges in user ledgers.
- **Root Cause:** Client service lacked mock awareness when constructing ledger receipts, and bypassed backend RPC contracts.
- **Repair:**
  - Created RPC [`px28_record_image_message`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107060000_wave2_multimodal.sql#L60-L125) that inserts into `public.messages` with `model_used`, and sets `cost: { status: 'unmetered', finalUsd: 0 }` whenever `isMock` is true.
  - Updated [`ChatInterface.tsx`](file:///home/ubuntu/Prismatix/src/components/ChatInterface.tsx#L1314-L1350) to invoke `px28_record_image_message`.
- **Verification:** Real PostgreSQL test in [`wave2_multimodal_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_multimodal_persistence.sql) proved mock images receive `unmetered` status and $0.00 settled cost.

---

### FIND-05: Client-Side URL Reading SSRF & CORS Vulnerability (P0)
- **Affected Features:** [F23 URL Page Reading](file:///home/ubuntu/Prismatix/src/services/urlPageReader.ts)
- **Observed Behavior:** `fetchAndParseUrl` ran directly in the browser. In browser environments, CORS blocked fetching external URLs, while in SSR/node environments it was susceptible to DNS rebinding and cloud metadata IMDS exfiltration.
- **Root Cause:** URL fetching lacked server-side execution with redirect hop inspection.
- **Repair:**
  - Built Supabase Edge Function [`supabase/functions/page-reader/index.ts`](file:///home/ubuntu/Prismatix/supabase/functions/page-reader/index.ts).
  - Enforces SSRF defense: blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata IMDS (`169.254.169.254`), and internal hostnames.
  - Implements manual redirect handling (max 3 hops), validating each target hop against SSRF rules.
  - Implements a streaming byte cap of 2MB (`2 * 1024 * 1024` bytes) and 10s AbortSignal timeout.
  - Updated [`urlPageReader.ts`](file:///home/ubuntu/Prismatix/src/services/urlPageReader.ts#L190-L245) to invoke the `page-reader` edge function with graceful test mock fallback.
- **Verification:** Unit tests in [`knowledge_wave2.test.ts`](file:///home/ubuntu/Prismatix/tests/knowledge/knowledge_wave2.test.ts), Deno type check, and Playwright E2E SSRF block assertion in `pr5_knowledge.spec.ts`.

---

### FIND-06: Web Search BYOK Credential Resolution (P0)
- **Affected Features:** [F11 BYOK Web Search](file:///home/ubuntu/Prismatix/src/services/webSearchService.ts), [F24 Research Workflow](file:///home/ubuntu/Prismatix/src/services/researchWorkflow.ts)
- **Observed Behavior:** Web search was invoked in `ChatInterface.tsx` and `researchWorkflow.ts` without an API key, returning unavailable because the client could not decrypt user keys stored in `prismatix_internal.user_provider_keys`.
- **Root Cause:** Client lacked a secure server-side proxy to execute authenticated search using encrypted BYOK credentials.
- **Repair:**
  - Created Edge Function [`supabase/functions/web-search/index.ts`](file:///home/ubuntu/Prismatix/supabase/functions/web-search/index.ts).
  - Validates user JWT, queries `get_user_provider_key_material` via service_role, decrypts the key with AES-256-GCM via [`decryptKey`](file:///home/ubuntu/Prismatix/supabase/functions/_shared/byok_crypto.ts), calls Brave Search API server-side, validates citations against SSRF, and returns normalized sources.
  - Updated [`webSearchService.ts`](file:///home/ubuntu/Prismatix/src/services/webSearchService.ts#L95-L160) to call `web-search` edge function when direct key is omitted.
- **Verification:** 13 unit tests in [`web_search.test.ts`](file:///home/ubuntu/Prismatix/tests/routing/web_search.test.ts), Deno type check, and Playwright research mode toggle in `pr5_knowledge.spec.ts`.

---

### FIND-07: Incomplete Knowledge Persistence & Full-Corpus Retrieval (P0)
- **Affected Features:** [F21 Project File Library](file:///home/ubuntu/Prismatix/src/services/projectDocumentLibrary.ts), [F22 Grounded Knowledge Search](file:///home/ubuntu/Prismatix/src/services/projectKnowledgeSearch.ts)
- **Observed Behavior:** Project documents only stored chunked text without original file binaries, and knowledge search performed unindexed client-side scanning over at most 100 chunks.
- **Root Cause:** Storage bucket `project-documents` was missing, and database chunks table lacked full-text search indexing.
- **Repair:**
  - Added migration [`20261107050000_wave2_knowledge.sql`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107050000_wave2_knowledge.sql):
    - Configured `project-documents` private storage bucket with user folder isolation RLS (`(storage.foldername(name))[1] = auth.uid()::text`).
    - Added GIN index `idx_project_document_chunks_fts on public.project_document_chunks using gin (to_tsvector('english', content))`.
    - Added RPC `px22_search_project_knowledge` performing tsvector ranking across the entire project corpus.
  - Updated [`projectDocumentLibrary.ts`](file:///home/ubuntu/Prismatix/src/services/projectDocumentLibrary.ts) to upload and delete original binaries from Supabase Storage.
- **Verification:** Tested in [`wave2_knowledge_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_knowledge_persistence.sql) and 31 unit tests in `tests/knowledge/`.

---

### FIND-08: Ephemeral Generated Artifacts (P0)
- **Affected Features:** [F29 Editable Artifacts](file:///home/ubuntu/Prismatix/src/services/artifactService.ts)
- **Observed Behavior:** Code artifacts existed only in ephemeral component state; switching chats or refreshing lost all edits and revision history.
- **Root Cause:** Missing database persistence schema for artifacts.
- **Repair:**
  - Created `public.artifacts` table in [`20261107060000_wave2_multimodal.sql`](file:///home/ubuntu/Prismatix/supabase/migrations/20261107060000_wave2_multimodal.sql) with full RLS and `px29_save_artifact_revision` RPC.
  - Wired [`ChatInterface.tsx`](file:///home/ubuntu/Prismatix/src/components/ChatInterface.tsx#L3630-L3650) to persist edited artifact revisions to Supabase.
- **Verification:** Verified in [`wave2_multimodal_persistence.sql`](file:///home/ubuntu/Prismatix/tests/integration/wave2_multimodal_persistence.sql) and Playwright `pr6_multimodal.spec.ts`.
