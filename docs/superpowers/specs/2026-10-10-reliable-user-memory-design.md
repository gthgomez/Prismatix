# Reliable user memory design

Approved scope: account memory across chats/model switches, structured evidence, whole-corpus retrieval, read-only LLM tools, reliable extraction, owner controls. Execute inline per user request; independent review remains waived.

## Contracts

Supabase messages remain authoritative. Add public.memory_items, memory_sources, memory_settings and internal memory_jobs, with owner-scoped reads and server-only writes. Preserve 38 legacy summaries by copying into labelled legacy items. Use simple-config full-text search/GIN, Unicode-preserving text, up to eight hits and a 1,500-token context limit; no unrelated fallback. Expired, forgotten and superseded facts never enter recall.

Expose authenticated memory endpoint actions status/list/search_memory/read_memory/settings/remember/correct/forget/retry. Identity is always server-bound. LLM receives search_memory and read_memory only; schemas disallow extra identity/SQL/URL fields. Native tool loops initially support OpenRouter Chat Completions and OpenCode Chat Completions; other protocols retain automatic recall. At most two tool invocations per turn; final answer remains normalized SSE. Every provider dispatch has a ledger row and conservative budget admission.

Extract JSON facts grounded in exact saved user-message quotations. Validate source IDs/quotes, kind and bounds. Do not extract assistant-only claims. Durable jobs lease an ordered source window, retry at most three provider attempts, keep error state, and atomically commit sources/items/cursor. Cursor uses timestamp plus UUID tie-break. New completed turns resume jobs; Memory panel offers retry. waitUntil keeps in-flight background work alive; persisted jobs survive runtime loss. No paid bulk historical backfill. Extraction uses saved enabled gateway and resolved key; separate budget admission and reported usage settlement.

Remember/correct/forget are explicit user controls. Corrections supersede previous item. Forgotten sources cannot be re-extracted. Deletion forgets derived items only when their last source is deleted by default; a user setting may retain them. Existing raw conversations/summaries stay intact during migration. Disable pauses read/extraction. Mobile server-memory bypass remains.

Enable only owner's chat+memory grant after deployment and live checks; preserve $1/day and $0.10/request limits. Keep total live probes within previously authorized $1 budget. No embeddings or source-passage search in this increment.

## Acceptance

Old memory beyond newest24 found; no-match empty; Unicode supported; citations returned. Owner isolation and tool validation. Source-grounded extraction, atomic failure, concurrent leases, cursor ties, forget/retry/deletion races. Configured Go/OR extraction with settled usage; budget denied means zero provider calls. Native tool rounds bounded and never leaked into answer text. UI controls and honest job/status errors. Fresh-chat recall with model switch, correction, forget; full tests/typecheck/build/Deno/lint/audit.
