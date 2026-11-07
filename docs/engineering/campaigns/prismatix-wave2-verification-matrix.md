# Prismatix — Wave 2 Verification Matrix (F16–F30)

**Date:** 2026-11-07  
**Author:** Principal Full-Stack Engineer, Product Engineering Lead, Security Reviewer  
**Repository:** `https://github.com/gthgomez/Prismatix`  

---

## 1. 15-Row Feature Status Matrix

| Feature ID | Feature Name | Status | Primary Files Changed | Unit/Integration Tests | Browser E2E Tests | Known Issues / Notes |
|---|---|---|---|---|---|---|
| **F16** | Conversation import and migration | **Implemented & Verified** | `src/services/conversationImport.ts`, `src/components/ImportModal.tsx`, `src/components/ConversationSidebar.tsx` | `tests/productivity/productivity_wave2.test.ts` (3 tests) | `tests/e2e/pr4_productivity.spec.ts` | Historical costs segregated from active billing. |
| **F17** | Conversation branching and version history | **Implemented & Verified** | `src/services/conversationBranching.ts`, `src/components/MessageActionToolbar.tsx`, `src/components/ChatInterface.tsx` | `tests/productivity/productivity_wave2.test.ts` (3 tests) | `tests/e2e/pr4_productivity.spec.ts` | Preserves lineage while isolating thread state. |
| **F18** | Chat tags and archiving | **Implemented & Verified** | `src/services/conversationService.ts`, `src/components/ConversationSidebar.tsx` | `tests/productivity/productivity_wave2.test.ts` (3 tests) | `tests/e2e/pr4_productivity.spec.ts` | Filter views: Active, Archived, All with tag pills. |
| **F19** | Prompt library and variable substitution | **Implemented & Verified** | `src/services/promptLibraryService.ts`, `src/components/PromptLibraryModal.tsx`, `src/components/ChatInputComposer.tsx` | `tests/productivity/productivity_wave2.test.ts` (3 tests) | `tests/e2e/pr4_productivity.spec.ts` | Handles `{{variable}}` substitution into composer. |
| **F20** | Cross-device preference sync | **Implemented & Verified** | `src/services/userPreferencesService.ts`, `src/components/ChatInterface.tsx` | `tests/productivity/productivity_wave2.test.ts` (4 tests) | `tests/e2e/pr4_productivity.spec.ts` | Server-persisted with localStorage guest fallback. |
| **F21** | Persistent project file library | **Implemented & Verified** | `supabase/migrations/20261107050000_wave2_knowledge.sql`, `src/services/projectDocumentLibrary.ts`, `src/components/ProjectModal.tsx` | `tests/knowledge/knowledge_wave2.test.ts` (3 tests) | `tests/e2e/pr5_knowledge.spec.ts` | RLS isolation on documents & chunk cascades. |
| **F22** | Grounded project knowledge search | **Implemented & Verified** | `src/services/projectKnowledgeSearch.ts`, `src/components/ChatInterface.tsx` | `tests/knowledge/knowledge_wave2.test.ts` (3 tests) | `tests/e2e/pr5_knowledge.spec.ts` | Lexical TF ranking; no fabricated hallucinations. |
| **F23** | Secure URL ingestion & strict SSRF defense | **Implemented & Verified** | `src/services/urlPageReader.ts`, `src/components/UrlIngestionModal.tsx`, `src/components/ChatInputComposer.tsx` | `tests/knowledge/knowledge_wave2.test.ts` (4 tests) | `tests/e2e/pr5_knowledge.spec.ts` | Blocks loopback, RFC 1918, IMDS metadata, CGNAT. |
| **F24** | Bounded multi-source research workflow | **Implemented & Verified** | `src/services/researchWorkflow.ts`, `src/components/ChatInterface.tsx` | `tests/knowledge/knowledge_wave2.test.ts` (3 tests) | `tests/e2e/pr5_knowledge.spec.ts` | Bounded synthesis across files and web search. |
| **F25** | Multi-document analysis & comparison | **Implemented & Verified** | `src/services/multiDocComparison.ts`, `src/components/DocumentComparisonModal.tsx`, `src/components/ChatInputComposer.tsx` | `tests/knowledge/knowledge_wave2.test.ts` (3 tests) | `tests/e2e/pr5_knowledge.spec.ts` | Jaccard vocabulary similarity and length deltas. |
| **F26** | Voice dictation (STT) | **Implemented & Verified** | `src/services/voiceDictationService.ts`, `src/components/ChatInputComposer.tsx`, `src/components/ChatInterface.tsx` | `tests/multimodal/multimodal_wave2.test.ts` (3 tests) | `tests/e2e/pr6_multimodal.spec.ts` | Explicit mic permission; never auto-submits audio. |
| **F27** | Read-aloud responses (TTS) | **Implemented & Verified** | `src/services/ttsPlaybackService.ts`, `src/components/MessageActionToolbar.tsx` | `tests/multimodal/multimodal_wave2.test.ts` (3 tests) | `tests/e2e/pr6_multimodal.spec.ts` | Native zero-cost synthesis; play/pause/stop actions. |
| **F28** | BYOK image generation | **Implemented & Verified** | `src/services/imageGenerationService.ts`, `src/components/ImageGenerationModal.tsx`, `src/components/ChatMessageItem.tsx` | `tests/multimodal/multimodal_wave2.test.ts` (4 tests) | `tests/e2e/pr6_multimodal.spec.ts` | Upfront cost disclosure; settled cost persistence. |
| **F29** | Editable generated artifacts & safe previews | **Implemented & Verified** | `src/services/artifactService.ts`, `src/components/ArtifactViewerModal.tsx`, `src/components/ChatMessageItem.tsx` | `tests/multimodal/multimodal_wave2.test.ts` (4 tests) | `tests/e2e/pr6_multimodal.spec.ts` | Sandboxed iframe isolation without allow-same-origin. |
| **F30** | Installable PWA and mobile continuity | **Implemented & Verified** | `public/manifest.webmanifest`, `public/sw.js`, `src/services/pwaService.ts`, `src/components/ChatInterface.tsx` | `tests/multimodal/multimodal_wave2.test.ts` (2 tests) | `tests/e2e/pr6_multimodal.spec.ts` | Offline shell continuity; no offline inference claim. |

