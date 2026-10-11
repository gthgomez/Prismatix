// Memory retrieval and enqueue share the authenticated endpoint/tool contracts.
import {
  buildMemoryContext,
  executeMemoryTool,
  memoryRpc,
  type MemoryRpcClient,
} from "../_shared/memory_contract.ts";
export interface MemoryRetrievalResult {
  contextBlock: string;
  hits: number;
  tokenCount: number;
}
export function memoryAvailabilityContext(enabled: boolean): string {
  return enabled
    ? 'Prismatix persistent memory is enabled for this account. The application processes saved USER messages for durable facts after this reply, subject to budget and processing success. Retrieval tools are read-only; their lack of write access does not mean persistent memory is unavailable. Do not claim a save has completed during this reply. Explain that it can be saved asynchronously and that the Memory panel confirms saved records and processing status.'
    : '';
}
export async function fetchRelevantMemories(
  client: MemoryRpcClient,
  subject: string,
  query: string,
): Promise<MemoryRetrievalResult> {
  const stopwords = new Set(
    "a an the i me my we our you your is are was were do does did what which who when where how about for from to of in on at and or it this that please remember recall previous earlier have has can could would tell"
      .split(" "),
  );
  const terms = [
    ...new Set(
      (query.slice(0, 512).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
        .filter((term) => term.length > 1 && !stopwords.has(term)),
    ),
  ].slice(0, 16);
  if (terms.length === 0) return buildMemoryContext([]);
  const items = await executeMemoryTool(client, subject, "search_memory", {
    query: terms.map((term) => `"${term}"`).join(" OR ").slice(0, 512),
    limit: 8,
  });
  return buildMemoryContext(items);
}
export async function enqueueMemoryJob(
  client: MemoryRpcClient,
  subject: string,
  conversation: string,
): Promise<void> {
  await memoryRpc(client, "memory_enqueue", {
    p_subject_id: subject,
    p_conversation_id: conversation,
  });
}
