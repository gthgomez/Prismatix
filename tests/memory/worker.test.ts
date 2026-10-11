import { describe, expect, it, vi } from 'vitest';
import { runMemoryJobs } from '../../supabase/functions/memory/worker';
const subject = '11111111-1111-4111-8111-111111111111';
const source = '22222222-2222-4222-8222-222222222222';
const job = {
  id: 'job',
  conversation_id: 'conv',
  attempts: 1,
  lease_token: 'lease',
  window_end_id: source,
  messages: [{ id: source, role: 'user', content: 'I prefer concise answers.' }],
};
function setup(text = '{"facts":[]}') {
  let claimed = false;
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'memory_claim' && !claimed
      ? (claimed = true, job)
      : name === 'memory_allowed'
      ? true
      : null,
    error: null,
  }));
  const extract = vi.fn(async () => text);
  return { rpc, extract };
}
describe('durable extraction worker', () => {
  it('commits only validated saved-user quotations with the lease and cursor', async () => {
    const f = setup(
      JSON.stringify({
        facts: [{
          kind: 'preference',
          sourceMessageId: source,
          quote: 'I prefer concise answers.',
        }],
      }),
    );
    await runMemoryJobs({ rpc: f.rpc }, subject, { extract: f.extract });
    expect(f.rpc).toHaveBeenCalledWith('memory_complete', {
      p_subject_id: subject,
      p_job_id: 'job',
      p_lease_token: 'lease',
      p_end_id: source,
      p_facts: [{
        kind: 'preference',
        source_message_id: source,
        text: 'I prefer concise answers.',
      }],
    });
  });
  it('records failures durably without advancing the cursor', async () => {
    const f = setup('not json');
    await runMemoryJobs({ rpc: f.rpc }, subject, { extract: f.extract });
    expect(f.rpc.mock.calls.some((c) => c[0] === 'memory_complete')).toBe(false);
    expect(f.rpc).toHaveBeenCalledWith(
      'memory_fail',
      expect.objectContaining({ p_error: 'memory_extraction_failed', p_deferred: false }),
    );
  });
  it('defers budget denial without retry spending or fabricated progress', async () => {
    const f = setup();
    f.extract.mockRejectedValue(new Error('memory_budget_deferred'));
    await runMemoryJobs({ rpc: f.rpc }, subject, { extract: f.extract });
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith(
      'memory_fail',
      expect.objectContaining({ p_error: 'memory_budget_deferred', p_deferred: true }),
    );
  });
  it('does not call a provider when no claim is available', async () => {
    const f = setup();
    f.rpc.mockResolvedValue({ data: null, error: null });
    await runMemoryJobs({ rpc: f.rpc }, subject, { extract: f.extract });
    expect(f.extract).not.toHaveBeenCalled();
  });
});
