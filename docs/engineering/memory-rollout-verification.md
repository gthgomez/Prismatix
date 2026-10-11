# Memory rollout verification — 2026-10-11

## Verified implementation

- Full local suite: 604 tests passed across 62 files on implementation commit 0895b1f. Final publication changes only align the migration filename and update documentation.
- Typecheck, production build, lint (zero errors), Deno router/memory checks, and enforced stale-model coupling gate passed. The gate budget was unchanged; a new retired-provider reference found by CI was removed.
- Database fixture transaction passed real authenticated-role RLS, service-only RPC privilege, old/Unicode/no-match retrieval, pagination, exclusive lease, timestamp/UUID cursor, validated user quotation, atomic source commit, forget suppression and source deletion assertions. Transaction rolled back.
- Applied migration version: 20261011045239. Repository filename matches the recorded version. Original legacy summaries remain preserved and labelled unverified.
- Memory and router functions deployed with JWT validation. Unauthenticated memory GET returned 401.

## Verified live behavior

- OpenCode and OpenRouter extraction saved facts from durable user messages.
- Different fresh chats recalled the same saved project color through OpenCode GPT-6 Luna and OpenRouter Gemini 3.8 Flash.
- OpenRouter Haiku performed a native search_memory call and continued with a grounded answer and memory ID; both dispatches settled from reported usage.
- Production controls: search, manual remember, source navigation, correction, forget, pause and restore.
- Fresh chat recalled the corrected value; after forgetting it, another fresh chat reported not found. Database lookup independently confirmed exclusion.
- Synthetic memory records were forgotten after tests. Memory is enabled; configured default OpenCode and automatic routing restored.
- Extraction is separately admitted with a $0.025 maximum; live tests remain within the owner-approved total limit. Missing-usage tests retain pending accounting rather than reporting a fabricated settlement.

## Scope and pending integration

- Indexed lexical retrieval; embeddings and unbounded historical extraction are deferred.
- Native tools require supported gateway Chat Completions, explicit recall intent and affordable bounded continuations. Other protocols use automatic retrieval; mobile chat remains isolated.
- Unfinished extraction resumes on subsequent turns or explicit Retry; no indefinite paid background loop.
- Independent review waived by owner. PR32 awaits CI runner allocation and merge; post-merge release identity will be verified.