---

## 2. Feature Verification Detail (10-Point Analysis)

### F16 — Conversation Import & Migration
1. **User Problem:** Users migrating to Prismatix or moving between workstations need to restore conversation histories without data corruption or accidental billing charges.
2. **Implemented Solution:** `conversationImport.ts` validates schemas, previews conversation count and message count, checks for duplicates, and tags imported records with `metadata.imported = true` and `actual_cost = 0`.
3. **Source Files:** `src/services/conversationImport.ts`, `src/components/ImportModal.tsx`, `src/components/ConversationSidebar.tsx`.
4. **Database/API Changes:** None; reuses existing `conversations` and `messages` tables.
5. **Security:** Validates user identity and forces all imported rows to have `user_id = auth.uid()`. Rejects schemas with unauthorized foreign keys.
6. **Unit Tests:** `tests/productivity/productivity_wave2.test.ts` (schema validation, duplicate prevention, cost segregation).
7. **Browser Test:** `tests/e2e/pr4_productivity.spec.ts` (opens import modal, previews payload, renders controls).
8. **Negative Tests:** Malformed JSON, oversized payloads, non-array exports, duplicate timestamps.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Supports Prismatix exports natively; third-party exports require mapped fields.

### F17 — Conversation Branching & Version History
1. **User Problem:** Exploring alternative prompts or model responses destroys the original conversation linear thread.
2. **Implemented Solution:** `branchConversation()` copies previous messages up to the branch point into a new conversation record, linking `branched_from_conversation_id` and `branched_from_message_id`.
3. **Source Files:** `src/services/conversationBranching.ts`, `src/components/MessageActionToolbar.tsx`, `src/components/ChatInterface.tsx`.
4. **Database/API Changes:** Leverages `parent_conversation_id` or metadata lineage.
5. **Security:** Only branches conversations owned by the authenticated user via RLS.
6. **Unit Tests:** `tests/productivity/productivity_wave2.test.ts` (branch point extraction, chronological preservation).
7. **Browser Test:** `tests/e2e/pr4_productivity.spec.ts` (verifies branch button in message action toolbar).
8. **Negative Tests:** Branching non-existent message ID, unauthenticated branching attempt.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Deep branching trees are displayed as distinct conversations in sidebar rather than an interactive DAG graph.

### F18 — Chat Tags & Archiving
1. **User Problem:** High-volume daily use clutters the conversation sidebar, making active work hard to find.
2. **Implemented Solution:** Added `archived` boolean and `tags` array to conversation records, with filter toggle (`Active`, `Archived`, `All`) and tag badge management.
3. **Source Files:** `src/services/conversationService.ts`, `src/components/ConversationSidebar.tsx`.
4. **Database/API Changes:** Reuses `conversations.metadata` or existing columns.
5. **Security:** RLS ensures tag updates and archive mutations only succeed for conversation owner.
6. **Unit Tests:** `tests/productivity/productivity_wave2.test.ts` (archive filter, tag addition/removal).
7. **Browser Test:** `tests/e2e/pr4_productivity.spec.ts` (filter pills toggle visibility of conversations).
8. **Negative Tests:** Empty tag strings, duplicate tags, archiving missing conversations.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Tag colors are deterministic based on string hash rather than custom picker.

