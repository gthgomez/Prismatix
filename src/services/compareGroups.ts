interface CompareChild {
  executionId: string;
  assistantMessageId?: string;
  model: string;
  content: string;
  status: 'completed' | 'interrupted' | 'stopped' | 'failed';
  cost?: number;
  costStatus: 'settled' | 'pending' | 'estimated' | 'unknown';
  transcriptSaved: boolean;
}

interface CompareGroup {
  id: string;
  conversationId: string;
  modelA: CompareChild;
  modelB: CompareChild;
}

function parseCompareChild(value: unknown): CompareChild | null {
  if (!value || typeof value !== 'object') return null;
  const child = value as Record<string, unknown>;
  if (typeof child.executionId !== 'string') return null;
  const { status, costStatus, cost } = child;
  return {
    executionId: child.executionId,
    assistantMessageId: typeof child.assistantMessageId === 'string' ? child.assistantMessageId : undefined,
    model: typeof child.model === 'string' ? child.model : 'Unknown model',
    content: typeof child.content === 'string' ? child.content : '',
    status: status === 'completed' || status === 'stopped' || status === 'failed' ? status : 'interrupted',
    costStatus: costStatus === 'settled' || costStatus === 'pending' || costStatus === 'estimated' ? costStatus : 'unknown',
    cost: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined,
    transcriptSaved: child.transcriptSaved === true,
  };
}

export function parseCompareGroup(value: unknown): CompareGroup | null {
  if (!value || typeof value !== 'object') return null;
  const group = value as Record<string, unknown>;
  if (typeof group.id !== 'string' || typeof group.conversationId !== 'string') return null;
  const modelA = parseCompareChild(group.modelA);
  const modelB = parseCompareChild(group.modelB);
  if (!modelA || !modelB || modelA.executionId === modelB.executionId) return null;
  return { id: group.id, conversationId: group.conversationId, modelA, modelB };
}
