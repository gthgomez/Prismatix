-- PX09: Containment and provenance alignment
--
-- Drop client INSERT / UPDATE policies on user_memories.
-- Memories are extracted and persisted exclusively by the router edge function
-- (memory_helpers.ts) using the service_role key. Dropping direct client write
-- permissions prevents authenticated users from injecting forged memory
-- context into future prompt windows via PostgREST.
-- SELECT and DELETE policies remain active for user privacy and ownership.

drop policy if exists user_memories_insert_own on public.user_memories;
drop policy if exists user_memories_update_own on public.user_memories;
