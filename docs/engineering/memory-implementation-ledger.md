# Memory implementation ledger

Plan: docs/superpowers/plans/2026-10-10-reliable-user-memory.md
Base: cf48e2523624e5fe9b14fc0f41dff9105937e856

User approved design and requested implementation. Executing inline in isolated clone on feat/reliable-user-memory. Review waiver preserved. Deletion default uses last-source forget, configurable; no existing memories deleted. Native tools limited to gateway Chat Completions; automatic recall covers other protocols. No embeddings/source-passage search in this increment. No repeated design approval required by user's explicit implementation instruction.

Task 1: complete. Contracts RED missing module -> GREEN 3/3. SQL missing RPC RED -> migration+fixtures transaction: memory_storage_assertions_passed, rollback. Actual authenticated-role RLS and RPC privileges verified. Complete source/cursor transaction rejects assistant claims without progress, exclusive lease, Unicode old-match/no-match, forget suppression, last-source deletion and pause tested.
Ruling: repair live messages_conversation_id_fkey to ON DELETE CASCADE — canonical schema/UI already expect this; transaction test exposed live NO ACTION drift. No existing chats deleted. Rollback requires restoring NO ACTION before reverting dependent tables; existing memory originals remain.
Task 2: in progress.
