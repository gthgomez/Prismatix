import { expect, it, vi } from "vitest";
import { fetchRelevantMemories, memoryAvailabilityContext } from "../../supabase/functions/router/memory_helpers";
it('explains asynchronous saving only when memory is enabled', () => {
  expect(memoryAvailabilityContext(false)).toBe('');
  expect(memoryAvailabilityContext(true)).toContain('persistent memory is enabled');
  expect(memoryAvailabilityContext(true)).toContain('after this reply');
  expect(memoryAvailabilityContext(true)).toContain('Do not claim a save has completed');
});
it("searches meaningful Unicode terms without requiring every prompt word", async () => {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  await fetchRelevantMemories(
    { rpc },
    "subject",
    "What do you remember about my café project?",
  );
  expect(rpc).toHaveBeenCalledWith(
    "memory_search",
    expect.objectContaining({ p_query: '"café" OR "project"' }),
  );
});
it("does not retrieve unrelated records for a stopword-only prompt", async () => {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  expect(
    (await fetchRelevantMemories(
      { rpc },
      "subject",
      "What do you remember about me?",
    )).hits,
  ).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});