### F19 — Prompt Library & Variable Substitution
1. **User Problem:** Re-typing boilerplate prompts or system instructions wastes time and causes inconsistencies.
2. **Implemented Solution:** `promptLibraryService.ts` and `PromptLibraryModal.tsx` allow storing reusable prompt templates with `{{variable}}` placeholders, providing interactive replacement fields and one-click insertion.
3. **Source Files:** `src/services/promptLibraryService.ts`, `src/components/PromptLibraryModal.tsx`, `src/components/ChatInputComposer.tsx`.
4. **Database/API Changes:** Local and project-scoped storage.
5. **Security:** Sanitizes variables against injection attacks before inserting into composer.
6. **Unit Tests:** `tests/productivity/productivity_wave2.test.ts` (extraction of `{{vars}}`, substitution, empty fallback).
7. **Browser Test:** `tests/e2e/pr4_productivity.spec.ts` (opens prompt library, fills variable, inserts into composer).
8. **Negative Tests:** Unmatched brackets, empty templates, missing variable values.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Variables are plain text strings; no nested macro execution.

### F20 — Cross-Device Preference Sync
1. **User Problem:** Switching between phone and laptop resets user preferences (model overrides, routing profile, theme).
2. **Implemented Solution:** `userPreferencesService.ts` syncs preferences to Supabase `public.user_preferences` table with optimistic caching and graceful offline localStorage fallback.
3. **Source Files:** `src/services/userPreferencesService.ts`, `src/components/ChatInterface.tsx`.
4. **Database/API Changes:** `public.user_preferences` table with `user_id` primary key and RLS.
5. **Security:** User-isolated RLS policy prevents cross-user reading of preferences.
6. **Unit Tests:** `tests/productivity/productivity_wave2.test.ts` (merge logic, unauthenticated fallback).
7. **Browser Test:** `tests/e2e/pr4_productivity.spec.ts` (preference round-trip persistence).
8. **Negative Tests:** Network disconnection during sync, corrupted JSON in preference payloads.
9. **Deployment Prerequisites:** Table `public.user_preferences` exists in database.
10. **Limitations:** Conflict resolution is last-write-wins by timestamp.

### F21 — Persistent Project File Library
1. **User Problem:** Uploaded reference files in chats are ephemeral and lost across sessions.
2. **Implemented Solution:** Database-backed `project_documents` and `project_document_chunks` with text chunking, overlap, and cascade deletion.
3. **Source Files:** `supabase/migrations/20261107050000_wave2_knowledge.sql`, `src/services/projectDocumentLibrary.ts`, `src/components/ProjectModal.tsx`.
4. **Database/API Changes:** Added tables `project_documents` and `project_document_chunks` with foreign key cascade.
5. **Security:** Explicit RLS policies enforcing `auth.uid() = user_id`.
6. **Unit Tests:** `tests/knowledge/knowledge_wave2.test.ts` (chunking algorithm, document deletion cascade).
7. **Browser Test:** `tests/e2e/pr5_knowledge.spec.ts` (project modal knowledge files tab).
8. **Negative Tests:** Oversized documents, empty files, non-text binaries.
9. **Deployment Prerequisites:** Run migration `20261107050000_wave2_knowledge.sql`.
10. **Limitations:** Maximum document size capped at 5MB per file for local chunking performance.

### F22 — Grounded Project Knowledge Search
1. **User Problem:** Chat models lack context regarding active project files and hallucinate facts.
2. **Implemented Solution:** `projectKnowledgeSearch.ts` provides lexical relevance ranking (TF scoring) across chunks and formats verifiable grounding blocks into turn prompt.
3. **Source Files:** `src/services/projectKnowledgeSearch.ts`, `src/components/ChatInterface.tsx`.
4. **Database/API Changes:** Queries `project_document_chunks` table.
5. **Security:** Chunk queries strictly filtered by `user_id` and `project_id`.
6. **Unit Tests:** `tests/knowledge/knowledge_wave2.test.ts` (relevance ranking, context chunk limit).
7. **Browser Test:** `tests/e2e/pr5_knowledge.spec.ts` (grounding injection).
8. **Negative Tests:** Zero matching chunks, query with only stopwords, missing project.
9. **Deployment Prerequisites:** Migration `20261107050000_wave2_knowledge.sql`.
10. **Limitations:** Lexical search rather than dense vector embeddings (zero extra vector database infrastructure required).

