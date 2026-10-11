// Historic models remain addressable for explicit manual selection only.
export const HISTORIC_MODEL_IDS: ReadonlySet<string> = new Set([
  'deepseek-v4-flash', 'deepseek-v4-flash-free',
  'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol',
  'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5',
  'gemini-3.7-flash', 'grok-4.6', 'mimo-v2.5-free',
  'opus-4.6', 'sonnet-4.6', 'haiku-4.5',
  'gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-pro',
]);

export function isHistoricModel(modelId: string): boolean {
  return HISTORIC_MODEL_IDS.has(modelId);
}
