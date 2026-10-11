// Memory retrieval and enqueue share the authenticated endpoint/tool contracts.
import {
  buildMemoryContext,
  executeMemoryTool,
  memoryRpc,
  type MemoryRpcClient,
} from '../_shared/memory_contract.ts';
export interface MemoryRetrievalResult {
  contextBlock: string;
  hits: number;
  tokenCount: number;
}
export async function fetchRelevantMemories(
  client: MemoryRpcClient,
  subject: string,
  query: string,
): Promise<MemoryRetrievalResult> {
  const items = await executeMemoryTool(client, subject, 'search_memory', {
    query: query.slice(0, 512),
    limit: 8,
  });
  return buildMemoryContext(items);
}
export async function enqueueMemoryJob(
  client: MemoryRpcClient,
  subject: string,
  conversation: string,
): Promise<void> {
  await memoryRpc(client, 'memory_enqueue', {
    p_subject_id: subject,
    p_conversation_id: conversation,
  });
}