### F23 — Secure URL Ingestion & Strict SSRF Defense
1. **User Problem:** Models cannot read web pages directly, and ad-hoc fetchers risk Server-Side Request Forgery (SSRF) against internal services and cloud metadata.
2. **Implemented Solution:** `urlPageReader.ts` validates destination IP/host against strict deny lists (loopback, RFC 1918, IMDS `169.254.169.254`, CGNAT `100.64.0.0/10`), validates ports and schemes, and extracts clean sanitized text.
3. **Source Files:** `src/services/urlPageReader.ts`, `src/components/UrlIngestionModal.tsx`, `src/components/ChatInputComposer.tsx`.
4. **Database/API Changes:** None.
5. **Security:** Multi-layer SSRF mitigation blocking private IPv4, IPv6 bracketed hosts, integer decimal IPs, and metadata targets.
6. **Unit Tests:** `tests/knowledge/knowledge_wave2.test.ts` (loopback block, IMDS block, valid URL parse).
7. **Browser Test:** `tests/e2e/pr5_knowledge.spec.ts` (attempts `169.254.169.254`, displays SSRF error banner).
8. **Negative Tests:** Non-http schemes (`file://`, `gopher://`), localhost alias variants, non-HTML responses.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Dynamic single-page applications requiring heavy client-side JavaScript execution are read in fallback mode.

### F24 — Bounded Multi-Source Research Workflow
1. **User Problem:** Complex questions require synthesizing information across internal project files and live web search without hallucinations or runaway costs.
2. **Implemented Solution:** `researchWorkflow.ts` coordinates bounded search across project knowledge chunks and authenticated web search, validating citations and synthesizing grounded answers.
3. **Source Files:** `src/services/researchWorkflow.ts`, `src/components/ChatInterface.tsx`.
4. **Database/API Changes:** None.
5. **Security:** External search credentials read securely; zero fabricated citations.
6. **Unit Tests:** `tests/knowledge/knowledge_wave2.test.ts` (source synthesis, attribution validation).
7. **Browser Test:** `tests/e2e/pr5_knowledge.spec.ts` (research mode toggle in routing bar).
8. **Negative Tests:** Empty query, missing search credentials, zero retrieved sources.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Web search bound by user's search provider quota.

### F25 — Multi-Document Analysis & Comparison
1. **User Problem:** Users need to compare versions of contracts, specifications, or code files side-by-side to detect drift and differences.
2. **Implemented Solution:** `multiDocComparison.ts` computes Jaccard vocabulary similarity, length delta, unique keyword divergence, and injects a structured comparative prompt into the chat.
3. **Source Files:** `src/services/multiDocComparison.ts`, `src/components/DocumentComparisonModal.tsx`, `src/components/ChatInputComposer.tsx`.
4. **Database/API Changes:** None.
5. **Security:** Content comparison executed locally; no data leaves the browser until prompt submission.
6. **Unit Tests:** `tests/knowledge/knowledge_wave2.test.ts` (identical doc similarity = 1.0, disjoint doc similarity = 0.0).
7. **Browser Test:** `tests/e2e/pr5_knowledge.spec.ts` (compares two texts, verifies similarity metrics).
8. **Negative Tests:** Empty inputs, single document comparison, binary files.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Uses token-level Jaccard similarity; not a replacement for full AST semantic diffs.

### F26 — Voice Dictation (STT)
1. **User Problem:** Typing lengthy queries on desktop or mobile can be slow and inaccessible.
2. **Implemented Solution:** `voiceDictationService.ts` integrates browser Web Speech API with explicit permission handling, recording indicators, and direct composer population for manual editing before send.
3. **Source Files:** `src/services/voiceDictationService.ts`, `src/components/ChatInputComposer.tsx`, `src/components/ChatInterface.tsx`.
4. **Database/API Changes:** None.
5. **Security:** Explicit microphone permission check; never records in background or auto-submits audio.
6. **Unit Tests:** `tests/multimodal/multimodal_wave2.test.ts` (lifecycle, interim transcript handling, cancel cleanup).
7. **Browser Test:** `tests/e2e/pr6_multimodal.spec.ts` (toggles recording state from composer).
8. **Negative Tests:** Microphone access denied, unsupported browser platform, silent audio.
9. **Deployment Prerequisites:** None (HTTPS required in production for browser microphone access).
10. **Limitations:** Browser Web Speech API availability varies in non-Chromium headless environments.

