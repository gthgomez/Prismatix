import {
  memoryRpc,
  type MemoryRpcClient,
  type SourceMessage,
  validateExtractedFacts,
} from '../_shared/memory_contract.ts';
import { readEnv } from './runtime.ts';
export interface MemoryJob {
  id: string;
  conversation_id: string;
  attempts: number;
  lease_token: string;
  window_end_id: string;
  messages: SourceMessage[];
}
export interface WorkerDeps {
  extract?: (job: MemoryJob) => Promise<string>;
  getEnv?: (name: string) => string | undefined;
}
export async function runMemoryJobs(
  client: MemoryRpcClient,
  subject: string,
  deps: WorkerDeps = {},
): Promise<void> {
  let extract = deps.extract;
  for (let n = 0; n < 2; n++) {
    const raw = await memoryRpc(client, 'memory_claim', { p_subject_id: subject });
    if (!raw) return;
    const job = raw as MemoryJob;
    try {
      let facts: ReturnType<typeof validateExtractedFacts> = [];
      if (job.messages.some((m) => m.role === 'user' && m.content.trim())) {
        if (!extract) {
          const { createMemoryExtractor } = await import('./provider.ts');
          extract = await createMemoryExtractor(client, subject, deps.getEnv ?? readEnv);
        }
        facts = validateExtractedFacts(await extract(job), job.messages);
      }
      await memoryRpc(client, 'memory_complete', {
        p_subject_id: subject,
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_end_id: job.window_end_id,
        p_facts: facts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const deferred = [
        'memory_budget_deferred',
        'memory_provider_unavailable',
        'memory_not_enabled',
      ].includes(message);
      const code = deferred ? message : 'memory_extraction_failed';
      await memoryRpc(client, 'memory_fail', {
        p_subject_id: subject,
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_error: code,
        p_deferred: deferred,
      });
      // Never retry a paid failure twice in the same invocation.
      return;
    }
  }
}