### F27 — Read-Aloud Responses (TTS)
1. **User Problem:** Reading lengthy responses during multitasking or hands-free scenarios is difficult.
2. **Implemented Solution:** `ttsPlaybackService.ts` provides native zero-cost speech synthesis with accessible Play/Pause/Stop toolbar controls and markdown cleanup.
3. **Source Files:** `src/services/ttsPlaybackService.ts`, `src/components/MessageActionToolbar.tsx`.
4. **Database/API Changes:** None.
5. **Security:** Native browser synthesis; no audio data sent to third parties; no voice cloning.
6. **Unit Tests:** `tests/multimodal/multimodal_wave2.test.ts` (play/pause/stop lifecycle, markdown strip).
7. **Browser Test:** `tests/e2e/pr6_multimodal.spec.ts` (verifies toolbar controls on assistant messages).
8. **Negative Tests:** Empty message reading, synthesis failure handling.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Voice selection dependent on operating system installed TTS voice packs.

### F28 — BYOK Image Generation
1. **User Problem:** Users need image generation alongside text models using their own API keys with clear cost transparency.
2. **Implemented Solution:** `imageGenerationService.ts` and `ImageGenerationModal.tsx` support DALL-E 3, DALL-E 2, Flux 1 Schnell, Flux 1 Dev, and Stable Diffusion 3 Medium with explicit cost disclosure and confirmation. Images render with download buttons and cost records.
3. **Source Files:** `src/services/imageGenerationService.ts`, `src/components/ImageGenerationModal.tsx`, `src/components/ChatMessageItem.tsx`.
4. **Database/API Changes:** Stored in `messages.metadata` JSONB.
5. **Security:** Requires explicit opt-in confirmation; enforces BYOK credentials; zero fabricated outputs.
6. **Unit Tests:** `tests/multimodal/multimodal_wave2.test.ts` (pricing calculations, prompt validation, mock mode).
7. **Browser Test:** `tests/e2e/pr6_multimodal.spec.ts` (prompt configuration, preview rendering, cost badge).
8. **Negative Tests:** Missing API key, empty prompt, API network error, unsupported aspect ratio.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Does not support interactive image-to-image inpainting or outpainting.

### F29 — Editable Generated Artifacts & Sandboxed Previews
1. **User Problem:** Code, Markdown, and HTML generated in chat is hard to isolate, edit, version, and preview safely.
2. **Implemented Solution:** `artifactService.ts` extracts code/document blocks into standalone artifacts. `ArtifactViewerModal.tsx` provides code editing, version history, file export, and sandboxed iframe previews.
3. **Source Files:** `src/services/artifactService.ts`, `src/components/ArtifactViewerModal.tsx`, `src/components/ChatMessageItem.tsx`.
4. **Database/API Changes:** None.
5. **Security:** Sandboxed preview uses `<iframe sandbox="allow-scripts">` without `allow-same-origin`, preventing untrusted scripts from accessing cookies, localStorage, Supabase auth tokens, or parent DOM.
6. **Unit Tests:** `tests/multimodal/multimodal_wave2.test.ts` (extraction, version tracking, file extensions, HTML escaping).
7. **Browser Test:** `tests/e2e/pr6_multimodal.spec.ts` (extracts artifact, opens modal, verifies editor).
8. **Negative Tests:** XSS payloads in code blocks, corrupted code fences, version restore drift.
9. **Deployment Prerequisites:** None.
10. **Limitations:** Does not include a full server-side containerized code execution sandbox.

### F30 — Installable PWA & Mobile Continuity
1. **User Problem:** Web workspace lacks installability on desktop/mobile and fails ungracefully when internet connectivity drops.
2. **Implemented Solution:** Complete PWA with `manifest.webmanifest`, service worker (`sw.js`) precaching the app shell, online/offline status banner, install prompt listeners, and viewport safe area handling.
3. **Source Files:** `public/manifest.webmanifest`, `public/sw.js`, `src/services/pwaService.ts`, `src/components/ChatInterface.tsx`, `index.html`.
4. **Database/API Changes:** None.
5. **Security:** Service worker strictly excludes API, Supabase, and provider endpoints from caching; never caches unencrypted private conversations offline.
6. **Unit Tests:** `tests/multimodal/multimodal_wave2.test.ts` (online status listener, install prompt handler).
7. **Browser Test:** `tests/e2e/pr6_multimodal.spec.ts` (manifest links, offline banner visibility).
8. **Negative Tests:** Reconnection race conditions, service worker registration failures.
9. **Deployment Prerequisites:** HTTPS domain required for service worker and PWA installability.
10. **Limitations:** Live AI model inference is unavailable offline (truthfully disclosed via offline banner).
